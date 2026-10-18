"""
벡터 검색 패키지.

    · embeddings — Upstage embedding-query / embedding-passage (4096d)
    · retriever  — Retriever 경계 + get_retriever() 팩토리 (RAG on/off, KB3 검색, graceful)
    · kb3_store·laws_store·kbdict_store·vec_memory — 답변 근거 코퍼스
    · store      — app_config 스위치 읽기 · rag.chat_turns 계측

옛 검수 흐름의 적재(ingest)와 KB2 는 절단 S3, rag.passages·kb2·kbdict·fusion 검색 갈래는 S5(10/16)에서 지웠다.
pipeline.py 는 get_retriever() 를 여기서 받는다.
"""

from __future__ import annotations

from api.rag.retriever import Passage, Retriever, get_retriever

__all__ = [
    "Passage",
    "Retriever",
    "get_retriever",
]
