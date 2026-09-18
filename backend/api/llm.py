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
import re
import sys
from functools import lru_cache
from typing import get_args

from openai import OpenAI

from api import upstage_gate
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
# 근사 동의어 접기 뒤 빈 칸 리필(2026-09-13). 입력은 merge 와 같은 후보 목록이지만 출력이
# 빈 칸 수(현 세대 기준 8개 안팎)뿐이라 merge 보다 가볍다. 아직 실측 전이라 merge 실측
# (186초)은 넘겨 잡되 600 까지는 주지 않는다 — 여기서 실패해도 관찰 횟수순 코드 리필이
# 받고, 그 실패는 labelFold.refillError 로 세어진다.
TIMEOUT_REFILL_CATEGORIES = 300
# 카테고리별 문장 합성. 240 → 60 (2026-09-12). 240 은 "출력이 길어 넉넉히"라고 감으로
# 잡은 값이었고, 실측하니 **정상 호출의 16배**였다. 재시도를 SDK 밖으로 꺼내 한 번의
# 호출 = 한 개의 소요값으로 만든 회차(job 9da37290)에서 분포가 두 덩어리로 갈렸다:
#
#     성공 48회  min 1.04s  p50 2.90s  p90 4.87s  max 15.0s (2위 7.24s)
#     실패  2회  240.068s · 240.092s   ← 정확히 상한에 붙음
#
# **240초 근처의 성공이 0건**이다 — 느린 생성이면 연속 분포여야 한다. 즉 상한을 낮춰도
# 자를 정상 호출이 없다(48건 전부 15초 이하라 후보 20/30/45/60/90초 어느 것도 0건 절단).
# 60 은 관측 최대의 4배로, 아직 못 본 느린 호출에 여유를 남긴 보수적 선택이다.
# 실패한 호출은 CHUNK_ATTEMPTS 루프가 다시 묻고 그 재시도는 계측에 세어진다(유실 0 실측).
TIMEOUT_SYNTHESIZE = 60
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


class _Gated:
    """클라이언트 대리 — `.create(...)` 를 upstage_gate.slot() 안에서 부른다(P8 B).

    `bounded_client(t).chat.completions.create(...)` / `.embeddings.create(...)` 모양을 그대로
    두고 게이트를 한 자리에서 건다 — 호출 지점 14곳을 고치지 않고, 새 호출도 자동으로 줄에 선다."""

    def __init__(self, target, label: str) -> None:
        self._target = target
        self._label = label

    def __getattr__(self, name: str):
        attr = getattr(self._target, name)
        if name != "create":
            return _Gated(attr, self._label)

        def gated_create(*args, **kwargs):
            with upstage_gate.slot(self._label):
                return attr(*args, **kwargs)
        return gated_create


def bounded_client(timeout_sec: float, retries: int = DEFAULT_RETRIES) -> OpenAI:
    """시간 상한이 걸린 클라이언트. 상한 없는 get_client() 를 그대로 쓰면 SDK 기본
    600초 × 2회에 걸린다 — 새 호출을 추가할 때는 이쪽을 쓸 것.

    돌려주는 것은 동시 호출 게이트(upstage_gate)를 거치는 대리다. 게이트 대기는 이 timeout 밖이다."""
    label = sys._getframe(1).f_code.co_name   # 로그용 — 어느 함수의 호출이 줄에서 기다렸나
    return _Gated(get_client().with_options(timeout=timeout_sec, max_retries=retries), label)


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


# ── L0 규범층 (KB통합 3층검색 로드맵 P1, 2026-09-16) ────────────────────────────
# 시스템 프롬프트 = 경로별 역할·출력 규칙(코드, 위 _WRITE_SYSTEM 등) + 공통 규범 블록.
# 규범은 load_norms() 경계 뒤에서만 온다 — 여기는 파일 위치도 저장소도 모른다.
# 로드 실패(None)면 규범 없이 현행 문안 그대로 = 규범 도입 전과 같은 프롬프트.
def _with_norms(base: str) -> str:
    from api.prompts import load_norms

    norms = load_norms()
    if not norms:
        return base
    return (
        f"{base}\n\n"
        "[공통 규범 — 답변 절차·해석 원칙·오류 패턴. 위 규칙과 부딪히면 위 규칙이 우선이며, "
        "판정은 어떤 경우에도 규칙엔진의 권위다]\n"
        f"{norms}"
    )


