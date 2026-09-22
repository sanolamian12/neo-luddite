"""0040 conversations_staff_read 축소 — 역할별 RLS(조건 ①~④ 각각 열림·사라지면 닫힘) + anon 평가. 전부 트랜잭션 안에서 하고 롤백한다.

사용 (저장소 루트에서):
    backend/.venv/Scripts/python.exe supabase/tests/test_0040_staff_read.py --applied
      --applied          적용된 DB 의 함수·정책 그대로 시험 (보통 이것)
      --applied --refn   파일의 판정 함수만 바꿔 끼운 뒤 시험 — 적용 뒤 함수를 고칠 때 적용 전에 돌린다
      --applied --fresh  0040 객체를 지우고 0005 원래 정책으로 되돌린 뒤 파일 전체를 다시 실행
      (옵션 없음)        0040 미적용 DB 에서 파일 전체를 실행해 시험
"""
import json, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "supabase"))
from apply_migration import db_url  # noqa: E402
import psycopg  # noqa: E402

APPLIED = "--applied" in sys.argv
SQL = (REPO / "supabase/migrations/0040_conversations_staff_read_scope.sql").read_text(encoding="utf-8")

UID = {
    "viewer": "11111111-1111-1111-1111-111111111111",
    "auditor": "22222222-2222-2222-2222-222222222222",
    "admin": "33333333-3333-3333-3333-333333333333",
    "auditor2": "44444444-4444-4444-4444-444444444444",
    "owner2": "55555555-5555-5555-5555-555555555555",
    "auditor3": "88888888-8888-8888-8888-888888888888",
}

# 0040 이전 모양(0005 정책) — --fresh 와 롤백 SQL 이 같은 것
RESTORE_0005 = """
drop policy if exists conversations_staff_read on public.conversations;
create policy conversations_staff_read on public.conversations
  for select using (public.current_role() in ('admin', 'auditor'));
drop function if exists public.can_staff_read_conversation(text);
drop index if exists public.audits_conversation_idx;
drop index if exists public.consultation_requests_conversation_idx;
"""

