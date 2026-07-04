"""
rag.passages 벡터 저장소 — Supabase Postgres(pgvector)에 psycopg 로 직결.

2-호스트 토폴로지(마스터 §1): Python 백엔드가 Supabase(Tokyo)로 직접 SQL.
접근은 service role 급 직결 문자열(SUPABASE_DB_URL, 세션/트랜잭션 풀러) 하나로.
프론트는 rag.* 를 만지지 않는다(RLS 로 차단) — 오직 이 백엔드만.

뼈대 원칙: DB 가 설정 안 됐거나 붙지 않으면 예외를 삼키지 말고 명확히 올린다.
단, 파이프라인 상위(get_retriever)가 이를 잡아 RAG 없이도 챗이 동작하도록 graceful.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Optional

_conn = None  # 지연 연결(모듈 캐시). 끊기면 재연결.


def _db_url() -> str:
    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        raise RuntimeError(
            "SUPABASE_DB_URL 이 설정되지 않았습니다. Supabase 대시보드 → Project "
            "Settings → Database → Connection string(풀러)을 backend/.env 에 넣으세요."
        )
    # 비밀번호 특수문자 URL 인코딩 헛수고 방지: SUPABASE_DB_PASSWORD 를 주면 raw 로 받아
    # 자동 인코딩해 URL 의 비밀번호 자리를 채운다. (URL 은 [YOUR-PASSWORD] placeholder 유지 가능)
    raw_pw = os.environ.get("SUPABASE_DB_PASSWORD")
    if raw_pw:
        from urllib.parse import quote

        enc = quote(raw_pw, safe="")
        url = url.replace("[YOUR-PASSWORD]", enc)
        # placeholder 가 없으면 user:pw@ 사이의 비밀번호 구간을 교체
        if "[YOUR-PASSWORD]" not in os.environ["SUPABASE_DB_URL"]:
            import re as _re

            url = _re.sub(r"(://[^:/@]+:)[^@]*(@)", rf"\g<1>{enc}\g<2>", url, count=1)
    return url


def _connect():
    """psycopg3 연결 + pgvector 어댑터 등록. import 는 지연(선택적 의존성)."""
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


def is_configured() -> bool:
    return bool(os.environ.get("SUPABASE_DB_URL"))


# ── 검색 (read path) ─────────────────────────────────────────────────────────

@dataclass
class RetrievedRow:
    id: str
    content: str
    source_kind: str
    reviewer: Optional[str]
    case_refs: list[str]
    law_articles: list[str]
    tax_category: Optional[str]
    occupation: Optional[str]
    metadata: dict
    score: float


def search(
    query_embedding: list[float],
    k: int = 5,
    occupation: Optional[str] = None,
    tax_category: Optional[str] = None,
) -> list[RetrievedRow]:
    """rag.match_passages 로 코사인 유사도 top-k 반환. KB 가 비면 빈 리스트."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "select id, content, source_kind, reviewer, case_refs, law_articles, "
            "tax_category, occupation, metadata, score "
            "from rag.match_passages(%s::vector, %s, %s, %s)",
            (query_embedding, k, occupation, tax_category),
        )
        rows = cur.fetchall()
    return [
        RetrievedRow(
            id=str(r[0]), content=r[1], source_kind=r[2], reviewer=r[3],
            case_refs=list(r[4] or []), law_articles=list(r[5] or []),
            tax_category=r[6], occupation=r[7], metadata=dict(r[8] or {}),
            score=float(r[9]),
        )
        for r in rows
    ]


# ── 적재 (write path) ────────────────────────────────────────────────────────

@dataclass
class PassageRecord:
    """rag.passages 한 행. dedupe_key 로 멱등 업서트."""
    dedupe_key: str
    content: str
    embedding: list[float]
    source_kind: str                       # feedback | kb_document | case_seed | conversation
    conversation_id: Optional[str] = None
    segment_id: Optional[str] = None
    feedback_id: Optional[str] = None
    kb_document_id: Optional[str] = None
    case_id: Optional[str] = None
    reviewer: Optional[str] = None          # 표시이름
    auditor_id: Optional[str] = None        # 신원(도메인 id) — attribution/정산 연동
    tax_category: Optional[str] = None
    occupation: Optional[str] = None
    case_refs: list[str] = field(default_factory=list)
    law_articles: list[str] = field(default_factory=list)
    feedback_tags: list[str] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)