# ── 출처 라벨 분리 (KB통합 3층검색 로드맵 P4, 2026-09-17) ────────────────────────
# 검색 근거를 한 목록으로 평평하게 붙이면 모델이 권위가 다른 층을 구분하지 못한다. 그래서
# 코퍼스(Passage.corpus)별로 블록을 가르고, 쓰는 규칙을 블록 뒤에 박는다.
#   검수 선례 ← kb2 · rag   (세무사가 확인했지만 **다른 질문자의 사안**)
#   참고 사전 ← kbdict      (일반 법리·용어. 이 사안에 대한 확인이 아님 — 권위 최하위)
# 두 번째 규칙(선례의 사실관계를 사용자 것으로 옮기지 말 것)은 맥락 혼입 대응이다: rag 번들의
# 옛 AI 답변 "귀하께서 말씀하신 '신규 채용 4명 중 청년 2명'"이 질문에 없는 사실로 답변에 섞였다
# (2026-09-16 프로덕션 스모크, 09-17 로컬 재현).
# 이 문구는 코드 규칙이다 — 세무사 컨펌 대상인 규범 md(api/prompts/)에 넣지 않는다.
_REVIEWED_HEADER = "[검수 선례 — 세무사가 확인한 내용 · 다른 질문자의 사안]"
_DICTIONARY_HEADER = "[참고 사전 — 일반 법리·용어, 본 사안에 대한 확인이 아님]"
_GROUNDING_RULES = (
    "[근거 사용 규칙]\n"
    "- 우선순위는 규칙엔진 판정 > 검수 선례 > 참고 사전입니다. 어떤 근거도 판정을 바꾸지 못합니다. "
    "충돌 시 검수 선례를 우선하고, 참고 사전만을 근거로 단정하지 마세요.\n"
    "- 검수 선례는 다른 질문자의 사안입니다. 선례에 나오는 인원·금액·연도·업종·명의 같은 사실관계를 "
    "사용자의 상황인 것처럼 옮겨 쓰지 마세요. 사용자의 사실은 [사용자 질문]과 대화에 나온 것뿐입니다."
)
# 참고 사전이 섞였을 때만 붙인다. 없으면 이 줄 자체가 불필요하고, 붙이면 사전 없는 경로의 프롬프트만 길어진다.
# 실측(2026-09-17, 사전만 근거 24답변): 이 줄 없이 "유사 사례에서 세무사들은 ~로 보았습니다"가 6건 —
# 사전 내용을 세무사 판단으로 귀속하는 거짓 출처다(_ADVISORY_SYSTEM 의 어조 예시를 그대로 따라 썼다).
_DICTIONARY_RULE = (
    "\n- 참고 사전의 내용은 세무사가 확인한 선례가 아닙니다. 참고 사전만을 근거로 '세무사들은 ~로 보았습니다', "
    "'유사 사례에서는 ~' 처럼 쓰지 말고, '일반적으로 ~로 봅니다', '법리상 ~인지에 따라 달라집니다' 처럼 "
    "일반 법리로 쓰세요."
)


def _grounding_block(passages) -> str:
    """검색 근거 → 라벨 블록 + 사용 규칙. 근거가 없으면 빈 문자열.

    passages: api.rag.retriever.Passage 목록(.content, .corpus). corpus 가 없는 항목은
    검수 선례로 본다 — 사전(kbdict)은 KbdictRetriever 만 만들고 항상 corpus 를 싣는다."""
    reviewed = [p.content for p in passages if getattr(p, "corpus", None) != "kbdict"]
    dictionary = [p.content for p in passages if getattr(p, "corpus", None) == "kbdict"]
    blocks = []
    if reviewed:
        blocks.append(_REVIEWED_HEADER + "\n" + "\n\n".join(f"- {c}" for c in reviewed))
    if dictionary:
        blocks.append(_DICTIONARY_HEADER + "\n" + "\n\n".join(f"- {c}" for c in dictionary))
    if not blocks:
        return ""
    return "\n\n".join(blocks) + "\n\n" + _GROUNDING_RULES + (_DICTIONARY_RULE if dictionary else "")


def write_segments(user_text: str, verdict_label: str, reason: str,
                   accepted_won: int, amount: int, evidences: list[str],
                   case_refs: list[str], passages: list | None = None) -> list[dict]:
    """Solar writes argument segments grounded on the engine result. Returns
    a list of {text, type, framework?, citations?} dicts (ids assigned later).

    passages: 검색된 근거(Passage — 검수 선례·참고 사전, 있으면). 판정은 못 뒤집고,
    법리 설명·인용을 풍부하게 하는 근거로만 쓴다(마스터 §2 — verdict 는 엔진 권위)."""
    rag_block = ""
    grounding_block = _grounding_block(passages or [])
    if grounding_block:
        rag_block = "\n" + grounding_block + "\n"
    grounding = (
        f"[사용자 질문]\n{user_text}\n\n"
        f"[규칙엔진 판정 — 권위 원천, 뒤집지 말 것]\n"
        f"- 판정: {verdict_label}\n"
        f"- 인정금액: {accepted_won:,} / {amount:,}원\n"
        f"- 근거: {reason}\n"
        f"- 필요증빙: {', '.join(evidences) if evidences else '없음'}\n"
        f"- 참고 판례: {', '.join(case_refs) if case_refs else '없음'}\n"
        f"{rag_block}\n"
        "위 판정을 설명하는 세그먼트를 작성하세요. 검색 근거가 있으면 근거 사용 규칙에 따라 "
        "법리·인용에 반영하세요."
    )
    resp = bounded_client(TIMEOUT_WRITE_SEGMENTS).chat.completions.create(
        model=_chat_model(),
        messages=[{"role": "system", "content": _with_norms(_WRITE_SYSTEM)},
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
                                              "description": "검수 선례·참고 사전에 실제로 등장한 법령·판례만."},
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
    "같은 확정적 표현 금지. 대신 '유사 사례에서 세무사들은 ~로 보았습니다'(검수 선례가 근거일 때만), "
    "'~인지에 따라 갈립니다' 처럼 자문 어조로 쓰세요.\n"
    "2. **검수 선례·참고 사전에 있는 내용만** 근거로 쓰세요. 거기에 없는 법령·판례·수치를 "
    "지어내지 마세요. 아는 바가 부족하면 '확정적으로 말씀드리기 어렵다'고 하고, "
    "확인이 필요한 사항을 되물으세요.\n"
    "3. 근거가 사용자 질문과 어긋나면 억지로 끼워맞추지 말고, 관련 선례가 부족하다고 "
    "솔직히 밝히세요.\n"
    "4. 반드시 emit_segments 도구로만 출력하세요."
)


