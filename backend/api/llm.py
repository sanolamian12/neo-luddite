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
