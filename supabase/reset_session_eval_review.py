"""
E2E(session-eval-review.spec.ts) 가 만든 정성 평가 검수 흔적을 지운다.

그 스펙은 실 DB 를 바꾼다 — 평가 1건을 최종 승인하고, 기여를 적립하고, RAG 에 적재한다.
테스트가 끝나면 이걸 돌려 원상태(전부 pending / session_eval passage 없음)로 되돌린다.

사용:
    backend/.venv/Scripts/python.exe supabase/reset_session_eval_review.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from apply_migration import db_url  # noqa: E402


def main() -> None:
    import psycopg

    with psycopg.connect(db_url(), autocommit=True) as conn:
        cur = conn.cursor()
        cur.execute("delete from rag.passages where source_kind = 'session_eval'")
        passages = cur.rowcount
        cur.execute(
            "delete from public.ledger_entries where source_ref->>'kind' = 'session_eval'"
        )
        ledger = cur.rowcount
        cur.execute(
            "update public.session_evaluations "
            "set decision = null, decided_at = null, decided_by = null, "
            "    review_status = 'pending' "
            "where review_status <> 'pending' or decision is not null"
        )
        evals = cur.rowcount
        print(f"[reset] passage {passages} · ledger {ledger} · 평가 {evals} 건 원복")

        cur.execute(
            "select review_status, count(*) from public.session_evaluations group by 1"
        )
        print("[reset] 정성 평가 상태:", cur.fetchall())
        cur.execute("select source_kind, count(*) from rag.passages group by 1")
        print("[reset] KB 구성      :", cur.fetchall())


if __name__ == "__main__":
    main()
