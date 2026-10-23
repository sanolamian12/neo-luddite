"""턴 단위 사용 현황 기록 보조 (0063, 사용 현황 M2 — design/관리자_사용현황_모니터링_대시보드_설계_1021.md §2.4·§2.5).

`_run_clinic` 첫머리에서 `bind(user_text)` 로 이번 턴의 질문·시작 시각을 붙이고, `pipeline._recorded` 가
`fields(resp)` 로 chat_turns 보강 값을, `question()` 으로 가린 질문 원문을 꺼낸다.
답변 경로에는 아무것도 돌려주지 않는다 — 여기서 나는 예외는 _recorded 가 삼킨다.

가림 규칙은 0063 의 analytics.mask_pii 와 같다(DB 트리거가 한 번 더 가린다).
"""

from __future__ import annotations

import re
import time
from contextvars import ContextVar

from api import usage_log

_TURN: ContextVar[tuple[str, float] | None] = ContextVar("turn_record", default=None)

MAX_QUESTION = 500

# (패턴, 설명) — 순서 중요: 사업자번호를 계좌 꼴보다, 휴대폰을 유선보다 먼저.
MASKS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), "이메일"),
    (re.compile(r"\d{6}\s*-\s*[1-8]\d{6}"), "주민·외국인등록번호"),
    (re.compile(r"\d{3}\s*-\s*\d{2}\s*-\s*\d{5}"), "사업자등록번호"),
    (re.compile(r"01[016789][\s.-]?\d{3,4}[\s.-]?\d{4}"), "휴대폰"),
    (re.compile(r"0\d{1,2}[\s.)-]\s?\d{3,4}[\s.-]\d{4}"), "유선 전화"),
    (re.compile(r"\d{3,6}-\d{2,6}-\d{4,8}(?:-\d{1,6})?"), "계좌번호"),
]


def mask(text: str) -> str:
    for pattern, _ in MASKS:
        text = pattern.sub("[가림]", text)
    return text


def bind(user_text: str) -> None:
    """이번 요청(컨텍스트)의 질문과 시작 시각. 요청마다 컨텍스트가 따로라 되돌릴 필요 없다(usage_log.bind 와 같다)."""
    _TURN.set((user_text or "", time.monotonic()))


def channel(conversation_id: str | None) -> str:
    """chat(고객 챗) | room(3자 방) | studio(세무사 스튜디오 시험칸) | eval(평가 러너) | bg."""
    if conversation_id and conversation_id.startswith("studio_"):
        return "studio"
    return usage_log.channel(conversation_id)


def fields(resp, conversation_id: str) -> dict:
    """chat_turns 보강 값 — meta 에 이미 실린 값만 옮긴다(다시 계산하지 않는다)."""
    meta = resp.meta
    extracted = meta.extracted or {}
    bound = _TURN.get()
    return {
        "channel": channel(conversation_id),
        "tax_topic": _short(extracted.get("tax_topic")),
        "question_type": _short(extracted.get("question_type")),
        "handoff_reason": _short(meta.handoff),
        "latency_ms": int((time.monotonic() - bound[1]) * 1000) if bound else None,
    }


def question(conversation_id: str) -> str | None:
    """고객 챗의 이번 질문(가림·500자). 방·스튜디오·평가 턴과 빈 질문은 None — 저장하지 않는다."""
    bound = _TURN.get()
    if not bound or channel(conversation_id) != "chat":
        return None
    text = mask(bound[0].strip())[:MAX_QUESTION]
    return text or None


def _short(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text[:80] or None
