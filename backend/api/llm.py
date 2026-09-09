"""
Upstage Solar client — the LLM half of the hybrid pipeline (docs API 계약 §2.5, steps ①④).

Upstage is OpenAI-compatible, so we drive it through the `openai` SDK with a
base_url override. Two responsibilities:
  · extract_engine_inputs() — function-calling extraction of engine inputs (step ①)
  · write_segments()        — writes natural-language argument segments grounded on
                              the engine's authoritative result (step ④)

The LLM NEVER decides the verdict; it only extracts inputs and writes prose.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import get_args

from openai import OpenAI

from api.schema import Framework, SegmentType

_SEGMENT_TYPES = list(get_args(SegmentType))
_FRAMEWORKS = list(get_args(Framework))


@lru_cache(maxsize=1)
def get_client() -> OpenAI:
    key = os.environ.get("UPSTAGE_API_KEY")
    if not key:
        raise RuntimeError(
            "UPSTAGE_API_KEY is not set. Copy backend/.env.example → backend/.env "
            "and fill the Upstage key (see memory reference_upstage_api)."
        )
    base_url = os.environ.get("UPSTAGE_BASE_URL", "https://api.upstage.ai/v1")
    return OpenAI(api_key=key, base_url=base_url)


def _chat_model() -> str:
    return os.environ.get("UPSTAGE_CHAT_MODEL", "solar-pro3")


def _history_to_messages(history: list) -> list[dict]:
    """Flatten prior Message[] → plain OpenAI chat messages (segment texts joined)."""
    out = []
    for m in history:
        text = " ".join(s.text for s in m.segments)
        if text.strip():
            out.append({"role": m.role, "content": text})
    return out


# ── step ① extraction ───────────────────────────────────────────────────────────

# 결정변수를 '상식적으로 그럴 것 같다'고 채우면 판정이 사용자가 말한 적 없는 사실 위에
# 서게 되고, 같은 질문의 판정이 회차마다 뒤집힌다(실측: 부인↔조건부). 생략은 실패가 아니라
# 정상 경로다 — 파이프라인이 그 값을 사용자에게 되묻는다.
_EXTRACT_SYSTEM = (
    "당신은 병의원 원장의 세무 비용처리 상담 대화를 분석해, 규칙엔진 입력값을 추출하는 도구입니다.\n"
    "규칙:\n"
    "1. 사용자가 대화에서 **명시적으로 말한 사실만** 채웁니다. 말하지 않은 필드는 반드시 생략하세요.\n"
    "2. 추측·추론·상식·일반적 관행으로 값을 채우는 것을 금지합니다. "
    "특히 적격증빙 보유(has_qualified_receipt), 사업자 명의(in_business_name), 업무사용비율(business_use_ratio), "
    "거래처 여부(상대방_거래처), 기록 보유(상대방_기록보유), 전직원 수혜(전직원_수혜), 사규 근거(사규근거), "
    "공식일정 증빙(공식일정증빙), 운행기록부 등 판정을 가르는 값은 "
    "사용자가 직접 언급하지 않았다면 **절대 채우지 마세요**.\n"
    "3. '보통 그렇다', '아마 있을 것이다' 같은 판단으로 true/false 를 넣지 마세요. 모르면 생략입니다.\n"
    "4. 필드를 생략하는 것은 올바른 동작입니다. 생략된 값은 시스템이 사용자에게 다시 물어봅니다."
)


def extract_engine_inputs(history: list, user_text: str, tool: dict) -> dict | None:
    """Run Solar with the extraction tool. Returns the parsed args dict, or None
    if Solar chose not to call the tool (insufficient info)."""
    messages = [{"role": "system", "content": _EXTRACT_SYSTEM}]
    messages += _history_to_messages(history)
    messages.append({"role": "user", "content": user_text})

    resp = get_client().chat.completions.create(
        model=_chat_model(),
        messages=messages,
        tools=[tool],
        tool_choice="auto",
        temperature=0,
    )
    choice = resp.choices[0].message
    if not getattr(choice, "tool_calls", None):
        return None
    try:
        return json.loads(choice.tool_calls[0].function.arguments)
    except (json.JSONDecodeError, TypeError):
        return None


# ── step ④ segment writing ──────────────────────────────────────────────────────

def _emit_segments_tool() -> dict:
    return {
        "type": "function",
        "function": {
            "name": "emit_segments",
            "description": "세무 상담 답변을 문장 단위 세그먼트 배열로 출력한다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "segments": {
                        "type": "array",
                        "minItems": 1,
                        "items": {
                            "type": "object",
                            "properties": {
                                "text": {"type": "string", "description": "한 문장(자연어)."},
                                "type": {"type": "string", "enum": _SEGMENT_TYPES,
                                         "description": "세그먼트 유형(결정문 구조)."},
                                "framework": {"type": "string", "enum": _FRAMEWORKS,
                                              "description": "해석 프레임워크(해당 시에만)."},
                                "citations": {"type": "array", "items": {"type": "string"},
                                              "description": "법령·판례 인용(예: 소득세법 §35, 조심2025구1960)."},
                            },
                            "required": ["text", "type"],
                        },
                    }
                },
                "required": ["segments"],
            },
        },
    }


_WRITE_SYSTEM = (
    "당신은 한국 세무 전문가입니다. 규칙엔진이 내린 판정을 근거로, 병의원 원장에게 설명하는 "
    "논증을 문장 단위 세그먼트로 작성합니다. 규칙:\n"
    "1. 판정(인정/부인/안분/조건부)은 엔진이 이미 결정했습니다 — 절대 뒤집지 말고 그대로 설명하세요.\n"
    "2. 결론(conclusion) → 법리(rule_statement) → 적용(application) → 증빙요구(evidence_request) "
    "→ 단서(caveat) 흐름을 권장합니다.\n"
    "3. 법리·해석 문장에는 적절한 framework와 citations를 태깅하세요(근거 텍스트의 [ ] 인용 활용).\n"
    "4. 반드시 emit_segments 도구로만 출력하세요."
)


def write_segments(user_text: str, verdict_label: str, reason: str,
                   accepted_won: int, amount: int, evidences: list[str],
                   case_refs: list[str], rag_passages: list[str] | None = None) -> list[dict]:
    """Solar writes argument segments grounded on the engine result. Returns
    a list of {text, type, framework?, citations?} dicts (ids assigned later).

    rag_passages: RAG 로 검색된 세무사 코멘트/판례 지식(있으면). 판정은 못 뒤집고,
    법리 설명·인용을 풍부하게 하는 근거로만 쓴다(마스터 §2 — verdict 는 엔진 권위)."""
    rag_block = ""
    if rag_passages:
        joined = "\n\n".join(f"- {p}" for p in rag_passages)
        rag_block = (
            "\n[참고 지식 — 세무사 검수 코멘트·판례에서 검색됨 · 판정 변경 불가, "
            "법리·인용 보강용]\n" + joined + "\n"
        )
    grounding = (
        f"[사용자 질문]\n{user_text}\n\n"
        f"[규칙엔진 판정 — 권위 원천, 뒤집지 말 것]\n"
        f"- 판정: {verdict_label}\n"
        f"- 인정금액: {accepted_won:,} / {amount:,}원\n"
        f"- 근거: {reason}\n"
        f"- 필요증빙: {', '.join(evidences) if evidences else '없음'}\n"
        f"- 참고 판례: {', '.join(case_refs) if case_refs else '없음'}\n"
        f"{rag_block}\n"
        "위 판정을 설명하는 세그먼트를 작성하세요. 참고 지식이 있으면 법리·인용에 반영하세요."
    )
    resp = get_client().chat.completions.create(
        model=_chat_model(),
        messages=[{"role": "system", "content": _WRITE_SYSTEM},
                  {"role": "user", "content": grounding}],
        tools=[_emit_segments_tool()],
        tool_choice={"type": "function", "function": {"name": "emit_segments"}},
        temperature=0.3,
    )
    tool_calls = getattr(resp.choices[0].message, "tool_calls", None)
    if not tool_calls:
        # fallback: single conclusion segment carrying the engine reason
        return [{"text": reason, "type": "conclusion"}]
    try:
        data = json.loads(tool_calls[0].function.arguments)
        segs = data.get("segments") or []
        return segs if segs else [{"text": reason, "type": "conclusion"}]
    except (json.JSONDecodeError, TypeError):
        return [{"text": reason, "type": "conclusion"}]


# ── 자문 경로 (엔진 규칙 밖 + RAG 지식) ────────────────────────────────────────
# 엔진 규칙은 9개 지출유형뿐이라 4대보험·세액공제·대손금 등은 판정할 수 없다. 예전엔
# 여기서 "미지원"만 안내하고 끝냈다 → 세무사 코멘트로 쌓은 KB 가 통째로 사장됐다.
# 이제 판정은 여전히 안 내리되(엔진 권위 — 마스터 §2), 검색된 세무사 코멘트를 근거로
# 자문을 준다. 이 경로가 "RAG 가 답할 수 있는 범위를 넓힌다"는 논지의 증거다.

# 자문에는 판정형 세그먼트(conclusion/application)를 허용하지 않는다. 판정처럼 읽히는
# 문장이 엔진 없이 나가는 순간 엔진 권위 원칙이 깨진다.
_ADVISORY_SEGMENT_TYPES = [
    "context", "issue_framing", "rule_statement", "evidence_request", "caveat", "follow_up",
]


def _emit_advisory_tool() -> dict:
    return {
        "type": "function",
        "function": {
            "name": "emit_segments",
            "description": "세무 자문(판정 아님)을 문장 단위 세그먼트 배열로 출력한다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "segments": {
                        "type": "array",
                        "minItems": 1,
                        "items": {
                            "type": "object",
                            "properties": {
                                "text": {"type": "string", "description": "한 문장(자연어)."},
                                "type": {"type": "string", "enum": _ADVISORY_SEGMENT_TYPES},
                                "framework": {"type": "string", "enum": _FRAMEWORKS},
                                "citations": {"type": "array", "items": {"type": "string"},
                                              "description": "참고 지식에 실제로 등장한 법령·판례만."},
                            },
                            "required": ["text", "type"],
                        },
                    }
                },
                "required": ["segments"],
            },
        },
    }


_ADVISORY_SYSTEM = (
    "당신은 한국 세무 전문가입니다. 이 사안은 **규칙엔진의 판정 대상이 아닙니다**. "
    "따라서 당신은 판정을 내리는 것이 아니라, 검색된 **세무사 검수 코멘트**를 근거로 "
    "참고용 자문을 제공합니다. 규칙:\n"
    "1. **인정/부인/안분/조건부 같은 판정을 단언하지 마세요.** '~로 판단됩니다', '전액 인정됩니다' "
    "같은 확정적 표현 금지. 대신 '유사 사례에서 세무사들은 ~로 보았습니다', "
    "'~인지에 따라 갈립니다' 처럼 자문 어조로 쓰세요.\n"
    "2. **참고 지식에 있는 내용만** 근거로 쓰세요. 참고 지식에 없는 법령·판례·수치를 "
    "지어내지 마세요. 아는 바가 부족하면 '확정적으로 말씀드리기 어렵다'고 하고, "
    "확인이 필요한 사항을 되물으세요.\n"
    "3. 참고 지식이 사용자 질문과 어긋나면 억지로 끼워맞추지 말고, 관련 선례가 부족하다고 "
    "솔직히 밝히세요.\n"
    "4. 반드시 emit_segments 도구로만 출력하세요."
)


def write_advisory(history: list, user_text: str, etype: str | None,
                   rag_passages: list[str]) -> list[dict]:
    """엔진 규칙 밖 질문에 대해, 검색된 세무사 코멘트를 근거로 **판정 없는** 자문 세그먼트를 쓴다.

    호출 전제: passages 가 비어 있지 않다(비면 pipeline 이 기존 '미지원' 안내로 떨어진다).
    반환: [{text, type, framework?, citations?}] — 판정형 type 은 도구 enum 에서 원천 차단.
    """
    joined = "\n\n".join(f"- {p}" for p in rag_passages)
    grounding = (
        f"[사용자 질문]\n{user_text}\n\n"
        f"[상태] 이 사안({etype or '분류 불가'})은 규칙엔진에 판정 규칙이 없습니다. 판정 금지.\n\n"
        f"[참고 지식 — 세무사 검수 코멘트·판례에서 검색됨]\n{joined}\n\n"
        "위 참고 지식에 근거해, 판정이 아닌 **자문**을 작성하세요. "
        "지식이 부족한 부분은 솔직히 밝히고, 필요한 확인 사항을 되물으세요."
    )
    messages = [{"role": "system", "content": _ADVISORY_SYSTEM}]
    messages += _history_to_messages(history)
    messages.append({"role": "user", "content": grounding})

    fallback = [{"text": "유사 사례에서 세무사들이 남긴 검수 의견을 참고하시기 바랍니다.",
                 "type": "caveat"}]
    try:
        resp = get_client().chat.completions.create(
            model=_chat_model(),
            messages=messages,
            tools=[_emit_advisory_tool()],
            tool_choice={"type": "function", "function": {"name": "emit_segments"}},
            temperature=0.3,
        )
        tool_calls = getattr(resp.choices[0].message, "tool_calls", None)
        if not tool_calls:
            return fallback
        data = json.loads(tool_calls[0].function.arguments)
        return data.get("segments") or fallback
    except Exception:  # noqa: BLE001 — 자문은 부가 기능. 실패해도 미지원 안내는 나가야 한다.
        return fallback


def verify_decisive(history: list, user_text: str, fields: list[str]) -> list[str]:
    """추출기가 채운 결정변수 중 **사용자가 실제로 말한 것**만 골라 돌려준다(grounding guard).

    추출 프롬프트에 '추측 금지'를 넣어도 모델은 상식으로 값을 지어낸다(실측: 학회 질문에
    공식일정증빙=false 날조 → 되묻지 않고 '부인'). 판정은 대화에서 확인된 사실만의 함수여야
    하므로, 근거 없는 값은 여기서 떨어내고 pipeline 이 사용자에게 되묻는다.

    보수적 실패: 호출이 실패하면 빈 리스트 → 전부 미확인 취급 → 되묻기(판정 안 함).
    """
    if not fields:
        return []
    tool = {
        "type": "function",
        "function": {
            "name": "report_grounding",
            "description": "각 필드가 사용자 발화에 명시적 근거를 갖는지 보고한다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "supported": {
                        "type": "array",
                        "items": {"type": "string", "enum": fields},
                        "description": "사용자가 대화에서 명시적으로 말한 필드만. 추론된 것은 제외.",
                    }
                },
                "required": ["supported"],
            },
        },
    }
    sys = (
        "당신은 엄격한 근거 검증관입니다. 아래 필드 목록 중, 사용자가 대화에서 **직접 말한** "
        "사실만 supported 에 넣으세요.\n"
        "- '보통 그렇다', '당연히 그럴 것이다', '맥락상 그렇다' 는 근거가 아닙니다.\n"
        "- 사용자가 언급조차 하지 않은 항목은 절대 넣지 마세요.\n"
        "- 확신이 없으면 넣지 마세요(빠뜨리는 쪽이 안전합니다)."
    )
    messages = [{"role": "system", "content": sys}]
    messages += _history_to_messages(history)
    messages.append({"role": "user", "content": user_text})
    messages.append({"role": "user",
                     "content": f"[검증 대상 필드: {', '.join(fields)}] "
                                "이 중 사용자가 명시적으로 말한 것만 보고하세요."})
    try:
        resp = get_client().chat.completions.create(
            model=_chat_model(),
            messages=messages,
            tools=[tool],
            tool_choice={"type": "function", "function": {"name": "report_grounding"}},
            temperature=0,
        )
        tool_calls = getattr(resp.choices[0].message, "tool_calls", None)
        if not tool_calls:
            return []
        data = json.loads(tool_calls[0].function.arguments)
        return [f for f in (data.get("supported") or []) if f in fields]
    except Exception:  # noqa: BLE001 — 검증 실패 시 판정하지 않고 되묻는 쪽이 안전
        return []


def write_followup(history: list, user_text: str, missing: list[str]) -> list[dict]:
    """When required fields are missing, Solar asks a clarifying follow-up.
    Returns follow_up/evidence_request segments (no verdict)."""
    sys = (
        "당신은 병의원 세무 상담사입니다. 아직 판정에 필요한 정보가 부족합니다. "
        "판정을 내리지 말고, 부족한 정보를 자연스럽게 되묻는 질문을 문장 세그먼트로 작성하세요. "
        "반드시 emit_segments 도구로만 출력하고, type은 follow_up 또는 evidence_request를 사용하세요."
    )
    hint = {
        "etype": "어떤 종류의 지출인지(차량·접대·통신·복리후생 등)",
        "amount": "지출 금액",
        # 판정 결정변수 — 엔진 분기에 직접 쓰이므로 추측 없이 반드시 확인해야 한다.
        "has_qualified_receipt": "적격증빙(세금계산서·계산서·신용카드·현금영수증) 보유 여부",
        "in_business_name": "사업자 명의로 지출했는지 여부",
        "business_use_ratio": "업무사용비율(예: 70%처럼 입증 가능한 비율)",
        "승용차특례대상": "차량이 업무용승용차 특례 대상인지(경차·화물차·9인승↑이면 비대상)",
        "업무전용보험": "업무전용자동차보험 가입 여부",
        "운행기록부": "운행기록부 작성 여부",
        "상대방_거래처": "접대 상대방이 사업 관련 거래처인지 여부",
        "상대방_기록보유": "접대 상대방·목적 기록을 보유하고 있는지 여부",
        "불특정다수": "불특정 다수를 대상으로 한 지출인지 여부",
        "인당금액": "1인당 금액(원)",
        "전직원_수혜": "전 직원이 대상인지 여부(원장 단독 아님)",
        "사규근거": "사내 복리후생 규정에 근거가 있는지 여부",
        "공식일정증빙": "학회·세미나 등록증 등 공식 일정 증빙 보유 여부",
        "동반가족": "출장에 가족이 동반했는지 여부",
        "별도사업장등록": "자택과 분리된 별도 사업장이 있는지 여부",
    }
    need = " / ".join(hint.get(k, k) for k in missing)
    messages = [{"role": "system", "content": sys}]
    messages += _history_to_messages(history)
    messages.append({"role": "user", "content": user_text})
    messages.append({"role": "user",
                     "content": f"[부족한 정보: {need}] 이 정보를 되묻는 질문을 작성하세요."})
    resp = get_client().chat.completions.create(
        model=_chat_model(),
        messages=messages,
        tools=[_emit_segments_tool()],
        tool_choice={"type": "function", "function": {"name": "emit_segments"}},
        temperature=0.4,
    )
    tool_calls = getattr(resp.choices[0].message, "tool_calls", None)
    if not tool_calls:
        return [{"text": f"판단을 위해 {need}를 알려주시겠어요?", "type": "follow_up"}]
    try:
        data = json.loads(tool_calls[0].function.arguments)
        segs = data.get("segments") or []
        return segs if segs else [{"text": f"판단을 위해 {need}를 알려주시겠어요?", "type": "follow_up"}]
    except (json.JSONDecodeError, TypeError):
        return [{"text": f"판단을 위해 {need}를 알려주시겠어요?", "type": "follow_up"}]


# ── KB 세목 분류 (RAG 지식망 클러스터링, 2026-08-28) ─────────────────────────────
# 정책은 api/rag/taxonomy.py 참고. 판정과 무관 — Q+A+C 번들이 어느 주제에 속하는지만
# 고른다. 어느 카테고리와도 안 맞으면 '미분류'(정상 결과, 강제 배정 금지).

_CLASSIFY_SYSTEM = (
    "당신은 병의원 세무 상담 KB를 주제별로 분류하는 도구입니다. 주어진 질문+답변+세무사"
    "코멘트 묶음을 읽고, 아래 카테고리 설명을 참고해 가장 적합한 것 하나를 고르세요. 여러 "
    "주제가 섞여 있으면 사용자 질문의 핵심 주제를 기준으로 고르세요.\n\n"
    "· 업무용승용차: 차량 구입·리스·유지비(G80·포르쉐·그랜저 등 업무용 등록)\n"
    "· 임차료: 오피스텔·사무공간·병원건물 임대료, 임대차계약, 원상복구비\n"
    "· 접대성지출: 거래처 선물·골프·식사 등 특정 상대방 접대\n"
    "· 광고선전비: 인플루언서 마케팅, SNS·유튜브 홍보, 경품, 불특정다수 대상 광고\n"
    "· 통신비: 휴대폰·인터넷 요금\n"
    "· 복리후생비: 직원 워크숍·경조사비·명절선물·헬스장·식대 등 급여가 아닌 후생 혜택\n"
    "· 출장비: 학회·해외출장·연수 경비(항공·숙박·식대)\n"
    "· 소프트웨어구독: AI·SaaS·클라우드 구독료\n"
    "· 가사관련비: 원장 개인·자택 관련 지출(자택 사무공간, 개인용 휴대폰 등)\n"
    "· 인건비·가족직원: 배우자·자녀·부모 등 가족 고용, 급여, 4대보험 미가입, 프리랜서·근로자 구분\n"
    "· 퇴직금·4대보험: 퇴직금 중간정산·지급, 4대보험 가입·정지, 고용증대세액공제, 육아휴직 대체인력\n"
    "· 시설·인테리어: 인테리어 공사·장비 구매·리스·감가상각·즉시상각, 수선비 vs 자산 판단\n"
    "· 부가가치세: 부가세 신고, 간이과세자, 면세사업자, 매입세액공제, 대리납부, 폐업재고 부가세, 세금계산서\n"
    "· 상속·증여: 자녀·배우자 명의 증여(펀드·부동산), 종신보험 수익자 지정을 통한 상속·증여 설계\n"
    "· 소득세·법인전환·개원폐업: 법인전환, 종합소득세, 노란우산·IRP·연금저축, 강사료·인세 등 기타소득, "
    "개원 준비비용, 폐업, 공동개원 동업 정산\n"
    "· 매출관리: 현금매출 누락, 진료비 할인·면제, 매출 신고 누락, 비대면진료 매출 구분\n"
    "· 기타: 기부금, 화재·재해 보험금, 거래처 부도(대손), 노동분쟁 합의금, 친족비율 제한·공시의무 등 "
    "행정규정 — 위 카테고리 어디에도 안 맞을 때만\n\n"
    "위 어느 카테고리와도 명확히 안 맞으면 '미분류'를 고르세요 — 억지로 끼워맞추지 마세요. "
    "classify_tax_category 도구로만 응답하세요."
)


def _classify_tax_category_tool(categories: list[str]) -> dict:
    return {
        "type": "function",
        "function": {
            "name": "classify_tax_category",
            "description": "세무 상담 문답 묶음의 주제 카테고리를 하나 고른다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {
                        "type": "string",
                        "enum": categories + ["미분류"],
                        "description": "가장 적합한 카테고리. 안 맞으면 '미분류'.",
                    }
                },
                "required": ["category"],
            },
        },
    }


def classify_tax_category(content: str, categories: list[str]) -> str:
    """Q+A+C 번들 텍스트 → categories 중 하나(또는 '미분류'). 실패 시 '미분류' 반환
    (분류 실패가 적재/재분류 자체를 막지 않는다)."""
    try:
        resp = get_client().chat.completions.create(
            model=_chat_model(),
            messages=[
                {"role": "system", "content": _CLASSIFY_SYSTEM},
                {"role": "user", "content": content[:4000]},
            ],
            tools=[_classify_tax_category_tool(categories)],
            tool_choice={"type": "function", "function": {"name": "classify_tax_category"}},
            temperature=0,
        )
        tool_calls = getattr(resp.choices[0].message, "tool_calls", None)
        if not tool_calls:
            return "미분류"
        args = json.loads(tool_calls[0].function.arguments)
        category = args.get("category", "미분류")
        return category if category in categories else "미분류"
    except Exception:
        return "미분류"


# ── kb2 동적 카테고리 재구조화 — map-reduce (로드맵 4.5단계, 2026-09-09) ─────────
# 17개 세목 하드코딩을 대체 — Solar Pro가 그 시점 RAG 전체를 분석해 카테고리 자체를
# 새로 제안한다. 400여 건 원문을 한 번에 넣을 수 없어 배치(맵)로 후보를 뽑고, 후보
# label+description만(원문 없이, 가벼움) 다시 한 번 통합(리듀스)한다.

_PROPOSE_CATEGORIES_SYSTEM = (
    "당신은 병의원 세무 상담 KB 뭉치를 보고 주제 카테고리를 관찰해 제안하는 도구입니다. "
    "주어진 여러 건의 [질문/답변/코멘트] 요약을 읽고, 이 안에서 실제로 관찰되는 세무 주제 "
    "카테고리를 3~8개 나열하세요. 카테고리명은 명사형으로 짧게(예: '업무용승용차'), 설명은 "
    "한 줄로. 억지로 끼워맞추지 말고 실제 관찰되는 주제만 고르세요. propose_categories "
    "도구로만 응답하세요."
)


def _propose_categories_tool() -> dict:
    return {
        "type": "function",
        "function": {
            "name": "propose_categories",
            "description": "주어진 KB 뭉치에서 관찰되는 세무 주제 카테고리를 제안한다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "categories": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string", "description": "카테고리명(명사형, 짧게)."},
                                "description": {"type": "string", "description": "한 줄 설명."},
                            },
                            "required": ["label", "description"],
                        },
                    }
                },
                "required": ["categories"],
            },
        },
    }


def propose_categories_batch(passages: list[dict]) -> list[dict]:
    """맵 단계 — 배치 하나(passages: [{id, content}])에서 후보 카테고리를 뽑는다.
    각 건은 앞부분만(주제 신호면 충분, 전문 불필요) 사용. 실패 시 빈 리스트 —
    다른 배치 결과로 커버되므로 이 배치만 스킵해도 무방."""
    if not passages:
        return []
    bundle = "\n\n".join(f"[{p['id']}] {p['content'][:200]}" for p in passages)
    try:
        resp = get_client().chat.completions.create(
            model=_chat_model(),
            messages=[
                {"role": "system", "content": _PROPOSE_CATEGORIES_SYSTEM},
                {"role": "user", "content": bundle[:10000]},
            ],
            tools=[_propose_categories_tool()],
            tool_choice={"type": "function", "function": {"name": "propose_categories"}},
            temperature=0,
        )
        tool_calls = getattr(resp.choices[0].message, "tool_calls", None)
        if not tool_calls:
            return []
        args = json.loads(tool_calls[0].function.arguments)
        return [
            {"label": c["label"].strip(), "description": (c.get("description") or "").strip()}
            for c in args.get("categories", [])
            if c.get("label", "").strip()
        ]
    except Exception:
        return []


_MERGE_CATEGORIES_SYSTEM = (
    "여러 배치에서 관찰된 후보 카테고리 목록을 통합하는 도구입니다. 의미가 겹치거나 "
    "동의어인 카테고리는 하나로 합치고, 최종 카테고리를 중요도(관찰 빈도) 순으로 최대 "
    "20개까지 정리하세요. finalize_categories 도구로만 응답하세요."
)


def _finalize_categories_tool() -> dict:
    return {
        "type": "function",
        "function": {
            "name": "finalize_categories",
            "description": "후보 카테고리 목록을 중복 제거·병합해 최종 목록으로 정리한다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "categories": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string"},
                                "description": {"type": "string"},
                            },
                            "required": ["label", "description"],
                        },
                    }
                },
                "required": ["categories"],
            },
        },
    }


MAX_CATEGORIES = 20  # 프롬프트로만 요청하면 모델이 안 지킬 수 있어 코드에서 강제 상한


def merge_categories(candidates: list[dict]) -> list[dict]:
    """리듀스 단계 — 후보 label+description(원문 없음, 가벼움)만 다시 LLM에 넣어
    중복 제거·병합. 실패 시 label 기준 단순 dedup 폴백(첫 등장 설명 유지). 프롬프트로만
    개수 제한을 요청하면 모델이 그대로 다 돌려줄 수 있어(맵 단계 배치 수만큼 후보가
    쌓이면 100개 넘게 나올 수 있음), 어느 경로든 MAX_CATEGORIES로 코드에서 자른다."""
    if not candidates:
        return []
    listing = "\n".join(f"- {c['label']}: {c['description']}" for c in candidates)
    try:
        resp = get_client().chat.completions.create(
            model=_chat_model(),
            messages=[
                {"role": "system", "content": _MERGE_CATEGORIES_SYSTEM},
                {"role": "user", "content": listing[:12000]},
            ],
            tools=[_finalize_categories_tool()],
            tool_choice={"type": "function", "function": {"name": "finalize_categories"}},
            temperature=0,
        )
        tool_calls = getattr(resp.choices[0].message, "tool_calls", None)
        if not tool_calls:
            raise ValueError("no tool call")
        args = json.loads(tool_calls[0].function.arguments)
        merged = [
            {"label": c["label"].strip(), "description": (c.get("description") or "").strip()}
            for c in args.get("categories", [])
            if c.get("label", "").strip()
        ]
        if merged:
            return merged[:MAX_CATEGORIES]
        raise ValueError("empty result")
    except Exception:
        seen: dict[str, dict] = {}
        for c in candidates:
            seen.setdefault(c["label"], c)
        return list(seen.values())[:MAX_CATEGORIES]


# ── kb2 세목 자동 그룹화 — 대목 제안 (로드맵 4.6단계, 2026-09-09) ─────────────────
# "미분류" 세목들을 대목(kb2.groups)으로 묶는다. 하드코딩된 표준 세무 대분류를 쓰지
# 않고, Solar Pro의 세무 지식으로 세목 제목만 보고 표준적인 대분류를 스스로 판단하게
# 한다(국내 AI 트랙 취지 — 구조 자체가 Upstage 산출물이어야 함). 17개 안팎이라 배치
# 없이 한 번에 처리.

_PROPOSE_DOCUMENT_GROUPS_SYSTEM = (
    "당신은 세무 정책 사전의 목차를 정리하는 도구입니다. 주어진 세목(정책 사전 문서) "
    "제목 목록을 읽고, 실제 한국 세무 실무에서 통용되는 대분류(예: '차량·자산 관련비', "
    "'인건비·복리후생', '광고·마케팅비', '부가가치세', '소득세·법인전환' 등) 기준으로 "
    "3~8개의 대목으로 묶으세요. 모든 세목은 정확히 하나의 대목에 속해야 하고, 빠짐없이 "
    "배정하세요. propose_document_groups 도구로만 응답하세요."
)


def _propose_document_groups_tool(document_ids: list[str]) -> dict:
    return {
        "type": "function",
        "function": {
            "name": "propose_document_groups",
            "description": "세목 제목 목록을 표준 세무 대분류로 묶는다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "groups": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "label": {"type": "string", "description": "대분류명(명사형, 짧게)."},
                                "documentIds": {
                                    "type": "array",
                                    "items": {"type": "string", "enum": document_ids},
                                    "description": "이 대분류에 속하는 세목 id들.",
                                },
                            },
                            "required": ["label", "documentIds"],
                        },
                    }
                },
                "required": ["groups"],
            },
        },
    }


def propose_document_groups(documents: list[dict]) -> list[dict]:
    """documents: [{"id": str, "title": str}, ...]. 반환: [{"label": str, "documentIds": [str]}, ...].
    실패 시 빈 리스트(호출측이 아무것도 재배치하지 않고 스킵)."""
    if not documents:
        return []
    document_ids = [d["id"] for d in documents]
    listing = "\n".join(f"- [{d['id']}] {d['title']}" for d in documents)
    try:
        resp = get_client().chat.completions.create(
            model=_chat_model(),
            messages=[
                {"role": "system", "content": _PROPOSE_DOCUMENT_GROUPS_SYSTEM},
                {"role": "user", "content": listing[:12000]},
            ],
            tools=[_propose_document_groups_tool(document_ids)],
            tool_choice={"type": "function", "function": {"name": "propose_document_groups"}},
            temperature=0,
        )
        tool_calls = getattr(resp.choices[0].message, "tool_calls", None)
        if not tool_calls:
            return []
        args = json.loads(tool_calls[0].function.arguments)
        valid_ids = set(document_ids)
        out = []
        for g in args.get("groups", []):
            label = (g.get("label") or "").strip()
            ids = [i for i in (g.get("documentIds") or []) if i in valid_ids]
            if label and ids:
                out.append({"label": label, "documentIds": ids})
        return out
    except Exception:
        return []


# ── 지식베이스2 합성 (§02, 2026-09-03) ────────────────────────────────────────
# rag.passages(질문+답변+코멘트 번들)를 세목별로 응축해 조항형 단문 사전을 만든다.
# 검색 단위를 문서 전체에서 문장으로 낮추는 것이 목적이라, 문장은 앞뒤 맥락(대명사)
# 없이도 홀로 의미가 통해야 한다 — 그래야 문장 단위 임베딩이 제 역할을 한다.

_KB2_SYNTHESIS_SYSTEM = (
    "당신은 세무 상담 KB를 세목별 정책 사전으로 응축하는 도구입니다. 주어진 "
    "[질문/답변/세무사코멘트] 묶음 여러 건을 읽고, 그 안의 확정된 지식(세무사가 인정한 "
    "처리 기준·판단)을 조항 형태의 문장들로 재작성하세요. 규칙:\n"
    "1. 각 문장은 '이 경우', '위와 같이' 같은 앞 문장 의존 표현 없이, 그 문장 하나만 읽어도 "
    "의미가 완결되어야 합니다.\n"
    "2. 여러 묶음에 흩어진 같은 주제의 지식은 하나의 문장으로 합쳐도 됩니다.\n"
    "3. 묶음 사이에 서로 다른 결론이 있으면 억지로 합치지 말고 각각 별도 문장으로 남기세요.\n"
    "4. 각 문장마다 그 근거가 된 묶음의 id를 sourcePassageIds에 명시하세요.\n"
    "5. 반드시 emit_kb2_sentences 도구로만 출력하세요."
)


def _emit_kb2_sentences_tool() -> dict:
    return {
        "type": "function",
        "function": {
            "name": "emit_kb2_sentences",
            "description": "세무 상담 KB 묶음들을 조항형 단문 사전 문장 배열로 응축한다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "sentences": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "content": {"type": "string", "description": "독립 완결형 조항 문장."},
                                "sourcePassageIds": {
                                    "type": "array",
                                    "items": {"type": "string"},
                                    "description": "이 문장의 근거가 된 묶음 id들.",
                                },
                            },
                            "required": ["content", "sourcePassageIds"],
                        },
                    }
                },
                "required": ["sentences"],
            },
        },
    }


def synthesize_kb2_sentences(tax_category: str, passages: list[dict]) -> list[dict]:
    """passages: [{"id": str, "content": str}, ...] (같은 세목의 rag.passages).
    반환: [{"content": str, "source_passage_ids": [str]}, ...]. 실패 시 빈 리스트
    (호출측 kb2_synthesis 가 그 세목을 스킵)."""
    if not passages:
        return []
    bundle = "\n\n".join(f"[묶음 id={p['id']}]\n{p['content']}" for p in passages)
    try:
        resp = get_client().chat.completions.create(
            model=_chat_model(),
            messages=[
                {"role": "system", "content": _KB2_SYNTHESIS_SYSTEM},
                {"role": "user", "content": f"세목: {tax_category}\n\n{bundle}"[:12000]},
            ],
            tools=[_emit_kb2_sentences_tool()],
            tool_choice={"type": "function", "function": {"name": "emit_kb2_sentences"}},
            temperature=0,
        )
        tool_calls = getattr(resp.choices[0].message, "tool_calls", None)
        if not tool_calls:
            return []
        args = json.loads(tool_calls[0].function.arguments)
        out = []
        for s in args.get("sentences", []):
            content = (s.get("content") or "").strip()
            if not content:
                continue
            out.append({
                "content": content,
                "source_passage_ids": [str(x) for x in (s.get("sourcePassageIds") or [])],
            })
        return out
    except Exception:
        return []
