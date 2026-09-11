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


# ── 호출 시간 상한 ────────────────────────────────────────────────────────────
# OpenAI SDK 기본값은 타임아웃 600초 × 재시도 2회 = 한 번 물리면 최대 30분이다. 정상
# 응답이 수 초~수십 초인 호출에 이 기본값이 걸려 있으면, 단발 폭주 하나가 파이프라인
# 전체를 세운다(실측 2026-09-10: 분류 배치 하나가 1250초 = 600+600+50). 그래서 호출마다
# "이 정도면 비정상"인 상한을 명시하고 재시도도 1회로 줄인다.
#
# 상한을 넘기면 예외 → 각 함수의 except 가 폴백(빈 결과/건별 재시도/근거 없이 진행)으로
# 흡수한다. 즉 상한은 정확도를 깎지 않고 최악 시간만 자른다.
DEFAULT_RETRIES = 1

TIMEOUT_CLASSIFY_BATCH = 90     # 20건 배치 분류 — 실측 8~20초
TIMEOUT_CLASSIFY_ONE = 30       # 단건 분류(배치 폴백) — 실측 0.8초
TIMEOUT_PROPOSE_CATEGORIES = 90  # 맵 단계 배치 — 35건 요약 투입, 출력은 카테고리 3~8개
# 리듀스 — 처음엔 "레이블만 다루니 가볍다"고 90초로 잡았는데 오판이었다(2026-09-10
# 실측: 186초 ≈ 90×2 를 쓰고 폴백으로 빠졌다). 후보가 12배치 × 3~8개 = 50~90개
# 들어가고 출력도 카테고리 20개 + 설명이라 실제로는 무거운 생성이다. 여기서 폴백으로
# 빠지면 의미가 겹치는 카테고리를 합쳐주는 LLM 통합이 통째로 사라지고 레이블 문자열
# 완전일치 dedup 만 남아 — 사전 품질이 조용히 나빠진다. 넉넉히 준다.
TIMEOUT_MERGE_CATEGORIES = 600
TIMEOUT_SYNTHESIZE = 240        # 카테고리별 문장 합성 — 출력이 길어 넉넉히
TIMEOUT_PROPOSE_GROUPS = 90     # 세목 제목 목록 → 대목 배정
TIMEOUT_EMBED = 30              # 임베딩 — 실측 1초 미만. 챗 요청 경로에도 걸린다

# 챗 요청 경로 — 여기서 물리면 사용자가 그 시간만큼 응답을 못 받는다. 산문 생성은
# 넉넉히, 도구 호출(추출/검증)은 짧게. 여섯 함수 모두 try/except 폴백이 있어 상한을
# 넘겨도 500 이 아니라 폴백 응답으로 흡수된다(근거 없이 진행 / 기본 문안).
TIMEOUT_EXTRACT = 60
TIMEOUT_WRITE_SEGMENTS = 120
TIMEOUT_WRITE_ADVISORY = 120    # 자문 경로 — 산문 생성이라 write_segments 와 같은 성격
TIMEOUT_VERIFY_DECISIVE = 60
TIMEOUT_WRITE_FOLLOWUP = 90


