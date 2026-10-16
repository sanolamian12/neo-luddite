"""0056 트리거(공용 승격 ↔ 기여 원장) + kb3_store 승인·철회 검증 — 일회용 로컬 Postgres(127.0.0.1:55432), 운영 DB 안 씀.

준비(10/16 방식): EDB postgresql-16 windows-x64-binaries.zip 을 스크래치에 풀고
  initdb -D pgdata -U postgres -A trust -E UTF8 --locale=C  →  pg_ctl -D pgdata -o "-p 55432" start
실행(backend/ 에서): .venv/Scripts/python.exe -X utf8 eval/local/test_0056_share_ledger.py   (11 PASS 기대)
"""
import sys
from pathlib import Path

import psycopg

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "backend"))
URL = "postgresql://postgres@127.0.0.1:55432/postgres"

BASE = """
drop schema if exists kb3 cascade; drop table if exists public.ledger_entries, public.profiles cascade;
create extension if not exists pgcrypto;
do $r$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; create role authenticated; end if; end $r$;
create table public.profiles (id uuid primary key, domain_id text);
create table public.ledger_entries (
  id text primary key, auditor_id text not null, kind text not null, amount integer not null,
  source_ref jsonb not null, balance_after integer not null, timestamp bigint not null, note text);
create schema kb3;
create table kb3.documents (
  id uuid primary key default gen_random_uuid(), case_id text unique not null,
  corpus text not null check (corpus in ('kb3_prec','kb3_trib','kb3_qna','kb3_expert')),
  case_number text not null, title text not null, content text not null default '', card jsonb, content_hash text,
  status text not null default 'active' check (status in ('active','archived')),
  publish_state text check (publish_state in ('draft','published')),
  share_state text check (share_state in ('pending','approved','rejected')),
  share_requested_at bigint, share_reviewed_at bigint, share_reviewed_by text, share_note text,
  expert_id uuid references public.profiles(id) on delete set null,
  updated_at bigint not null default 0);
"""
E1 = "11111111-1111-1111-1111-111111111111"
E2 = "22222222-2222-2222-2222-222222222222"