def write_advisory(history: list, user_text: str, etype: str | None,
                   passages: list) -> list[dict]:
    """엔진 규칙 밖 질문에 대해, 검색된 근거(검수 선례·참고 사전)로 **판정 없는** 자문 세그먼트를 쓴다.

    호출 전제: passages 가 비어 있지 않다(비면 pipeline 이 기존 '미지원' 안내로 떨어진다).
    반환: [{text, type, framework?, citations?}] — 판정형 type 은 도구 enum 에서 원천 차단.
    """
    grounding = (
        f"[사용자 질문]\n{user_text}\n\n"
        f"[상태] 이 사안({etype or '분류 불가'})은 규칙엔진에 판정 규칙이 없습니다. 판정 금지.\n\n"
        f"{_grounding_block(passages)}\n\n"
        "위 근거에 기대어, 판정이 아닌 **자문**을 작성하세요. "
        "지식이 부족한 부분은 솔직히 밝히고, 필요한 확인 사항을 되물으세요."
    )
    messages = [{"role": "system", "content": _with_norms(_ADVISORY_SYSTEM)}]
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
    except upstage_gate.UpstageCongested:
        raise   # 혼잡은 폴백 문안으로 가리지 않는다 — main.chat 이 혼잡 안내로 바꾼다
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
    except upstage_gate.UpstageCongested:
        raise   # 혼잡을 '전부 미확인'으로 삼키면 되묻기 호출이 또 줄을 선다
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

    반환이 튜플인 이유(2026-09-11). 이전에는 `except Exception: return "미분류"` 였다.
    그래서 **API 실패와 모델의 진짜 '미분류' 판정이 호출측에서 구분되지 않았다** —
    둘 다 그냥 '미분류'다. kb2 에서 '미분류'는 어느 문서에도 안 실리고 사라지는 값이라,
    이 구분이 없으면 429 한 번에 원문이 조용히 증발한다.

    실측(2026-09-11, 표본 100건·8워커): `RateLimitError` 16건이 전부 '미분류'로 접혀
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
                        # 개수를 산문("3~6개만")으로만 요구하면 안 지킨다 — 실측 2026-09-11:
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


def _finalize_categories_tool(
    min_items: int = MERGE_MIN_CATEGORIES, max_items: int = MERGE_MAX_CATEGORIES
) -> dict:
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
                        "minItems": min_items,
                        "maxItems": max_items,
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
        merged = _dedup_labels([
            {"label": c["label"].strip(), "description": (c.get("description") or "").strip()}
            for c in args.get("categories", [])
            if c.get("label", "").strip()
        ])
        # 고유 레이블이 하한에 못 미치면 목차로 못 쓴다 — 폴백(관찰 횟수순)이 낫다.
        if len(merged) >= MERGE_MIN_CATEGORIES:
            return merged[:MAX_CATEGORIES]
        raise ValueError(f"merged labels too few after dedup: {len(merged)}")
    except Exception:
        return _dedup_labels([
            {"label": c["label"], "description": c["description"]} for c in tallied
        ])[:MAX_CATEGORIES]


def _dedup_labels(categories: list[dict]) -> list[dict]:
    """같은 레이블을 첫 것만 남긴다(2026-09-11).

    merge 가 **같은 레이블 30개**를 돌려주는 것을 실측으로 봤다(맵 입력 실험 3회 중 1회,
    전부 '복리후생비'). 그러면 목차 30칸이 한 칸이 되고, 분류는 선택지가 하나뿐이라
    오히려 배정률이 높게 나올 수도 있어 **나쁜 회차 가드도 이걸 못 잡는다** — 가드는
    배정률과 호출 실패만 본다. 여기서 접고, 접은 뒤 하한(20)에 못 미치면 호출측이
    폴백으로 넘어간다.

    레이블 정규화는 공백만 접는다. 근사 동의어 병합(`복리후생비` vs `복리후생비인정`)은
    이 자리의 일이 아니다 — 그건 커버리지가 아니라 트리 가독성 과제로 분류돼 있고,
    임베딩 코사인이 필요한 별개의 판단이다."""
    seen: set[str] = set()
    out: list[dict] = []
    for c in categories:
        key = " ".join(c["label"].split())
        if key in seen:
            continue
        seen.add(key)
        out.append(c)
    return out


