"""0039 제안(경로 B) — 역할별 RLS + make_offer/transition_offer + open_room(offer) + list_pool_cases 열. 전부 트랜잭션 안에서 하고 롤백한다.

사용 (저장소 루트에서):
    backend/.venv/Scripts/python.exe supabase/tests/test_0039_offers.py --applied
      --applied          적용된 DB 의 함수 그대로 시험 (보통 이것)
      --applied --refn   파일의 함수 정의만 바꿔 끼운 뒤 시험 — 적용 뒤 함수를 고칠 때 적용 전에 돌린다
      --applied --fresh  0039 객체를 전부 지우고(0038 open_room·0037 list_pool_cases 로 되돌린 뒤) 파일 전체를 다시 실행
      (옵션 없음)        0039 미적용 DB 에서 파일 전체를 실행해 시험
"""
import json, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "supabase"))
from apply_migration import db_url  # noqa: E402
import psycopg  # noqa: E402

APPLIED = "--applied" in sys.argv
SQL = (REPO / "supabase/migrations/0039_consultation_offers.sql").read_text(encoding="utf-8")

UID = {
    "viewer": "11111111-1111-1111-1111-111111111111",
    "auditor": "22222222-2222-2222-2222-222222222222",
    "admin": "33333333-3333-3333-3333-333333333333",
    "auditor2": "44444444-4444-4444-4444-444444444444",
    "owner2": "55555555-5555-5555-5555-555555555555",
    "auditor3": "88888888-8888-8888-8888-888888888888",
}

DROP_0039 = """
alter publication supabase_realtime drop table public.consultation_offers;
drop function if exists public._offer_mail(text, text, text, text, text);
drop function if exists public.make_offer(text, text);
drop function if exists public.transition_offer(text, text, text);
drop function if exists public.list_pool_cases();
drop table if exists public.consultation_offers;
"""