def bounded_client(timeout_sec: float, retries: int = DEFAULT_RETRIES) -> OpenAI:
    """시간 상한이 걸린 클라이언트. 상한 없는 get_client() 를 그대로 쓰면 SDK 기본
    600초 × 2회에 걸린다 — 새 호출을 추가할 때는 이쪽을 쓸 것."""
    return get_client().with_options(timeout=timeout_sec, max_retries=retries)


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

    resp = bounded_client(TIMEOUT_EXTRACT).chat.completions.create(
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
    resp = bounded_client(TIMEOUT_WRITE_SEGMENTS).chat.completions.create(
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
        resp = bounded_client(TIMEOUT_WRITE_ADVISORY).chat.completions.create(
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
        resp = bounded_client(TIMEOUT_VERIFY_DECISIVE).chat.completions.create(
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
    resp = bounded_client(TIMEOUT_WRITE_FOLLOWUP).chat.completions.create(
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
        resp = bounded_client(TIMEOUT_CLASSIFY_ONE).chat.completions.create(
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


# ── kb2 동적 목차용 분류 (2026-09-11) ─────────────────────────────────────────
# 위 classify_tax_category 를 kb2 가 그대로 빌려 쓰고 있었는데, _CLASSIFY_SYSTEM 은
# **레거시 17개 고정 세목**을 이름과 설명까지 박아둔 프롬프트다. kb2 는 그 시점에 새로
# 만든 동적 목차를 enum 으로 넘기므로, 모델은 "업무용승용차·임차료·접대성지출…"을
# 설명받고 전혀 다른 목록 중에서 고르라는 지시를 받고 있었다.
#
# 여기 프롬프트가 한 일(표본 100건·목차 30개 실측): 미분류 45% → 28%. 핵심은 두 가지 —
# 고정 목차 설명을 걷어낸 것, 그리고 '미분류'를 **최후의 수단으로 격하**한 것이다.
# 이전 문구("안 맞으면 미분류, 억지로 끼워맞추지 마세요")를 모델이 성실히 따르느라
# 웬만한 상담을 전부 미분류로 보냈다. kb2 에서 미분류는 그냥 버려지는 값이라(어느
# 문서에도 안 실림) 비용이 대칭이 아니다 — 가까운 세목에 넣으면 세무사가 옮길 수
# 있지만, 미분류는 화면에 나타나지도 않는다.
_CLASSIFY_DYNAMIC_SYSTEM = (
    "당신은 병의원 세무 상담 KB 뭉치를 주어진 목차 중 하나로 분류하는 도구입니다. "
    "질문+답변+세무사코멘트 묶음을 읽고 **가장 가까운** 카테고리를 하나 고르세요. "
    "여러 주제가 섞여 있으면 사용자 질문의 핵심 주제를 기준으로 고르세요. "
    "완벽히 일치하지 않아도 주제가 가장 가까운 것을 고르는 것이 원칙입니다 — "
    "'미분류'는 그 건이 세무와 무관하거나 어느 주제와도 전혀 닿지 않을 때만 쓰세요. "
    "classify_tax_category 도구로만 응답하세요."
)


def classify_dynamic_category(content: str, categories: list[str]) -> tuple[str, str | None]:
    """kb2 동적 목차 전용 분류. 반환은 **(카테고리, 실패사유)** —
    카테고리는 categories 중 하나 또는 '미분류', 실패사유는 성공 시 None.

    반환이 튜플인 이유(2026-09-12). 이전에는 `except Exception: return "미분류"` 였다.
    그래서 **API 실패와 모델의 진짜 '미분류' 판정이 호출측에서 구분되지 않았다** —
    둘 다 그냥 '미분류'다. kb2 에서 '미분류'는 어느 문서에도 안 실리고 사라지는 값이라,
    이 구분이 없으면 429 한 번에 원문이 조용히 증발한다.

    실측(2026-09-12, 표본 100건·8워커): `RateLimitError` 16건이 전부 '미분류'로 접혀
    배정률이 42% 로 보였다. 프로덕션은 순차라 429 가 덜 뜨지만, 같은 일이 새벽 3시에
    나면 **아무도 안 보는 중에** 멀쩡한 세대가 빈 세대로 교체된다. 그래서 사유를
    올려보내 나쁜 회차 가드(kb2_taxonomy._assess_run)가 판단하게 한다.

    재시도도 1 → 2 로 올린다. 429 는 짧은 백오프면 대개 통과하는데, 상한을 크게 잡으면
    전량 실패 시 파이프라인이 몇 시간씩 늘어진다 — 그 경우는 재시도가 아니라 가드가
    처리할 일이다."""
    try:
        resp = bounded_client(TIMEOUT_CLASSIFY_ONE, retries=2).chat.completions.create(
            model=_chat_model(),
            messages=[
                {"role": "system", "content": _CLASSIFY_DYNAMIC_SYSTEM},
                {"role": "user", "content": content[:CLASSIFY_BATCH_EXCERPT]},
            ],
            tools=[_classify_tax_category_tool(categories)],
            tool_choice={"type": "function", "function": {"name": "classify_tax_category"}},
            temperature=0,
        )
        tool_calls = getattr(resp.choices[0].message, "tool_calls", None)
        if not tool_calls:
            # 도구 호출이 안 온 것도 실패다 — tool_choice 로 강제했는데 안 지킨 것이라
            # 모델의 '미분류' 판정으로 볼 근거가 없다.
            return "미분류", "no_tool_call"
        category = json.loads(tool_calls[0].function.arguments).get("category", "미분류")
        if category == "미분류":
            return "미분류", None  # 모델의 진짜 판정 — 이것만이 정상적인 미분류다
        if category not in categories:
            return "미분류", "off_enum"  # enum 밖 레이블 = 환각
        return category, None
    except Exception as e:  # noqa: BLE001 — 사유만 올려보내고 파이프라인은 계속 돈다
        return "미분류", type(e).__name__


_CLASSIFY_BATCH_SYSTEM = (
    "당신은 병의원 세무 상담 KB 뭉치를 카테고리로 분류하는 도구입니다. 주어진 여러 건의 "
    "[id] 질문/답변/코멘트를 각각 읽고, 건마다 가장 적합한 카테고리를 하나씩 고르세요. "
    "어느 카테고리에도 맞지 않으면 '미분류'. 주어진 id를 하나도 빠뜨리지 말고 전부 "
    "분류하고, 없는 id를 지어내지 마세요. classify_passages 도구로만 응답하세요."
)


def _classify_passages_tool(passage_ids: list[str], categories: list[str]) -> dict:
    return {
        "type": "function",
        "function": {
            "name": "classify_passages",
            "description": "여러 건의 KB 뭉치를 각각 카테고리 하나에 배정한다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "assignments": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string", "enum": passage_ids},
                                "category": {
                                    "type": "string",
                                    "enum": categories + ["미분류"],
                                },
                            },
                            "required": ["id", "category"],
                        },
                    }
                },
                "required": ["assignments"],
            },
        },
    }