_REFILL_CATEGORIES_SYSTEM = (
    "세무 정책 사전 목차의 **빈 칸을 채우는** 도구입니다.\n"
    "이미 확정된 목차와, 서로 중복이라 접혀서 빠진 레이블이 주어집니다. 후보 목록에서 "
    "확정 목차가 **아직 덮지 못하는 주제**만 골라 새 카테고리를 만드세요.\n"
    "규칙:\n"
    "- 확정 목차나 접힌 레이블과 의미가 겹치는 것, 그 하위 항목·동의어·표현만 바꾼 것은 "
    "절대 내지 마세요.\n"
    "- 새 카테고리끼리도 서로 겹치면 안 됩니다.\n"
    "- 관찰 횟수가 많은 후보를 우선하세요. 1회만 관찰된 좁은 후보는 그대로 옮기지 말고 "
    "여러 후보를 아우르는 넓은 주제로 묶어 이름 붙이세요.\n"
    "- 카테고리명은 12자 이내의 짧은 명사구로 하세요.\n"
    "- 중요도 순으로 정렬하세요.\n"
    "finalize_categories 도구로만 응답하세요."
)

# 리필 여분. 돌아온 레이블 중 일부는 호출측 접기 규칙(kb2_taxonomy)에 걸려 버려지므로
# 딱 빈 칸 수만 받으면 모자라고, 모자란 칸은 1회 관찰 레이블로 채워진다(코드 리필).
REFILL_SPARE = 3


def refill_categories(
    uncovered: list[dict], kept_labels: list[str], folded_labels: list[str], count: int
) -> list[dict]:
    """근사 동의어를 접어 빈 목차 칸을 다시 채운다(2026-09-13, 트리 가독성).

    **왜 채워야 하나**: 접기만 하면 목차가 줄고, 목차가 줄면 커버리지가 떨어진다 — 같은
    150건·순차 3회 A/B/C 실험에서 "접고 30개로 채움" 53.6% ≈ 현행 51.8%(편차 안) 인 반면
    "접고 22개로 축소" 46.4%(편차 밖)였다. 접기만 하는 구현은 기각된 C 그 자체다.

    **왜 LLM 인가**: B 실험은 맵 후보를 관찰 횟수순으로 코드가 채웠는데, 실측 후보 72개
    중 고유 59개의 **52개가 1회 관찰**이라 코드 리필은 곧 1회짜리 좁은 레이블(추석선물·
    학회등록증류)을 되돌려놓는 일이다 — 트리 가독성이 목적인 작업이 가독성을 해친다.
    merge 가 흡수시킨 좁은 후보를 넓은 주제로 다시 묶는 판단은 모델 몫이다.
    ⚠️ 단 기대만큼은 아직 못 봤다: 드라이런(2026-09-13, 덮이지 않은 후보 20개 전부 1회
    관찰)에서 모델은 묶지 않고 **후보를 관찰 순서대로 거의 그대로** 골랐다 — 결과가 코드
    리필과 같았다. 호출 1회(2.6초)라 두되, 묶는지는 후보에 반복 관찰 주제가 섞인 회차에서
    labelFold.refillProposed 로 되짚을 것.

    **입력은 전체 후보가 아니라 `uncovered`** — 현 목차 어느 레이블과도 접기 규칙에 안
    걸리는 후보만(관찰 횟수 포함, 호출측이 거른다). 처음엔 전체 후보 + 금지 목록을 줬는데
    드라이런(2026-09-13)에서 모델이 **후보 목록 머리를 그대로 베껴** 11개 전부가 기존
    레이블과 겹쳤다(복리후생비·접대비·인테리어비용…). 무엇이 이미 덮였는지는 모델이 알 수
    없고 파이썬은 공짜로 안다 — tally_candidates 와 같은 수법이다.

    실패는 삼키지 않는다 — 예외를 올려보내 호출측이 코드 리필로 넘어가며 사유를 센다.
    돌아온 레이블이 정말 새 주제인지는 여기서 믿지 않고 호출측이 같은 접기 규칙으로
    다시 거른다."""
    listing = "\n".join(
        f"- {c['label']} ({c['count']}회 관찰): {c['description']}" for c in uncovered
    )
    header = (
        "[확정 목차]\n" + "\n".join(f"- {label}" for label in kept_labels)
        + "\n\n[중복이라 접힌 레이블 — 이것들과 겹치는 주제도 다시 내지 말 것]\n"
        + "\n".join(f"- {label}" for label in folded_labels)
        + f"\n\n[채울 칸] {count}개. 일부가 중복으로 걸러질 수 있으니 중요도순으로 "
        f"{count}~{count + REFILL_SPARE}개를 내세요.\n\n"
        "[아직 목차가 덮지 못한 후보 — 여기서만 고르거나 묶을 것]\n"
    )
    resp = bounded_client(TIMEOUT_REFILL_CATEGORIES).chat.completions.create(
        model=_chat_model(),
        messages=[
            {"role": "system", "content": _REFILL_CATEGORIES_SYSTEM},
            # 잘리면 후보 꼬리(관찰 횟수가 적은 쪽)부터 잘리도록 목록을 뒤에 둔다.
            {"role": "user", "content": (header + listing)[:12000]},
        ],
        tools=[_finalize_categories_tool(min_items=count, max_items=count + REFILL_SPARE)],
        tool_choice={"type": "function", "function": {"name": "finalize_categories"}},
        temperature=0,
    )
    tool_calls = getattr(resp.choices[0].message, "tool_calls", None)
    if not tool_calls:
        raise ValueError("no tool call")
    args = json.loads(tool_calls[0].function.arguments)
    return _dedup_labels([
        {"label": c["label"].strip(), "description": (c.get("description") or "").strip()}
        for c in args.get("categories", [])
        if c.get("label", "").strip()
    ])


