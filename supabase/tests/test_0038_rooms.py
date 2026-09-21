"""0038 채팅방·메시지 — 역할별 RLS + open_room/close_room/mark_room_read + 0035 전이 회귀. 전부 트랜잭션 안에서 하고 롤백한다.

사용 (저장소 루트에서):
    backend/.venv/Scripts/python.exe supabase/tests/test_0038_rooms.py --applied
      --applied          적용된 DB 의 함수 그대로 시험 (보통 이것)
      --applied --refn   파일의 함수 정의만 바꿔 끼운 뒤 시험 — 적용 뒤 함수를 고칠 때 적용 전에 돌린다
      --applied --fresh  0038 객체를 전부 지우고 파일 전체를 다시 실행해 시험(깨끗한 DB 재현)
      (옵션 없음)        0038 미적용 DB 에서 파일 전체를 실행해 시험
"""
import json, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "supabase"))
from apply_migration import db_url  # noqa: E402
import psycopg  # noqa: E402

APPLIED = "--applied" in sys.argv
SQL = (REPO / "supabase/migrations/0038_consultation_rooms.sql").read_text(encoding="utf-8")

UID = {
    "viewer": "11111111-1111-1111-1111-111111111111",
    "auditor": "22222222-2222-2222-2222-222222222222",
    "admin": "33333333-3333-3333-3333-333333333333",
    "auditor2": "44444444-4444-4444-4444-444444444444",
    "owner2": "55555555-5555-5555-5555-555555555555",
    "auditor3": "88888888-8888-8888-8888-888888888888",
}

