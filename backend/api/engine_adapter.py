"""
Deterministic bridge between the LLM and `clinic_expense_engine`.

Two deterministic halves of the hybrid pipeline (docs API 계약 §2.5, steps ②⑤):
  · build_extraction_tool()      — the function-calling schema Solar fills (step ①)
  · to_engine_inputs()           — extracted dict → ClinicProfile / ExpenseInput
  · result_to_ui_blocks()        — ExpenseResult → verdict_card + evidence_checklist (step ⑤)

The engine is the authoritative source of the verdict (hallucination guard):
Solar never decides 인정/부인 — it only writes prose around this result.
"""

from __future__ import annotations

from dataclasses import fields
from typing import Optional

import clinic_expense_engine as eng
from api.schema import ChecklistItem, EvidenceChecklist, VerdictCard

# ── etype label ↔ ExpenseType member ────────────────────────────────────────────
# The frontend/engine use Korean enum member NAMES; the .value carries a spaced /
# descriptive label. We bridge on member name so both sides stay in sync.

_EXPENSE_TYPES = [t.name for t in eng.ExpenseType]      # 업무용승용차, 임차료, ...
_BIZ_TYPES = [t.name for t in eng.BizType]              # 개인의원, 의료법인

# 엔진이 판정 규칙을 가진 지출유형(런타임 가드에서 참조). function-calling 의 enum 은
# 소프트 제약이라 Solar 가 목록 밖 값(예: '이자비용')을 낼 수 있다 → run_clinic 이
# 이 집합으로 걸러 크래시 대신 우아한 안내로 전환한다.
SUPPORTED_ETYPES = _EXPENSE_TYPES

# fields the engine accepts, split by target dataclass
_PROFILE_FIELDS = {f.name for f in fields(eng.ClinicProfile)}
_EXPENSE_FIELDS = {f.name for f in fields(eng.ExpenseInput)}

# minimal fields required before the engine can produce a verdict.
# Missing → the pipeline asks a follow-up instead of guessing.
REQUIRED_FOR_VERDICT = ("etype", "amount")


def build_extraction_tool() -> dict:
    """OpenAI/Upstage function-calling tool schema Solar uses to extract engine inputs.

    Field names match the engine dataclasses exactly so extraction maps 1:1.
    Only etype+amount are required; every other field defaults in the dataclass.
    """
    props = {
        # ── ClinicProfile (공통 전제) ──
        "biz_type": {
            "type": "string", "enum": _BIZ_TYPES,
            "description": "사업자 유형. 개인의원(필요경비) 또는 의료법인(손금). 미상이면 생략(기본 개인의원).",
        },
        "복식부기": {"type": "boolean", "description": "복식부기 의무자 여부(기본 true)."},
        "성실신고확인대상": {
            "type": "boolean",
            "description": "성실신고확인대상 여부. 업무용승용차 업무전용보험 의무 등에 영향(기본 false).",
        },
        # ── ExpenseInput (지출) ──
        "etype": {
            "type": "string", "enum": _EXPENSE_TYPES,
            "description": "지출 항목 유형. 골프·명품접대=접대성지출, 불특정다수 판촉=광고선전비, "
                           "차량=업무용승용차, 헬스장·회원권=복리후생비, 휴대폰=통신비, "
                           "학회·해외출장=출장비, AI·SW구독=소프트웨어구독, 자택사무=가사관련비, 오피스텔=임차료.",
        },
        "amount": {"type": "integer", "description": "지출 금액(연액, 원). 사용자가 밝힌 액수."},
        "in_business_name": {"type": "boolean", "description": "사업자 명의 지출 여부(기본 true)."},
        "has_qualified_receipt": {
            "type": "boolean",
            "description": "적격증빙(세금계산서·카드·현금영수증) 보유 여부(기본 true).",
        },
        "business_use_ratio": {
            "type": "number",
            "description": "업무사용비율 0.0~1.0. 안분 판단 핵심값. 미상이면 생략.",
        },
        # 차량
        "운행기록부": {"type": "boolean", "description": "운행기록부 작성 여부(업무용승용차)."},
        "업무전용보험": {"type": "boolean", "description": "업무전용자동차보험 가입 여부."},
        "승용차특례대상": {
            "type": "boolean",
            "description": "업무용승용차 특례 대상 여부. 경차·화물·9인승↑이면 false(전액 가능).",
        },
        # 접대/광고
        "상대방_거래처": {"type": "boolean", "description": "접대 동반/수령자가 사업관련 거래처인가."},
        "상대방_기록보유": {"type": "boolean", "description": "접대 상대방·목적 기록 보유 여부."},
        "인당금액": {"type": "integer", "description": "1인당 금액(원). 광고선전 vs 접대비 구분(3만원 기준)."},
        "불특정다수": {"type": "boolean", "description": "불특정 다수 대상(광고선전비 성격)인가."},
        # 복리후생
        "전직원_수혜": {"type": "boolean", "description": "전 직원 대상인가(원장 단독 아님)."},
        "사규근거": {"type": "boolean", "description": "복리후생 사내규정 존재 여부."},
        # 출장
        "공식일정증빙": {"type": "boolean", "description": "학회·세미나 등록증 등 공식일정 증빙 보유."},
        "동반가족": {"type": "boolean", "description": "출장에 가족 동반 여부."},
        # 가사관련
        "별도사업장등록": {"type": "boolean", "description": "자택과 분리된 사업장 별도 존재 여부."},
    }
    return {
        "type": "function",
        "function": {
            "name": "extract_clinic_expense",
            "description": "병의원 원장의 비용처리 상담 대화에서 규칙엔진 입력값을 추출한다. "
                           "대화에서 확인된 값만 채우고, 확인되지 않은 필드는 넣지 말 것(추측 금지).",
            "parameters": {
                "type": "object",
                "properties": props,
                "required": ["etype", "amount"],
            },
        },
    }