# ── kb2 세목 자동 그룹화 — 대목 제안 (로드맵 4.6단계, 2026-09-09) ─────────────────
# "미분류" 세목들을 대목(kb2.groups)으로 묶는다. 하드코딩된 표준 세무 대분류를 쓰지
# 않고, Solar Pro의 세무 지식으로 세목 제목만 보고 표준적인 대분류를 스스로 판단하게
# 한다(국내 AI 트랙 취지 — 구조 자체가 Upstage 산출물이어야 함). 30개 안팎이라 배치
# 없이 두 번의 호출(대목 확정 → 세목 배정)로 처리.

# 2단 구조인 이유는 측정된 것이다(2026-09-16). 원래는 한 번에 "대목마다 소속 세목
# 배열"을 받았는데, 그 형식은 **세목당 정확히 하나**를 프롬프트로 부탁만 할 뿐 구조로
# 강제하지 못한다. 활성 29개 세목 실측:
#
#   기존(그룹→세목 배열, 기존 레이블 없음)  배정 20/29 · 누락 9 · 중복 1 · 한 대목에 17개
#   기존 + 기존 레이블 제공                배정 30/29 · 누락 2 · 중복 3 · 한 대목에 23개
#   세목→대목 뒤집기(아래 2패스)           배정 29/29 · 누락 0 · 중복 0
#
# 즉 **누락·중복은 스키마를 뒤집는 것만으로 사라진다**(documentId 가 enum 인 항목을
# 세목 수만큼 정확히 받으므로, 빠뜨리거나 두 번 내는 것이 애초에 불가능하다).
#
# 그런데 뒤집기만 하면 이번엔 대목이 **17개로 파편화**됐다 — 모델이 세목 제목을 그대로
# 대목 이름으로 복사한다('복리후생비 정책 사전'이 대목 이름이 된 사례까지 나왔다).
# 대목 수 상한(3~8)도 프롬프트로 부탁만 해서는 안 지켜진다.
#
# 그래서 재구조화 파이프라인이 이미 쓰는 것과 **같은 2단 구조**로 간다:
#   merge_categories(목차 확정) → classify_dynamic_category(그 목차 안에서만 고름)
# 여기서는 패스1이 대목 목록을 minItems/maxItems 로 개수까지 확정하고, 패스2는 그
# 확정 목록을 **enum** 으로만 고른다 — 새 이름을 지어내는 것이 구조적으로 불가능해진다.
#
# ⚠️ 패스2는 30건을 한 번에 배정한다. "분류 배치화 금지"(kb2_taxonomy._classify_all)와
# 충돌하는 것처럼 보이지만 조건이 다르다 — 거기서 깨진 건 700자짜리 원문 20건을 한
# 프롬프트에 넣었을 때이고, 여기 입력은 제목 한 줄씩이다. 실측에서 29/29 전부 배정됐다.
# 그래도 누락은 **미분류로 남기고 세지** 조용히 넘기지 않는다(반환값의 배정 수).

GROUP_MIN_LABELS = 3
GROUP_MAX_LABELS = 8

_DEFINE_GROUPS_SYSTEM = (
    "당신은 세무 정책 사전의 목차를 정리하는 도구입니다. 주어진 세목(정책 사전 문서) "
    "제목 목록 전체를 읽고, 이 세목들을 담을 **대목(대분류) 이름 목록**을 정하세요. "
    f"대목은 {GROUP_MIN_LABELS}~{GROUP_MAX_LABELS}개입니다.\n"
    "규칙:\n"
    "1. [기존 대목]이 주어지면 **그 이름을 글자 그대로 쓰는 것을 우선**하세요. 세무사가 "
    "이미 쓰고 있는 이름이라, 뜻이 같은데 이름만 다른 대목을 만들면 화면에서 같은 주제가 "
    "두 줄로 갈라집니다.\n"
    "2. 다만 **기존 대목을 채우는 것이 목적이 아닙니다.** 이번 세목 목록을 먼저 읽고, "
    "기존 대목이 담지 못하는 주제가 있으면 **새 대목을 반드시 추가하세요.** 이번 목록에 "
    "해당 세목이 없는 기존 대목은 빼도 됩니다.\n"
    "3. **어느 한 대목이 전체 세목의 절반 이상을 담게 하지 마세요.** 그렇게 된다면 대목이 "
    "모자란 것이니 주제를 더 갈라 대목을 추가하세요.\n"
    "4. '기타', '특수', '그 외'처럼 **내용을 규정하지 않는 이름은 마지막 수단**입니다. "
    "그런 대목은 무엇이든 빨아들여서, 있으나 마나 한 분류가 됩니다.\n"
    "5. 대목은 실제 한국 세무 실무에서 통용되는 대분류여야 합니다(예: '차량·자산 관련비', "
    "'인건비·복리후생', '광고·마케팅비', '부가가치세', '소득세·법인전환').\n"
    "6. **세목 이름을 그대로 대목 이름으로 쓰지 마세요.** 대목은 여러 세목을 담는 "
    "상위 묶음입니다 — 세목 하나만 담을 이름이라면 그건 대목이 아닙니다.\n"
    "define_document_groups 도구로만 응답하세요."
)

