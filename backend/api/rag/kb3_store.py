"""
kb3.* 저장소 — 판례 요지 · 국세청 질의회신(KB3 요지수집 설계 §10, W5 설계 §2).

kbdict_store.py 와 같은 컨벤션(모듈 캐시 커넥션, register_vector, %s 바인딩). 접속 URL 해석은
kb2_store 의 것을 그대로 쓴다(같은 DB).

적재(upsert_document·archive_except)는 scripts/kb3_ingest.py 만 부른다 — 챗 요청 경로는 match_documents 하나뿐이다.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

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
    case_number: str
    content: str
    law_articles: list[str]
    tax_category: str | None
    source_url: str
    score: float


def match_documents(query_embedding: list[float], k: int = 5) -> list[MatchedDocument]:
    """kb3.match_documents 코사인 top-k(active 만)."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "select id, case_id, corpus, case_number, content, law_articles, tax_category, source_url, score "
            "from kb3.match_documents(%s::vector, %s)",
            (query_embedding, k),
        )
        rows = cur.fetchall()
    return [
        MatchedDocument(id=str(r[0]), case_id=r[1], corpus=r[2], case_number=r[3], content=r[4],
                        law_articles=list(r[5] or []), tax_category=r[6], source_url=r[7], score=float(r[8]))
        for r in rows
    ]


# ── 적재 (scripts/kb3_ingest.py 전용) ──────────────────────────────────────────

def existing_hashes() -> dict[str, tuple[str, str]]:
    """case_id → (content_hash, status). 바뀌지 않은 건의 재기록을 건너뛰는 데 쓴다."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute("select case_id, content_hash, status from kb3.documents")
        return {r[0]: (r[1], r[2]) for r in cur.fetchall()}


def upsert_document(case_id: str, corpus: str, origin: str, case_number: str, title: str, content: str,
                    tax_law: str | None, tax_category: str | None, decision_date: str | None,
                    source_url: str, law_articles: list[str], embedding: list[float],
                    content_hash: str) -> None:
    """case_id 기준 멱등. 다시 올라오면 active 로 되살리고 전 필드를 갱신한다."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into kb3.documents
              (case_id, corpus, origin, case_number, title, content, tax_law, tax_category,
               decision_date, source_url, law_articles, embedding, content_hash)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::vector, %s)
            on conflict (case_id) do update set
              corpus        = excluded.corpus,
              origin        = excluded.origin,
              case_number   = excluded.case_number,
              title         = excluded.title,
              content       = excluded.content,
              tax_law       = excluded.tax_law,
              tax_category  = excluded.tax_category,
              decision_date = excluded.decision_date,
              source_url    = excluded.source_url,
              law_articles  = excluded.law_articles,
              embedding     = excluded.embedding,
              content_hash  = excluded.content_hash,
              status        = 'active',
              updated_at    = (extract(epoch from now()) * 1000)::bigint
            """,
            (case_id, corpus, origin, case_number, title, content, tax_law, tax_category, decision_date,
             source_url, json.dumps(law_articles, ensure_ascii=False), embedding, content_hash),
        )


def archive_except(case_ids: list[str]) -> int:
    """이번 적재 범위에 없는 문서를 archived 로(삭제 아님 — 범위를 줄이면 되돌릴 수 있게)."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "update kb3.documents set status = 'archived', "
            "updated_at = (extract(epoch from now()) * 1000)::bigint "
            "where status = 'active' and not (case_id = any(%s))",
            (case_ids,),
        )
        return cur.rowcount


def counts() -> dict:
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute("select corpus, status, count(*) from kb3.documents group by corpus, status order by 1, 2")
        return {f"{r[0]}/{r[1]}": int(r[2]) for r in cur.fetchall()}
