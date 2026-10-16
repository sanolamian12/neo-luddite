"""
벡터 검색 패키지.

    · embeddings — Upstage embedding-query / embedding-passage (4096d)
    · retriever  — Retriever 경계 + get_retriever() 팩토리 (RAG on/off, 코퍼스 선택, graceful)
    · kb3_store·laws_store·kbdict_store·vec_memory — 답변 근거 코퍼스
    · store      — app_config 스위치 · rag.chat_turns 계측 (+ 옛 rag.passages 검색, S5 정리)

옛 검수 흐름의 적재(ingest: 코멘트 C → Q+A+C 번들)와 KB2 는 절단 S3(10/16)에서 지웠다.
pipeline.py 는 get_retriever() 를 여기서 받는다.
"""

from __future__ import annotations

from api.rag.retriever import Passage, Retriever, get_retriever

__all__ = [
    "Passage",
    "Retriever",
    "get_retriever",
]
