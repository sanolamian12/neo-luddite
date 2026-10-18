"""
옛 검수 흐름 rag·kbdict 테이블 CSV 백업 (절단 S6b, 2026-10-19) — 0060(archive 이동) 전에 한 번. 운영 DB 는 읽기만 한다.

사용 (저장소 루트에서):
    backend/.venv/Scripts/python.exe supabase/backup_old_review_s6b_1019.py

출력: backend/data/old_review_backup_1016/s6b/ (git 제외 — rag.passages 는 고객 질문·답변·검수 코멘트 번들이다)
  · <스키마>.<테이블>.csv — 임베딩 칸(vector 4096)은 뺀다(로드맵 S6b ①: 텍스트만, 다시 만들 수 있다)
  · manifest.json — 테이블별 행 수·sha256·찍은 시각 (check_0060.py 가 archive 행 수와 대조)
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
OUT = REPO / "backend" / "data" / "old_review_backup_1016" / "s6b"
TABLES = [("rag", "passages"), ("rag", "passage_edges"), ("rag", "passage_edits"),
          ("kbdict", "documents"), ("kbdict", "chunks")]


def main() -> None:
    import psycopg

    sys.stdout.reconfigure(encoding="utf-8")
    OUT.mkdir(parents=True, exist_ok=True)
    manifest: dict = {"taken_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "files": {}}
    with psycopg.connect(db_url()) as conn:
        conn.execute("set transaction read only")
        for schema, table in TABLES:
            cols = [r[0] for r in conn.execute(
                "select column_name from information_schema.columns where table_schema = %s and table_name = %s "
                "and udt_name <> 'vector' order by ordinal_position", (schema, table)).fetchall()]
            sql = f"select {', '.join(cols)} from {schema}.{table}"
            buf = io.StringIO()
            with conn.cursor() as cur:
                with cur.copy(f"copy ({sql}) to stdout with (format csv, header true)") as cp:
                    for chunk in cp:
                        buf.write(bytes(chunk).decode("utf-8"))
            text = buf.getvalue()
            rows = max(0, sum(1 for _ in csv.reader(io.StringIO(text))) - 1)
            name = f"{schema}.{table}.csv"
            (OUT / name).write_text(text, encoding="utf-8", newline="")
            manifest["files"][name] = {"rows": rows, "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
                                       "bytes": len(text.encode("utf-8"))}
            print(f"{name:28s} {rows:6d} 행")
        conn.rollback()
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n→ {OUT}")


if __name__ == "__main__":
    main()
