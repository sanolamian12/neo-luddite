"""
kb2_store — 공용 DB 헬퍼 재수출 shim + 남은 KB2 검색 한 줄.

KB2(응축형 정책 사전)는 10/12 폐기·kb2 스키마 삭제(0053), 화면·API·재구조화 폴러·저장소 본체는
옛 검수 흐름 절단 S3(10/16)에서 지웠다. 남은 것:
  · `_db_url`·`is_configured` — api/db.py 재수출. kb3·법령·kbdict·규범·vec_memory·인증·방 agent 가
    아직 이 이름으로 import 한다(답변 경로라 S5 에서 api.db 로 옮긴다).
  · `kb2_enabled`·`match_sentences` — retriever 의 kb2·hybrid·fusion 갈래가 부른다(KB2=off 라 빈 결과).
    retriever 정리(S5)와 함께 지운다.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Optional

from api.db import _db_url, is_configured  # noqa: F401 — 재수출(위 docstring)

_conn = None  # 지연 연결(모듈 캐시, rag/store.py 와 별개 커넥션). 끊기면 재연결.


def _connect():
    import psycopg
    from pgvector.psycopg import register_vector

    conn = psycopg.connect(_db_url(), autocommit=True)
    register_vector(conn)
    return conn


def _get_conn():
    global _conn
    if _conn is None or _conn.closed:
        _conn = _connect()
    return _conn


def kb2_enabled() -> bool:
    """KB2 기능 스위치(10/12 — KB2 폐기·kb2 스키마 삭제, DB 크기 0.5GB 한도). 기본 off. KB2=on 이면서 DB 가 있을 때만.
    kb2 API·재구조화 폴러·Kb2Retriever 는 이걸 본다(스키마가 없으면 쿼리가 실패하므로)."""
    return is_configured() and os.environ.get("KB2", "off") == "on"


@dataclass
class MatchedSentence:
    id: str
    document_id: str
    content: str
    score: float


def match_sentences(
    query_embedding: list[float], k: int = 5, tax_category: Optional[str] = None
) -> list[MatchedSentence]:
    """kb2.match_sentences 코사인 top-k. 검색 전환(로드맵 3단계)에서 실제 사용."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "select id, document_id, content, score from kb2.match_sentences(%s::vector, %s, %s)",
            (query_embedding, k, tax_category),
        )
        rows = cur.fetchall()
    return [
        MatchedSentence(id=str(r[0]), document_id=str(r[1]), content=r[2], score=float(r[3]))
        for r in rows
    ]
