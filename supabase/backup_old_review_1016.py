"""
옛 검수 흐름 테이블 CSV 백업 (절단 S6a, 2026-10-16) — 0059(archive 이동) 전에 한 번. 운영 DB 는 읽기만 한다.

사용 (저장소 루트에서):
    backend/.venv/Scripts/python.exe supabase/backup_old_review_1016.py

출력: backend/data/old_review_backup_1016/ (git 제외 — 고객 대화 원문·코멘트가 들어 있다, 0053 KB2 백업과 같은 자리)
  · public.<테이블>.csv  — 옛 테이블 10개 전체(jsonb·배열은 Postgres 텍스트 표현 그대로)
  · conversations_snapshot.csv — conversations 의 id·snapshot_at·snapshot_payload·excluded_at
  · manifest.json — 테이블별 행 수·sha256·찍은 시각
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from apply_migration import db_url  # noqa: E402

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "backend" / "data" / "old_review_backup_1016"
TABLES = ["pool_candidates", "audit_tasks", "audits", "line_feedback", "session_evaluations", "reviews",
          "inquiries", "training_batches", "model_versions", "kb_documents"]


def main() -> None:
    import psycopg

    sys.stdout.reconfigure(encoding="utf-8")
    OUT.mkdir(parents=True, exist_ok=True)
    manifest: dict = {"taken_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "files": {}}
    jobs = [(f"public.{t}.csv", f"select * from public.{t}") for t in TABLES]
    jobs.append(("conversations_snapshot.csv",
                 "select id, snapshot_at, snapshot_payload, excluded_at from public.conversations "
                 "where snapshot_at is not null or snapshot_payload is not null or excluded_at is not null"))
    with psycopg.connect(db_url()) as conn:
        conn.execute("set transaction read only")
        for name, sql in jobs:
            buf = io.StringIO()
            with conn.cursor() as cur:
                with cur.copy(f"copy ({sql}) to stdout with (format csv, header true)") as cp:
                    for chunk in cp:
                        buf.write(bytes(chunk).decode("utf-8"))
            text = buf.getvalue()
            rows = max(0, sum(1 for _ in csv.reader(io.StringIO(text))) - 1)
            (OUT / name).write_text(text, encoding="utf-8", newline="")
            manifest["files"][name] = {"rows": rows, "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
                                       "bytes": len(text.encode("utf-8"))}
            print(f"{name:32s} {rows:6d} 행")
        conn.rollback()
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n→ {OUT}")


if __name__ == "__main__":
    main()
