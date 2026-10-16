"""
0059(옛 검수 흐름 절단 S6a — archive 이동) 적용 뒤 확인 — 읽기 전용 트랜잭션으로만 조회한다.

사용:
    backend/.venv/Scripts/python.exe supabase/check_0059.py

행 수는 백업 manifest(backend/data/old_review_backup_1016/manifest.json)와 대조한다.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from apply_migration import db_url  # noqa: E402

REPO = Path(__file__).resolve().parents[1]
MANIFEST = REPO / "backend" / "data" / "old_review_backup_1016" / "manifest.json"
MOVED = ["pool_candidates", "audit_tasks", "audits", "line_feedback", "session_evaluations", "reviews",
         "inquiries", "training_batches", "model_versions", "kb_documents"]


def main() -> None:
    import psycopg

    sys.stdout.reconfigure(encoding="utf-8")
    backup = json.loads(MANIFEST.read_text(encoding="utf-8"))["files"] if MANIFEST.exists() else {}
    fails = 0

    def check(label: str, ok: bool, detail: object = "") -> None:
        nonlocal fails
        fails += 0 if ok else 1
        print(f"[{'OK' if ok else 'FAIL'}] {label}" + (f" : {detail}" if detail != "" else ""))

    with psycopg.connect(db_url()) as conn:
        conn.execute("set transaction read only")
        cur = conn.cursor()
        cur.execute("select version from supabase_migrations.schema_migrations where version = '0059'")
        check("schema_migrations 0059 기록", cur.fetchone() is not None)

        for t in MOVED:
            cur.execute("select to_regclass(%s), to_regclass(%s)", (f"public.{t}", f"archive.{t}"))
            pub, arc = cur.fetchone()
            rows = None
            if arc is not None:
                cur.execute(f"select count(*) from archive.{t}")
                rows = cur.fetchone()[0]
            want = backup.get(f"public.{t}.csv", {}).get("rows")
            check(f"{t} → archive (행 {rows} / 백업 {want})", pub is None and arc is not None and (want is None or rows == want))

        cur.execute("select column_name from information_schema.columns where table_schema = 'public' "
                    "and table_name = 'conversations' and column_name in ('snapshot_at','snapshot_payload','excluded_at')")
        check("conversations 스냅샷 칸 없음", not cur.fetchall())
        cur.execute("select to_regclass('archive.conversation_snapshots')")
        n = None
        if cur.fetchone()[0] is not None:
            cur.execute("select count(*) from archive.conversation_snapshots")
            n = cur.fetchone()[0]
        want = backup.get("conversations_snapshot.csv", {}).get("rows")
        check(f"archive.conversation_snapshots 행 {n} / 백업 {want}", n is not None and (want is None or n == want))
        cur.execute("select to_regclass('public.settlement_rounds')")
        check("settlement_rounds 는 public 에 남음(D7)", cur.fetchone()[0] is not None)

        cur.execute("select exists (select 1 from pg_namespace where nspname = 'archive')")
        if cur.fetchone()[0]:
            cur.execute("select has_schema_privilege('anon', 'archive', 'usage'), "
                        "has_schema_privilege('authenticated', 'archive', 'usage')")
            a, b = cur.fetchone()
            check("anon·authenticated archive 사용권 없음", not a and not b)
        else:
            check("archive 스키마 있음", False)
        cur.execute("select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'archive'")
        check("archive 테이블 publication 0", not cur.fetchall())
        cur.execute("select prosrc from pg_proc where proname = '_purge_legacy_review_rows'")
        row = cur.fetchone()
        check("_purge_legacy_review_rows 가 정지 사진 보관본도 지움", bool(row) and "archive.conversation_snapshots" in row[0])
        cur.execute("select count(*) from public.conversations")
        check("conversations 행 그대로", cur.fetchone()[0] > 0)
        conn.rollback()

    print("\n모두 OK" if fails == 0 else f"\nFAIL {fails}건")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
