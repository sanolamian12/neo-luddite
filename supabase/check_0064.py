"""
0064·0065(사용 현황 M3 — 관리자 읽기 RPC · 게시 코드 · 옛 대화 턴 귀속 고침) 확인. 운영 데이터는 바꾸지 않는다(게시 코드 저장 시험은 되돌린다).

사용:
    backend/.venv/Scripts/python.exe supabase/check_0064.py

하는 일: schema_migrations 기록 · 함수 존재 · 실행 권한(공개 RPC = authenticated 만, 내부 analytics._* = 아무도) ·
관리자 신원(request.jwt.claim.sub)으로 RPC 6종 호출해 요약 출력 · 사장님 신원이면 'admin only' 거부 ·
게시 코드 저장 시험(트랜잭션 롤백) · 응답 시간.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from apply_migration import db_url  # noqa: E402

PUBLIC = [
    "admin_traffic_overview(integer, text)",
    "admin_question_stats(integer, text)",
    "admin_question_feed(integer, text, text, text[], integer, integer)",
    "admin_handoff_demand(integer, text)",
    "admin_list_campaigns()",
    "admin_save_campaign(text, text, text, text)",
]
INTERNAL = ["_excluded_visitors()", "_visitors()", "_conv_visitor()", "_requests()"]


def main() -> None:
    import psycopg

    sys.stdout.reconfigure(encoding="utf-8")
    fails = 0

    def check(label: str, ok: bool, detail: object = "") -> None:
        nonlocal fails
        fails += 0 if ok else 1
        print(f"[{'OK' if ok else 'FAIL'}] {label}" + (f" : {detail}" if detail != "" else ""))

    def as_user(cur, uid: str) -> None:
        cur.execute("select set_config('request.jwt.claim.sub', %s, true), "
                    "set_config('request.jwt.claims', %s, true)", (uid, json.dumps({"sub": uid, "role": "authenticated"})))

    with psycopg.connect(db_url()) as conn:
        cur = conn.cursor()
        cur.execute("select version from supabase_migrations.schema_migrations where version = '0064'")
        check("schema_migrations 0064 기록", cur.fetchone() is not None)
        # 0065(옛 대화 턴 귀속 고침)까지 적용했는지
        cur.execute("select version from supabase_migrations.schema_migrations where version = '0065'")
        check("schema_migrations 0065 기록", cur.fetchone() is not None)
        cur.execute("select pg_get_function_result('analytics._conv_visitor()'::regprocedure)")
        check("_conv_visitor 에 first_ts(0065)", "first_ts" in cur.fetchone()[0])
        for sig in PUBLIC:
            cur.execute("select to_regprocedure(%s) is not null, "
                        "has_function_privilege('anon', %s, 'execute'), has_function_privilege('authenticated', %s, 'execute')",
                        (f"public.{sig}",) * 3)
            exists, anon, auth = cur.fetchone()
            check(f"public.{sig.split('(')[0]} 권한(anon ✗ · authenticated ✓)", exists and not anon and auth, (exists, anon, auth))
        for sig in INTERNAL:
            cur.execute("select has_function_privilege('anon', %s, 'execute') or has_function_privilege('authenticated', %s, 'execute')",
                        (f"analytics.{sig}",) * 2)
            check(f"analytics.{sig} 직접 실행 불가", not cur.fetchone()[0])

        cur.execute("select id from public.profiles where role = 'admin' order by created_at limit 1")
        admin = str(cur.fetchone()[0])
        cur.execute("select id from public.profiles where role = 'user' order by created_at limit 1")
        member = str(cur.fetchone()[0])

        # 사장님 신원 → 거부
        try:
            with conn.transaction():
                as_user(cur, member)
                cur.execute("select public.admin_traffic_overview(7, null)")
            check("사장님 신원 거부", False, "통과돼 버림")
        except psycopg.errors.InsufficientPrivilege as e:
            check("사장님 신원 거부", "admin only" in str(e), str(e).splitlines()[0])

        with conn.transaction():
            as_user(cur, admin)
            for days in (7, 30):
                t0 = time.time()
                cur.execute("select public.admin_traffic_overview(%s, null)", (days,))
                o = cur.fetchone()[0]
                check(f"traffic_overview({days}) {time.time() - t0:.2f}s", "kpi" in o and len(o["daily"]) == days,
                      f"kpi={o['kpi']} prev={o['prev']} funnel={o['funnel']} 경로={[(s['source'], s['visitors']) for s in o['sources']]}"
                      f" 미연결턴={o['unattributedTurns']} 지금={o['liveNow']}")
            t0 = time.time()
            cur.execute("select public.admin_question_stats(30, null)")
            s = cur.fetchone()[0]
            check(f"question_stats(30) {time.time() - t0:.2f}s", "byOutcome" in s,
                  f"total={s['total']} sessions={s['sessions']} 결과={s['byOutcome']} 세목={s['byTopic']}")
            cur.execute("select public.admin_question_feed(30, null, null, null, 5, 0)")
            f = cur.fetchone()[0]
            check("question_feed(30)", "rows" in f, f"total={f['total']} (원문은 출력하지 않음)")
            cur.execute("select public.admin_handoff_demand(30, null)")
            h = cur.fetchone()[0]
            check("handoff_demand(30)", "funnel" in h, f"funnel={h['funnel']} 사유={h['byReason']} 최근={len(h['recent'])}")
            cur.execute("select public.admin_list_campaigns()")
            check("list_campaigns", isinstance(cur.fetchone()[0], list))

        # 게시 코드 저장 시험 → 되돌림
        try:
            with conn.transaction():
                as_user(cur, admin)
                cur.execute("select public.admin_save_campaign('check0064', 'apsa', '확인용', null)")
                cur.execute("select count(*) from analytics.campaigns where code = 'check0064'")
                check("save_campaign(롤백 시험)", cur.fetchone()[0] == 1)
                raise RuntimeError("rollback")
        except RuntimeError:
            pass
        cur.execute("select count(*) from analytics.campaigns where code = 'check0064'")
        check("시험 코드 남지 않음", cur.fetchone()[0] == 0)

    print("\n모두 OK" if fails == 0 else f"\nFAIL {fails}건")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
