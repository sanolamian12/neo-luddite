"""
RAG 뼈대 CLI — 시드 적재 / 검색 스모크 / KB 크기.

제품 논지(메모리 project_rag_product_thesis): KB 는 비어서 출발하고 세무사 코멘트로
자란다. 그러므로 이 CLI 의 `seed` 는 **최소 기본 지식만** 넣는다(전량 인덱싱 아님).
실제 성장은 배포 후 검수 코멘트(line_feedback → api.rag.ingest_feedback)가 담당한다.

사용 (backend/ 에서, venv 활성 + .env 에 SUPABASE_DB_URL·UPSTAGE_API_KEY):
    python scripts/rag_ingest.py seed --n 8 --occupation clinic
    python scripts/rag_ingest.py count
    python scripts/rag_ingest.py search "병의원 접대비 300만원 손금 인정되나요?"
"""

from __future__ import annotations

import argparse
import json
import os
import sys

# backend/ 를 import 경로에 (api.* / scripts 밖에서 실행해도 동작)
_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

from dotenv import load_dotenv

load_dotenv(os.path.join(_BACKEND, ".env"))

_CASES = os.path.join(_BACKEND, "data", "processed", "all_cases.jsonl")


def _load_cases(n: int) -> list[dict]:
    """all_cases.jsonl 앞에서 요약이 충실한 판례 n건만(기본 지식 시드)."""
    out: list[dict] = []
    with open(_CASES, encoding="utf-8") as f:
        for line in f:
            if len(out) >= n:
                break
            try:
                c = json.loads(line)
            except json.JSONDecodeError:
                continue
            if (c.get("summary") or "").strip():   # 요약 있는 것만
                out.append(c)
    return out


def cmd_seed(args) -> None:
    from api.rag import ingest, store

    cases = _load_cases(args.n)
    print(f"시드 후보 {len(cases)}건 (요약 보유). 적재 시작…")
    for i, c in enumerate(cases, 1):
        pid = ingest.ingest_case_seed(c, occupation=args.occupation)
        print(f"  [{i}/{len(cases)}] {c.get('case_number') or c.get('case_id')} → {pid}")
    print(f"완료. 현재 KB passage 수: {store.count()}")


def cmd_count(args) -> None:
    from api.rag import store

    print(f"KB passage(active): {store.count()}")


def cmd_search(args) -> None:
    from api.rag import get_retriever

    r = get_retriever(force_enabled=True)
    hits = r.retrieve(args.query, k=args.k, occupation=args.occupation)
    if not hits:
        print("검색 결과 없음 (KB 가 비었거나 DB 미설정 — baseline 상태).")
        return
    for h in hits:
        print(f"\n[score {h.score:.4f} · {h.source_kind} · refs={h.case_refs}]")
        print(h.content[:300])


def main() -> None:
    ap = argparse.ArgumentParser(description="RAG 뼈대 CLI")
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("seed", help="all_cases.jsonl 에서 기본 지식 n건 시드")
    s.add_argument("--n", type=int, default=8)
    s.add_argument("--occupation", default="clinic")
    s.set_defaults(func=cmd_seed)

    c = sub.add_parser("count", help="KB passage 수")
    c.set_defaults(func=cmd_count)

    q = sub.add_parser("search", help="검색 스모크 테스트")
    q.add_argument("query")
    q.add_argument("--k", type=int, default=5)
    q.add_argument("--occupation", default="clinic")
    q.set_defaults(func=cmd_search)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
