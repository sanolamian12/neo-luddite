"""
Upstage 호출 사용 로그 — 호출 1회 = stdout JSON 한 줄(→ journald). 대회 "API/사용 로그" 제출용(10/12).

왜 journald 인가: Supabase 는 egress 293% 초과·DB 크기 한도 근처다(docs/doing/261012_Supabase_egress초과_진단_및_대응.md).
호출마다 DB 에 쓰면 행이 쌓이고 조회가 egress 가 된다 — 그래서 DB 를 전혀 건드리지 않고 서버 로컬 로그에만 남긴다.
마이그레이션 0, 네트워크 0. 꺼내기는 scripts/usage_log_export.py(journalctl 출력 → CSV·일자별 집계).

· 기록 지점은 llm._Gated.gated_create 한 곳 — 런타임 Upstage 호출(챗·임베딩, 헤지 중복 포함)이 전부 여기를 지난다.
· 사용자 발화·답변 본문은 남기지 않는다. 대화 id 는 해시 12자로만(비식별), 채널(chat/room/eval/bg)은 접두어로 가른다.
· SDK 재시도(max_retries=1)는 한 줄로 합쳐진다 — 줄 수 = 우리 쪽 호출 수.
· UPSTAGE_CALL_LOG=off 로 끈다(재시작만).
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from contextvars import ContextVar

PREFIX = "[upstage_call] "

_CONV: ContextVar[str | None] = ContextVar("usage_log_conv", default=None)


def enabled() -> bool:
    return os.environ.get("UPSTAGE_CALL_LOG", "on") != "off"


def bind(conversation_id: str | None) -> None:
    """이 요청(컨텍스트)의 호출에 대화를 붙인다. run_clinic 첫머리에서 부른다 — 요청마다 컨텍스트가 따로라 되돌릴 필요 없다."""
    _CONV.set(conversation_id or None)


def current() -> str | None:
    return _CONV.get()


def channel(conversation_id: str | None) -> str:
    if not conversation_id:
        return "bg"          # 적재·분류·배치 등 대화 밖 호출
    if conversation_id.startswith("room_"):
        return "room"        # 3자 방 세무사 AI
    if conversation_id.startswith("eval-"):
        return "eval"        # backend/eval 러너
    return "chat"


def conv_hash(conversation_id: str | None) -> str | None:
    if not conversation_id:
        return None
    return hashlib.sha256(conversation_id.encode("utf-8")).hexdigest()[:12]


def _usage(resp) -> dict:
    u = getattr(resp, "usage", None)
    if u is None:
        return {}
    out = {}
    for k in ("prompt_tokens", "completion_tokens", "total_tokens"):
        v = getattr(u, k, None)
        if isinstance(v, int):
            out[k] = v
    return out


def line(label: str, kwargs: dict, resp=None, latency_ms: int = 0, error: BaseException | None = None) -> str:
    conv = current()
    rec = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "fn": label,
        "kind": "embed" if "input" in kwargs else "chat",
        "model": getattr(resp, "model", None) or kwargs.get("model"),
        "ch": channel(conv),
        "conv": conv_hash(conv),
        "ms": latency_ms,
        "ok": error is None,
        **_usage(resp),
    }
    if error is not None:
        rec["err"] = type(error).__name__
    return PREFIX + json.dumps(rec, ensure_ascii=False, separators=(",", ":"))


def record(label: str, kwargs: dict, resp=None, latency_ms: int = 0, error: BaseException | None = None) -> None:
    """로그가 실패해도 호출은 그대로 — 계측이 서비스를 깨면 안 된다."""
    if not enabled():
        return
    try:
        print(line(label, kwargs, resp, latency_ms, error), flush=True)
    except Exception:
        pass