def upsert(rec: PassageRecord) -> str:
    """dedupe_key 충돌 시 갱신(재임베딩 반영). 반환: passage id."""
    import json

    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into rag.passages
              (dedupe_key, content, embedding, source_kind, conversation_id, segment_id,
               feedback_id, kb_document_id, case_id, reviewer, auditor_id, tax_category,
               occupation, case_refs, law_articles, feedback_tags, metadata)
            values (%s, %s, %s::vector, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s::jsonb)
            on conflict (dedupe_key) do update set
              content       = excluded.content,
              embedding     = excluded.embedding,
              source_kind   = excluded.source_kind,
              reviewer      = excluded.reviewer,
              auditor_id    = excluded.auditor_id,
              tax_category  = excluded.tax_category,
              occupation    = excluded.occupation,
              case_refs     = excluded.case_refs,
              law_articles  = excluded.law_articles,
              feedback_tags = excluded.feedback_tags,
              metadata      = excluded.metadata,
              status        = 'active',
              updated_at    = (extract(epoch from now()) * 1000)::bigint
            returning id
            """,
            (
                rec.dedupe_key, rec.content, rec.embedding, rec.source_kind,
                rec.conversation_id, rec.segment_id, rec.feedback_id, rec.kb_document_id,
                rec.case_id, rec.reviewer, rec.auditor_id, rec.tax_category, rec.occupation,
                rec.case_refs, rec.law_articles, rec.feedback_tags, json.dumps(rec.metadata),
            ),
        )
        return str(cur.fetchone()[0])


def count() -> int:
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute("select count(*) from rag.passages where status = 'active'")
        return int(cur.fetchone()[0])


# ── 추적/포장실 (provenance 조회 + 연결끊기) ──────────────────────────────────

@dataclass
class PassageInfo:
    """포장실 추적용 passage 한 행 — content + 전체 provenance + status."""
    id: str
    dedupe_key: str
    content: str
    source_kind: str
    conversation_id: Optional[str]
    segment_id: Optional[str]
    feedback_id: Optional[str]
    reviewer: Optional[str]
    auditor_id: Optional[str]
    tax_category: Optional[str]
    occupation: Optional[str]
    feedback_tags: list[str]
    status: str
    created_at: int
    updated_at: int


_PASSAGE_COLS = (
    "id, dedupe_key, content, source_kind, conversation_id, segment_id, "
    "feedback_id, reviewer, auditor_id, tax_category, occupation, feedback_tags, "
    "status, created_at, updated_at"
)


def _row_to_info(r) -> "PassageInfo":
    return PassageInfo(
        id=str(r[0]), dedupe_key=r[1], content=r[2], source_kind=r[3],
        conversation_id=r[4], segment_id=r[5], feedback_id=r[6], reviewer=r[7],
        auditor_id=r[8], tax_category=r[9], occupation=r[10],
        feedback_tags=list(r[11] or []), status=r[12],
        created_at=int(r[13]), updated_at=int(r[14]),
    )


def list_passages(conversation_id: Optional[str] = None) -> list[PassageInfo]:
    """대화에 귀속된 passage(=검수 루프로 실린 데이터셋) 조회. status 무관(retired 도 포함
    → 추적 보존). conversation_id 주면 그 대화만. case_seed/kb(대화 없음)는 제외."""
    conn = _get_conn()
    q = f"select {_PASSAGE_COLS} from rag.passages where conversation_id is not null"
    params: list = []
    if conversation_id:
        q += " and conversation_id = %s"
        params.append(conversation_id)
    q += " order by created_at desc"
    with conn.cursor() as cur:
        cur.execute(q, params)
        rows = cur.fetchall()
    return [_row_to_info(r) for r in rows]


def set_status(passage_ids: list[str], status: str) -> int:
    """passage 들의 status 를 일괄 변경(연결끊기=retired / 재연결=active). 반환: 변경 행수.
    삭제가 아니라 status 전환이라 추적 로그는 보존된다(match_passages 는 active 만 검색)."""
    if not passage_ids:
        return 0
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "update rag.passages set status = %s, "
            "updated_at = (extract(epoch from now()) * 1000)::bigint "
            "where id = any(%s::uuid[])",
            (status, passage_ids),
        )
        return cur.rowcount