_ASSIGN_GROUPS_SYSTEM = (
    "당신은 세무 정책 사전의 목차를 정리하는 도구입니다. [대목 목록]과 [세목 목록]이 "
    "주어집니다. 세목을 하나씩 읽고 **각 세목이 속할 대목을 목록에서 하나 고르세요**.\n"
    "주어진 세목을 하나도 빠짐없이, 각각 정확히 한 번씩 내세요. 대목은 반드시 주어진 "
    "목록 안에서만 고르고, 새 이름을 만들지 마세요. 어느 대목에도 딱 맞지 않으면 가장 "
    "가까운 것을 고르세요.\n"
    "목록에 '기타'나 '특수'처럼 내용을 규정하지 않는 대목이 있다면, **그것은 정말로 어느 "
    "대목에도 속하지 않는 세목에만** 쓰세요 — 애매하다는 이유로 그쪽에 몰면 분류를 하지 "
    "않은 것과 같습니다.\n"
    "assign_document_groups 도구로만 응답하세요."
)


def _define_document_groups_tool() -> dict:
    return {
        "type": "function",
        "function": {
            "name": "define_document_groups",
            "description": "세목들을 담을 대목(대분류) 이름 목록을 정한다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "labels": {
                        "type": "array",
                        "minItems": GROUP_MIN_LABELS,
                        "maxItems": GROUP_MAX_LABELS,
                        "items": {"type": "string", "description": "대분류명(명사형, 짧게)."},
                    }
                },
                "required": ["labels"],
            },
        },
    }


def _assign_document_groups_tool(document_ids: list[str], labels: list[str]) -> dict:
    return {
        "type": "function",
        "function": {
            "name": "assign_document_groups",
            "description": "세목마다 속할 대목을 목록에서 하나 고른다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "assignments": {
                        "type": "array",
                        # 세목 수만큼 정확히 — 누락·중복을 구조로 막는 자리다.
                        "minItems": len(document_ids),
                        "maxItems": len(document_ids),
                        "items": {
                            "type": "object",
                            "properties": {
                                "documentId": {"type": "string", "enum": document_ids},
                                # enum 이라 새 대목을 지어낼 수 없다 — 파편화(실측 17개)를
                                # 막는 자리이자, 이 함수가 2패스인 이유 그 자체다.
                                "groupLabel": {"type": "string", "enum": labels},
                            },
                            "required": ["documentId", "groupLabel"],
                        },
                    }
                },
                "required": ["assignments"],
            },
        },
    }


def _define_document_groups(documents: list[dict], existing_labels: list[str]) -> list[str]:
    """패스1 — 대목 이름 목록 확정. 실패 시 빈 리스트."""
    listing = ""
    if existing_labels:
        listing += (
            "[기존 대목 — 가능하면 이 이름을 그대로 쓸 것]\n"
            + "\n".join(f"- {label}" for label in existing_labels)
            + "\n\n"
        )
    listing += "[담아야 할 세목]\n" + "\n".join(f"- {d['title']}" for d in documents)
    resp = bounded_client(TIMEOUT_PROPOSE_GROUPS).chat.completions.create(
        model=_chat_model(),
        messages=[
            {"role": "system", "content": _DEFINE_GROUPS_SYSTEM},
            {"role": "user", "content": listing[:12000]},
        ],
        tools=[_define_document_groups_tool()],
        tool_choice={"type": "function", "function": {"name": "define_document_groups"}},
        temperature=0,
    )
    tool_calls = getattr(resp.choices[0].message, "tool_calls", None)
    if not tool_calls:
        return []
    args = json.loads(tool_calls[0].function.arguments)
    out: list[str] = []
    seen: set[str] = set()
    for label in args.get("labels", []):
        label = (label or "").strip()
        # 같은 이름이 두 번 나오면 enum 이 깨진다(같은 값이 두 칸). 정규화로 접는다 —
        # 호출측 get_or_create_group 이 쓰는 규칙과 같아야 화면에서도 하나로 보인다.
        key = "".join(label.split()).replace("·", "").lower()
        if label and key not in seen:
            seen.add(key)
            out.append(label)
    return out


