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
import threading
import time
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone

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


# ── 원문 기록 모드(10/19) — 대회 "국내 AI API 호출 로그" 제출용 ──────────────────────────────────────────────
# 위 사용 로그는 메타(fn·모델·토큰·지연)만 남긴다. 제출 가이드는 호출 1건 = {요청 시각(KST)·엔드포인트(도메인 포함)·요청 모델·
# 요청 메시지 전체 / 응답 시각(KST)·응답 본문(ID·모델·답변·토큰)} 을 요구한다 → API_CALL_CAPTURE_DIR 가 설정되면 그 폴더의
# calls.jsonl 에 호출 1건 = JSON 한 줄로 누적한다. 기본 꺼짐(운영 .env 에 두지 않는다 — 사용자 발화 원문이 남는다).
# API 키·Authorization 헤더는 SDK 클라이언트 쪽에만 있고 create(**kwargs) 에는 없다. 그래도 헤더·키 성격의 인자는 지운다.
CAPTURE_FILE = "calls.jsonl"
_KST = timezone(timedelta(hours=9))
_SECRET_KWARGS = frozenset({"extra_headers", "api_key", "authorization", "default_headers"})
_CAPTURE_LOCK = threading.Lock()


def capture_dir() -> str | None:
    return os.environ.get("API_CALL_CAPTURE_DIR") or None


def kst_now() -> str:
    return datetime.now(_KST).isoformat(timespec="milliseconds")


def endpoint(kwargs: dict) -> str:
    """실제 호출 URL — llm.get_client() 와 같은 base_url 규칙 + OpenAI 호환 경로."""
    base = os.environ.get("UPSTAGE_BASE_URL", "https://api.upstage.ai/v1").rstrip("/")
    return base + ("/embeddings" if "input" in kwargs else "/chat/completions")


def _jsonable(v):
    return json.loads(json.dumps(v, ensure_ascii=False, default=lambda o: o.model_dump() if hasattr(o, "model_dump") else str(o)))


def _response_body(resp):
    if resp is None:
        return None
    if hasattr(resp, "model_dump"):
        return resp.model_dump()
    return _jsonable(resp)


def capture_record(label: str, kwargs: dict, requested_at: str, responded_at: str,
                   resp=None, error: BaseException | None = None) -> dict:
    conv = current()
    rec = {
        "fn": label,
        "channel": channel(conv),
        "conversation": conv_hash(conv),
        "request": {
            "requested_at_kst": requested_at,
            "method": "POST",
            "endpoint": endpoint(kwargs),
            "model": kwargs.get("model"),
            "body": _jsonable({k: v for k, v in kwargs.items() if k.lower() not in _SECRET_KWARGS}),
        },
        "response": {
            "responded_at_kst": responded_at,
            "ok": error is None,
            "body": _response_body(resp),
        },
    }
    if error is not None:
        rec["response"]["error"] = {"type": type(error).__name__, "message": str(error)[:500]}
    return rec


def capture(label: str, kwargs: dict, requested_at: str, resp=None, error: BaseException | None = None) -> None:
    """원문 기록 — 꺼져 있으면 아무것도 안 한다. 실패해도 호출은 그대로."""
    d = capture_dir()
    if not d:
        return
    try:
        rec = capture_record(label, kwargs, requested_at, kst_now(), resp, error)
        os.makedirs(d, exist_ok=True)
        with _CAPTURE_LOCK, open(os.path.join(d, CAPTURE_FILE), "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False, separators=(",", ":")) + "\n")
    except Exception:
        pass