DROP_0038 = """
drop table if exists public.consultation_messages;
drop table if exists public.consultation_rooms cascade;
drop function if exists public.is_room_member(text);
drop function if exists public._room_message_before_insert();
drop function if exists public._room_message_before_update();
drop function if exists public._room_message_after_insert();
drop function if exists public._room_mail(text, text, text, text, text);
drop function if exists public.open_room(text, text, text, text, text);
drop function if exists public.mark_room_read(text);
drop function if exists public.close_room(text);
"""


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
        if "--fresh" in sys.argv:
            cur.execute(DROP_0038)
            cur.execute(SQL)
            print("[dryrun] 0038 객체 전부 drop → 파일 전체 재실행(트랜잭션 안)")
        elif not APPLIED:
            cur.execute(SQL)
            print("[dryrun] 0038 실행(트랜잭션 안)")
        elif "--refn" in sys.argv:
            i = SQL.index("create or replace function public.is_room_member")
            j = SQL.index("-- ── Realtime")
            # 테이블·정책·트리거 생성문을 빼고 함수 정의만 다시 실행
            body = SQL[i:j]
            funcs = []
            for chunk in body.split("create or replace function")[1:]:
                end = chunk.index("$$;", chunk.index("$$") + 2) + 3
                funcs.append("create or replace function" + chunk[:end])
            cur.execute("\n".join(funcs))
            print(f"[dryrun] 함수 {len(funcs)}개 교체(트랜잭션 안)")

        now = "(extract(epoch from now())*1000)::bigint"

        def as_user(who):
            cur.execute("set local role authenticated")
            cur.execute("select set_config('request.jwt.claims', %s, true)",
                        (json.dumps({"sub": UID[who], "role": "authenticated"}),))

        def reset():
            cur.execute("reset role")

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

        def mails(recipient, where="true"):
            cur.execute(f"select subject, body, ref, read_at from public.mail where recipient_id=%s and id in "
                        f"(select id from public.mail where sent_at >= %s) and {where} order by sent_at", (recipient, t0))
            return cur.fetchall()

        t0 = one(f"select {now}")[0]

        # ── 준비: 대화 2건(사장님·사장님2) ──────────────────────────────────────
        cur.execute(
            f"insert into public.conversations (id, occupation, title, owner_id, owner_label, created_at, updated_at, payload)"
            f" values ('dry-room-c1','clinic','방 시험 1','viewer','사장님',{now},{now},'{{}}'::jsonb),"
            f"        ('dry-room-c2','clinic','방 시험 2','owner2','사장님2',{now},{now},'{{}}'::jsonb)")

        # 사장님 신청(경로 A)
        as_user("viewer")
        cur.execute(f"insert into public.consultation_requests (id, conversation_id, viewer_id, expert_id, message, status, status_history, created_at, updated_at)"
                    f" values ('dry-req-1','dry-room-c1','viewer','auditor','도와주세요','pending','[]',{now},{now})")
        reset()
        check("신청 → 세무사 메일(0035 회귀)",
              any(s.startswith("새 상담 신청") for s, *_ in mails("auditor")), mails("auditor"))

        # 수락 전: 방 없음
        check("수락 전 방 없음", one("select count(*) from public.consultation_rooms where conversation_id='dry-room-c1'")[0] == 0)

        # 남이 수락 불가(0035 회귀)
        as_user("auditor2")
        expect_error("다른 세무사는 수락 불가", "select public.transition_consultation('dry-req-1','accepted')")
        reset()

        # 세무사 수락 → 방 개설
        as_user("auditor")
        st = one("select status from public.transition_consultation('dry-req-1','accepted')")[0]
        check("수락 전이", st == "accepted")
        reset()
        room = one("select id, viewer_id, expert_id, origin, origin_id, status from public.consultation_rooms where conversation_id='dry-room-c1'")
        check("수락이 방을 만든다", room is not None and room[1:] == ("viewer", "auditor", "request", "dry-req-1", "open"), room)
        rid = room[0] if room else None
        acc = [m for m in mails("viewer") if "수락" in m[0]]
        check("수락 메일(채팅방 안내)", len(acc) == 1 and "[채팅방 열기]" in acc[0][1]
              and acc[0][2] == {"kind": "consultation", "requestId": "dry-req-1"}, acc)

        # ── 방 조회 RLS ─────────────────────────────────────────────────────────
        for who, want in (("viewer", 1), ("auditor", 1), ("admin", 1), ("auditor2", 0), ("owner2", 0), ("auditor3", 0)):
            as_user(who)
            n = one("select count(*) from public.consultation_rooms where id=%s", (rid,))[0]
            check(f"방 조회 {who}={want}", n == want, n)
            reset()

        # 방 직접 쓰기 불가
        as_user("viewer")
        expect_error("방 직접 insert 차단",
                     f"insert into public.consultation_rooms (id, conversation_id, viewer_id, expert_id, origin, origin_id, created_at)"
                     f" values ('dry-x','dry-room-c1','viewer','auditor2','request','dry-req-1',1)")
        cur.execute("update public.consultation_rooms set status='closed' where id=%s", (rid,))
        check("방 직접 update 0행", cur.rowcount == 0)
        expect_error("open_room 사용자 실행 불가",
                     "select public.open_room('dry-room-c1','viewer','auditor','request','dry-req-1')")
        reset()

        # ── 메시지 ──────────────────────────────────────────────────────────────
        as_user("viewer")
        # sender_id 를 세무사로 속여도 서버가 호출자로 덮어쓴다
        cur.execute("insert into public.consultation_messages (id, room_id, sender_id, sender_role, body, created_at)"
                    " values ('dry-m1', %s, 'auditor', 'auditor', '안녕하세요 세무사님', 1)", (rid,))
        m1 = one("select sender_id, sender_role, created_at > 1 from public.consultation_messages where id='dry-m1'")
        check("보낸 사람·역할·시각은 서버가", m1 == ("viewer", "user", True), m1)
        cur.execute("insert into public.consultation_messages (id, room_id, sender_id, sender_role, body, created_at)"
                    " values ('dry-m2', %s, 'viewer', 'user', '두 번째', 1)", (rid,))
        expect_error("빈 본문 거부",
                     "insert into public.consultation_messages (id, room_id, sender_id, sender_role, body, created_at) values ('dry-m0', %s, 'viewer', 'user', '   ', 1)", (rid,))
        expect_error("4001자 거부",
                     "insert into public.consultation_messages (id, room_id, sender_id, sender_role, body, created_at) values ('dry-m0', %s, 'viewer', 'user', %s, 1)", (rid, "가" * 4001))
        reset()

        as_user("auditor")
        cur.execute("insert into public.consultation_messages (id, room_id, sender_id, sender_role, body, created_at)"
                    " values ('dry-m3', %s, 'auditor', 'auditor', '네 말씀하세요', 1)", (rid,))
        cur.execute("insert into public.consultation_messages (id, room_id, sender_id, sender_role, body, created_at)"
                    " values ('dry-m4', %s, 'auditor', 'auditor', '추가 질문', 1)", (rid,))
        reset()

        for who in ("auditor2", "owner2", "auditor3"):
            as_user(who)
            expect_error(f"제3자 {who} 메시지 쓰기 불가",
                         "insert into public.consultation_messages (id, room_id, sender_id, sender_role, body, created_at) values ('dry-mx', %s, %s, 'user', '끼어들기', 1)", (rid, who))
            n = one("select count(*) from public.consultation_messages where room_id=%s", (rid,))[0]
            check(f"제3자 {who} 메시지 0행", n == 0, n)
            reset()
        for who in ("viewer", "auditor", "admin"):
            as_user(who)
            n = one("select count(*) from public.consultation_messages where room_id=%s", (rid,))[0]
            check(f"{who} 메시지 4행", n == 4, n)
            reset()
        as_user("admin")
        expect_error("admin 메시지 쓰기 불가(읽기만)",
                     "insert into public.consultation_messages (id, room_id, sender_id, sender_role, body, created_at) values ('dry-mx', %s, 'admin', 'user', 'x', 1)", (rid,))
        reset()

        # 방 갱신: 마지막 메시지 시각 · 보낸 쪽 읽음
        r = one("select last_message_at, viewer_last_read_at, expert_last_read_at from public.consultation_rooms where id=%s", (rid,))
        last = one("select max(created_at) from public.consultation_messages where room_id=%s", (rid,))[0]
        check("last_message_at 갱신", r[0] == last, r)
        check("보낸 쪽 읽음 자동 갱신", r[1] is not None and r[2] == last, r)

        # 메일: 받는 사람마다 방당 1건
        am = mails("auditor", "ref->>'kind'='room'")
        vm = mails("viewer", "ref->>'kind'='room'")
        check("세무사 방 메일 1건(메시지 2개)", len(am) == 1 and am[0][2] == {"kind": "room", "id": rid}, am)
        check("사장님 방 메일 1건(메시지 2개)", len(vm) == 1 and "세무사" in vm[0][0], vm)

        # soft delete
        as_user("viewer")
        cur.execute("update public.consultation_messages set deleted_at = 1 where id='dry-m1'")
        check("본인 메시지 soft delete", cur.rowcount == 1)
        d = one("select deleted_at > 1 from public.consultation_messages where id='dry-m1'")[0]
        check("지운 시각은 서버 시각", d is True)
        cur.execute("update public.consultation_messages set deleted_at = null where id='dry-m1'")
        check("되살리기 불가", one("select deleted_at is not null from public.consultation_messages where id='dry-m1'")[0] is True)
        cur.execute("update public.consultation_messages set deleted_at = 1 where id='dry-m3'")
        check("남의 메시지 soft delete 0행", cur.rowcount == 0)
        check("남의 메시지 그대로", one("select deleted_at from public.consultation_messages where id='dry-m3'")[0] is None)
        expect_error("본문 수정 불가(컬럼 권한)", "update public.consultation_messages set body='고침' where id='dry-m2'")
        expect_error("메시지 delete 불가", "delete from public.consultation_messages where id='dry-m2'")
        reset()

        # 읽음 RPC
        as_user("viewer")
        before = one("select viewer_last_read_at from public.consultation_rooms where id=%s", (rid,))[0]
        after = one("select viewer_last_read_at from public.mark_room_read(%s)", (rid,))[0]
        check("mark_room_read 갱신", after is not None and after >= before, (before, after))
        reset()
        check("mark_room_read 가 방 메일 읽음", all(m[3] is not None for m in mails("viewer", "ref->>'kind'='room'")))
        check("세무사 메일은 그대로 안 읽음", all(m[3] is None for m in mails("auditor", "ref->>'kind'='room'")))
        as_user("auditor2")
        expect_error("제3자 mark_room_read 불가", "select public.mark_room_read(%s)", (rid,))
        reset()

        # ── open_room 중복 · 상한 ────────────────────────────────────────────────
        same = one("select id from public.open_room('dry-room-c1','viewer','auditor','request','dry-req-1')")[0]
        check("open_room 중복 호출 → 같은 방", same == rid)
        expect_error("수락 안 된 출처로 open_room 불가",
                     "select public.open_room('dry-room-c1','viewer','auditor2','request','dry-req-1')")
        cur.execute(f"insert into public.auditors (id, display_name, email, created_at) values ('dry-aud4','임시4','dry4@x.local',{now})")
        for i, exp in enumerate(("auditor2", "auditor3", "dry-aud4"), start=2):
            cur.execute(f"insert into public.consultation_requests (id, conversation_id, viewer_id, expert_id, status, status_history, created_at, updated_at)"
                        f" values ('dry-req-{i}','dry-room-c1','viewer',%s,'accepted','[]',{now},{now})", (exp,))
        one("select id from public.open_room('dry-room-c1','viewer','auditor2','request','dry-req-2')")
        one("select id from public.open_room('dry-room-c1','viewer','auditor3','request','dry-req-3')")
        check("열린 방 3개", one("select count(*) from public.consultation_rooms where conversation_id='dry-room-c1' and status='open'")[0] == 3)
        expect_error("상한 초과(4번째) 거부",
                     "select public.open_room('dry-room-c1','viewer','dry-aud4','request','dry-req-4')")
        # 수락 전이 경로에서도 상한 → 수락 자체가 롤백
        cur.execute(f"insert into public.consultation_requests (id, conversation_id, viewer_id, expert_id, status, status_history, created_at, updated_at)"
                    f" values ('dry-req-5','dry-room-c1','viewer','dry-aud4','pending','[]',{now},{now})")
        as_user("admin")
        expect_error("상한 초과 시 수락 전이 거부", "select public.transition_consultation('dry-req-5','accepted')")
        reset()
        check("상한 거부 뒤 신청은 pending 그대로",
              one("select status from public.consultation_requests where id='dry-req-5'")[0] == "pending")

        # ── close_room ──────────────────────────────────────────────────────────
        for who in ("owner2", "auditor2"):
            as_user(who)
            expect_error(f"비참여자 {who} 종료 불가", "select public.close_room(%s)", (rid,))
            reset()
        as_user("auditor")   # 세무사 쪽도 닫을 수 있다(양쪽 누구나)
        st = one("select status, closed_at is not null from public.close_room(%s)", (rid,))
        check("세무사 종료", st == ("closed", True), st)
        st2 = one("select status from public.close_room(%s)", (rid,))[0]
        check("종료 두 번 = 같은 결과", st2 == "closed")
        reset()
        as_user("viewer")
        expect_error("닫힌 방 쓰기 불가",
                     "insert into public.consultation_messages (id, room_id, sender_id, sender_role, body, created_at) values ('dry-m9', %s, 'viewer', 'user', '닫힌 뒤', 1)", (rid,))
        check("닫힌 방 읽기는 유지", one("select count(*) from public.consultation_messages where room_id=%s", (rid,))[0] == 4)
        reset()
        rid2 = one("select id from public.consultation_rooms where conversation_id='dry-room-c1' and expert_id='auditor2'")[0]
        as_user("viewer")
        check("사장님 종료", one("select status from public.close_room(%s)", (rid2,))[0] == "closed")
        reset()
        rid3 = one("select id from public.consultation_rooms where conversation_id='dry-room-c1' and expert_id='auditor3'")[0]
        as_user("admin")
        check("admin 종료", one("select status from public.close_room(%s)", (rid3,))[0] == "closed")
        reset()

        # 닫힌 방은 상한에서 빠지고, 같은 쌍의 재수락은 그 방을 다시 연다
        as_user("admin")
        check("닫힌 방 빠진 뒤 4번째 수락 가능",
              one("select status from public.transition_consultation('dry-req-5','accepted')")[0] == "accepted")
        reset()
        cur.execute(f"insert into public.consultation_requests (id, conversation_id, viewer_id, expert_id, status, status_history, created_at, updated_at)"
                    f" values ('dry-req-6','dry-room-c1','viewer','auditor','pending','[]',{now},{now})")
        as_user("auditor")
        one("select status from public.transition_consultation('dry-req-6','accepted')")
        reset()
        re = one("select id, status, closed_at, origin_id from public.consultation_rooms where conversation_id='dry-room-c1' and expert_id='auditor'")
        check("재수락 → 같은 방 다시 열림", re == (rid, "open", None, "dry-req-6"), re)
        check("다시 열린 방에 이전 메시지 유지",
              one("select count(*) from public.consultation_messages where room_id=%s", (rid,))[0] == 4)

        # ── 0035 전이 회귀: 거절 · 취소 · 완료 ─────────────────────────────────────
        cur.execute(f"insert into public.consultation_requests (id, conversation_id, viewer_id, expert_id, status, status_history, created_at, updated_at)"
                    f" values ('dry-req-d','dry-room-c2','owner2','auditor2','pending','[]',{now},{now}),"
                    f"        ('dry-req-c','dry-room-c2','owner2','auditor3','pending','[]',{now},{now})")
        as_user("auditor2")
        check("거절 전이", one("select status from public.transition_consultation('dry-req-d','declined','바빠요')")[0] == "declined")
        reset()
        check("거절은 방을 안 만든다", one("select count(*) from public.consultation_rooms where conversation_id='dry-room-c2'")[0] == 0)
        dm = [m for m in mails("owner2") if "거절" in m[0]]
        check("거절 메일 + 사유", len(dm) == 1 and "바빠요" in dm[0][1], dm)
        as_user("auditor3")
        expect_error("세무사는 취소 불가", "select public.transition_consultation('dry-req-c','cancelled')")
        reset()
        as_user("owner2")
        check("취소 전이", one("select status from public.transition_consultation('dry-req-c','cancelled')")[0] == "cancelled")
        expect_error("취소 뒤 수락 불가(직전 상태)", "select public.transition_consultation('dry-req-c','accepted')")
        reset()
        check("취소 메일 → 세무사", any(s.startswith("상담 신청 취소") for s, *_ in mails("auditor3")))
        as_user("auditor")
        check("완료 전이", one("select status from public.transition_consultation('dry-req-6','completed')")[0] == "completed")
        reset()
        cm = [m for m in mails("viewer") if "완료" in m[0]]
        check("완료 메일", len(cm) == 1, cm)
        check("완료해도 방은 열린 채", one("select status from public.consultation_rooms where id=%s", (rid,))[0] == "open")
        hist = one("select status_history from public.consultation_requests where id='dry-req-1'")[0]
        check("status_history 누적", [h["status"] for h in hist] == ["accepted"], hist)

        # anon 이 정책 함수를 실행할 수 있어야 한다(없으면 Realtime 이 방 참여자에게도 이벤트를 안 준다) — 그리고 false
        cur.execute("set local role anon")
        cur.execute("select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true)")
        check("anon: is_room_member 실행 가능·false", one("select public.is_room_member(%s)", (rid,))[0] is False)
        check("anon: 메시지 0행(오류 없이)", one("select count(*) from public.consultation_messages")[0] == 0)
        check("anon: 방 0행", one("select count(*) from public.consultation_rooms")[0] == 0)
        reset()

        # 대화 삭제 → 방·메시지 cascade
        cur.execute("delete from public.conversations where id='dry-room-c1'")
        check("대화 삭제 → 방 cascade", one("select count(*) from public.consultation_rooms where conversation_id='dry-room-c1'")[0] == 0)
        check("대화 삭제 → 메시지 cascade", one("select count(*) from public.consultation_messages where room_id=%s", (rid,))[0] == 0)

        # Realtime publication
        pubs = {r[0] for r in (cur.execute("select tablename from pg_publication_tables where pubname='supabase_realtime'") or cur).fetchall()}
        check("Realtime 두 테이블", {"consultation_rooms", "consultation_messages"} <= pubs)

        conn.rollback()
        print("[dryrun] 롤백")

    print(f"\n결과: {ok} OK / {fail} FAIL")
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
