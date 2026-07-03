"""
Workstream B — 벡터 RAG (뼈대).

제품 논지(메모리 project_rag_product_thesis): KB 는 비어서 출발하고 세무사 코멘트
(질문 A + Upstage 답변 B + 코멘트 C)로 자란다. 이 패키지는 그 성장 루프의 배선:

    · embeddings — Upstage embedding-query / embedding-passage (4096d)
    · store      — rag.passages 벡터 저장·검색 (Supabase pgvector, psycopg 직결)
    · retriever  — Retriever 경계(§3-3) + get_retriever() 팩토리 (RAG on/off, graceful)
    · ingest     — C(코멘트)/KB/판례 → Q+A+C 번들 → embed_passage → upsert (write path)

pipeline.py ③단계가 get_retriever() 로 정규식 스텁을 대체한다.
"""

from __future__ import annotations

from api.rag.ingest import (
    build_bundle_text,
    ingest_case_seed,
    ingest_feedback,
    ingest_kb_document,
)
from api.rag.retriever import Passage, Retriever, get_retriever

__all__ = [
    "Passage",
    "Retriever",
    "get_retriever",
    "build_bundle_text",
    "ingest_feedback",
    "ingest_kb_document",
    "ingest_case_seed",
]
