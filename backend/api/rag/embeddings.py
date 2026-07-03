"""
Upstage 임베딩 클라이언트 — RAG 의 벡터화 절반.

Upstage 는 OpenAI 호환이라 llm.get_client() 를 그대로 재사용한다(base_url override).
비대칭 임베딩: 문서는 embedding-passage, 질의는 embedding-query 로 임베딩한다
(Upstage 실측 2026-07-03, 둘 다 4096차원).

LLM 과 마찬가지로 판정에는 관여하지 않는다 — 검색을 위한 벡터화 전용.
"""

from __future__ import annotations

import os

from api import llm

# rag.passages.embedding vector(4096) 와 반드시 일치. (Upstage 실측값)
EMBED_DIM = int(os.environ.get("UPSTAGE_EMBED_DIM", "4096"))


def _passage_model() -> str:
    return os.environ.get("UPSTAGE_EMBED_PASSAGE_MODEL", "embedding-passage")


def _query_model() -> str:
    return os.environ.get("UPSTAGE_EMBED_QUERY_MODEL", "embedding-query")


def _embed(text: str, model: str) -> list[float]:
    text = (text or "").strip()
    if not text:
        raise ValueError("빈 텍스트는 임베딩할 수 없습니다.")
    resp = llm.get_client().embeddings.create(model=model, input=text)
    vec = resp.data[0].embedding
    if len(vec) != EMBED_DIM:
        raise RuntimeError(
            f"임베딩 차원 불일치: {model} → {len(vec)}d, 기대 {EMBED_DIM}d. "
            f"rag.passages.embedding 컬럼 차원과 UPSTAGE_EMBED_DIM 을 맞추세요."
        )
    return vec


def embed_passage(text: str) -> list[float]:
    """KB 문서(Q+A+C 번들)를 저장용 벡터로 임베딩."""
    return _embed(text, _passage_model())


def embed_query(text: str) -> list[float]:
    """사용자 질의를 검색용 벡터로 임베딩."""
    return _embed(text, _query_model())