# 조건 ①~④ 를 정의대로 직접 센 기대값(슈퍼유저로 계산) — 정책 결과와 맞춰 본다
EXPECTED = """
select count(*) from public.conversations c
 where exists (select 1 from public.audits a where a.conversation_id = c.id and a.auditor_id = %(me)s)
    or exists (select 1 from public.audit_tasks t where t.status in ('open','full','in_progress') and c.id = any (t.conversation_ids))
    or exists (select 1 from public.consultation_rooms r where r.conversation_id = c.id and r.expert_id = %(me)s)
    or exists (select 1 from public.consultation_requests q where q.conversation_id = c.id and q.expert_id = %(me)s)
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

        def one(sql, args=()):
            cur.execute(sql, args)
            return cur.fetchone()

        # 적용 전 기준: 0005 정책에서 세무사가 읽는 건수(= 전체)
        if not APPLIED or "--fresh" in sys.argv:
            if "--fresh" in sys.argv:
                cur.execute(RESTORE_0005)
            cur.execute("set local role authenticated")
            cur.execute("select set_config('request.jwt.claims', %s, true)", (json.dumps({"sub": UID["auditor3"], "role": "authenticated"}),))
            before = one("select count(*) from public.conversations")[0]
            cur.execute("reset role")
            total0 = one("select count(*) from public.conversations")[0]
            check("적용 전: 세무사(auditor3)가 전체를 읽는다(0005)", before == total0, f"{before}/{total0}")
            cur.execute(SQL)
            print(f"[dryrun] {'0040 객체 제거·0005 복원 → ' if '--fresh' in sys.argv else ''}0040 실행(트랜잭션 안), 적용 전 auditor3 {before}/{total0}건")
        elif "--refn" in sys.argv:
            cur.execute(fn_chunk(SQL, "create or replace function public.can_staff_read_conversation("))
            print("[dryrun] 판정 함수 교체(트랜잭션 안)")

        now = "(extract(epoch from now())*1000)::bigint"

        def as_user(who):
            cur.execute("set local role authenticated")
            cur.execute("select set_config('request.jwt.claims', %s, true)",
                        (json.dumps({"sub": UID[who], "role": "authenticated"}),))

        def as_anon():
            cur.execute("set local role anon")
            cur.execute("select set_config('request.jwt.claims', '{\"role\":\"anon\"}', true)")

        def reset():
            cur.execute("reset role")

        def sees(who, conv_id):
            as_user(who)
            n = one("select count(*) from public.conversations where id=%s", (conv_id,))[0]
            reset()
            return n == 1

        def visible(who):
            as_user(who)
            n = one("select count(*) from public.conversations")[0]
            reset()
            return n

        # ── 정의 ────────────────────────────────────────────────────────────────
        qual = one("select qual from pg_policies where schemaname='public' and tablename='conversations' and policyname='conversations_staff_read'")
        check("정책 = 판정 함수 하나", qual is not None and "can_staff_read_conversation" in qual[0] and "select" not in qual[0].lower(), qual)
        check("사장님 정책 그대로", one("select qual from pg_policies where schemaname='public' and tablename='conversations' and policyname='conversations_owner'")[0]
              == "(owner_id = current_domain_id())")
        check("admin 정책 그대로", one("select qual from pg_policies where schemaname='public' and tablename='conversations' and policyname='conversations_admin_all'")[0]
              == "is_admin()")
        check("판정 함수 security definer", one("select prosecdef from pg_proc where proname='can_staff_read_conversation' and pronamespace='public'::regnamespace")[0] is True)
        check("판정 함수 anon 실행 권한", one("select has_function_privilege('anon','public.can_staff_read_conversation(text)','execute')")[0] is True)
        check("판정 함수 authenticated 실행 권한", one("select has_function_privilege('authenticated','public.can_staff_read_conversation(text)','execute')")[0] is True)
        check("판정 함수 public 실행 권한 없음(명시 grant 만)",
              one("select count(*) from aclexplode((select proacl from pg_proc where proname='can_staff_read_conversation')) where grantee=0")[0] == 0)

        # ── 준비: 어떤 조건에도 안 걸린 시험 대화 ──────────────────────────────────
        cur.execute(
            "insert into public.conversations (id, occupation, title, owner_id, owner_label, created_at, updated_at, payload) values"
            f" ('dry-sr-c1','clinic','열람 시험 1','owner2','사장님2',{now},{now},'{{}}'::jsonb),"
            f" ('dry-sr-c2','clinic','열람 시험 2','owner2','사장님2',{now},{now},'{{}}'::jsonb),"
            f" ('dry-sr-c3','clinic','열람 시험 3','owner2','사장님2',{now},{now},'{{}}'::jsonb),"
            f" ('dry-sr-c4','clinic','열람 시험 4','owner2','사장님2',{now},{now},'{{}}'::jsonb),"
            f" ('dry-sr-c5','clinic','열람 시험 5','viewer','사장님',{now},{now},'{{}}'::jsonb)")
        dry = ["dry-sr-c1", "dry-sr-c2", "dry-sr-c3", "dry-sr-c4", "dry-sr-c5"]
        total = one("select count(*) from public.conversations")[0]

        # ── 배정 밖 = 0행 (설계 §2 의 218건 시험을 반대로) ─────────────────────────
        for a in ("auditor", "auditor2", "auditor3"):
            as_user(a)
            n = one("select count(*) from public.conversations where id = any(%s)", (dry,))[0]
            reset()
            check(f"{a}: 배정 밖 새 대화 0행", n == 0, n)
            exp = one(EXPECTED, {"me": a})[0]
            got = visible(a)
            check(f"{a}: 보이는 건수 = 조건 ①~④ 정의대로", got == exp, f"{got} vs {exp}")
            check(f"{a}: 전체보다 적다", got < total, f"{got}/{total}")
        check("단건 fetch(eq id)도 0행", not sees("auditor3", "dry-sr-c1"))

        # ── ① 내가 픽업한 검수 건 ─────────────────────────────────────────────────
        cur.execute(f"insert into public.audits (id, task_id, conversation_id, auditor_id, picked_at, status)"
                    f" values ('dry-sr-a1','dry-sr-t0','dry-sr-c1','auditor3',{now},'cancelled')")
        check("① 픽업한 검수 건(취소 상태라도) 열림", sees("auditor3", "dry-sr-c1"))
        check("① 다른 세무사에겐 안 열림", not sees("auditor2", "dry-sr-c1"))
        cur.execute("delete from public.audits where id='dry-sr-a1'")
        check("① 검수 건이 사라지면 다시 닫힘", not sees("auditor3", "dry-sr-c1"))

        # ── ② 열린 일감에 실린 대화 ───────────────────────────────────────────────
        cur.execute(f"insert into public.audit_tasks (id, label, conversation_ids, capacity, deadline, created_at, created_by, status)"
                    f" values ('dry-sr-t1','열람 시험',array['dry-sr-c2'],1,{now}+86400000,{now},'admin','open')")
        for st in ("open", "full", "in_progress"):
            cur.execute("update public.audit_tasks set status=%s where id='dry-sr-t1'", (st,))
            check(f"② 일감 {st} → 모든 세무사에게 열림", sees("auditor", "dry-sr-c2") and sees("auditor3", "dry-sr-c2"))
        check("② 사장님(비소유)에겐 안 열림 — 역할 가드", not sees("viewer", "dry-sr-c2"))
        cur.execute("update public.audit_tasks set status='closed' where id='dry-sr-t1'")
        check("② 일감이 닫히면 다시 닫힘", not sees("auditor3", "dry-sr-c2"))
        cur.execute("update public.audit_tasks set status='open' where id='dry-sr-t1'")
        cur.execute("delete from public.audit_tasks where id='dry-sr-t1'")
        check("② 일감이 지워지면 다시 닫힘", not sees("auditor3", "dry-sr-c2"))

        # ── ③ 나와 채팅방이 있는 대화 ─────────────────────────────────────────────
        cur.execute(f"insert into public.consultation_rooms (id, conversation_id, viewer_id, expert_id, origin, origin_id, status, created_at)"
                    f" values ('dry-sr-r1','dry-sr-c3','owner2','auditor3','offer','dry-sr-o1','open',{now})")
        check("③ 방이 있으면 열림", sees("auditor3", "dry-sr-c3"))
        check("③ 방 없는 세무사에겐 안 열림", not sees("auditor", "dry-sr-c3"))
        cur.execute(f"update public.consultation_rooms set status='closed', closed_at={now} where id='dry-sr-r1'")
        check("③ 닫힌 방이라도 열림(읽기 전용 방에서 원 대화 링크)", sees("auditor3", "dry-sr-c3"))
        cur.execute("delete from public.consultation_rooms where id='dry-sr-r1'")
        check("③ 방이 지워지면 다시 닫힘", not sees("auditor3", "dry-sr-c3"))

        # ── ④ 내 앞으로 온 경로 A 신청(상태 무관) ────────────────────────────────
        cur.execute(f"insert into public.consultation_requests (id, conversation_id, viewer_id, expert_id, status, status_history, created_at, updated_at)"
                    f" values ('dry-sr-q1','dry-sr-c4','owner2','auditor3','pending','[]',{now},{now})")
        for st in ("pending", "accepted", "declined", "completed", "cancelled"):
            cur.execute("update public.consultation_requests set status=%s where id='dry-sr-q1'", (st,))
            check(f"④ 신청 {st} → 열림", sees("auditor3", "dry-sr-c4"))
        check("④ 다른 세무사에겐 안 열림", not sees("auditor2", "dry-sr-c4"))
        cur.execute("delete from public.consultation_requests where id='dry-sr-q1'")
        check("④ 신청이 지워지면 다시 닫힘", not sees("auditor3", "dry-sr-c4"))

        # ── 제안(0039)만으로는 열리지 않는다 ───────────────────────────────────────
        cur.execute(f"insert into public.consultation_offers (id, conversation_id, viewer_id, expert_id, status, created_at, updated_at, expires_at)"
                    f" values ('dry-sr-o2','dry-sr-c4','owner2','auditor3','pending',{now},{now},{now}+604800000)")
        check("제안만으로는 안 열림", not sees("auditor3", "dry-sr-c4"))

        # ── 세무사 쓰기는 여전히 불가 ─────────────────────────────────────────────
        cur.execute(f"insert into public.audits (id, task_id, conversation_id, auditor_id, picked_at) values ('dry-sr-a2','dry-sr-t0','dry-sr-c1','auditor3',{now})")
        as_user("auditor3")
        cur.execute("update public.conversations set title='x' where id='dry-sr-c1'")
        check("세무사: 열린 대화도 update 0행", cur.rowcount == 0)
        cur.execute("delete from public.conversations where id='dry-sr-c1'")
        check("세무사: 열린 대화도 delete 0행", cur.rowcount == 0)
        reset()

        # ── admin 전체 · 사장님 본인 것 ───────────────────────────────────────────
        check("admin: 전체", visible("admin") == total, f"{visible('admin')}/{total}")
        own = {w: one("select count(*) from public.conversations where owner_id=%s", (w,))[0] for w in ("viewer", "owner2")}
        check("사장님 viewer: 본인 것 전부·그것만", visible("viewer") == own["viewer"], f"{visible('viewer')}/{own['viewer']}")
        check("사장님 owner2: 본인 것 전부·그것만", visible("owner2") == own["owner2"], f"{visible('owner2')}/{own['owner2']}")
        check("사장님 viewer: 본인 새 대화 보임", sees("viewer", "dry-sr-c5"))
        as_user("viewer")
        cur.execute(f"insert into public.conversations (id, occupation, title, owner_id, created_at, updated_at, payload)"
                    f" values ('dry-sr-c6','clinic','사장님 새 대화','viewer',{now},{now},'{{}}'::jsonb)")
        check("사장님: 본인 대화 insert·다시 읽기", one("select count(*) from public.conversations where id='dry-sr-c6'")[0] == 1)
        reset()
        check("판정 함수: 사장님 → false", (as_user("viewer"), one("select public.can_staff_read_conversation('dry-sr-c5')")[0])[1] is False)
        reset()
        check("판정 함수: admin → true", (as_user("admin"), one("select public.can_staff_read_conversation('dry-sr-c5')")[0])[1] is True)
        reset()
        check("판정 함수: null id → false", (as_user("auditor"), one("select public.can_staff_read_conversation(null)")[0])[1] is False)
        reset()

        # ── anon: 판정 함수 실행 가능·false, conversations 0행(오류 없이) ────────────
        as_anon()
        check("anon: 판정 함수 실행 가능·false", one("select public.can_staff_read_conversation('dry-sr-c5')")[0] is False)
        check("anon: current_role 실행 가능·null", one("select public.current_role()")[0] is None)
        check("anon: conversations 0행(오류 없이)", one("select count(*) from public.conversations")[0] == 0)
        reset()

        # ── Realtime ────────────────────────────────────────────────────────────
        pubs = {r[0] for r in (cur.execute("select tablename from pg_publication_tables where pubname='supabase_realtime'") or cur).fetchall()}
        check("Realtime conversations 그대로", "conversations" in pubs)

        conn.rollback()
        print("[dryrun] 롤백")

    print(f"\n결과: {ok} OK / {fail} FAIL")
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
