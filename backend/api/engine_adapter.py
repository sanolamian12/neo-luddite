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

# ── etype 별칭 정규화 ───────────────────────────────────────────────────────────
# function-calling 의 enum 은 소프트 제약이라 Solar 가 회계 실무에서 더 흔한 표기를
# 그대로 내는 일이 있다(예: '접대비'). 같은 개념이면 엔진 멤버명으로 돌려놓는다.
# 개념이 다른 값(대손금·이자비용 등)은 여기 넣지 말 것 — 규칙이 없으므로 안내로 빠져야 한다.
_ETYPE_ALIASES = {
    "접대비": "접대성지출", "접대": "접대성지출", "기업업무추진비": "접대성지출",
    "광고비": "광고선전비", "광고선전": "광고선전비", "판촉비": "광고선전비",
    "차량유지비": "업무용승용차", "차량비": "업무용승용차", "업무용차량": "업무용승용차",
    "복리후생": "복리후생비", "통신": "통신비",
    "임차": "임차료", "임대료": "임차료", "지급임차료": "임차료",
    "출장": "출장비", "여비교통비": "출장비", "해외출장비": "출장비",
    "소프트웨어": "소프트웨어구독", "SW구독": "소프트웨어구독", "구독료": "소프트웨어구독",
    "가사비": "가사관련비", "가사경비": "가사관련비",
}


def normalize_etype(extracted: dict) -> dict:
    """추출된 etype 을 엔진 멤버명으로 정규화(별칭·공백 흡수). 원본 dict 를 수정해 돌려준다."""
    raw = extracted.get("etype")
    if not isinstance(raw, str):
        return extracted
    key = raw.strip().replace(" ", "")
    if key not in _EXPENSE_TYPES:
        key = _ETYPE_ALIASES.get(key, key)
    extracted["etype"] = key
    return extracted


# ── 판정 결정변수(swing factors) ────────────────────────────────────────────────
# 엔진 dataclass 의 기본값(False / ratio 1.0)은 "사용자가 말한 적 없는 사실"이다.
# 그대로 판정하면 추출기가 필드를 채웠는지 여부에 따라 같은 질문의 판정이 뒤집힌다
# (접대성지출: 미채움→부인 / 채움→조건부). 그래서 규칙이 실제로 분기에 쓰는 값이
# 대화에 없으면 판정하지 않고 되묻는다 — 판정은 오직 "사용자가 말한 사실"의 함수다.
#
# 규칙의 분기 구조를 따라가며 지금 당장 필요한 값만 고른다(불필요한 질문 방지).
# 예: 승용차특례대상=False 면 즉시 전부인정이므로 운행기록부는 묻지 않는다.

_GATE_FIELDS = ("has_qualified_receipt", "in_business_name")

# 어떤 규칙에서든 판정을 가르는 값들의 합집합. 추출기가 이 필드를 채웠다면 "사용자가 실제로
# 말했는가"를 한 번 더 검증한다(llm.verify_decisive) — 프롬프트로 '추측 금지'를 지시해도
# 모델은 상식으로 값을 지어낸다(실측: 학회 질문에 공식일정증빙=false 를 날조 → 부인).
DECISIVE_FIELDS = _GATE_FIELDS + (
    "business_use_ratio", "승용차특례대상", "업무전용보험", "운행기록부",
    "상대방_거래처", "상대방_기록보유", "불특정다수", "인당금액",
    "전직원_수혜", "사규근거", "공식일정증빙", "동반가족", "별도사업장등록",
)


def _has(extracted: dict, key: str) -> bool:
    return extracted.get(key) is not None


def missing_decisive(extracted: dict, profile_hint: Optional[dict] = None) -> list[str]:
    """rule_* 의 분기에 실제로 쓰이는 값 중 대화에서 확인되지 않은 것들.

    반환이 비어야만 엔진을 돌린다. 비어있지 않으면 pipeline 이 한 번에 되묻는다.
    """
    etype = extracted.get("etype")
    if etype not in _EXPENSE_TYPES:
        return []

    need: list[str] = [k for k in _GATE_FIELDS if not _has(extracted, k)]

    def want(*keys: str) -> None:
        need.extend(k for k in keys if not _has(extracted, k))

    if etype == "업무용승용차":
        want("승용차특례대상")
        if extracted.get("승용차특례대상") is False:
            return need                                   # → 전부인정, 더 물을 것 없음
        p = profile_hint or {}
        if p.get("성실신고확인대상") or p.get("biz_type") == "의료법인":
            want("업무전용보험")
            if extracted.get("업무전용보험") is False:
                return need                               # → 전액 부인
        want("운행기록부")
        if extracted.get("운행기록부"):
            want("business_use_ratio")                    # 기록 있으면 비율로 안분
    elif etype == "접대성지출":
        want("상대방_거래처", "상대방_기록보유")
    elif etype == "광고선전비":
        want("불특정다수")
        if extracted.get("불특정다수"):
            want("인당금액")                              # 3만원 기준으로 갈림
    elif etype == "복리후생비":
        want("전직원_수혜", "사규근거")
    elif etype == "출장비":
        want("공식일정증빙")
        if extracted.get("공식일정증빙") is False:
            return need                                   # → 개인여행 부인
        want("동반가족", "business_use_ratio")
    elif etype == "가사관련비":
        want("별도사업장등록")
        if extracted.get("별도사업장등록"):
            return need                                   # → 원칙적 부인
        want("business_use_ratio")
    elif etype in ("임차료", "통신비", "소프트웨어구독"):
        want("business_use_ratio")                        # _ratio_result 전용 규칙

    return need


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
            # '기타' 는 엔진 멤버가 아니라 탈출구다. 이게 없으면 모델은 규칙 없는 지출
            # (대손금·이자비용 등)을 억지로 9개 유형에 끼워맞춘다(실측: 대손금 → 접대성지출
            # → '부인' 오판정). run_clinic 이 SUPPORTED_ETYPES 로 걸러 안내로 전환한다.
            "type": "string", "enum": _EXPENSE_TYPES + ["기타"],
            "description": (
                "지출 항목 유형. **먼저 아래 9개 유형 중 가장 가까운 것을 고르세요.**\n"
                "· 업무용승용차: 차량 구입·리스·유지비(G80, 경차 등)\n"
                "· 임차료: 오피스텔·휴게공간·부동산 임차\n"
                "· 접대성지출: 골프·식사·선물 등 특정 거래처 접대\n"
                "· 광고선전비: 병원 홍보·마케팅·판촉. 온라인 광고비(구글·메타·인스타), "
                "인플루언서 협찬·무료시술 후기, 불특정다수 대상 사은품 포함\n"
                "· 통신비: 휴대폰·인터넷 회선\n"
                "· 복리후생비: 직원 대상 헬스장·회원권·경조사·떡값\n"
                "· 출장비: 학회·세미나·해외연수·전시회 참석\n"
                "· 소프트웨어구독: AI·SaaS·SW 구독료(원장 개인사용 여부와 무관하게 이 유형)\n"
                "· 가사관련비: 자택 사무공간·자택 관리비\n"
                "'기타'는 **마지막 수단**입니다. 위 9개 중 어느 것과도 성격이 다른 경우에만 쓰세요 "
                "— 예: 대손금·이자비용·세액공제·4대보험·부가세·퇴직금·노무분쟁 합의금·자산 폐기손실 "
                "같이 '지출 유형' 자체가 목록과 무관한 사안. 비슷한 유형이 하나라도 있으면 그걸 고르세요."
            ),
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