def fn_chunk(sql: str, head: str) -> str:
    """파일에서 `head` 로 시작하는 함수 정의 한 덩어리(끝 $$; 까지)."""
    i = sql.index(head)
    j = sql.index("$$", sql.index("$$", i) + 2) + 3
    return sql[i:j]


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
            cur.execute(DROP_0039)
            # 0039 이전 모양으로 되돌린다: open_room 은 0038, list_pool_cases 는 0037 정의.
            s38 = (REPO / "supabase/migrations/0038_consultation_rooms.sql").read_text(encoding="utf-8")
            s37 = (REPO / "supabase/migrations/0037_pool_consents_masking.sql").read_text(encoding="utf-8")
            cur.execute(fn_chunk(s38, "create or replace function public.open_room("))
            cur.execute(fn_chunk(s37, "create or replace function public.list_pool_cases()"))
            cur.execute(SQL)
            print("[dryrun] 0039 객체 drop · 0038/0037 함수 복원 → 파일 전체 재실행(트랜잭션 안)")
        elif not APPLIED:
            cur.execute(SQL)
            print("[dryrun] 0039 실행(트랜잭션 안)")
        elif "--refn" in sys.argv:
            heads = ["create or replace function public._offer_mail(",
                     "create or replace function public.make_offer(",
                     "create or replace function public.open_room(",
                     "create or replace function public.transition_offer("]
            cur.execute("\n".join(fn_chunk(SQL, h) for h in heads))
            print(f"[dryrun] 함수 {len(heads)}개 교체(트랜잭션 안, list_pool_cases 는 열이 같으면 --fresh 로)")

        now = "(extract(epoch from now())*1000)::bigint"

        def as_user(who):
            cur.execute("set local role authenticated")
            cur.execute("select set_config('request.jwt.claims', %s, true)",
                        (json.dumps({"sub": UID[who], "role": "authenticated"}),))

        def as_domain(domain_id):
            """시험용 임시 세무사(dry-aud*) — auth 사용자가 없으니 profiles 로 uuid 를 만든다."""
            uid = one("select id from public.profiles where domain_id=%s", (domain_id,))[0]
            cur.execute("set local role authenticated")
            cur.execute("select set_config('request.jwt.claims', %s, true)",
                        (json.dumps({"sub": str(uid), "role": "authenticated"}),))

        def reset():
            cur.execute("reset role")

        def expect_error(label, sql, args=(), contains=None):
            cur.execute("savepoint sp")
            try:
                cur.execute(sql, args)
                cur.fetchall() if cur.description else None
                check(label, False, "오류가 나야 함")
            except psycopg.Error as e:
                check(label, contains is None or contains in str(e), str(e).splitlines()[0])
            cur.execute("rollback to savepoint sp")

        def one(sql, args=()):
            cur.execute(sql, args)
            return cur.fetchone()

        def mails(recipient, where="true"):
            cur.execute(f"select subject, body, ref, read_at from public.mail where recipient_id=%s and sent_at >= %s"
                        f" and {where} order by sent_at", (recipient, t0))
            return cur.fetchall()

        def offer_of(expert):
            return one("select id, status from public.consultation_offers where conversation_id='dry-off-c1' and expert_id=%s", (expert,))

        t0 = one(f"select {now}")[0]

        # ── 준비 ────────────────────────────────────────────────────────────────
        payload = json.dumps({"id": "dry-off-c1", "messages": [
            {"id": "m1", "role": "user", "order": 0, "segments": [{"id": "s1", "text": "종소세 문의입니다"}]}]})
        cur.execute(
            f"insert into public.conversations (id, occupation, title, owner_id, owner_label, created_at, updated_at, payload)"
            f" values ('dry-off-c1','clinic','제안 시험 1','viewer','사장님',{now},{now},%s::jsonb),"
            f"        ('dry-off-c2','clinic','제안 시험 2','owner2','사장님2',{now},{now},%s::jsonb)", (payload, payload))
        # 임시 세무사 5명(공개 4 · 비공개 1) — 상한 시험용. profiles 행이 있어야 current_domain_id() 가 풀린다.
        prof_cols = [r[0] for r in (cur.execute(
            "select column_name from information_schema.columns where table_schema='public' and table_name='profiles'"
            " and is_nullable='NO' and column_default is null") or cur).fetchall()]
        for i in range(4, 9):
            aid = f"dry-aud{i}"
            cur.execute(f"insert into public.auditors (id, display_name, email, created_at) values (%s, %s, %s, {now})",
                        (aid, f"임시{i}", f"dry{i}@x.local"))
            vals = {"id": f"00000000-0000-0000-0000-00000000000{i}", "domain_id": aid, "role": "auditor",
                    "label": f"임시{i}", "display_name": f"임시{i}", "created_at": 1, "updated_at": 1}
            cols = sorted(set(prof_cols) | {"id", "domain_id", "role"})
            cur.execute("set local session_replication_role = replica")  # auth.users FK 없이 넣기
            cur.execute(f"insert into public.profiles ({', '.join(cols)}) values ({', '.join(['%s'] * len(cols))})",
                        [vals.get(c, "x") for c in cols])
            cur.execute("set local session_replication_role = origin")
            cur.execute("insert into public.expert_profiles (auditor_id, listed) values (%s, %s)", (aid, i != 8))

        # 사장님 풀 동의(dry-off-c1 만)
        as_user("viewer")
        one("select conversation_id from public.grant_pool_consent('dry-off-c1')")
        reset()

        # ── make_offer 권한·조건 ─────────────────────────────────────────────────
        as_user("auditor2")
        expect_error("동의 없는 대화에 제안 불가", "select public.make_offer('dry-off-c2')", contains="pool case not available")
        reset()
        as_user("viewer")
        expect_error("사장님은 제안 불가", "select public.make_offer('dry-off-c1')", contains="only experts")
        reset()
        as_user("admin")
        expect_error("admin 은 제안 불가", "select public.make_offer('dry-off-c1')", contains="only experts")
        reset()
        as_domain("dry-aud8")
        expect_error("프로필 비공개 세무사 제안 불가", "select public.make_offer('dry-off-c1')", contains="not listed")
        reset()
        as_user("auditor2")
        expect_error("메시지 301자 거부", "select public.make_offer('dry-off-c1', %s)", ("가" * 301,), contains="too long")
        row = one("select id, viewer_id, expert_id, status, message, expires_at - created_at, jsonb_array_length(status_history)"
                  " from public.make_offer('dry-off-c1', '  치과 종소세 경험 많습니다  ')")
        check("제안 생성", row[1:] == ("viewer", "auditor2", "pending", "치과 종소세 경험 많습니다", 7 * 24 * 3600 * 1000, 1), row)
        oid2 = row[0]
        expect_error("같은 대화 재제안 불가(1회만)", "select public.make_offer('dry-off-c1')", contains="already offered")
        reset()
        nm = [m for m in mails("viewer") if m[2] == {"kind": "offer", "id": oid2}]
        check("새 제안 → 사장님 메일(ref offer)", len(nm) == 1 and "연결을 요청" in nm[0][0] and "치과 종소세" in nm[0][1], nm)

        # ── 조회 RLS · 직접 쓰기 차단 ───────────────────────────────────────────────
        for who, want in (("viewer", 1), ("auditor2", 1), ("admin", 1), ("auditor", 0), ("auditor3", 0), ("owner2", 0)):
            as_user(who)
            n = one("select count(*) from public.consultation_offers where id=%s", (oid2,))[0]
            check(f"제안 조회 {who}={want}", n == want, n)
            reset()
        as_user("auditor2")
        expect_error("제안 직접 insert 차단",
                     f"insert into public.consultation_offers (id, conversation_id, expert_id, viewer_id, created_at, updated_at, expires_at)"
                     f" values ('dry-x','dry-off-c2','auditor2','owner2',1,1,1)")
        cur.execute("update public.consultation_offers set status='approved' where id=%s", (oid2,))
        check("제안 직접 update 0행", cur.rowcount == 0)
        reset()
        as_user("viewer")
        cur.execute("update public.consultation_offers set status='approved' where id=%s", (oid2,))
        check("사장님도 직접 update 0행", cur.rowcount == 0)
        reset()

        # ── list_pool_cases: 내 제안 상태 열 ─────────────────────────────────────────
        as_user("auditor2")
        st = one("select my_offer_status, viewed_by_me from public.list_pool_cases() where conversation_id='dry-off-c1'")
        check("풀 목록 my_offer_status=pending(제안한 세무사)", st == ("pending", False), st)
        reset()
        as_user("auditor")
        st = one("select my_offer_status from public.list_pool_cases() where conversation_id='dry-off-c1'")
        check("풀 목록 my_offer_status=null(안 한 세무사)", st == (None,), st)
        one("select conversation_id from public.open_pool_case('dry-off-c1')")
        check("열람 기록 회귀", one("select viewed_by_me from public.list_pool_cases() where conversation_id='dry-off-c1'")[0] is True)
        reset()
        as_user("viewer")
        expect_error("사장님 풀 목록 불가(회귀)", "select * from public.list_pool_cases()")
        reset()

        # ── 전이 권한 ──────────────────────────────────────────────────────────────
        for who in ("auditor", "auditor2", "owner2"):
            as_user(who)
            expect_error(f"{who} 승인 불가", "select public.transition_offer(%s,'approved')", (oid2,), contains="only the owner")
            reset()
        as_user("viewer")
        expect_error("사장님 철회 불가", "select public.transition_offer(%s,'withdrawn')", (oid2,), contains="only the offering expert")
        expect_error("알 수 없는 전이", "select public.transition_offer(%s,'expired')", (oid2,), contains="invalid transition target")
        reset()
        as_user("admin")
        expect_error("admin 승인 불가(대신 방을 열지 않음)", "select public.transition_offer(%s,'approved')", (oid2,))
        reset()

        # ── 대기 상한 5 ────────────────────────────────────────────────────────────
        for who in ("auditor", "auditor3"):
            as_user(who)
            one("select id from public.make_offer('dry-off-c1')")
            reset()
        for d in ("dry-aud4", "dry-aud5"):
            as_domain(d)
            one("select id from public.make_offer('dry-off-c1')")
            reset()
        check("대기 제안 5건", one("select count(*) from public.consultation_offers where conversation_id='dry-off-c1' and status='pending'")[0] == 5)
        as_domain("dry-aud6")
        expect_error("6번째 제안 거부(상한 5)", "select public.make_offer('dry-off-c1')", contains="limit reached")
        reset()

        # ── 만료(7일) ─────────────────────────────────────────────────────────────
        oid5 = offer_of("dry-aud5")[0]
        cur.execute(f"update public.consultation_offers set expires_at = {now} - 1 where id=%s", (oid5,))
        as_domain("dry-aud5")
        check("만료분 풀 목록 = expired", one("select my_offer_status from public.list_pool_cases() where conversation_id='dry-off-c1'")[0] == "expired")
        reset()
        as_user("viewer")
        r5 = one("select status from public.transition_offer(%s,'approved')", (oid5,))[0]
        check("만료분 승인 → expired 확정(승인 안 됨)", r5 == "expired", r5)
        reset()
        check("만료분은 방을 안 만든다", one("select count(*) from public.consultation_rooms where conversation_id='dry-off-c1' and expert_id='dry-aud5'")[0] == 0)
        h5 = one("select status_history from public.consultation_offers where id=%s", (oid5,))[0]
        check("만료 이력 actor=system", h5[-1]["status"] == "expired" and h5[-1]["actor"] == "system", h5)
        as_user("viewer")
        expect_error("expired 뒤 전이 불가", "select public.transition_offer(%s,'declined')", (oid5,), contains="invalid transition")
        reset()
        as_domain("dry-aud6")
        oid6 = one("select id from public.make_offer('dry-off-c1')")[0]
        check("만료분은 상한에서 빠짐 → 6번째 가능", oid6 is not None)
        reset()

        # ── 승인 → 방(origin offer) ─────────────────────────────────────────────────
        as_user("viewer")
        st = one("select status from public.transition_offer(%s,'approved')", (oid2,))[0]
        check("사장님 승인", st == "approved")
        expect_error("승인 두 번 불가", "select public.transition_offer(%s,'approved')", (oid2,), contains="invalid transition")
        reset()
        room = one("select id, viewer_id, expert_id, origin, origin_id, status from public.consultation_rooms"
                   " where conversation_id='dry-off-c1' and expert_id='auditor2'")
        check("승인이 방을 만든다(origin offer)", room is not None and room[1:] == ("viewer", "auditor2", "offer", oid2, "open"), room)
        rid2 = room[0] if room else None
        am = [m for m in mails("auditor2") if m[2] == {"kind": "offer", "id": oid2}]
        check("승인 → 세무사 메일", len(am) == 1 and "승인" in am[0][0], am)
        for who, want in (("viewer", 1), ("auditor2", 1), ("auditor", 0)):
            as_user(who)
            check(f"offer 방 조회 {who}={want}", one("select count(*) from public.consultation_rooms where id=%s", (rid2,))[0] == want)
            reset()
        as_user("auditor2")
        check("풀 목록 my_offer_status=approved", one("select my_offer_status from public.list_pool_cases() where conversation_id='dry-off-c1'")[0] == "approved")
        cur.execute("insert into public.consultation_messages (id, room_id, sender_id, sender_role, body, created_at)"
                    " values ('dry-off-m1', %s, '-', 'user', '승인 감사합니다', 1)", (rid2,))
        check("offer 방에서 세무사 메시지", one("select sender_role from public.consultation_messages where id='dry-off-m1'")[0] == "auditor")
        expect_error("방 열린 뒤 같은 세무사 재제안 불가", "select public.make_offer('dry-off-c1')")
        reset()

        # open_room 출처 검증(offer)
        oid_a = offer_of("auditor")[0]
        expect_error("승인 안 된 제안으로 open_room 불가",
                     "select public.open_room('dry-off-c1','viewer','auditor','offer',%s)", (oid_a,), contains="no approved offer")
        expect_error("남의 쌍으로 open_room 불가",
                     "select public.open_room('dry-off-c1','viewer','auditor3','offer',%s)", (oid2,), contains="no approved offer")
        same = one("select id from public.open_room('dry-off-c1','viewer','auditor2','offer',%s)", (oid2,))[0]
        check("open_room(offer) 중복 호출 → 같은 방", same == rid2)
        as_user("viewer")
        expect_error("open_room 사용자 실행 불가(회귀)", "select public.open_room('dry-off-c1','viewer','auditor2','offer',%s)", (oid2,))
        reset()

        # ── 거절 · 철회 · admin 브레이크 ─────────────────────────────────────────────
        as_user("viewer")
        st = one("select status from public.transition_offer(%s,'declined','이미 다른 세무사와 상담 중')", (oid_a,))[0]
        check("사장님 거절", st == "declined")
        reset()
        dm = [m for m in mails("auditor") if m[2] == {"kind": "offer", "id": oid_a}]
        check("거절 → 세무사 메일 + 사유", len(dm) == 1 and "거절" in dm[0][0] and "다른 세무사" in dm[0][1], dm)
        check("거절은 방을 안 만든다", one("select count(*) from public.consultation_rooms where conversation_id='dry-off-c1' and expert_id='auditor'")[0] == 0)
        as_user("auditor")
        expect_error("거절 뒤 재제안 불가(1회만)", "select public.make_offer('dry-off-c1')", contains="already offered")
        check("풀 목록 my_offer_status=declined", one("select my_offer_status from public.list_pool_cases() where conversation_id='dry-off-c1'")[0] == "declined")
        reset()

        oid4 = offer_of("dry-aud4")[0]
        as_user("auditor2")
        expect_error("남의 제안 철회 불가", "select public.transition_offer(%s,'withdrawn')", (oid4,), contains="only the offering expert")
        reset()
        as_domain("dry-aud4")
        check("세무사 철회", one("select status from public.transition_offer(%s,'withdrawn')", (oid4,))[0] == "withdrawn")
        reset()
        wm = [m for m in mails("viewer") if m[2] == {"kind": "offer", "id": oid4}]
        check("철회 → 사장님 메일", len(wm) == 2 and "철회" in wm[-1][0], wm)   # 새 제안 1 + 철회 1
        as_user("admin")
        check("admin 거절(브레이크)", one("select status from public.transition_offer(%s,'declined')", (oid6,))[0] == "declined")
        reset()

        # ── 방 상한 3 → 승인 롤백 ────────────────────────────────────────────────────
        oid3 = offer_of("auditor3")[0]
        as_user("viewer")
        one("select status from public.transition_offer(%s,'approved')", (oid3,))
        reset()
        cur.execute(f"insert into public.consultation_requests (id, conversation_id, viewer_id, expert_id, status, status_history, created_at, updated_at)"
                    f" values ('dry-off-req4','dry-off-c1','viewer','dry-aud4','accepted','[]',{now},{now})")
        one("select id from public.open_room('dry-off-c1','viewer','dry-aud4','request','dry-off-req4')")
        check("열린 방 3개(offer 2 + request 1)", one("select count(*) from public.consultation_rooms where conversation_id='dry-off-c1' and status='open'")[0] == 3)
        as_domain("dry-aud7")
        oid7 = one("select id from public.make_offer('dry-off-c1')")[0]
        reset()
        as_user("viewer")
        expect_error("방 상한 초과 → 승인 거부", "select public.transition_offer(%s,'approved')", (oid7,), contains="room limit")
        reset()
        check("상한 거부 뒤 제안은 pending 그대로", offer_of("dry-aud7")[1] == "pending")
        check("상한 거부 뒤 승인 메일 없음", not [m for m in mails("dry-aud7") if "승인" in m[0]])

        # ── 경로 A 가 대기 중이면 같은 세무사 제안 불가 ───────────────────────────────
        cur.execute("insert into public.conversations (id, occupation, title, owner_id, owner_label, created_at, updated_at, payload)"
                    f" values ('dry-off-c3','clinic','제안 시험 3','viewer','사장님',{now},{now},%s::jsonb)", (payload,))
        as_user("viewer")
        one("select conversation_id from public.grant_pool_consent('dry-off-c3')")
        cur.execute(f"insert into public.consultation_requests (id, conversation_id, viewer_id, expert_id, status, status_history, created_at, updated_at)"
                    f" values ('dry-off-req-a','dry-off-c3','viewer','auditor','pending','[]',{now},{now})")
        reset()
        as_user("auditor")
        expect_error("내 앞 대기 신청이 있으면 제안 불가", "select public.make_offer('dry-off-c3')", contains="already requested")
        reset()
        as_user("auditor3")
        check("다른 세무사는 제안 가능", one("select status from public.make_offer('dry-off-c3')")[0] == "pending")
        reset()

        # ── 동의 철회(D4): 이미 열린 방은 유지, 새 제안은 불가 ─────────────────────────
        as_user("viewer")
        one("select conversation_id from public.revoke_pool_consent('dry-off-c1')")
        reset()
        check("동의 철회 뒤 열린 방 유지", one("select count(*) from public.consultation_rooms where conversation_id='dry-off-c1' and status='open'")[0] == 3)
        as_domain("dry-aud6")
        expect_error("동의 철회 뒤 제안 불가", "select public.make_offer('dry-off-c1')")
        reset()
        as_user("auditor2")
        check("동의 철회 뒤 풀 목록에서 빠짐", one("select count(*) from public.list_pool_cases() where conversation_id='dry-off-c1'")[0] == 0)
        reset()

        # ── 경로 A 회귀: 수락 → 방(open_room 교체 뒤에도) ──────────────────────────────
        cur.execute("insert into public.conversations (id, occupation, title, owner_id, owner_label, created_at, updated_at, payload)"
                    f" values ('dry-off-c4','clinic','경로 A','owner2','사장님2',{now},{now},'{{}}'::jsonb)")
        cur.execute(f"insert into public.consultation_requests (id, conversation_id, viewer_id, expert_id, status, status_history, created_at, updated_at)"
                    f" values ('dry-off-req-b','dry-off-c4','owner2','auditor2','pending','[]',{now},{now})")
        as_user("auditor2")
        one("select status from public.transition_consultation('dry-off-req-b','accepted')")
        reset()
        check("경로 A 수락 → 방(origin request)",
              one("select origin, origin_id from public.consultation_rooms where conversation_id='dry-off-c4'") == ("request", "dry-off-req-b"))

        # ── anon: 정책 함수 실행 가능 · 0행(오류 없이) ────────────────────────────────
        cur.execute("set local role anon")
        cur.execute("select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true)")
        check("anon: current_domain_id 실행 가능·null", one("select public.current_domain_id()")[0] is None)
        check("anon: is_admin 실행 가능·false", one("select public.is_admin()")[0] is False)
        check("anon: 제안 0행(오류 없이)", one("select count(*) from public.consultation_offers")[0] == 0)
        expect_error("anon: make_offer 불가", "select public.make_offer('dry-off-c3')")
        expect_error("anon: transition_offer 불가", "select public.transition_offer(%s,'approved')", (oid7,))
        reset()

        # ── 삭제 cascade · Realtime ────────────────────────────────────────────────
        cur.execute("delete from public.conversations where id='dry-off-c1'")
        check("대화 삭제 → 제안 cascade", one("select count(*) from public.consultation_offers where conversation_id='dry-off-c1'")[0] == 0)
        pubs = {r[0] for r in (cur.execute("select tablename from pg_publication_tables where pubname='supabase_realtime'") or cur).fetchall()}
        check("Realtime consultation_offers", "consultation_offers" in pubs)
        cols = [r[0] for r in (cur.execute(
            "select unnest(proargnames) from pg_proc where proname='list_pool_cases' and pronamespace='public'::regnamespace") or cur).fetchall()]
        check("list_pool_cases 반환 열 끝 = my_offer_status", cols[-1:] == ["my_offer_status"], cols)

        conn.rollback()
        print("[dryrun] 롤백")

    print(f"\n결과: {ok} OK / {fail} FAIL")
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
