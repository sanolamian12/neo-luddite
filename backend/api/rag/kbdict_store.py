"""
kbdict.* 저장소 — L1 사전층(glossary·cases·occupations, KB통합 3층검색 로드맵 P3).

kb2_store.py 와 같은 컨벤션(모듈 캐시 커넥션, register_vector, %s 바인딩). 스키마가 분리돼
있어 별도 모듈로 둔다. 접속 URL 해석은 kb2_store 의 것을 그대로 쓴다(같은 DB).

적재(upsert_*)는 scripts/kbdict_ingest.py 만 부른다 — 챗 요청 경로는 match_chunks 하나뿐이다.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Optional

_conn = None  # 지연 연결(모듈 캐시). 끊기면 재연결.


def _get_conn():
    global _conn
    if _conn is None or _conn.closed:
        import psycopg
        from pgvector.psycopg import register_vector

        from api.rag.kb2_store import _db_url

        _conn = psycopg.connect(_db_url(), autocommit=True)
        register_vector(_conn)
    return _conn


def is_configured() -> bool:
    from api.rag import kb2_store

    return kb2_store.is_configured()


@dataclass
class MatchedChunk:
    id: str
    document_id: str
    source_path: str
    corpus: str
    title: str
    content: str
    score: float


def match_chunks(query_embedding: list[float], k: int = 5,
                 occupation: Optional[str] = None) -> list[MatchedChunk]:
    """kbdict.match_chunks 코사인 top-k. 업종 무관 문서는 항상, 업종 문서는 일치할 때만."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "select id, document_id, source_path, corpus, title, content, score "
            "from kbdict.match_chunks(%s::vector, %s, %s)",
            (query_embedding, k, occupation),
        )
        rows = cur.fetchall()
    return [
        MatchedChunk(id=str(r[0]), document_id=str(r[1]), source_path=r[2], corpus=r[3],
                     title=r[4], content=r[5], score=float(r[6]))
        for r in rows
    ]


# ── 적재 (scripts/kbdict_ingest.py 전용) ───────────────────────────────────────

def upsert_document(source_path: str, corpus: str, title: str, summary: Optional[str],
                    occupation: Optional[str], content_hash: str, origin: str = "seed") -> str:
    """source_path 기준 멱등. 다시 올라오면 active 로 되살리고 메타를 갱신한다."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into kbdict.documents
              (source_path, corpus, origin, title, summary, occupation, content_hash)
            values (%s, %s, %s, %s, %s, %s, %s)
            on conflict (source_path) do update set
              corpus       = excluded.corpus,
              origin       = excluded.origin,
              title        = excluded.title,
              summary      = excluded.summary,
              occupation   = excluded.occupation,
              content_hash = excluded.content_hash,
              status       = 'active',
              updated_at   = (extract(epoch from now()) * 1000)::bigint
            returning id
            """,
            (source_path, corpus, origin, title, summary, occupation, content_hash),
        )
        return str(cur.fetchone()[0])


def chunk_hashes(document_id: str) -> dict[int, tuple[str, str]]:
    """chunk_index → (content_hash, status). 바뀌지 않은 청크의 재임베딩을 건너뛰는 데 쓴다."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "select chunk_index, content_hash, status from kbdict.chunks where document_id = %s",
            (document_id,),
        )
        return {int(r[0]): (r[1], r[2]) for r in cur.fetchall()}


def upsert_chunk(document_id: str, chunk_index: int, heading: str, content: str,
                 questions: list[str], embedding: list[float], content_hash: str) -> None:
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into kbdict.chunks
              (document_id, chunk_index, heading, content, questions, embedding, content_hash)
            values (%s, %s, %s, %s, %s::jsonb, %s::vector, %s)
            on conflict (document_id, chunk_index) do update set
              heading      = excluded.heading,
              content      = excluded.content,
              questions    = excluded.questions,
              embedding    = excluded.embedding,
              content_hash = excluded.content_hash,
              status       = 'active',
              updated_at   = (extract(epoch from now()) * 1000)::bigint
            """,
            (document_id, chunk_index, heading, content,
             json.dumps(questions, ensure_ascii=False), embedding, content_hash),
        )


def reactivate_chunk(document_id: str, chunk_index: int) -> None:
    conn = _get_conn()
    conn.execute(
        "update kbdict.chunks set status = 'active', "
        "updated_at = (extract(epoch from now()) * 1000)::bigint "
        "where document_id = %s and chunk_index = %s and status <> 'active'",
        (document_id, chunk_index),
    )


def archive_chunks_from(document_id: str, first_stale_index: int) -> int:
    """청크 수가 줄었을 때 남는 꼬리를 archived 로(삭제 아님 — 로드맵 §6-6)."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "update kbdict.chunks set status = 'archived', "
            "updated_at = (extract(epoch from now()) * 1000)::bigint "
            "where document_id = %s and chunk_index >= %s and status = 'active'",
            (document_id, first_stale_index),
        )
        return cur.rowcount


def archive_documents_except(source_paths: list[str], origin: str = "seed") -> int:
    """이번 적재에 없는 같은 origin 문서를 archived 로."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "update kbdict.documents set status = 'archived', "
            "updated_at = (extract(epoch from now()) * 1000)::bigint "
            "where origin = %s and status = 'active' and not (source_path = any(%s))",
            (origin, source_paths),
        )
        return cur.rowcount


def counts() -> dict:
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "select d.corpus, count(distinct d.id), count(c.id) "
            "from kbdict.documents d left join kbdict.chunks c "
            "  on c.document_id = d.id and c.status = 'active' "
            "where d.status = 'active' group by d.corpus order by d.corpus"
        )
        return {r[0]: {"documents": int(r[1]), "chunks": int(r[2])} for r in cur.fetchall()}
