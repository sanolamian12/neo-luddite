"""
0060(옛 검수 흐름 절단 S6b — rag 옛 KB·kbdict archive 이동) 적용 뒤 확인 — 읽기 전용 트랜잭션으로만 조회한다.

사용:
    backend/.venv/Scripts/python.exe supabase/check_0060.py

행 수는 백업 manifest(backend/data/old_review_backup_1016/s6b/manifest.json)와 대조한다.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from apply_migration import db_url  # noqa: E402

REPO = Path(__file__).resolve().parents[1]
MANIFEST = REPO / "backend" / "data" / "old_review_backup_1016" / "s6b" / "manifest.json"
# (원래 자리, archive 자리, 백업 파일)
MOVED = [("rag.passages", "archive.passages", "rag.passages.csv"),
         ("rag.passage_edges", "archive.passage_edges", "rag.passage_edges.csv"),
         ("rag.passage_edits", "archive.passage_edits", "rag.passage_edits.csv"),
         ("kbdict.documents", "archive.kbdict_documents", "kbdict.documents.csv"),
         ("kbdict.chunks", "archive.kbdict_chunks", "kbdict.chunks.csv")]


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
        cur.execute("select version from supabase_migrations.schema_migrations where version = '0060'")
        check("schema_migrations 0060 기록", cur.fetchone() is not None)

        for old, new, csv_name in MOVED:
            cur.execute("select to_regclass(%s), to_regclass(%s)", (old, new))
            was, now = cur.fetchone()
            rows = None
            if now is not None:
                cur.execute(f"select count(*) from {new}")
                rows = cur.fetchone()[0]
            want = backup.get(csv_name, {}).get("rows")
            check(f"{old} → {new} (행 {rows} / 백업 {want})", was is None and now is not None and (want is None or rows == want))

        cur.execute("select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
                    "where (n.nspname = 'rag' and p.proname = 'match_passages') "
                    "or (n.nspname = 'kbdict' and p.proname = 'match_chunks')")
        check("검색 함수 삭제(rag.match_passages·kbdict.match_chunks)", not cur.fetchall())
        cur.execute("select to_regprocedure('kb3.match_chunks(vector, integer, text, text)') is not null "
                    "or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace "
                    "where n.nspname = 'kb3' and p.proname = 'match_chunks')")
        check("kb3.match_chunks(운영 검색)는 남음", cur.fetchone()[0])
        cur.execute("select exists (select 1 from pg_namespace where nspname = 'kbdict')")
        check("kbdict 스키마 없음", not cur.fetchone()[0])
        cur.execute("select to_regclass('rag.chat_turns')")
        check("rag.chat_turns 는 남음(계측)", cur.fetchone()[0] is not None)
        cur.execute("select count(*) from pg_constraint where contype = 'f' "
                    "and confrelid = to_regclass('archive.passages')")
        check("archive.passages 를 가리키는 FK 3개(edges 2·edits 1)", cur.fetchone()[0] == 3)
        cur.execute("select has_schema_privilege('anon', 'archive', 'usage'), "
                    "has_schema_privilege('authenticated', 'archive', 'usage')")
        a, b = cur.fetchone()
        check("anon·authenticated archive 사용권 없음", not a and not b)
        cur.execute("select tablename from pg_publication_tables where schemaname = 'archive'")
        check("archive 테이블 publication 0", not cur.fetchall())
        cur.execute("select prosrc from pg_proc where proname = '_purge_legacy_review_rows'")
        row = cur.fetchone()
        check("_purge_legacy_review_rows 가 archive.passages 를 찾음", bool(row) and "archive.passages" in row[0])
        conn.rollback()

    print("\n모두 OK" if fails == 0 else f"\nFAIL {fails}건")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
