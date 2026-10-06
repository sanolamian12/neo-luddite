"""0044 3자 방 — agent 메시지(사칭 차단·메일 없음) · 응답 스위치 · 호출 선점(PK·방당 running 1) · expert_agents RLS.
전부 트랜잭션 안에서 하고 롤백한다(DB 에 아무것도 안 남는다).

사용 (저장소 루트에서):
    backend/.venv/Scripts/python.exe supabase/tests/test_0044_room_agent.py            # 0044 미적용 DB: 파일을 트랜잭션 안에서 실행
    backend/.venv/Scripts/python.exe supabase/tests/test_0044_room_agent.py --applied  # 적용된 DB 그대로
"""
import json, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "supabase"))
from apply_migration import db_url  # noqa: E402
import psycopg  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")
APPLIED = "--applied" in sys.argv
SQL = (REPO / "supabase/migrations/0044_room_agent.sql").read_text(encoding="utf-8")
UID = {
    "viewer": "11111111-1111-1111-1111-111111111111",
    "auditor": "22222222-2222-2222-2222-222222222222",
    "admin": "33333333-3333-3333-3333-333333333333",
    "auditor2": "44444444-4444-4444-4444-444444444444",
    "owner2": "55555555-5555-5555-5555-555555555555",
}
NOW = "(extract(epoch from now())*1000)::bigint"


