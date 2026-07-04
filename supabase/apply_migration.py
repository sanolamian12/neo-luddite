"""
재사용 마이그레이션 적용기 — psycopg 직접 실행 (0005/0006 방식의 스크립트화).

사용:
    backend/.venv/Scripts/python.exe supabase/apply_migration.py \
        supabase/migrations/0007_shared_audit_board.sql 0007 shared_audit_board

접속: backend/.env 의 SUPABASE_DB_URL (세션 풀러). 비밀번호가 URL 에 없으면
SUPABASE_DB_PASSWORD 를 인코딩해 채운다(store.py 와 동일 규약).

동작: ①현재 schema_migrations 출력 → ②이미 적용됐으면 중단 → ③파일 전체 실행
(psycopg3: 파라미터 없는 다중 statement 는 simple-query 로 원자 실행) →
④schema_migrations 기록 → ⑤검증 쿼리.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

REPO = Path(__file__).resolve().parents[1]
load_dotenv(REPO / "backend" / ".env")


def db_url() -> str:
    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        raise SystemExit("SUPABASE_DB_URL 미설정 (backend/.env)")
    raw_pw = os.environ.get("SUPABASE_DB_PASSWORD")
    if raw_pw:
        from urllib.parse import quote

        enc = quote(raw_pw, safe="")
        if "[YOUR-PASSWORD]" in url:
            url = url.replace("[YOUR-PASSWORD]", enc)
        else:
            import re

            url = re.sub(r"(://[^:/@]+:)[^@]*(@)", rf"\g<1>{enc}\g<2>", url, count=1)
    return url


def main() -> None:
    if len(sys.argv) < 4:
        raise SystemExit("usage: apply_migration.py <sql_path> <version> <name>")
    sql_path = Path(sys.argv[1])
    version = sys.argv[2]
    name = sys.argv[3]
    sql = sql_path.read_text(encoding="utf-8")

    import psycopg

    with psycopg.connect(db_url(), autocommit=True) as conn:
        # ① 현재 이력
        with conn.cursor() as cur:
            cur.execute(
                "select version from supabase_migrations.schema_migrations order by version"
            )
            existing = [r[0] for r in cur.fetchall()]
        print(f"[migrations] 적용됨: {existing}")
        if version in existing:
            print(f"[migrations] {version} 이미 적용됨 — 중단")
            return

        # ③ 파일 전체 실행 (파라미터 없음 → 다중 statement 원자 실행)
        print(f"[apply] {sql_path.name} 실행 중…")
        conn.execute(sql)
        print("[apply] 실행 완료")

        # ④ 이력 기록 (schema_migrations 컬럼 구조에 맞춰 version+name)
        with conn.cursor() as cur:
            cur.execute(
                "select column_name from information_schema.columns "
                "where table_schema='supabase_migrations' and table_name='schema_migrations'"
            )
            cols = {r[0] for r in cur.fetchall()}
        if "name" in cols:
            conn.execute(
                "insert into supabase_migrations.schema_migrations (version, name) "
                "values (%s, %s) on conflict (version) do nothing",
                (version, name),
            )
        else:
            conn.execute(
                "insert into supabase_migrations.schema_migrations (version) "
                "values (%s) on conflict (version) do nothing",
                (version,),
            )
        print(f"[migrations] {version} 기록")

        # ⑤ 검증
        print("\n=== 검증 ===")
        checks = {
            "line_feedback.auditor_id": (
                "select 1 from information_schema.columns where table_schema='public' "
                "and table_name='line_feedback' and column_name='auditor_id'"
            ),
            "session_evaluations.auditor_id": (
                "select 1 from information_schema.columns where table_schema='public' "
                "and table_name='session_evaluations' and column_name='auditor_id'"
            ),
            "rag.passages.auditor_id": (
                "select 1 from information_schema.columns where table_schema='rag' "
                "and table_name='passages' and column_name='auditor_id'"
            ),
            "policy feedback_member_read": (
                "select 1 from pg_policies where schemaname='public' "
                "and tablename='line_feedback' and policyname='feedback_member_read'"
            ),
            "policy feedback_owner_write": (
                "select 1 from pg_policies where schemaname='public' "
                "and tablename='line_feedback' and policyname='feedback_owner_write'"
            ),
            "policy eval_member_read": (
                "select 1 from pg_policies where schemaname='public' "
                "and tablename='session_evaluations' and policyname='eval_member_read'"
            ),
            "unique session_eval_conv_auditor_key": (
                "select 1 from pg_indexes where schemaname='public' "
                "and tablename='session_evaluations' and indexname='session_eval_conv_auditor_key'"
            ),
            "old unique conv_id dropped": (
                "select 1 from pg_constraint where conname='session_evaluations_conversation_id_key'"
            ),
            "realtime line_feedback": (
                "select 1 from pg_publication_tables where pubname='supabase_realtime' "
                "and schemaname='public' and tablename='line_feedback'"
            ),
            "realtime session_evaluations": (
                "select 1 from pg_publication_tables where pubname='supabase_realtime' "
                "and schemaname='public' and tablename='session_evaluations'"
            ),
        }
        for label, q in checks.items():
            with conn.cursor() as cur:
                cur.execute(q)
                hit = cur.fetchone() is not None
            # "old unique dropped" 는 없어야 통과
            ok = (not hit) if label == "old unique conv_id dropped" else hit
            print(f"  [{'OK' if ok else 'FAIL'}] {label}")


if __name__ == "__main__":
    main()
