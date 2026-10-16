"""
0058(옛 검수 흐름 절단 S4) 적용 뒤 확인 — 읽기 전용 트랜잭션으로만 조회한다.

사용:
    backend/.venv/Scripts/python.exe supabase/check_0058.py

모든 줄이 OK 면 끝. FAIL 이 있으면 출력을 그대로 남기고 화면 체크리스트로 넘어가지 않는다.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from apply_migration import db_url  # noqa: E402

KEEP = {"auditors", "consultation_messages", "consultation_offers", "consultation_requests",
        "consultation_rooms", "conversations", "ledger_entries", "mail", "room_agent_runs"}
GONE_FUNCS = ["enforce_snapshot_immutable", "snapshot_settled_conversations", "is_review_member",
              "my_conversation_ids", "conversation_finalized", "my_audit_submitted", "rebuild_passage_edges"]
OLD = ["audit_tasks", "audits", "line_feedback", "session_evaluations", "reviews", "pool_candidates"]


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    import psycopg

    fails = 0
    with psycopg.connect(db_url()) as conn:
        conn.execute("set transaction read only")
        cur = conn.cursor()

        def check(label: str, ok: bool, detail: object = "") -> None:
            nonlocal fails
            fails += 0 if ok else 1
            print(f"[{'OK' if ok else 'FAIL'}] {label}" + (f" : {detail}" if detail != "" else ""))

        cur.execute("select version from supabase_migrations.schema_migrations where version = '0058'")
        check("schema_migrations 0058 기록", cur.fetchone() is not None)

        cur.execute("select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'")
        pub = {r[0] for r in cur.fetchall()}
        check("publication = 남길 9개", pub == KEEP, sorted(pub ^ KEEP) or len(pub))

        cur.execute("select proname from pg_proc where proname = any(%s)", (GONE_FUNCS,))
        check("지운 함수 0", not cur.fetchall())
        cur.execute("select 1 from pg_trigger where tgname = 'conversations_snapshot_immutable'")
        check("스냅샷 트리거 없음", cur.fetchone() is None)

        cur.execute(
            "select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
            "where n.nspname = 'public' and p.proname in "
            "('list_experts','can_staff_read_conversation','_purge_account','admin_expert_revoke_preview','revoke_expert') "
            "and exists (select 1 from unnest(%s::text[]) t where p.prosrc ~ ('\\m' || t || '\\M'))",
            (OLD,),
        )
        check("남길 함수 5개 본문에 옛 테이블 0", not cur.fetchall())

        cur.execute(
            "select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
            "where n.nspname in ('public','rag','kb3','norms','laws','kbdict') and p.proname <> '_purge_legacy_review_rows' "
            "and exists (select 1 from unnest(%s::text[]) t where p.prosrc ~ ('\\m' || t || '\\M'))",
            (OLD,),
        )
        check("옛 테이블을 본문에서 읽는 함수 0 (_purge_legacy_review_rows 동적 참조 제외)", not (rows := cur.fetchall()), rows)
        cur.execute("select 1 from pg_proc where proname = 'match_passages'")
        check("rag.match_passages 는 남음(S5)", cur.fetchone() is not None)

        cur.execute("select policyname from pg_policies where tablename = 'conversations' and policyname = 'conversations_staff_read'")
        check("conversations_staff_read 정책 그대로", cur.fetchone() is not None)
        # anon 처럼 로그인 정보 없이 판정 함수 호출 → 오류 없이 false (Realtime 함정)
        cur.execute("select public.can_staff_read_conversation('nonexistent')")
        check("can_staff_read_conversation 호출 OK(false)", cur.fetchone()[0] is False)
        # 세무사 카드: 비로그인 호출 → 오류 없이, 검수 칸 0/false
        cur.execute("select count(*), coalesce(max(reviewed_count), 0), bool_or(reviewed_this_case) from public.list_experts(null)")
        n, mx, any_case = cur.fetchone()
        check("list_experts 호출 OK", n > 0 and mx == 0 and not any_case, f"카드 {n}장")
        conn.rollback()

    print("\n모두 OK" if fails == 0 else f"\nFAIL {fails}건")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
