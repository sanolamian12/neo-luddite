"""0045 — 스위치 꺼짐→켜짐 때 꺼 둔 동안의 메시지에 skipped run. 트랜잭션 안에서 하고 롤백한다.
    backend/.venv/Scripts/python.exe supabase/tests/test_0045_switch_on_skip.py [--applied]
"""
import json, sys
from pathlib import Path
REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "supabase"))
from apply_migration import db_url  # noqa: E402
import psycopg  # noqa: E402
sys.stdout.reconfigure(encoding="utf-8")
SQL = (REPO / "supabase/migrations/0045_room_agent_switch_on_skip.sql").read_text(encoding="utf-8")
UID = {"viewer": "11111111-1111-1111-1111-111111111111", "auditor": "22222222-2222-2222-2222-222222222222"}
NOW = "(extract(epoch from now())*1000)::bigint"


def main():
    ok = fail = 0

    def check(label, cond, detail=""):
        nonlocal ok, fail
        ok, fail = (ok + 1, fail) if cond else (ok, fail + 1)
        if not cond:
            print("  FAIL", label, detail)

    with psycopg.connect(db_url()) as conn:
        cur = conn.cursor()
        if "--applied" not in sys.argv:
            cur.execute(SQL); print("[dryrun] 0045 실행(트랜잭션 안)")

        def as_user(who):
            cur.execute("set local role authenticated")
            cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({"sub": UID[who], "role": "authenticated"}),))

        def reset():
            cur.execute("reset role"); cur.execute("select set_config('request.jwt.claims', '', true)")

        def msg(who, mid):
            as_user(who)
            cur.execute("insert into public.consultation_messages (id, room_id, sender_id, sender_role, body, created_at)"
                        " values (%s, %s, '-', 'user', 'x', 0)", (mid, rid))
            reset()

        def runs():
            cur.execute("select trigger_message_id, status, error from public.room_agent_runs where room_id=%s order by trigger_message_id", (rid,))
            return cur.fetchall()

        def sw(c, e):
            as_user("auditor"); cur.execute("select public.set_room_agent_switches(%s, %s, %s)", (rid, c, e)); reset()

        cur.execute(f"insert into public.conversations (id, occupation, title, owner_id, owner_label, created_at, updated_at, payload)"
                    f" values ('dry-45-c','clinic','t','viewer','사장님',{NOW},{NOW},'{{\"messages\":[]}}'::jsonb)")
        as_user("viewer")
        cur.execute(f"insert into public.consultation_requests (id, conversation_id, viewer_id, expert_id, message, status, status_history, created_at, updated_at)"
                    f" values ('dry-45-r','dry-45-c','viewer','auditor','m','pending','[]',{NOW},{NOW})")
        reset(); as_user("auditor"); cur.execute("select public.transition_consultation('dry-45-r','accepted')"); reset()
        cur.execute("select id from public.consultation_rooms where conversation_id='dry-45-c'"); rid = cur.fetchone()[0]

        msg("viewer", "dry-45-u1")
        cur.execute(f"insert into public.room_agent_runs (trigger_message_id, room_id, status, started_at) values ('dry-45-u1', %s, 'done', {NOW})", (rid,))
        sw(False, None)
        msg("viewer", "dry-45-u2")                 # 꺼 둔 동안
        msg("auditor", "dry-45-a1")
        sw(False, None)                            # 꺼짐→꺼짐: 아무것도 안 함
        check("꺼진 채로는 skipped 없음", runs() == [("dry-45-u1", "done", None)], runs())
        sw(True, None)                             # 꺼짐→켜짐
        r = dict((t, (s, e)) for t, s, e in runs())
        check("꺼 둔 동안의 고객 메시지 = skipped switch_off", r.get("dry-45-u2") == ("skipped", "switch_off"), r)
        check("이미 답한 run 은 그대로", r.get("dry-45-u1") == ("done", None), r)
        check("세무사 메시지는 고객 스위치와 무관", "dry-45-a1" not in r, r)
        sw(True, None)                             # 켜짐→켜짐: 새 메시지 건드리지 않음
        msg("viewer", "dry-45-u3"); sw(True, None)
        check("켜진 채로 다시 눌러도 새 메시지는 그대로", "dry-45-u3" not in dict((t, s) for t, s, _ in runs()))
        sw(None, True)                             # 세무사 응답 꺼짐→켜짐
        r = dict((t, (s, e)) for t, s, e in runs())
        check("세무사 응답 켤 때 그 전 세무사 메시지 skipped", r.get("dry-45-a1") == ("skipped", "switch_off"), r)
        check("그때 고객 메시지는 안 건드림", "dry-45-u3" not in r, r)
        as_user("viewer")
        cur.execute("savepoint sp")
        try:
            cur.execute("select public.set_room_agent_switches(%s, true, true)", (rid,)); check("사장님 스위치 차단", False)
        except psycopg.Error:
            check("사장님 스위치 차단", True)
        cur.execute("rollback to savepoint sp"); reset()
        conn.rollback()
    print(f"\n0045: {ok} OK · {fail} FAIL (롤백 — DB 변경 없음)")
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
