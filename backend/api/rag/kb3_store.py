"""
kb3.* 저장소 v2 — 문서(사례 카드) + 청크(검색 단위) (0042, 새RAG_KB3_구축설계 §3, 2026-10-05).

corpus: 판례 kb3_prec · 심판례 kb3_trib · 국세청 질의회신 kb3_qna · 세무사 사례 kb3_expert.
검색은 청크로 하고 문서(사건) 단위로 접어 카드(content)를 돌려준다 — kb3.match_chunks.

kbdict_store.py 와 같은 컨벤션(모듈 캐시 커넥션, register_vector, %s 바인딩). 접속 URL 해석은
kb2_store 의 것을 그대로 쓴다(같은 DB).

적재(upsert_document·archive_except)는 scripts/kb3_ingest.py 만 부른다 — 챗 요청 경로는 match_chunks 하나뿐이다.
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
class MatchedDocument:
    id: str
    case_id: str
    corpus: str
    case_number: Optional[str]
    content: str
    law_articles: list[str]
    tax_category: Optional[str]
    source_url: Optional[str]
    score: float
    section: Optional[str] = None       # 걸린 청크 종류(situation·qna·…) — 계측용


def match_chunks(query_embedding: list[float], k: int = 5, corpora: Optional[list[str]] = None,
                 preview_expert_id: Optional[str] = None) -> list[MatchedDocument]:
    """kb3.match_chunks — 청크 코사인 → 문서 단위 top-k(active·게시분만, 미리보기면 그 세무사 초안 포함)."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "select document_id, case_id, corpus, case_number, content, law_articles, tax_category, "
            "source_url, section, score from kb3.match_chunks(%s::vector, %s, %s, %s)",
            (query_embedding, k, corpora, preview_expert_id),
        )
        rows = cur.fetchall()
    return [
        MatchedDocument(id=str(r[0]), case_id=r[1], corpus=r[2], case_number=r[3], content=r[4],
                        law_articles=list(r[5] or []), tax_category=r[6], source_url=r[7],
                        section=r[8], score=float(r[9]))
        for r in rows
    ]


# ── 적재 (scripts/kb3_ingest.py 전용) ──────────────────────────────────────────

def existing_hashes() -> dict[str, tuple[str, str]]:
    """case_id → (content_hash, status). 바뀌지 않은 건의 재기록을 건너뛰는 데 쓴다.
    content_hash 는 카드와 청크 텍스트를 함께 덮는다(kb3_ingest._doc_hash) — 청크만 바뀌어도 다시 쓴다."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute("select case_id, content_hash, status from kb3.documents")
        return {r[0]: (r[1], r[2]) for r in cur.fetchall()}


@dataclass
class ChunkRow:
    chunk_index: int
    section: str
    content: str
    embedding: list[float]
    content_hash: str
    char_start: Optional[int] = None
    char_end: Optional[int] = None


def upsert_document(*, case_id: str, corpus: str, origin: str, case_number: Optional[str], title: str,
                    tax_law: Optional[str], tax_category: Optional[str], decision_date: Optional[str],
                    decision_type: Optional[str], source_url: Optional[str], law_articles: list[str],
                    summary: Optional[str], card: dict, content: str, formatted_by: str,
                    format_checks: Optional[dict], content_hash: str, chunks: list[ChunkRow],
                    expert_id: Optional[str] = None, publish_state: Optional[str] = None) -> str:
    """case_id 기준 멱등. 문서를 갱신(다시 올라오면 active)하고 청크를 통째로 갈아 끼운다 — 한 트랜잭션."""
    conn = _get_conn()
    with conn.transaction(), conn.cursor() as cur:
        cur.execute(
            """
            insert into kb3.documents
              (case_id, corpus, origin, case_number, title, tax_law, tax_category, decision_date, decision_type,
               source_url, law_articles, summary, card, content, formatted_by, format_checks,
               expert_id, publish_state, content_hash)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s::jsonb, %s, %s, %s::jsonb,
                    %s, %s, %s)
            on conflict (case_id) do update set
              corpus        = excluded.corpus,
              origin        = excluded.origin,
              case_number   = excluded.case_number,
              title         = excluded.title,
              tax_law       = excluded.tax_law,
              tax_category  = excluded.tax_category,
              decision_date = excluded.decision_date,
              decision_type = excluded.decision_type,
              source_url    = excluded.source_url,
              law_articles  = excluded.law_articles,
              summary       = excluded.summary,
              card          = excluded.card,
              content       = excluded.content,
              formatted_by  = excluded.formatted_by,
              format_checks = excluded.format_checks,
              expert_id     = excluded.expert_id,
              publish_state = excluded.publish_state,
              content_hash  = excluded.content_hash,
              status        = 'active',
              updated_at    = (extract(epoch from now()) * 1000)::bigint
            returning id
            """,
            (case_id, corpus, origin, case_number, title, tax_law, tax_category, decision_date, decision_type,
             source_url, json.dumps(law_articles, ensure_ascii=False), summary,
             json.dumps(card, ensure_ascii=False), content, formatted_by,
             None if format_checks is None else json.dumps(format_checks, ensure_ascii=False),
             expert_id, publish_state, content_hash),
        )
        doc_id = cur.fetchone()[0]
        cur.execute("delete from kb3.chunks where document_id = %s", (doc_id,))
        for c in chunks:
            cur.execute(
                "insert into kb3.chunks (document_id, chunk_index, section, content, char_start, char_end, "
                "embedding, content_hash) values (%s, %s, %s, %s, %s, %s, %s::vector, %s)",
                (doc_id, c.chunk_index, c.section, c.content, c.char_start, c.char_end, c.embedding,
                 c.content_hash),
            )
    return str(doc_id)


def archive_except(case_ids: list[str], corpora: list[str]) -> int:
    """이번 적재 범위에 없는 문서를 archived 로(삭제 아님 — 범위를 줄이면 되돌릴 수 있게).
    corpora 로 범위를 한정한다 — 스크립트가 다루지 않는 corpus(세무사 사례 kb3_expert 등)는 건드리지 않는다."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "update kb3.documents set status = 'archived', "
            "updated_at = (extract(epoch from now()) * 1000)::bigint "
            "where status = 'active' and corpus = any(%s) and not (case_id = any(%s))",
            (corpora, case_ids),
        )
        return cur.rowcount


def counts() -> dict:
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "select d.corpus, d.status, count(distinct d.id), count(c.id) from kb3.documents d "
            "left join kb3.chunks c on c.document_id = d.id group by d.corpus, d.status order by 1, 2")
        return {f"{r[0]}/{r[1]}": {"docs": int(r[2]), "chunks": int(r[3])} for r in cur.fetchall()}
