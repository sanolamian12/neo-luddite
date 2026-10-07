"""
laws.* 저장소 — 자체 법령 DB(0046, design/LLM3_법령DB_설계.md, 2026-10-08).

챗 경로: load_current()(프로세스당 1회 — 현행·비삭제 조문 메타·원문, 임베딩 제외 약 8천 행) + match_articles()(벡터 검색).
적재(upsert_rows)는 scripts/law_ingest.py ingest 만 부른다.
kb3_store.py 와 같은 컨벤션(모듈 캐시 커넥션, register_vector, %s 바인딩, 접속 URL = kb2_store._db_url).
"""

from __future__ import annotations

import json
from typing import Iterable, Optional

_conn = None


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


def load_current() -> list[dict]:
    """현행·비삭제 조문 전부(임베딩 제외). LawStore 가 프로세스당 한 번 메모리에 올린다."""
    with _get_conn().cursor() as cur:
        cur.execute(
            "select law_name, article_no, title, text, paragraphs, heading, coalesce(issue, ''), keywords "
            "from laws.articles where status = 'active' and version = 'current' and not deleted"
        )
        return [
            {"law_name": r[0], "article_no": r[1], "title": r[2], "text": r[3], "paragraphs": r[4] or [],
             "heading": r[5] or "", "issue": r[6], "keywords": r[7] or []}
            for r in cur.fetchall()
        ]


def match_articles(query_embedding: list[float], k: int, exclude_parents: Iterable[str] = ()) -> list[tuple[str, str, float]]:
    with _get_conn().cursor() as cur:
        cur.execute(
            "select law_name, article_no, score from laws.match_articles(%s::vector, %s, %s)",
            (query_embedding, k, list(exclude_parents)),
        )
        return [(r[0], r[1], float(r[2])) for r in cur.fetchall()]


# ── 적재 (scripts/law_ingest.py 전용) ──────────────────────────────────────────

def existing_hashes() -> dict[str, tuple[str, bool]]:
    """id → (content_hash, 임베딩 있음). 바뀌지 않은 행의 재기록을 건너뛴다."""
    with _get_conn().cursor() as cur:
        cur.execute("select id, content_hash, embedding is not null from laws.articles")
        return {r[0]: (r[1], r[2]) for r in cur.fetchall()}


_COLS = ("id", "law_name", "parent_law", "kind", "law_no", "law_effective", "article_no", "article_num",
         "article_sub", "title", "heading", "deleted", "version", "effective_from", "note", "text",
         "paragraphs", "issue", "keywords", "source_file", "embedding", "content_hash")


def upsert_rows(rows: list[dict]) -> None:
    """rows: _COLS 키를 가진 dict. paragraphs·keywords 는 리스트, embedding 은 리스트 또는 None."""
    import numpy as np

    sql = (
        f"insert into laws.articles ({', '.join(_COLS)}) values ({', '.join(['%s'] * len(_COLS))}) "
        "on conflict (id) do update set "
        + ", ".join(f"{c} = excluded.{c}" for c in _COLS if c != "id")
        + ", status = 'active', updated_at = (extract(epoch from now()) * 1000)::bigint"
    )
    vals = []
    for r in rows:
        v = []
        for c in _COLS:
            x = r.get(c)
            if c in ("paragraphs", "keywords"):
                x = json.dumps(x or [], ensure_ascii=False)
            elif c == "embedding" and x is not None:
                x = np.asarray(x, dtype=np.float32)
            v.append(x)
        vals.append(v)
    with _get_conn().cursor() as cur:
        cur.executemany(sql, vals)


def archive_except(keep_ids: set[str]) -> int:
    """이번 적재에 없는 행을 archived 로(삭제 대신)."""
    with _get_conn().cursor() as cur:
        cur.execute("select id from laws.articles where status = 'active'")
        gone = [r[0] for r in cur.fetchall() if r[0] not in keep_ids]
        if gone:
            cur.execute("update laws.articles set status = 'archived', "
                        "updated_at = (extract(epoch from now()) * 1000)::bigint where id = any(%s)", (gone,))
        return len(gone)


def count() -> dict[str, int]:
    with _get_conn().cursor() as cur:
        cur.execute("select count(*) filter (where status='active'), "
                    "count(*) filter (where status='active' and embedding is not null) from laws.articles")
        a, e = cur.fetchone()
        return {"active": a, "embedded": e}