def missing_required(extracted: dict) -> list[str]:
    """Return required keys not present (or null) in the extracted dict."""
    return [k for k in REQUIRED_FOR_VERDICT
            if extracted.get(k) is None]


def to_engine_inputs(extracted: dict) -> tuple[eng.ClinicProfile, eng.ExpenseInput]:
    """Map a validated extraction dict → (ClinicProfile, ExpenseInput).

    Assumes missing_required() already passed. Unknown keys are ignored;
    only keys matching a dataclass field are forwarded.
    """
    profile_kwargs = {}
    # enum 은 member NAME 으로 브리지. Solar 가 enum 밖 값을 내도 KeyError 로 500 나지 않게
    # 유효한 멤버일 때만 반영(무효면 dataclass 기본값 = 개인의원).
    if extracted.get("biz_type") in _BIZ_TYPES:
        profile_kwargs["biz_type"] = eng.BizType[extracted["biz_type"]]
    for k in ("복식부기", "성실신고확인대상"):
        if extracted.get(k) is not None:
            profile_kwargs[k] = extracted[k]

    expense_kwargs = {"etype": eng.ExpenseType[extracted["etype"]],
                      "amount": int(extracted["amount"])}
    for k in _EXPENSE_FIELDS - {"etype", "amount"}:
        if extracted.get(k) is not None:
            expense_kwargs[k] = extracted[k]

    return eng.ClinicProfile(**profile_kwargs), eng.ExpenseInput(**expense_kwargs)


def result_to_ui_blocks(result: eng.ExpenseResult,
                        amount: int) -> tuple[VerdictCard, Optional[EvidenceChecklist]]:
    """ExpenseResult → deterministic uiBlocks (verdict is engine-authoritative).

    verdict enum bridges on member NAME: engine `Verdict.전부인정` → frontend "전부인정".
    """
    won = f"{result.인정금액:,}"
    total = f"{amount:,}"
    card = VerdictCard(
        verdict=result.verdict.name,          # "전부인정" | "안분인정" | "부인" | "조건부"
        title=f"{result.verdict.value} · 인정 {won}/{total}원 (리스크 {result.리스크점수}/100)",
        summary=result.근거,
    )
    checklist = None
    if result.필요증빙:
        checklist = EvidenceChecklist(
            title="필요 증빙",
            items=[ChecklistItem(label=str(x), required=True) for x in result.필요증빙],
        )
    return card, checklist