CLASSIFY_BATCH_EXCERPT = 700  # 건당 투입 길이 — 주제 판정엔 앞부분이면 충분(실측 평균 642자)


def classify_passages_batch(passages: list[dict], categories: list[str]) -> dict[str, str]:
    """⚠️ 현재 어느 파이프라인에도 연결돼 있지 않다(2026-09-11). kb2 재구조화가 이 함수를
    쓰다가 건별 호출로 되돌아갔다 — 같은 표본에서 미분류가 84% 대 45% 로 갈렸기 때문이다
    (상세: api/rag/kb2_taxonomy._classify_all). 다시 채택하려면 그 수치부터 다시 재고,
    커버리지 계측(job result 의 coverage)으로 전후를 비교할 것.

    배치화(2026-09-10) — passages: [{id, content}] 를 한 번의 호출로 전부
    분류한다. 반환: {passage_id: category}.

    반환에 빠진 id는 그냥 포함하지 않는다 — 호출측(kb2_taxonomy)이 누락분만 건별로
    보충한다. 배치 전체가 실패해도 빈 dict 라 같은 경로로 자동 폴백된다(정확도는
    건별 호출과 동일하게 유지되고, 느려질 뿐)."""
    if not passages or not categories:
        return {}
    passage_ids = [p["id"] for p in passages]
    bundle = "\n\n".join(f"[{p['id']}]\n{p['content'][:CLASSIFY_BATCH_EXCERPT]}" for p in passages)
    try:
        resp = bounded_client(TIMEOUT_CLASSIFY_BATCH).chat.completions.create(
            model=_chat_model(),
            messages=[
                {"role": "system", "content": _CLASSIFY_BATCH_SYSTEM},
                {"role": "user", "content": bundle},
            ],
            tools=[_classify_passages_tool(passage_ids, categories)],
            tool_choice={"type": "function", "function": {"name": "classify_passages"}},
            temperature=0,
        )
        tool_calls = getattr(resp.choices[0].message, "tool_calls", None)
        if not tool_calls:
            return {}
        args = json.loads(tool_calls[0].function.arguments)
        valid_ids = set(passage_ids)
        result: dict[str, str] = {}
        for a in args.get("assignments", []):
            pid, category = a.get("id"), a.get("category")
            # enum 을 줘도 Solar 가 없는 id를 지어낼 수 있어(4.5단계에서 겪은
            # sourcePassageIds 환각과 같은 종류) 이번 배치 id 집합으로 걸러낸다.
            if pid in valid_ids:
                result[pid] = category if category in categories else "미분류"
        return result
    except Exception:
        return {}