def main():
    ok = fail = 0

    def check(label, cond, detail=""):
        nonlocal ok, fail
        if cond:
            ok += 1
        else:
            fail += 1
            print(f"  FAIL {label} {detail}")

    with psycopg.connect(db_url()) as conn:
        cur = conn.cursor()
        if not APPLIED:
            cur.execute(SQL)
            print("[dryrun] 0044 실행(트랜잭션 안)")

        def as_user(who):
            cur.execute("set local role authenticated")
            cur.execute("select set_config('request.jwt.claims', %s, true)",
                        (json.dumps({"sub": UID[who], "role": "authenticated"}),))

        def as_anon():
            cur.execute("set local role anon")
            cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({"role": "anon"}),))

        def reset():   # 서비스 연결 흉내 — 역할도 JWT 클레임도 없음(서버 psycopg 연결과 같다)
            cur.execute("reset role")
            cur.execute("select set_config('request.jwt.claims', '', true)")

        def expect_error(label, sql, args=()):
            cur.execute("savepoint sp")
            try:
                cur.execute(sql, args)
                cur.fetchall() if cur.description else None
                check(label, False, "오류가 나야 함")
            except psycopg.Error:
                check(label, True)
            cur.execute("rollback to savepoint sp")

        def one(sql, args=()):
            cur.execute(sql, args)
            return cur.fetchone()

        def msg(who, mid, body, role="user"):
            if who:
                as_user(who)
            cur.execute("insert into public.consultation_messages (id, room_id, sender_id, sender_role, body, created_at)"
                        " values (%s, %s, '-', %s, %s, 0)", (mid, rid, role, body))
            reset()

        # ── 준비: 대화 → 신청 → 수락 = 방 ────────────────────────────────────────────
        t0 = one(f"select {NOW}")[0]
        cur.execute(f"insert into public.conversations (id, occupation, title, owner_id, owner_label, created_at, updated_at, payload)"
                    f" values ('dry-ag-c1','clinic','3자방 시험','viewer','사장님',{NOW},{NOW},'{{}}'::jsonb)")
        as_user("viewer")
        cur.execute(f"insert into public.consultation_requests (id, conversation_id, viewer_id, expert_id, message, status, status_history, created_at, updated_at)"
                    f" values ('dry-ag-r1','dry-ag-c1','viewer','auditor','도와주세요','pending','[]',{NOW},{NOW})")
        reset()
        as_user("auditor")
        cur.execute("select public.transition_consultation('dry-ag-r1','accepted')")
        reset()
        rid = one("select id from public.consultation_rooms where conversation_id='dry-ag-c1'")[0]

        # ── 스위치 기본값 · 기존 방 ───────────────────────────────────────────────────
        sw = one("select agent_reply_customer, agent_reply_expert from public.consultation_rooms where id=%s", (rid,))
        check("새 방 스위치 = 고객 ON · 세무사 OFF", sw == (True, False), sw)
        bad = one("select count(*) from public.consultation_rooms where not agent_reply_customer or agent_reply_expert")[0]
        check("기존 방도 기본값(D3)", bad == 0, bad)

        # ── 메시지 역할 ──────────────────────────────────────────────────────────────
        msg("viewer", "dry-ag-m1", "직원 회식비 처리 궁금해요", role="agent")   # agent 사칭 시도
        r = one("select sender_id, sender_role from public.consultation_messages where id='dry-ag-m1'")
        check("사장님이 agent 로 보내도 user 로 덮어씀", r == ("viewer", "user"), r)
        msg("auditor", "dry-ag-m2", "제가 확인할게요", role="agent")
        r = one("select sender_id, sender_role from public.consultation_messages where id='dry-ag-m2'")
        check("세무사가 agent 로 보내도 auditor 로 덮어씀", r == ("auditor", "auditor"), r)
        as_user("auditor2")
        expect_error("제3자의 agent 메시지 차단",
                     "insert into public.consultation_messages (id, room_id, sender_id, sender_role, body, created_at)"
                     " values ('dry-ag-mx', %s, 'agent:auditor', 'agent', '끼어들기', 0)", (rid,))
        reset()

        mail_before = one("select count(*) from public.mail where sent_at >= %s", (t0,))[0]
        read_before = one("select viewer_last_read_at, expert_last_read_at from public.consultation_rooms where id=%s", (rid,))
        msg(None, "dry-ag-m3", "회식비는 복리후생비로 볼 수 있습니다.", role="agent")   # 서비스 연결(uid 없음)
        r = one("select sender_id, sender_role, created_at > 0 from public.consultation_messages where id='dry-ag-m3'")
        check("서버 agent 메시지 = agent:<세무사>", r == ("agent:auditor", "agent", True), r)
        check("agent 메시지는 메일 없음", one("select count(*) from public.mail where sent_at >= %s", (t0,))[0] == mail_before)
        room = one("select viewer_last_read_at, expert_last_read_at, last_message_at from public.consultation_rooms where id=%s", (rid,))
        last = one("select created_at from public.consultation_messages where id='dry-ag-m3'")[0]
        check("agent 메시지: 읽음 칸 그대로 · last_message_at 갱신", room[:2] == read_before and room[2] == last, (room, read_before, last))
        for who in ("viewer", "auditor", "admin"):
            as_user(who)
            n = one("select count(*) from public.consultation_messages where id='dry-ag-m3'")[0]
            check(f"{who} 가 agent 메시지를 본다", n == 1, n)
            reset()
        as_user("auditor2")
        check("제3자는 agent 메시지 못 봄", one("select count(*) from public.consultation_messages where room_id=%s", (rid,))[0] == 0)
        reset()

        # ── 스위치 RPC ──────────────────────────────────────────────────────────────
        for who in ("viewer", "auditor2", "admin"):
            as_user(who)
            expect_error(f"{who} 는 스위치 못 바꿈", "select public.set_room_agent_switches(%s, false, true)", (rid,))
            reset()
        as_user("viewer")
        cur.execute("update public.consultation_rooms set agent_reply_customer=false where id=%s", (rid,))
        check("방 직접 update 0행(스위치)", cur.rowcount == 0)
        reset()
        as_user("auditor")
        r = one("select agent_reply_customer, agent_reply_expert from public.set_room_agent_switches(%s, false, true)", (rid,))
        check("세무사가 스위치 변경", r == (False, True), r)
        r = one("select agent_reply_customer, agent_reply_expert from public.set_room_agent_switches(%s, true, null)", (rid,))
        check("null 은 그대로 둠", r == (True, True), r)
        reset()

        # ── 호출 선점 ──────────────────────────────────────────────────────────────
        # 위 스위치 시험이 고객 응답을 껐다 켰다 — 0045 부터 그때 m1 은 skipped 로 막힌다. 선점은 새 메시지로 본다.
        msg("viewer", "dry-ag-m5", "선점 시험")
        claim = ("insert into public.room_agent_runs (trigger_message_id, room_id, status, caller_id, started_at)"
                 f" values (%s, %s, 'running', %s, {NOW}) on conflict do nothing returning trigger_message_id")
        cur.execute(claim, ("dry-ag-m5", rid, "viewer")); a = cur.fetchall()
        cur.execute(claim, ("dry-ag-m5", rid, "auditor")); b = cur.fetchall()
        check("같은 트리거 두 번 → 하나만 선점", len(a) == 1 and len(b) == 0, (a, b))
        msg("viewer", "dry-ag-m4", "하나 더요")
        cur.execute(claim, ("dry-ag-m4", rid, "viewer")); c = cur.fetchall()
        check("방에 running 이 있으면 다른 트리거도 선점 실패", len(c) == 0, c)
        cur.execute("update public.room_agent_runs set status='done', finished_at=%s where trigger_message_id='dry-ag-m5'" % NOW)
        cur.execute(claim, ("dry-ag-m4", rid, "viewer")); d = cur.fetchall()
        check("앞 run 이 끝나면 선점", len(d) == 1, d)
        cur.execute("update public.room_agent_runs set status='expired' where trigger_message_id='dry-ag-m4'")
        cur.execute("update public.room_agent_runs set status='running', attempts=attempts+1 where trigger_message_id='dry-ag-m4'"
                    " and status in ('failed','expired') returning attempts")
        e = cur.fetchall()
        check("expired 재선점(조건부 update)", e == [(2,)], e)

        for who, want in (("viewer", 2), ("auditor", 2), ("admin", 2), ("auditor2", 0), ("owner2", 0)):
            as_user(who)
            n = one("select count(*) from public.room_agent_runs where room_id=%s and trigger_message_id in ('dry-ag-m4','dry-ag-m5')", (rid,))[0]
            check(f"run 조회 {who}={want}", n == want, n)
            reset()
        as_user("viewer")
        expect_error("사용자 run insert 차단",
                     f"insert into public.room_agent_runs (trigger_message_id, room_id, status, started_at) values ('dry-ag-m2', %s, 'running', {NOW})", (rid,))
        expect_error("사용자 run update 차단(권한 없음)", "update public.room_agent_runs set status='done' where room_id=%s", (rid,))
        reset()
        as_anon()
        cur.execute("savepoint sp")
        try:
            n = one("select count(*) from public.room_agent_runs")[0]
            check("anon run 조회 = 0행 · 오류 없음(Realtime 함정 ①)", n == 0, n)
        except psycopg.Error as exc:
            check("anon run 조회 오류 없음", False, exc)
            cur.execute("rollback to savepoint sp")
        reset()

        # ── expert_agents ──────────────────────────────────────────────────────────
        ins = (f"insert into public.expert_agents (agent_id, name, agent, is_room_agent, created_at, updated_at)"
               f" values (%s, %s, '{{\"id\":\"x\"}}'::jsonb, %s, {NOW}, {NOW})")
        as_user("auditor")
        cur.execute(ins, ("dry-ag-a1", "에이전트1", True))
        cur.execute(ins, ("dry-ag-a2", "에이전트2", False))
        expect_error("방 에이전트 2개 차단", ins, ("dry-ag-a3", "에이전트3", True))
        n = one("select count(*) from public.expert_agents where agent_id like 'dry-ag-%%'")[0]
        check("본인 에이전트 조회 2", n == 2, n)
        reset()
        check("expert_id = auth uid", one("select count(*) from public.expert_agents where expert_id=%s and agent_id like 'dry-ag-%%'", (UID["auditor"],))[0] == 2)
        as_user("auditor2")
        check("다른 세무사는 0행", one("select count(*) from public.expert_agents where agent_id like 'dry-ag-%%'")[0] == 0)
        expect_error("남의 이름으로 insert 차단",
                     f"insert into public.expert_agents (expert_id, agent_id, agent, created_at, updated_at) values (%s, 'dry-ag-b', '{{}}'::jsonb, {NOW}, {NOW})",
                     (UID["auditor"],))
        cur.execute("update public.expert_agents set name='탈취' where agent_id='dry-ag-a1'")
        check("남의 에이전트 update 0행", cur.rowcount == 0)
        reset()
        as_user("viewer")
        expect_error("사장님 insert 차단", ins, ("dry-ag-v", "x", False))
        reset()
        as_anon()
        expect_error("anon 조회 차단(권한 없음)", "select count(*) from public.expert_agents")
        reset()

        conn.rollback()
    print(f"\n0044: {ok} OK · {fail} FAIL (롤백 — DB 변경 없음)")
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
