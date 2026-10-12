"""
Supabase egress 진단 (읽기 전용) — 메모리 벡터 적재 1회가 몇 바이트를 내려받는지 + 누적 쿼리 통계.
실행: backend/ 에서  .venv/Scripts/python.exe -m scripts.egress_audit
"""

import os

import psycopg
from dotenv import load_dotenv

load_dotenv(".env")
conn = psycopg.connect(os.environ["SUPABASE_DB_URL"])
cur = conn.cursor()
cur.execute("set default_transaction_read_only = on")


def mb(x):
    return f"{(x or 0) / 1e6:,.1f} MB"


print("=== 1. 메모리 벡터 적재 1회 크기 (vec_memory.py 와 같은 조건, 텍스트 전송 기준) ===")
cur.execute(
    "select count(*), sum(octet_length(embedding::text)) from laws.articles "
    "where status='active' and version='current' and not deleted and embedding is not null"
)
n, b = cur.fetchone()
n_l = n
print(f"laws.articles 임베딩   {n:>7,}행  {mb(b)}")
cur.execute(
    "select count(*), sum(octet_length(c.embedding::text)) from kb3.chunks c join kb3.documents d "
    "on d.id=c.document_id where c.status='active' and d.status='active' and d.corpus <> 'kb3_expert'"
)
n2, b2 = cur.fetchone()
n_k = n2
print(f"kb3.chunks 임베딩      {n2:>7,}행  {mb(b2)}")
cur.execute(
    "select count(*), sum(octet_length(coalesce(content,''))) from kb3.documents "
    "where status='active' and corpus <> 'kb3_expert'"
)
n3, b3 = cur.fetchone()
print(f"kb3.documents 본문     {n3:>7,}행  {mb(b3)}")
print(f"→ 재시작 1회 합계 ≈ {mb((b or 0) + (b2 or 0) + (b3 or 0))}")

print("\n=== 2. pg_stat_statements — 반환 행 수 상위 (통계 리셋 이후 누적) ===")
try:
    cur.execute("select stats_reset from pg_stat_statements_info")
    print("통계 시작:", cur.fetchone()[0])
except Exception as e:  # noqa: BLE001
    conn.rollback()
    print("stats_reset 조회 불가:", e)
cur.execute(
    "select calls, rows, left(regexp_replace(query, '\\s+', ' ', 'g'), 150) "
    "from pg_stat_statements order by rows desc limit 20"
)
for calls, rows, q in cur.fetchall():
    print(f"{calls:>8,}회 {rows:>11,}행  {q}")

print("\n=== 3. DB 크기 — 테이블 상위 15 (pg_total_relation_size = 표+인덱스+TOAST) ===")
cur.execute("select pg_database_size(current_database())")
print("DB 전체:", mb(cur.fetchone()[0]))
cur.execute(
    "select n.nspname || '.' || c.relname, pg_total_relation_size(c.oid), c.reltuples::bigint "
    "from pg_class c join pg_namespace n on n.oid = c.relnamespace "
    "where c.relkind in ('r','m') and n.nspname not in ('pg_catalog','information_schema') "
    "order by pg_total_relation_size(c.oid) desc limit 15"
)
for name, size, rows in cur.fetchall():
    print(f"{mb(size):>12}  {rows:>10,}행  {name}")

print("\n=== 4. pg_cron 실행 이력 (0052 정리 대상) ===")
try:
    cur.execute("select count(*), min(end_time), max(end_time) from cron.job_run_details")
    n, lo, hi = cur.fetchone()
    print(f"cron.job_run_details {n:,}행  {lo} ~ {hi}")
    cur.execute("select count(*) from cron.job_run_details where end_time < now() - interval '7 days'")
    print(f"  7일 지난 이력 {cur.fetchone()[0]:,}행")
except Exception as e:  # noqa: BLE001
    conn.rollback()
    print("조회 불가:", e)

print("\n=== 5. 기동 적재 1회 — 디스크 캐시 이후(지문만) vs 캐시 없을 때 바이너리 추정 ===")
print(f"캐시 적중: 지문 쿼리 3개(수백 바이트) · 캐시 미스(바이너리): 벡터 "
      f"laws {n_l:,}행 + kb3 {n_k:,}행 × 4096×4B ≈ {mb((n_l + n_k) * 4096 * 4)}")

conn.close()