# ── kb2 동적 카테고리 재구조화 — map-reduce (로드맵 4.5단계, 2026-09-09) ─────────
# 17개 세목 하드코딩을 대체 — Solar Pro가 그 시점 RAG 전체를 분석해 카테고리 자체를
# 새로 제안한다. 400여 건 원문을 한 번에 넣을 수 없어 배치(맵)로 후보를 뽑고, 후보
# label+description만(원문 없이, 가벼움) 다시 한 번 통합(리듀스)한다.

# 프롬프트 개정(2026-09-11) — 커버리지 20% 문제의 본체.
# 이전 프롬프트는 "실제 관찰되는 주제만"이라고만 말해서, 모델이 **상담 한 건**을 그대로
# 카테고리로 승격시켰다(실측 산출: '사립학교사무직원육아휴직수당과세', '유튜브콘텐츠제작비용').
# 그런 레이블은 자기 자신 말고는 아무것도 못 담아서, 분류 단계에서 나머지 원문 대부분이
# '미분류'로 떨어졌다. 그래서 개수·길이·귀속 건수로 "넓이"를 직접 요구한다:
#   ① 배치당 3~6개(이전 3~8개) — 적게 요구할수록 각 카테고리가 넓어진다.
#   ② 레이블 12자 이내 명사구 — 질문 한 건을 요약하면 길어질 수밖에 없어 길이가 곧 제동이다.
#   ③ 이 배치에서 최소 3건이 속하는 주제만 — 1:1 레이블을 정면으로 금지.
#   ④ 좋은 예/나쁜 예를 실제 산출물로 제시 — 추상적 지시보다 대비가 먹힌다.
_PROPOSE_CATEGORIES_SYSTEM = (
    "당신은 병의원 세무 상담 KB 뭉치를 보고 **여러 상담에 공통으로 걸리는 세무 주제**를 "
    "찾아내는 도구입니다. 주어진 여러 건의 [질문/답변/코멘트] 요약을 읽고, 이 묶음을 덮는 "
    "주제 카테고리를 3~6개만 고르세요.\n"
    "규칙:\n"
    "- 카테고리는 **주제**여야 합니다. 상담 한 건을 요약한 이름은 절대 안 됩니다.\n"
    "- 좋은 예: '업무용승용차', '인건비·복리후생', '접대비', '부가가치세 신고', '감가상각'.\n"
    "- 나쁜 예: '사립학교사무직원육아휴직수당과세', '유튜브콘텐츠제작비용', "
    "'리스종료후장비인수회계처리' — 전부 질문 하나에만 해당해 다른 상담을 담지 못합니다.\n"
    "- 카테고리명은 12자 이내의 짧은 명사구로 쓰세요. 이름이 길어지면 너무 좁다는 뜻입니다.\n"
    "- 이 묶음 안에서 **최소 3건 이상**이 속할 만한 주제만 고르세요. 한두 건짜리 주제는 "
    "더 넓은 상위 주제에 포함시키세요.\n"
    "- 설명은 한 줄로, 어떤 상담이 여기 속하는지 적으세요.\n"
    "propose_categories 도구로만 응답하세요."
)