def propose_document_groups(documents: list[dict], existing_labels: list[str] | None = None) -> list[dict]:
    """documents: [{"id": str, "title": str}, ...]. 반환: [{"label": str, "documentIds": [str]}, ...].
    실패 시 빈 리스트(호출측이 아무것도 재배치하지 않고 스킵).

    existing_labels 는 **지금 살아있는 대목**이다. 이걸 안 주면 모델은 매번 맨바닥에서
    이름을 짓고, 그 결과가 기존 대목과 뜻만 같고 글자가 달라 세목이 두 대목으로 갈라진다
    — 호출측이 이름으로 기존 대목을 재사용하기 때문에, 재사용 여부가 사실상 모델이 고른
    철자에 달려 있다. 그래서 후보를 주고 '그대로 쓰라'고 못박는다. (호출측
    get_or_create_group 이 정규화 비교로 한 겹 더 막지만, 거기서 막는 건 '띄어쓰기·
    가운뎃점만 다른 같은 이름'이고 '뜻만 같은 다른 이름'은 여기서만 막을 수 있다.)

    반환 형식은 예전 1패스 시절 그대로 유지한다 — 호출측(auto_group_ungrouped_documents)이
    '대목 하나와 그 소속 세목들'을 받아 get_or_create_group 으로 처리하는 구조라, 안쪽을
    2패스로 바꾼 것이 바깥으로 새 나갈 이유가 없다."""
    if not documents:
        return []
    document_ids = [d["id"] for d in documents]
    try:
        labels = _define_document_groups(documents, existing_labels or [])
        if not labels:
            return []

        listing = (
            "[대목 목록 — 이 중에서만 고를 것]\n"
            + "\n".join(f"- {label}" for label in labels)
            + "\n\n[대목을 정할 세목]\n"
            + "\n".join(f"- [{d['id']}] {d['title']}" for d in documents)
        )
        resp = bounded_client(TIMEOUT_PROPOSE_GROUPS).chat.completions.create(
            model=_chat_model(),
            messages=[
                {"role": "system", "content": _ASSIGN_GROUPS_SYSTEM},
                {"role": "user", "content": listing[:12000]},
            ],
            tools=[_assign_document_groups_tool(document_ids, labels)],
            tool_choice={"type": "function", "function": {"name": "assign_document_groups"}},
            temperature=0,
        )
        tool_calls = getattr(resp.choices[0].message, "tool_calls", None)
        if not tool_calls:
            return []
        args = json.loads(tool_calls[0].function.arguments)

        valid_ids = set(document_ids)
        valid_labels = {label: label for label in labels}
        assigned: dict[str, str] = {}
        for item in args.get("assignments", []):
            document_id = item.get("documentId")
            label = (item.get("groupLabel") or "").strip()
            # enum 을 뚫고 나온 값은 버린다 — 여기서 받아주면 패스1이 확정한 개수 제약이
            # 무의미해진다. 버려진 세목은 미분류로 남고, 화면 버튼으로 다시 시도할 수 있다.
            if document_id not in valid_ids or label not in valid_labels:
                continue
            # 같은 세목이 두 번 나오면 첫 배정만 — 나중 것이 이기면 배정이 호출 순서에
            # 달리고, 그건 화면에서 설명할 수 없는 결과가 된다.
            assigned.setdefault(document_id, label)

        grouped: dict[str, list[str]] = {}
        for document_id, label in assigned.items():
            grouped.setdefault(label, []).append(document_id)
        # 패스1이 냈지만 아무 세목도 안 붙은 대목은 내보내지 않는다 — 빈 대목을 만들면
        # 트리에 0개짜리 줄이 생기고, 그건 세무사가 지워야 할 쓰레기가 된다.
        return [{"label": label, "documentIds": ids} for label, ids in grouped.items()]
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
    "6. **[AI 답변]은 세무사 검수를 받은 AI 초안이지 확정된 지식이 아닙니다.** [세무사 코멘트]가 "
    "AI 답변의 어떤 주장을 틀렸다·모순이다·부적절하다·환각이다고 지적했다면 그 주장은 문장으로 옮기지 "
    "마세요. 그 묶음은 **코멘트가 제시한 올바른 내용**을 문장으로 써서 근거로 삼으세요(규칙 5는 이렇게 "
    "충족합니다). AI 답변이나 시스템이 무엇을 잘못했는지는 서술하지 말고, 세무 처리 기준만 쓰세요.\n"
    "7. 질문자의 개별 사실(특정 차종·금액·인원·연도·가족관계)을 조항에 넣지 말고, 처리 기준으로 일반화하세요.\n"
    "8. 반드시 emit_kb2_sentences 도구로만 출력하세요."
)
# 규칙 6·7 (2026-09-18, 로드맵 P8). 활성 kb2 문장 446건 중 최소 30건이 세무사가 오류로 지적한 [AI 답변]
# 문장을 거의 그대로 옮긴 것이었다(bigram 유사도 ≥0.6, 코멘트 쪽보다 +0.15 이상) — 예: "운행기록부를
# 작성하여 입증할 경우 연 1,500만원 한도 내에서 실제 사용비율"(코멘트: 한도의 의미를 반대로 이해). 규칙 5의
# 커버 압력이 "이 묶음에서 뭐라도 뽑아라"로 작동해, 코멘트가 짧으면 긴 AI 답변 쪽에서 문장을 뽑았다.
# "포르쉐 카이엔을 업무용으로 등록하면 전액(150,000,000원)" 같은 사안 사실 박제도 같은 경로다.
# 규칙만으로는 부족했다 — 같은 13개 문서 × 2회 드라이런에서 옮김 30.9% → 20.0%. 그래서 입력 쪽에서
# 오류 지적 번들의 [AI 답변]을 빼고(_synthesis_view) 보낸다: 옮김 0.9%, 인용률 89.5 → 93.2%.
# (docs P8_측정자료_260918/kb2_prompt_dryrun*.log)