def main():
    c = psycopg.connect(URL, autocommit=True)
    c.execute(BASE)
    c.execute("insert into public.profiles values (%s,'auditor-1'),(%s,'auditor-2')", (E1, E2))
    # 0056 이전 승인분(이행 대상) 1건 + 기존 원장 잔액 30 (감사 크레딧)
    c.execute("insert into public.ledger_entries values ('old-1','auditor-2','contribution_accepted',30,"
              "'{\"kind\":\"audit\"}',30,1,null)")
    c.execute("insert into kb3.documents (case_id,corpus,case_number,title,card,publish_state,share_state,expert_id,"
              "share_reviewed_at) values ('pre','kb3_expert','세무사사례-pre','이전 승인 사례','{}','published',"
              "'approved',%s,5)", (E2,))
    c.execute("insert into kb3.documents (case_id,corpus,case_number,title,card,publish_state,share_state,expert_id) "
              "values ('a','kb3_expert','세무사사례-a','사례 A','{}','published','pending',%s)", (E1,))
    c.execute("insert into kb3.documents (case_id,corpus,case_number,title) values ('p1','kb3_prec','조심1','판례')")
    c.execute((REPO / "supabase/migrations/0056_kb3_share_ledger.sql").read_text(encoding="utf-8"))

    from api.rag import kb3_store
    kb3_store._conn = c

    def doc(case):
        return str(c.execute("select id from kb3.documents where case_id=%s", (case,)).fetchone()[0])

    def ledger(aud):
        return c.execute("select kind, amount, balance_after, source_ref->>'event', source_ref->>'reason' "
                         "from public.ledger_entries where auditor_id=%s order by timestamp, id", (aud,)).fetchall()

    def check():
        bad = c.execute("select doc_id, title, is_public, ledger_net from kb3.expert_contribution_check "
                        "where (is_public and ledger_net <> 1) or (not is_public and ledger_net <> 0)").fetchall()
        assert not bad, bad

    fails = 0

    def step(name, fn):
        nonlocal fails
        try:
            fn(); check(); print("PASS", name)
        except AssertionError as e:
            fails += 1; print("FAIL", name, e)

    a = doc("a")
    step("이행: 이전 승인 사례 +1, 잔액 30→31",
         lambda: _assert(ledger("auditor-2")[-1][:4] == ("contribution_accepted", 1, 31, "approved")))

    def approve():
        out = kb3_store.review_expert_share(a, True, "admin-1")
        assert out["shareState"] == "approved" and out["ledgerId"], out
        assert ledger("auditor-1") == [("contribution_accepted", 1, 1, "approved", None)], ledger("auditor-1")
    step("승인 → 원장 +1, ledgerId 반환", approve)

    def queue():
        assert [r.case.id for r in kb3_store.list_share_queue("approved")] == sorted([a, doc("pre")], key=lambda x: x != a) or \
            set(r.case.id for r in kb3_store.list_share_queue("approved")) == {a, doc("pre")}
        assert kb3_store.list_share_queue("pending") == []
    step("목록: approved 2 · pending 0", queue)

    def again():
        try:
            kb3_store.review_expert_share(a, True, "admin-1"); raise AssertionError("두 번 승인됨")
        except kb3_store.ExpertCaseError:
            pass
        assert len(ledger("auditor-1")) == 1
    step("중복 승인 거절 · 원장 그대로", again)

    def withdraw():
        out = kb3_store.withdraw_expert_share(a, "admin-1", "근거 부족")
        assert out["shareState"] == "withdrawn" and out["ledgerId"], out
        assert ledger("auditor-1")[-1] == ("adjustment", -1, 0, "withdrawn", "admin_withdrawn"), ledger("auditor-1")
        st = c.execute("select publish_state, share_state from kb3.documents where id=%s", (a,)).fetchone()
        assert st == ("published", "withdrawn"), st   # 전용 RAG 그대로 · 공용만 빠짐
    step("관리자 철회 → 원장 −1, 게시는 유지", withdraw)

    def reshare_reapprove():
        kb3_store.request_expert_share(E1, [a])
        kb3_store.review_expert_share(a, True, "admin-1")
        assert ledger("auditor-1")[-1][:3] == ("contribution_accepted", 1, 1)
    step("철회 뒤 다시 보내기 → 재승인 +1", reshare_reapprove)

    def unpublish():
        kb3_store.set_expert_publish(E1, a, False)
        assert ledger("auditor-1")[-1][1:] == (-1, 0, "withdrawn", "unpublished"), ledger("auditor-1")
        kb3_store.set_expert_publish(E1, a, False)   # 두 번 내려도 −1 한 번
        assert len(ledger("auditor-1")) == 4
    step("세무사 내리기 → −1(한 번만)", unpublish)

    def edit():
        kb3_store.set_expert_publish(E1, a, True); kb3_store.request_expert_share(E1, [a])
        kb3_store.review_expert_share(a, True, "admin-1")
        # save_expert_case 의 '내용 바뀜' 경로 = 같은 update
        c.execute("update kb3.documents set publish_state='draft', content_hash='h2' where id=%s", (a,))
        c.execute("update kb3.documents set share_state=null where id=%s", (a,))
        assert ledger("auditor-1")[-1][4] == "edited", ledger("auditor-1")
    step("내용 수정(초안 복귀) → −1 edited", edit)

    def revoke_and_delete():
        pre = doc("pre")
        c.execute("update kb3.documents set status='archived' where id=%s", (pre,))   # 0050 강등
        assert ledger("auditor-2")[-1][1:] == (-1, 30, "withdrawn", "archived"), ledger("auditor-2")
        c.execute("update kb3.documents set status='active' where id=%s", (pre,))     # 되살리면 +1
        assert ledger("auditor-2")[-1][:3] == ("contribution_accepted", 1, 31)
        c.execute("delete from kb3.documents where id=%s", (pre,))                    # 0051 계정 삭제
        assert ledger("auditor-2")[-1][1:] == (-1, 30, "withdrawn", "deleted"), ledger("auditor-2")
    step("강등 보관 −1 · 복원 +1 · 삭제 −1", revoke_and_delete)

    def others():
        n = c.execute("select count(*) from public.ledger_entries").fetchone()[0]
        c.execute("update kb3.documents set title='판례2' where case_id='p1'")
        c.execute("insert into kb3.documents (case_id,corpus,case_number,title,card,publish_state,expert_id) "
                  "values ('b','kb3_expert','세무사사례-b','사례 B','{}','draft',%s)", (E1,))
        assert c.execute("select count(*) from public.ledger_entries").fetchone()[0] == n
        tg = c.execute("select count(*) from pg_trigger where tgrelid='kb3.documents'::regclass "
                       "and not tgisinternal").fetchone()[0]
        assert tg == 3
    step("판례 수정·초안 생성은 원장 무변화", others)

    def reapply():   # 마이그레이션 두 번 실행해도 이행 행이 다시 안 생긴다
        n = c.execute("select count(*) from public.ledger_entries").fetchone()[0]
        c.execute((REPO / "supabase/migrations/0056_kb3_share_ledger.sql").read_text(encoding="utf-8"))
        assert c.execute("select count(*) from public.ledger_entries").fetchone()[0] == n
    step("재실행 멱등", reapply)

    print("auditor-1:", ledger("auditor-1"))
    print("auditor-2:", ledger("auditor-2"))
    print("FAILS", fails)
    sys.exit(1 if fails else 0)


def _assert(cond):
    assert cond


if __name__ == "__main__":
    main()
