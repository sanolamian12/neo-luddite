"""
데모 계정 access token 발급 — 인증 붙은 쓰기 API 를 스크립트·스모크에서 한 줄로 치기 위한 헬퍼
(P6 ①, 2026-09-17). 로컬 우회 플래그 대신 이걸 쓴다.

사용 (backend/ 에서):
    python -m scripts.dev_token auditor2                 # 토큰만 출력
    python -m scripts.dev_token auditor2 --header        # "Authorization: Bearer ..." 출력

파이썬에서:
    from scripts.dev_token import auth_header
    req = urllib.request.Request(url, data=..., headers={**auth_header("auditor2"), "Content-Type": ...})

이메일 규약 {username}@demo.local, 비번 기본 demo1234(DEMO_PASSWORD 로 오버라이드).
anon key 는 SUPABASE_ANON_KEY → 없으면 frontend/.env.local 의 NEXT_PUBLIC_SUPABASE_ANON_KEY.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from functools import lru_cache
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]


def _env(name: str) -> str:
    from dotenv import dotenv_values

    if os.environ.get(name):
        return os.environ[name]
    return dotenv_values(_BACKEND / ".env").get(name) or ""


def _anon_key() -> str:
    key = _env("SUPABASE_ANON_KEY")
    if key:
        return key
    from dotenv import dotenv_values

    key = dotenv_values(_BACKEND.parent / "frontend" / ".env.local").get("NEXT_PUBLIC_SUPABASE_ANON_KEY") or ""
    if not key:
        raise SystemExit("anon key 없음 — SUPABASE_ANON_KEY 또는 frontend/.env.local 확인")
    return key


@lru_cache(maxsize=None)
def get_token(username: str, password: str | None = None) -> str:
    url = _env("SUPABASE_URL").rstrip("/")
    if not url:
        raise SystemExit("SUPABASE_URL 미설정(backend/.env)")
    body = json.dumps({
        "email": username if "@" in username else f"{username}@demo.local",
        "password": password or os.environ.get("DEMO_PASSWORD", "demo1234"),
    }).encode()
    req = urllib.request.Request(
        f"{url}/auth/v1/token?grant_type=password", data=body, method="POST",
        headers={"apikey": _anon_key(), "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read())["access_token"]


def auth_header(username: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {get_token(username)}"}


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("usage: python -m scripts.dev_token <username> [--header]")
    token = get_token(sys.argv[1])
    print(f"Authorization: Bearer {token}" if "--header" in sys.argv else token)
