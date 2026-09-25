"""
LLM1(v2) — 사실 추출 · 되묻기 문안 · 2턴 닫힌 대조. 설계 design/LLM1v2_역할축소_구현설계.md §3·부록 A·B.

    extract_facts()   1턴 — 결론을 가르는 누락 사실(최대 3, 결정력 순). 부록 A 원문 그대로
    check_asked()     2턴~ — **물은 사실만** stated/unknown/missing 으로 대조(열린 재추출 금지, §3)
    write_questions() 되묻기 문안 — D3 대체 질문(rephrase) 포함

LLM1 은 "충분"을 판정하지 않는다. 부록 A 도구에 `sufficiency` 가 남아 있는 것은 측정한 원문을
바꾸지 않기 위해서다(§7-1) — **값은 읽지 않는다.** 멈춤은 pipeline_agentic 의 D4 로직이 맡는다.

`engine_adapter` 를 import 하지 않는다(W3 완료 조건: 되묻기 갈래가 엔진 지출유형 enum 을 안 본다).
날조 방어는 구조로 한다 — 이 모듈은 사실의 **값을 채우지 않는다**(누락 목록과 대조 상태만 낸다).
답변 단계는 대화 원문을 읽으므로, 모델이 지어낸 값이 판정 입력으로 흘러갈 자리가 없다.

호출 규약(하니스 실측, §4-1): tool_choice 강제 · max_tokens 600 · temperature 0 · upstage_gate 경유
(`llm.bounded_client`). `llm.py` 는 고치지 않는다(공유 파일).
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path

from api import upstage_gate
from api.llm import _chat_model, _history_to_messages, bounded_client

log = logging.getLogger("api.llm1")

_PROMPTS = Path(__file__).resolve().parent / "prompts" / "v2"

MAX_MISSING = 3        # 부록 A — 퇴화 잘림 37→0 을 만든 상한
MAX_TOKENS = 600       # 하니스 상한. 넘으면 finish_reason=length 로 인자가 잘린다
TIMEOUT_EXTRACT = 60   # 하니스 p50 1.0초 — llm.TIMEOUT_EXTRACT 와 같은 급
TIMEOUT_CHECK = 60     # 하니스 p50 0.75초
TIMEOUT_ASK = 60

CHECK_STATUSES = ("unknown", "stated", "missing")   # unknown 을 앞에 — "어떤 답이든 stated" 에 먹히지 않게


@lru_cache(maxsize=None)
def _prompt(name: str) -> str:
    return (_PROMPTS / name).read_text(encoding="utf-8").strip()


def _forced(name: str) -> dict:
    return {"type": "function", "function": {"name": name}}


def _tool_args(resp, name: str) -> dict | None:
    """강제 지정한 도구의 인자. 잘림(finish_reason=length)도 로그로 남긴다 — 하니스에서 본 퇴화의 흔적."""
    choice = resp.choices[0]
    if getattr(choice, "finish_reason", None) == "length":
        log.warning("%s: max_tokens(%d) 에 잘림", name, MAX_TOKENS)
    calls = getattr(choice.message, "tool_calls", None)
    if not calls:
        return None
    try:
        return json.loads(calls[0].function.arguments)
    except (json.JSONDecodeError, TypeError):
        return None


def _dialogue(history: list, user_text: str | None) -> str:
    """대조용 대화 원문 — 역할을 붙여 한 덩어리로. 부록 B 는 [상담 질문] 한 칸으로 쟀지만 제품의 2턴은
    답이 여러 발화에 흩어진다(§7-2). 상담사 질문도 넣는다 — "네, 둘 다요" 같은 답은 질문 없이 못 읽는다."""
    lines = []
    for m in _history_to_messages(history):
        who = "사용자" if m["role"] == "user" else "상담사"
        lines.append(f"{who}: {m['content']}")
    if user_text:
        lines.append(f"사용자: {user_text}")
    return "\n".join(lines)


# ── 1턴 추출 (부록 A) ──────────────────────────────────────────────────────────

def _extract_tool() -> dict:
    return {
        "type": "function",
        "function": {
            "name": "judge_sufficiency",
            "description": "질문에 결론을 가르는 사실이 모두 나와 있는지 판정한다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "sufficiency": {"type": "string", "enum": ["sufficient", "insufficient"]},
                    "missing_facts": {
                        "type": "array",
                        "items": {"type": "string"},
                        "maxItems": MAX_MISSING,
                        "description": "insufficient 일 때 빠진 결정적 사실(결정력 순). sufficient 면 빈 배열.",
                    },
                },
                "required": ["sufficiency", "missing_facts"],
            },
        },
    }


def extract_facts(history: list, user_text: str) -> list[str] | None:
    """결론을 가르는 누락 사실(결정력 순, 최대 3). 빈 목록 = 물을 것 없음.

    None = 호출 실패. 호출부가 "물을 것 없음"과 구분해 계측할 수 있게 둘을 합치지 않는다.
    `sufficiency` 값은 **읽지 않는다**(§7-1) — solar-pro3 는 인자에서 missing_facts 를 먼저 쓰므로
    잘려도 목록은 남는다."""
    messages = [{"role": "system", "content": _prompt("extract_system.txt")}]
    messages += _history_to_messages(history)
    messages.append({"role": "user", "content": user_text})
    try:
        resp = bounded_client(TIMEOUT_EXTRACT).chat.completions.create(
            model=_chat_model(),
            messages=messages,
            tools=[_extract_tool()],
            tool_choice=_forced("judge_sufficiency"),
            max_tokens=MAX_TOKENS,
            temperature=0,
        )
    except upstage_gate.UpstageCongested:
        raise
    except Exception as exc:  # noqa: BLE001
        log.warning("extract_facts 실패: %s", exc)
        return None
    data = _tool_args(resp, "judge_sufficiency")
    if data is None:
        return None
    facts: list[str] = []
    for f in data.get("missing_facts") or []:
        f = str(f).strip()
        if f and f not in facts:        # 반복 퇴화 방어 — 같은 사실 두 번이면 한 번만
            facts.append(f)
    return facts[:MAX_MISSING]


# ── 2턴 닫힌 대조 (부록 B 개작 — §7-2) ─────────────────────────────────────────

def _check_tool() -> dict:
    return {
        "type": "function",
        "function": {
            "name": "check_facts",
            "description": "체크리스트 항목마다 사용자가 답했는지 대조한다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "no": {"type": "integer"},
                                "status": {"type": "string", "enum": list(CHECK_STATUSES)},
                            },
                            "required": ["no", "status"],
                        },
                    }
                },
                "required": ["items"],
            },
        },
    }


def check_asked(history: list, user_text: str, facts: list[str]) -> dict[int, str] | None:
    """물은 사실(체크리스트)만 대조 → {항목 index(0-based): stated|unknown|missing}.

    응답에 빠진 번호는 결과에 넣지 않는다(부록 B 의 unjudged — missing 과 따로 센다).
    None = 호출 실패. **새 누락을 찾지 않는다** — 목록 밖 사실은 이 함수가 볼 수조차 없다(§3 ⚠️)."""
    if not facts:
        return {}
    checklist = "\n".join(f"{i}. {f}" for i, f in enumerate(facts, start=1))
    user = f"[상담 대화]\n{_dialogue(history, user_text)}\n\n[체크리스트 — 앞서 물은 사실]\n{checklist}"
    try:
        resp = bounded_client(TIMEOUT_CHECK).chat.completions.create(
            model=_chat_model(),
            messages=[{"role": "system", "content": _prompt("check_system.txt")},
                      {"role": "user", "content": user}],
            tools=[_check_tool()],
            tool_choice=_forced("check_facts"),
            max_tokens=MAX_TOKENS,
            temperature=0,
        )
    except upstage_gate.UpstageCongested:
        raise
    except Exception as exc:  # noqa: BLE001
        log.warning("check_asked 실패: %s", exc)
        return None
    data = _tool_args(resp, "check_facts")
    if data is None:
        return None
    out: dict[int, str] = {}
    for it in data.get("items") or []:
        try:
            idx = int(it.get("no")) - 1
        except (TypeError, ValueError):
            continue
        status = it.get("status")
        if 0 <= idx < len(facts) and status in CHECK_STATUSES and idx not in out:
            out[idx] = status
    return out


# ── 되묻기 문안 ────────────────────────────────────────────────────────────────

def _ask_tool() -> dict:
    return {
        "type": "function",
        "function": {
            "name": "emit_questions",
            "description": "사용자에게 되묻는 문장들을 출력한다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "segments": {
                        "type": "array",
                        "minItems": 1,
                        "items": {
                            "type": "object",
                            "properties": {
                                "text": {"type": "string", "description": "한 문장."},
                                "type": {"type": "string", "enum": ["ack", "follow_up"]},
                            },
                            "required": ["text", "type"],
                        },
                    }
                },
                "required": ["segments"],
            },
        },
    }


def _fallback_questions(items: list[tuple[str, bool]]) -> list[dict]:
    segs = [{"text": "정확한 답변을 위해 몇 가지 확인하고 싶습니다.", "type": "ack"}]
    for fact, rephrase in items:
        lead = "혹시 알고 계신 범위에서라도" if rephrase else "판단을 위해"
        segs.append({"text": f"{lead} '{fact}'을(를) 알려주시겠어요?", "type": "follow_up"})
    return segs


def write_questions(history: list, user_text: str, items: list[tuple[str, bool]]) -> list[dict]:
    """(사실, 다시묻기?) 목록 → 되묻기 세그먼트. 실패하면 결정적 문안으로 — 되묻기 턴이 빈손이면 안 된다."""
    # 표식만 붙이면([다시 묻기]) 같은 질문을 되풀이했다(9/25 스모크) — 항목마다 무엇을 해야 하는지 적는다.
    need = "\n".join(
        f"- {fact} → [다시 묻기] 사용자가 앞서 '모르겠다'고 답함. 같은 질문 금지 — 사용자가 떠올릴 수 있는 "
        "다른 단서(서류·당시 상황·대략적 범위)로 바꿔 물을 것"
        if rephrase else f"- {fact} → 새로 묻기"
        for fact, rephrase in items)
    messages = [{"role": "system", "content": _prompt("ask_system.txt")}]
    messages += _history_to_messages(history)
    messages.append({"role": "user", "content": user_text})
    messages.append({"role": "user", "content": f"[물을 사실]\n{need}\n\n위 사실만 묻는 질문을 작성하세요. "
                                                f"follow_up 문장은 사실마다 하나씩, 정확히 {len(items)}개입니다."})
    try:
        resp = bounded_client(TIMEOUT_ASK).chat.completions.create(
            model=_chat_model(),
            messages=messages,
            tools=[_ask_tool()],
            tool_choice=_forced("emit_questions"),
            max_tokens=MAX_TOKENS,
            temperature=0,
        )
    except upstage_gate.UpstageCongested:
        raise
    except Exception as exc:  # noqa: BLE001
        log.warning("write_questions 실패: %s", exc)
        return _fallback_questions(items)
    data = _tool_args(resp, "emit_questions")
    segs = [s for s in (data or {}).get("segments") or [] if (s.get("text") or "").strip()]
    # 물은 것으로 기록되는 사실이 화면 질문에 없으면 2턴 대조가 "안 물은 걸 missing"으로 센다 —
    # 한 문장에 둘을 합치거나 하나를 빠뜨린 출력(9/25 브라우저 스모크)은 결정적 문안으로 바꾼다.
    if sum(s.get("type") == "follow_up" for s in segs) < len(items):
        log.warning("write_questions: follow_up %d < 사실 %d → 결정적 문안",
                    sum(s.get("type") == "follow_up" for s in segs), len(items))
        return _fallback_questions(items)
    return segs
