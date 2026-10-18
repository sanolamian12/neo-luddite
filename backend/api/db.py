"""
공용 DB 접속 헬퍼 — Supabase Postgres 직결 문자열과 '설정됨' 판정.

원래 api/rag/kb2_store.py 에 있었고 kb3·법령·kbdict·규범·vec_memory·인증·방 agent 가 거기서 빌려 썼다.
옛 검수 흐름 절단 S3(10/16)에서 여기로 옮겼고, S5 에서 모든 import 를 이리로 바꾸고 kb2_store 를 지웠다.
"""

from __future__ import annotations

import os


def _db_url() -> str:
    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        raise RuntimeError("SUPABASE_DB_URL 이 설정되지 않았습니다.")
    raw_pw = os.environ.get("SUPABASE_DB_PASSWORD")
    if raw_pw:
        from urllib.parse import quote

        enc = quote(raw_pw, safe="")
        url = url.replace("[YOUR-PASSWORD]", enc)
        if "[YOUR-PASSWORD]" not in os.environ["SUPABASE_DB_URL"]:
            import re as _re

            url = _re.sub(r"(://[^:/@]+:)[^@]*(@)", rf"\g<1>{enc}\g<2>", url, count=1)
    return url


def is_configured() -> bool:
    """DB 접속 설정 여부 — kb3·법령·규범 저장소가 'DB 있음' 판정으로 쓴다."""
    return bool(os.environ.get("SUPABASE_DB_URL"))
