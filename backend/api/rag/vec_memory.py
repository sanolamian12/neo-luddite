"""
메모리 벡터 검색 (10/8 응답 지연 진단) — 4096차원은 pgvector ANN 상한(2000) 밖이라 DB 가 매번 전수 비교를 한다.
실측(로컬→도쿄, 데운 뒤): laws.match_articles 8.6초 · kb3.match_chunks 6.4~7초 — 턴 25초 중 절반이 이 둘.
서버(A1 12GB, workers 1) 메모리에 정규화 float32 로 올려 두고 numpy 내적으로 찾는다(수십 ms).

· 적재 스크립트로만 바뀌는 코퍼스(법령 조문, KB3 심판례·질의회신·판례)만 올린다. 다시 적재하면 **서버 재시작**해야 반영된다
  (deploy.sh 가 재시작한다). 세무사 사례(kb3_expert)는 실시간으로 바뀌므로 DB 에 그대로 묻는다(kb3_store).
· 서버 기동 직후 백그라운드 스레드(main._lifespan)가 별도 커넥션으로 올린다. 다 올라가기 전 요청은 DB 검색으로 간다.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any, Optional

log = logging.getLogger("vec_memory")


class VecIndex:
    """rows[i] ↔ vecs[i] (정규화). top(q, k, keep) — keep(row) 가 False 인 행은 건너뛴다."""

    def __init__(self, rows: list[Any], vecs):
        import numpy as np

        m = np.asarray(vecs, dtype=np.float32)
        m /= np.linalg.norm(m, axis=1, keepdims=True)
        self.rows = rows
        self.vecs = m

    def top(self, qvec, k: int, keep=None) -> list[tuple[float, Any]]:
        import numpy as np

        q = np.asarray(qvec, dtype=np.float32)
        sims = self.vecs @ (q / np.linalg.norm(q))
        out = []
        for i in np.argsort(-sims):
            r = self.rows[i]
            if keep is not None and not keep(r):
                continue
            out.append((float(sims[i]), r))
            if len(out) >= k:
                break
        return out


def new_conn():
    """적재용 별도 커넥션 — 요청 경로의 모듈 캐시 커넥션을 수십 초 붙잡지 않게."""
    import psycopg
    from pgvector.psycopg import register_vector

    from api.rag.kb2_store import _db_url

    conn = psycopg.connect(_db_url(), autocommit=True)
    register_vector(conn)
    return conn


_lock = threading.Lock()
_indexes: dict[str, Optional[VecIndex]] = {}


def get(name: str) -> Optional[VecIndex]:
    return _indexes.get(name)


def put(name: str, idx: VecIndex) -> None:
    with _lock:
        _indexes[name] = idx


def enabled() -> bool:
    import os

    return os.environ.get("VEC_MEMORY", "on") != "off"


def load_all() -> None:
    """서버 기동 시 백그라운드 — KB3 정적 코퍼스 + 법령 조문. 실패해도 DB 검색으로 동작한다."""
    if not enabled():
        return
    for name, fn in (("kb3", _load_kb3), ("laws", _load_laws)):
        t = time.time()
        try:
            n = fn()
            log.warning("메모리 벡터 %s: %d행 %.1f초", name, n, time.time() - t)
        except Exception as exc:  # noqa: BLE001
            log.warning("메모리 벡터 %s 실패 — DB 검색 유지: %s", name, exc)


# 적재 조건(where) — 지문과 본 쿼리가 같은 행 집합을 봐야 한다.
_KB3_DOCS_WHERE = "d.status = 'active' and d.corpus <> 'kb3_expert'"
_KB3_CHUNKS_WHERE = "c.status = 'active' and d.status = 'active' and d.corpus <> 'kb3_expert'"
_LAWS_WHERE = "status = 'active' and version = 'current' and not deleted and embedding is not null"

KB3_FP_SQL = (
    "select (select count(*) from kb3.documents d where " + _KB3_DOCS_WHERE + "), "
    "(select max(d.updated_at) from kb3.documents d where " + _KB3_DOCS_WHERE + "), "
    "(select md5(string_agg(d.id::text || ':' || d.updated_at::text, ',' order by d.id)) from kb3.documents d where "
    + _KB3_DOCS_WHERE + "), "
    "(select count(*) from kb3.chunks c join kb3.documents d on d.id = c.document_id where " + _KB3_CHUNKS_WHERE + "), "
    "(select max(c.updated_at) from kb3.chunks c join kb3.documents d on d.id = c.document_id where "
    + _KB3_CHUNKS_WHERE + "), "
    "(select md5(string_agg(c.id::text || ':' || c.updated_at::text, ',' order by c.id)) from kb3.chunks c "
    "join kb3.documents d on d.id = c.document_id where " + _KB3_CHUNKS_WHERE + ")"
)
LAWS_FP_SQL = ("select count(*), max(updated_at), md5(string_agg(content_hash, ',' order by id)) "
               "from laws.articles where " + _LAWS_WHERE)


def _vec(emb):
    return emb.to_numpy() if hasattr(emb, "to_numpy") else emb


def _load_kb3() -> int:
    """kb3.chunks(정적 코퍼스) 벡터 + 문서 카드. 세무사 사례(kb3_expert)는 제외 — 실시간이라 DB 로.
    지문이 같으면 서버 디스크 캐시(api/rag/disk_cache) — DB 에서 벡터를 받지 않는다(egress 대응 10/12)."""
    import numpy as np

    from api.rag import disk_cache

    conn = new_conn()
    try:
        with conn.cursor() as cur:
            fp = disk_cache.fingerprint(cur, KB3_FP_SQL)

        def fetch():
            with conn.cursor(binary=True) as cur:      # 바이너리 — 벡터당 약 16KB(텍스트의 1/3)
                cur.execute(
                    "select d.id, d.case_id, d.corpus, d.case_number, d.content, d.law_articles, d.tax_category, "
                    "d.source_url from kb3.documents d where " + _KB3_DOCS_WHERE
                )
                docs = {str(r[0]): tuple(r) for r in cur.fetchall()}
                cur.execute(
                    "select c.document_id, c.section, c.embedding from kb3.chunks c join kb3.documents d "
                    "on d.id = c.document_id where " + _KB3_CHUNKS_WHERE
                )
                rows, vecs = [], []
                for doc_id, section, emb in cur:
                    did = str(doc_id)
                    if did in docs:
                        rows.append((did, section, docs[did][2]))   # (document_id, section, corpus)
                        vecs.append(_vec(emb))
            mat = np.asarray(vecs, dtype=np.float32) if vecs else None
            return {"rows": rows, "docs": docs}, mat

        meta, mat, _src = disk_cache.cached("kb3", fp, fetch)
    finally:
        conn.close()
    rows = meta["rows"]
    if rows and mat is not None:
        idx = VecIndex(rows, mat)
        idx.docs = meta["docs"]  # type: ignore[attr-defined]
        put("kb3", idx)
    return len(rows)


def _load_laws() -> int:
    import numpy as np

    from api.rag import disk_cache

    conn = new_conn()
    try:
        with conn.cursor() as cur:
            fp = disk_cache.fingerprint(cur, LAWS_FP_SQL)

        def fetch():
            with conn.cursor(binary=True) as cur:
                cur.execute("select law_name, article_no, parent_law, embedding from laws.articles where " + _LAWS_WHERE)
                rows, vecs = [], []
                for law, no, parent, emb in cur:
                    rows.append((law, no, parent))
                    vecs.append(_vec(emb))
            return {"rows": rows}, (np.asarray(vecs, dtype=np.float32) if vecs else None)

        meta, mat, _src = disk_cache.cached("laws", fp, fetch)
    finally:
        conn.close()
    rows = meta["rows"]
    if rows and mat is not None:
        put("laws", VecIndex(rows, mat))
    return len(rows)