# 배치 하나가 낼 후보 개수. 프롬프트의 "3~6개"와 같은 값을 스키마에도 박는다.
PROPOSE_MIN_CATEGORIES = 3
PROPOSE_MAX_CATEGORIES = 6


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
                        # 개수를 산문("3~6개만")으로만 요구하면 안 지킨다 — 실측 2026-09-12:
                        # 배치당 18~32개를 돌려줬다. 리듀스에서 minItems/maxItems 가 먹혔던
                        # 것과 같은 처방을 맵에도 건다.
                        #
                        # 맵에서 개수가 곧 넓이다: 35건짜리 배치를 6개로 덮으라고 하면 주제를
                        # 묶을 수밖에 없고, 30개를 허용하면 상담 하나에 레이블 하나를 붙여도
                        # 된다. 그렇게 나온 1회 관찰 레이블은 tally_candidates 에서 바닥에
                        # 깔려 리듀스의 빈도 신호까지 흐린다.
                        "minItems": PROPOSE_MIN_CATEGORIES,
                        "maxItems": PROPOSE_MAX_CATEGORIES,
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
        resp = bounded_client(TIMEOUT_PROPOSE_CATEGORIES).chat.completions.create(
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


# 리듀스도 같이 개정(2026-09-11) — 맵이 좁은 레이블을 흘려보내도 여기서 흡수시킨다.
# 이전엔 "동의어를 합치라"고만 해서, 겹치지만 않으면 질문 하나짜리 레이블이 그대로
# 최종 목록에 올라왔다. 최종 목록이 곧 분류 단계의 선택지라 여기서 좁으면 미분류가 된다.
_MERGE_CATEGORIES_SYSTEM = (
    "여러 배치에서 관찰된 후보 카테고리 목록을 **세무 정책 사전의 목차**로 통합하는 "
    "도구입니다.\n"
    "규칙:\n"
    "- 의미가 겹치거나 동의어인 카테고리는 하나로 합치세요.\n"
    "- 상담 한 건짜리로 보이는 좁은 후보(예: '사립학교사무직원육아휴직수당과세')는 "
    "독립 항목으로 두지 말고 더 넓은 주제(예: '인건비·복리후생')에 흡수시키세요.\n"
    "- 최종 카테고리명은 12자 이내의 짧은 명사구로 통일하세요.\n"
    "- 최종 개수는 20~30개를 목표로 하세요. 목차는 **모든 상담을 덮을 만큼 촘촘해야** 하고, "
    "어느 상담도 갈 곳이 없으면 안 됩니다.\n"
    "- 관찰 횟수가 많은 후보일수록 넓은 주제입니다. 1회만 관찰된 후보는 독립 항목으로 "
    "두지 말고 반드시 더 넓은 주제에 흡수시키세요.\n"
    "- 중요도(관찰 빈도) 순으로 정렬하세요.\n"
    "finalize_categories 도구로만 응답하세요."
)

# 최종 목차 크기. 상한을 프롬프트가 아니라 도구 스키마(maxItems)로도 박는다 — 실측상
# 산문 지시만으로는 모델이 155개 후보를 128개로 "정리"해 돌려줬다. 하한을 두는 이유는
# 반대 극단(전부 몇 개로 뭉개기)을 막기 위해서다.
#
# 20~30 인 근거(2026-09-11 표본 100건 실측, 건별+강화 분류 기준): 목차가 14개면 미분류
# 47%, 30개면 28%였다. "카테고리가 좁아서 커버리지가 낮다"는 직관과 반대로, **목차가
# 작을수록 갈 곳 없는 상담이 늘어난다** — 병의원 세무 상담 413건은 14개 비용 항목으로
# 덮이지 않는다. 넓은 주제명을 쓰되(맵 프롬프트), 목차 자체는 촘촘해야 한다.
# 목차가 커져도 탐색성은 2단 트리(대목/세목)가 이미 감당한다.
MERGE_MIN_CATEGORIES = 20
MERGE_MAX_CATEGORIES = 30


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
                        # 개수를 산문으로만 요구하면 모델이 압축을 아예 안 한다 — 실측
                        # 2026-09-11: "8~14개"라고 적었는데 155개 후보에 128개를 그대로
                        # 돌려줬다. 스키마 제약이 프롬프트 문장보다 강하게 먹는다.
                        "minItems": MERGE_MIN_CATEGORIES,
                        "maxItems": MERGE_MAX_CATEGORIES,
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


MAX_CATEGORIES = 30  # 프롬프트로만 요청하면 모델이 안 지킬 수 있어 코드에서 강제 상한


def tally_candidates(candidates: list[dict]) -> list[dict]:
    """후보를 레이블 기준으로 접어 **관찰 횟수**와 함께 빈도순으로 돌려준다.

    리듀스가 지금까지 못 한 판단의 열쇠(2026-09-11). 맵은 배치마다 독립적으로 도니까,
    여러 배치에서 반복 관찰된 레이블이 곧 '넓은 주제'다 — 실측 237개 후보에서
    업무용승용차·복리후생비 5회, 인테리어비용 4회인 반면 질문 하나짜리 레이블은 전부
    1회였다. 이전에는 이 신호를 만들지 않고 평평한 목록만 LLM 에 넘긴 뒤 "관찰 빈도순으로
    정리하라"고 요구했다 — 모델이 알 수 없는 것을 요구한 셈이다. 세는 건 파이썬이
    공짜로 할 수 있다."""
    tally: dict[str, dict] = {}
    for c in candidates:
        key = " ".join(c["label"].split()).lower()
        hit = tally.get(key)
        if hit is None:
            tally[key] = {"label": c["label"], "description": c["description"], "count": 1}
        else:
            hit["count"] += 1
            if not hit["description"]:
                hit["description"] = c["description"]
    return sorted(tally.values(), key=lambda c: -c["count"])


def merge_categories(candidates: list[dict]) -> list[dict]:
    """리듀스 단계 — 후보 label+description(원문 없음, 가벼움)만 다시 LLM에 넣어
    중복 제거·병합. 프롬프트로만 개수 제한을 요청하면 모델이 그대로 다 돌려줄 수 있어
    (맵 단계 배치 수만큼 후보가 쌓이면 100개 넘게 나올 수 있음), 어느 경로든
    MAX_CATEGORIES로 코드에서 자른다.

    후보는 tally_candidates 로 접어 **관찰 횟수와 함께** 넘긴다. 입력이 짧아져 호출이
    가벼워지고(237개 → 고유 ~190줄), 무엇보다 모델이 넓은 주제와 일회성 레이블을
    구분할 근거가 생긴다.

    폴백도 바꿨다(2026-09-11). 이전 폴백은 '첫 등장 순 dedup' 이라 1번 배치의 레이블이
    그대로 최종 목차가 됐다 — 그리고 실측상 리듀스는 **매번 타임아웃에 걸려 이 폴백으로
    빠지고 있었다**(600초×2 소진). 즉 목차를 정한 건 LLM 이 아니라 배치 순서였다. 이제는
    관찰 횟수순으로 남겨서, 폴백으로 빠져도 최소한 '자주 나온 주제'가 살아남는다."""
    if not candidates:
        return []
    tallied = tally_candidates(candidates)
    listing = "\n".join(
        f"- {c['label']} ({c['count']}회 관찰): {c['description']}" for c in tallied
    )
    try:
        resp = bounded_client(TIMEOUT_MERGE_CATEGORIES).chat.completions.create(
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
        return [
            {"label": c["label"], "description": c["description"]} for c in tallied
        ][:MAX_CATEGORIES]


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
        resp = bounded_client(TIMEOUT_PROPOSE_GROUPS).chat.completions.create(
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
    "5. **주어진 묶음은 하나도 빠짐없이 최소 한 문장의 근거로 쓰여야 합니다.** 어떤 묶음의 "
    "id도 sourcePassageIds 어디에도 안 나타나는 일이 없도록, 출력 전에 묶음 id 목록을 훑어 "
    "빠진 것이 있으면 그 묶음을 근거로 한 문장을 추가하세요.\n"
    "6. 반드시 emit_kb2_sentences 도구로만 출력하세요."
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


# 합성 프롬프트에 넣는 원문 총량(자). 12000 → 6000 (2026-09-12).
# 인용률이 묶음 개수에 강하게 반비례한다 — 같은 27건을 예산만 반으로 줄여(청크 2→4)
# 재보니 89% → 96%(3회 전부 96%, 편차 0)였다. 한 프롬프트에 ~9건이면 모델이 전부
# 끝까지 읽는다. 청크가 2배로 늘지만 _synthesize_members 가 병렬로 호출해 시간은 오히려
# 줄었다.
SYNTHESIS_INPUT_BUDGET = 6000


def fit_passages_for_synthesis(passages: list[dict]) -> tuple[list[dict], int]:
    """합성 프롬프트에 실제로 들어갈 passage 만 골라 (넣을 것, 잘려나간 수) 를 돌려준다.

    이전에는 bundle 문자열을 통째로 12000자에서 잘랐다(2026-09-11 발견). 그 방식은
    ①마지막 passage 가 문장 중간에서 끊겨 근거가 훼손되고 ②몇 건이 버려졌는지 아무도
    모른다 — 실측 평균 642자/건이라 세목 하나에 40건이 배정돼도 앞 ~17건만 모델이 보고
    나머지는 조용히 사라졌다. 여기서는 **건 단위로** 담아 경계 훼손을 없애고, 버린 수를
    호출측에 돌려줘 job result 에 계측으로 남긴다."""
    fitted: list[dict] = []
    used = 0
    for p in passages:
        cost = len(_synthesis_block(p)) + 2  # 구분자(빈 줄) 2자
        if fitted and used + cost > SYNTHESIS_INPUT_BUDGET:
            break
        fitted.append(p)
        used += cost
    return fitted, len(passages) - len(fitted)


def _synthesis_block(p: dict) -> str:
    return f"[묶음 id={p['id']}]\n{p['content']}"


def synthesize_kb2_sentences(tax_category: str, passages: list[dict]) -> list[dict]:
    """passages: [{"id": str, "content": str}, ...] (같은 세목의 rag.passages).
    반환: [{"content": str, "source_passage_ids": [str]}, ...]. 실패 시 빈 리스트
    (호출측 kb2_synthesis 가 그 세목을 스킵).

    투입량 제한은 호출측이 fit_passages_for_synthesis 로 미리 처리한다 — 여기 남은
    절단은 그 계약이 깨졌을 때를 위한 안전망일 뿐이다."""
    if not passages:
        return []
    passages, _dropped = fit_passages_for_synthesis(passages)
    # 프롬프트에는 36자 uuid 대신 P1..Pn 짧은 별칭을 보여주고 출력에서 되돌린다
    # (2026-09-12). uuid 를 그대로 쓰면 모델이 옮겨적기 부담 때문에 일부 묶음을 아예
    # 인용하지 않는다 — 27건 대조군에서 별칭만 바꿔도 인용률 59% → 74%, 커버 규칙과
    # 함께면 89% 였고 uuid 오타(환각 id)는 0이 됐다.
    alias_to_id = {f"P{i + 1}": p["id"] for i, p in enumerate(passages)}
    bundle = "\n\n".join(
        _synthesis_block({"id": alias, "content": p["content"]})
        for alias, p in zip(alias_to_id, passages)
    )
    # 안전망 절단은 실제 bundle 길이 기준 — 예산보다 긴 단일 passage 는 fit 이 통째로
    # 넘기므로, 예산으로 자르면 그런 건을 도로 훼손한다.
    user_content = f"세목: {tax_category}\n\n{bundle}"[: max(SYNTHESIS_INPUT_BUDGET, len(bundle)) + 200]
    try:
        resp = bounded_client(TIMEOUT_SYNTHESIZE).chat.completions.create(
            model=_chat_model(),
            messages=[
                {"role": "system", "content": _KB2_SYNTHESIS_SYSTEM},
                {"role": "user", "content": user_content},
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
            # 별칭을 실제 id 로 되돌린다. 모르는 값(모델이 지어낸 별칭·uuid)은 그대로
            # 흘려보내 호출측이 valid_ids 교집합에서 떨어뜨리고 환각으로 계측하게 한다.
            out.append({
                "content": content,
                "source_passage_ids": [
                    alias_to_id.get(str(x), str(x)) for x in (s.get("sourcePassageIds") or [])
                ],
            })
        return out
    except Exception:
        return []
