"""
0061(사용 현황 M1 — 방문·유입 기록 analytics.events) 적용 뒤 확인.

사용:
    backend/.venv/Scripts/python.exe supabase/check_0061.py

① DB 읽기 전용: 표·함수·권한·cron 확인
② 실제 경로: frontend/.env.local 의 anon 키로 PostgREST `rpc/analytics_track` 를 불러 1행이 생기는지 확인한 뒤
   그 시험 행(visitor_id = check0061-…)만 지운다. anon 이 표를 직접 못 읽는지도 REST 로 확인한다.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from dotenv import dotenv_values

sys.path.insert(0, str(Path(__file__).resolve().parent))
from apply_migration import db_url  # noqa: E402

REPO = Path(__file__).resolve().parents[1]


def frontend_env() -> tuple[str | None, str | None]:
    env = {**dotenv_values(REPO / "frontend" / ".env.local"), **os.environ}
    return env.get("NEXT_PUBLIC_SUPABASE_URL"), env.get("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") or env.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")


def rest(url: str, key: str, path: str, body: object | None = None) -> tuple[int, str]:
    req = urllib.request.Request(f"{url}/rest/v1/{path}", method="POST" if body is not None else "GET",
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def main() -> None:
    import psycopg

    sys.stdout.reconfigure(encoding="utf-8")
    fails = 0

    def check(label: str, ok: bool, detail: object = "") -> None:
        nonlocal fails
        fails += 0 if ok else 1
        print(f"[{'OK' if ok else 'FAIL'}] {label}" + (f" : {detail}" if detail != "" else ""))

    with psycopg.connect(db_url()) as conn:
        conn.execute("set transaction read only")
        cur = conn.cursor()
        cur.execute("select version from supabase_migrations.schema_migrations where version = '0061'")
        check("schema_migrations 0061 기록", cur.fetchone() is not None)
        cur.execute("select to_regclass('analytics.events'), to_regclass('analytics.campaigns')")
        check("analytics.events · analytics.campaigns", all(cur.fetchone()))
        cur.execute("select has_function_privilege('anon', 'public.analytics_track(jsonb)', 'execute'), "
                    "has_function_privilege('authenticated', 'public.analytics_track(jsonb)', 'execute'), "
                    "has_function_privilege('anon', 'public.purge_old_analytics_events()', 'execute')")
        anon_x, auth_x, anon_purge = cur.fetchone()
        check("analytics_track 실행권 anon·authenticated", anon_x and auth_x)
        check("파기 함수는 anon 실행 불가", not anon_purge)
        cur.execute("select has_table_privilege('anon', 'analytics.events', 'select'), has_table_privilege('authenticated', 'analytics.events', 'select'), "
                    "has_table_privilege('anon', 'analytics.events', 'insert')")
        check("events 표 직접 권한 없음(anon·authenticated)", not any(cur.fetchone()))
        cur.execute("select exists (select 1 from pg_extension where extname = 'pg_cron')")
        if cur.fetchone()[0]:
            cur.execute("select schedule from cron.job where jobname = 'purge-old-analytics-events'")
            row = cur.fetchone()
            check("cron purge-old-analytics-events", row is not None, row[0] if row else "")
        cur.execute("select count(*), count(distinct visitor_id), max(ts) from analytics.events")
        print("   현재 기록:", dict(zip(["행", "방문자", "최근"], cur.fetchone())))
        conn.rollback()

    url, key = frontend_env()
    if not url or not key:
        check("frontend/.env.local 의 Supabase URL·anon 키", False)
    else:
        vid = f"check0061-{uuid.uuid4().hex[:12]}"
        status, body = rest(url, key, "rpc/analytics_track", {"p_events": [
            {"visitor_id": vid, "session_id": vid, "event": "visit", "path": "/check", "ft": {"source": "check"}, "device": "desktop"},
            {"visitor_id": vid, "session_id": vid, "event": "page_view"},
        ]})
        check("REST anon rpc/analytics_track → 1건 기록(화이트리스트 밖 1건은 버림)", status == 200 and body.strip() == "1", f"{status} {body[:120]}")
        status, body = rest(url, key, "events?select=id&limit=1")
        check("REST anon 으로 events 직접 조회 불가", status >= 400, status)
        with psycopg.connect(db_url()) as conn:
            n = conn.execute("delete from analytics.events where visitor_id = %s", (vid,)).rowcount
            conn.commit()
        check("시험 행 삭제", n == 1, n)

    print("\n모두 OK" if fails == 0 else f"\nFAIL {fails}건")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