# 세무사 코멘트가 AI 답변을 오류로 지적했다는 표지. 코멘트 태그(법적 해석 오류·문법적 오류)와 세션 평가의
# 법률 정확성 1~2점. '제안' 태그는 AI 답변이 틀렸다는 뜻이 아니라서 넣지 않는다.
_AI_ANSWER_FLAGGED = re.compile(r"법적 해석 오류|문법적 오류|법률적 정확성 [12]/5")
_BUNDLE_SECTION = re.compile(r"^\[(질문|AI 답변|세무사 코멘트)\]", re.M)


def _synthesis_view(content: str) -> str:
    """합성에 보여줄 번들 본문. 세무사가 오류를 지적한 번들은 [AI 답변] 절을 뺀다.

    틀린 주장이 입력에 있는 한 모델은 규칙 6을 어기고 그걸 옮겨 적는다(위 실측). 코멘트만으로도
    지적 대상이 대개 복원된다 — 세무사 코멘트가 틀린 주장을 따옴표로 인용하며 정답을 적는 형식이라서다.
    적재·검색(rag.passages.content)은 그대로다 — 이건 KB2 합성 입력에만 쓰는 보기다."""
    parts = list(_BUNDLE_SECTION.finditer(content))
    comment = "".join(
        content[m.end(): parts[i + 1].start() if i + 1 < len(parts) else len(content)]
        for i, m in enumerate(parts) if m.group(1) == "세무사 코멘트"
    )
    if not _AI_ANSWER_FLAGGED.search(comment):
        return content
    kept = [content[: parts[0].start()]] if parts else [content]
    for i, m in enumerate(parts):
        if m.group(1) != "AI 답변":
            kept.append(content[m.start(): parts[i + 1].start() if i + 1 < len(parts) else len(content)])
    return "".join(kept)


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


# 합성 프롬프트에 넣는 원문 총량(자). 12000 → 6000 (2026-09-11).
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
    return f"[묶음 id={p['id']}]\n{_synthesis_view(p['content'])}"


def synthesize_kb2_sentences(
    tax_category: str, passages: list[dict]
) -> tuple[list[dict], str | None]:
    """passages: [{"id": str, "content": str}, ...] (같은 세목의 rag.passages).
    반환은 **(문장들, 실패사유)** — 실패사유는 성공 시 None.

    투입량 제한은 호출측이 fit_passages_for_synthesis 로 미리 처리한다 — 여기 남은
    절단은 그 계약이 깨졌을 때를 위한 안전망일 뿐이다.

    반환이 튜플인 이유(2026-09-11). 이전에는 `except Exception: return []` 이라
    **호출 실패가 '인용 0'으로 둔갑**했다 — classify_dynamic_category 가 429 를
    '미분류'로 접던 것과 같은 구멍이고, 같은 방식으로 측정을 오염시킨다. 실측(고정된
    304건·순차 3회)에서 회차 인용률이 84.9 / 80.6 / 87.5% 로 흔들렸는데, 타임아웃이
    난 세목을 빼면 87.5 / 86.7 / 87.1% 다 — **겉보기 편차 7.9% 는 전부 호출 실패에서
    오고 모델 편차는 0.9% 다.** 청크 하나가 죽으면 그 청크의 원문 ~10건이 통째로
    미인용이 되므로(실측 `개원비용` 6/16 vs 15/16), 이건 세어서 화면에 남겨야 한다."""
    if not passages:
        return [], None
    passages, _dropped = fit_passages_for_synthesis(passages)
    # 프롬프트에는 36자 uuid 대신 P1..Pn 짧은 별칭을 보여주고 출력에서 되돌린다
    # (2026-09-11). uuid 를 그대로 쓰면 모델이 옮겨적기 부담 때문에 일부 묶음을 아예
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
        # retries=0 인 이유(2026-09-12). 이 호출만 재시도가 **두 겹**이었다 — SDK 내부
        # 1회 + 호출측 CHUNK_ATTEMPTS 3회. 대가가 둘이다. ① 체감 상한이 240초가 아니라
        # 480초다(실측 실패 1건이 정확히 480.7초 = 240×2). ② **계측이 오염된다** —
        # SDK 재시도는 우리 눈 밖에서 일어나므로 "240초 물렸다가 재시도로 3초 만에
        # 성공"이 successMs 에 243초 한 건으로 찍힌다. 실제로 첫 측정의 p90 243.2s·
        # max 248.3s 가 이 모양이라 '정상 호출의 진짜 분포'를 못 읽었다.
        # 재시도 자체는 잃지 않는다 — CHUNK_ATTEMPTS 루프가 하고, 그쪽은 failedCalls
        # 로 **세어진다**. 여기서만 끄면 한 번의 호출 = 한 개의 소요값이 된다.
        resp = bounded_client(TIMEOUT_SYNTHESIZE, retries=0).chat.completions.create(
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
            # tool_choice 로 강제했는데 안 지킨 것 — 모델이 "할 말 없다"고 한 것이
            # 아니라 호출이 실패한 것이다.
            return [], "no_tool_call"
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
        return out, None
    except Exception as e:  # noqa: BLE001 — 사유만 올려보내고 파이프라인은 계속 돈다
        return [], type(e).__name__
