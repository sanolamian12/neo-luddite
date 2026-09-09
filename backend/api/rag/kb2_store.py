"""
kb2.* 저장소 — 지식베이스2(응축형 정책 사전) 의 Supabase Postgres(pgvector) 직결.

rag/store.py 와 같은 컨벤션(모듈 캐시 커넥션, register_vector, %s 파라미터 바인딩)을
따르되 스키마가 분리돼 있어 별도 모듈로 둔다. rag.passages 를 원재료로 Solar Pro 가
합성한 문장(kb2.sentences)을 담는다 — 검색·크레딧·수정이력의 최소 단위는 문서 전체가
아니라 문장 하나다(설계 아티팩트 §01).
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from typing import Optional

_conn = None  # 지연 연결(모듈 캐시, rag/store.py 와 별개 커넥션). 끊기면 재연결.

LOCK_TTL_MS = 5 * 60 * 1000  # 5분 — 브라우저 크래시로 unlock 이 안 온 락을 자동 회수


def _db_url() -> str:
    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        raise RuntimeError("SUPABASE_DB_URL 이 설정되지 않았습니다.")
    raw_pw = os.environ.get("SUPABASE_DB_PASSWORD")
    if raw_pw:
        from urllib.parse import quote

        enc = quote(raw_pw, safe="")
        url = url.replace("[YOUR-PASSWORD]", enc)
        if "[YOUR-PASSWORD]" not in os.environ["SUPABASE_DB_URL"]:
            import re as _re

            url = _re.sub(r"(://[^:/@]+:)[^@]*(@)", rf"\g<1>{enc}\g<2>", url, count=1)
    return url


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


def is_configured() -> bool:
    return bool(os.environ.get("SUPABASE_DB_URL"))


# ── 도메인 타입 ────────────────────────────────────────────────────────────────

@dataclass
class Kb2Document:
    id: str
    tax_category: str
    title: str
    status: str
    created_at: int
    updated_at: int
    group_id: Optional[str] = None


@dataclass
class Kb2Sentence:
    id: str
    document_id: str
    order_index: int
    content: str
    source_passage_ids: list[str] = field(default_factory=list)
    attribution: list[dict] = field(default_factory=list)
    locked_by_auditor: bool = False
    version: int = 1
    created_at: int = 0
    updated_at: int = 0
    locked_by: Optional[str] = None
    lock_acquired_at: Optional[int] = None

    @property
    def effectively_locked(self) -> bool:
        if not self.locked_by or self.lock_acquired_at is None:
            return False
        return (int(time.time() * 1000) - self.lock_acquired_at) < LOCK_TTL_MS


# ── kb2.documents ────────────────────────────────────────────────────────────

def upsert_document(tax_category: str, title: str) -> str:
    """세목당 1건 유지(멱등). 이미 있으면 title 만 갱신."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into kb2.documents (tax_category, title)
            values (%s, %s)
            on conflict (tax_category) do update set
              title      = excluded.title,
              updated_at = (extract(epoch from now()) * 1000)::bigint
            returning id
            """,
            (tax_category, title),
        )
        return str(cur.fetchone()[0])


_DOCUMENT_COLS = "id, tax_category, title, status, created_at, updated_at, group_id"


def _row_to_document(r) -> Kb2Document:
    return Kb2Document(
        id=str(r[0]), tax_category=r[1], title=r[2], status=r[3],
        created_at=int(r[4]), updated_at=int(r[5]), group_id=str(r[6]) if r[6] else None,
    )


def list_documents(status: str | None = "active") -> list[Kb2Document]:
    """status='active'(디폴트) — 재구조화로 archived 처리된 이전 문서는 auditor 화면에
    안 보이게. status=None 이면 전체(관리자 보관함 조회용은 status='archived')."""
    conn = _get_conn()
    with conn.cursor() as cur:
        if status is None:
            cur.execute(f"select {_DOCUMENT_COLS} from kb2.documents order by tax_category")
        else:
            cur.execute(
                f"select {_DOCUMENT_COLS} from kb2.documents where status = %s order by tax_category",
                (status,),
            )
        rows = cur.fetchall()
    return [_row_to_document(r) for r in rows]


def rename_document(document_id: str, title: str) -> Optional[Kb2Document]:
    """이름 수정 — title만 갱신. tax_category(내부 라벨, match_sentences 필터용)는
    안 건드린다."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            f"""
            update kb2.documents set title = %s,
              updated_at = (extract(epoch from now()) * 1000)::bigint
            where id = %s
            returning {_DOCUMENT_COLS}
            """,
            (title, document_id),
        )
        row = cur.fetchone()
    return _row_to_document(row) if row else None


def set_document_group(document_id: str, group_id: Optional[str]) -> Optional[Kb2Document]:
    """그룹 지정 — 기존/신규 세목을 원하는 대목으로 재배치(group_id=None 이면 미분류로)."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            f"""
            update kb2.documents set group_id = %s,
              updated_at = (extract(epoch from now()) * 1000)::bigint
            where id = %s
            returning {_DOCUMENT_COLS}
            """,
            (group_id, document_id),
        )
        row = cur.fetchone()
    return _row_to_document(row) if row else None


def create_empty_document(group_id: Optional[str], title: str) -> str:
    """"세목 추가" — 순수 insert, category_id=None(AI 파이프라인과 무관), 문장 0개로 시작."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "insert into kb2.documents (group_id, tax_category, title) "
            "values (%s, %s, %s) returning id",
            (group_id, title, title),
        )
        return str(cur.fetchone()[0])


def archive_all_active_documents() -> int:
    """재구조화 시작 전, 지금 활성 문서(레거시 고정 세목 포함) 전부를 보관 처리 — 삭제
    아님, locked_by_auditor 문장도 그대로 남지만 검색·auditor 화면 노출에서는 빠진다
    (kb2.match_sentences 가 이미 status='active'만 검색)."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute("update kb2.documents set status = 'archived' where status = 'active'")
        return cur.rowcount


def create_document(category_id: str, label: str, title: str) -> str:
    """순수 insert(upsert 아님) — 동적 재구조화는 매번 새 문서를 만든다(레이블이 매번
    달라질 수 있어 upsert 충돌 대상이 없음, category_id 가 정체성)."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "insert into kb2.documents (category_id, tax_category, title) "
            "values (%s, %s, %s) returning id",
            (category_id, label, title),
        )
        return str(cur.fetchone()[0])


# ── kb2.groups (대목) ────────────────────────────────────────────────────────
# auditor가 세목(kb2.documents)을 수동으로 묶는 상위 그룹 — AI 합성과 무관한 순수 UI
# 정리 계층. kb2.categories(AI 파이프라인의 재구조화 정체성)와는 별개 개념.

@dataclass
class Kb2Group:
    id: str
    label: str
    status: str
    created_at: int
    updated_at: int


def create_group(label: str) -> str:
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute("insert into kb2.groups (label) values (%s) returning id", (label,))
        return str(cur.fetchone()[0])


def list_groups(status: Optional[str] = "active") -> list[Kb2Group]:
    conn = _get_conn()
    with conn.cursor() as cur:
        if status is None:
            cur.execute("select id, label, status, created_at, updated_at from kb2.groups order by created_at")
        else:
            cur.execute(
                "select id, label, status, created_at, updated_at from kb2.groups "
                "where status = %s order by created_at",
                (status,),
            )
        rows = cur.fetchall()
    return [
        Kb2Group(id=str(r[0]), label=r[1], status=r[2], created_at=int(r[3]), updated_at=int(r[4]))
        for r in rows
    ]


# ── kb2.categories ───────────────────────────────────────────────────────────

@dataclass
class Kb2Category:
    id: str
    label: str
    description: str
    status: str
    created_at: int


def create_category(label: str, description: str) -> str:
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "insert into kb2.categories (label, description) values (%s, %s) returning id",
            (label, description),
        )
        return str(cur.fetchone()[0])


def list_categories(status: Optional[str] = "active") -> list[Kb2Category]:
    conn = _get_conn()
    with conn.cursor() as cur:
        if status is None:
            cur.execute("select id, label, description, status, created_at from kb2.categories order by created_at desc")
        else:
            cur.execute(
                "select id, label, description, status, created_at from kb2.categories "
                "where status = %s order by created_at desc",
                (status,),
            )
        rows = cur.fetchall()
    return [
        Kb2Category(id=str(r[0]), label=r[1], description=r[2], status=r[3], created_at=int(r[4]))
        for r in rows
    ]


# ── kb2.synthesis_jobs ───────────────────────────────────────────────────────

@dataclass
class Kb2SynthesisJob:
    id: str
    status: str
    stage: str
    total_categories: int
    completed_categories: int
    result: Optional[dict]
    error: Optional[str]
    created_at: int
    updated_at: int


def create_job() -> str:
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute("insert into kb2.synthesis_jobs default values returning id")
        return str(cur.fetchone()[0])


def update_job(
    job_id: str,
    *,
    stage: Optional[str] = None,
    status: Optional[str] = None,
    total: Optional[int] = None,
    completed: Optional[int] = None,
    result: Optional[dict] = None,
    error: Optional[str] = None,
) -> None:
    sets = ["updated_at = (extract(epoch from now()) * 1000)::bigint"]
    params: list = []
    if stage is not None:
        sets.append("stage = %s")
        params.append(stage)
    if status is not None:
        sets.append("status = %s")
        params.append(status)
    if total is not None:
        sets.append("total_categories = %s")
        params.append(total)
    if completed is not None:
        sets.append("completed_categories = %s")
        params.append(completed)
    if result is not None:
        sets.append("result = %s::jsonb")
        params.append(json.dumps(result))
    if error is not None:
        sets.append("error = %s")
        params.append(error)
    params.append(job_id)
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(f"update kb2.synthesis_jobs set {', '.join(sets)} where id = %s", params)


def get_job(job_id: str) -> Optional[Kb2SynthesisJob]:
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "select id, status, stage, total_categories, completed_categories, result, "
            "error, created_at, updated_at from kb2.synthesis_jobs where id = %s",
            (job_id,),
        )
        row = cur.fetchone()
    if row is None:
        return None
    return Kb2SynthesisJob(
        id=str(row[0]), status=row[1], stage=row[2], total_categories=row[3],
        completed_categories=row[4], result=row[5], error=row[6],
        created_at=int(row[7]), updated_at=int(row[8]),
    )


# ── kb2.sentences ────────────────────────────────────────────────────────────

_SENTENCE_COLS = (
    "id, document_id, order_index, content, source_passage_ids, attribution, "
    "locked_by_auditor, version, created_at, updated_at, locked_by, lock_acquired_at"
)


def _row_to_sentence(r) -> Kb2Sentence:
    return Kb2Sentence(
        id=str(r[0]), document_id=str(r[1]), order_index=r[2], content=r[3],
        source_passage_ids=[str(x) for x in (r[4] or [])],
        attribution=list(r[5] or []), locked_by_auditor=bool(r[6]),
        version=r[7], created_at=int(r[8]), updated_at=int(r[9]),
        locked_by=r[10], lock_acquired_at=int(r[11]) if r[11] is not None else None,
    )


def get_sentence(sentence_id: str) -> Optional[Kb2Sentence]:
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(f"select {_SENTENCE_COLS} from kb2.sentences where id = %s", (sentence_id,))
        row = cur.fetchone()
    return _row_to_sentence(row) if row else None


def list_sentences(document_id: str) -> list[Kb2Sentence]:
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            f"select {_SENTENCE_COLS} from kb2.sentences where document_id = %s order by order_index",
            (document_id,),
        )
        rows = cur.fetchall()
    return [_row_to_sentence(r) for r in rows]


def delete_unlocked_sentences(document_id: str) -> int:
    """재합성 대상 문서의 locked_by_auditor=false 문장만 정리(FK cascade 로 이력도 함께
    삭제 — 사람이 손댄 적 없는 시스템 생성 문장이라 보존할 이력이 없다)."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "delete from kb2.sentences where document_id = %s and locked_by_auditor = false",
            (document_id,),
        )
        return cur.rowcount


def create_sentence(
    document_id: str,
    order_index: int,
    content: str,
    embedding: list[float],
    source_passage_ids: list[str],
    attribution: list[dict],
    editor_id: str = "system:kb2_synthesis",
) -> str:
    """문장 insert + 같은 attribution 으로 sentence_versions v1 기록."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into kb2.sentences
              (document_id, order_index, content, embedding, source_passage_ids, attribution)
            values (%s, %s, %s, %s::vector, %s, %s::jsonb)
            returning id
            """,
            (document_id, order_index, content, embedding, source_passage_ids, json.dumps(attribution)),
        )
        sentence_id = str(cur.fetchone()[0])
        cur.execute(
            """
            insert into kb2.sentence_versions
              (sentence_id, version_no, content, attribution_snapshot, editor_type, editor_id)
            values (%s, 1, %s, %s::jsonb, 'system_synthesis', %s)
            """,
            (sentence_id, content, json.dumps(attribution), editor_id),
        )
    return sentence_id


def update_sentence_content(
    sentence_id: str,
    new_content: str,
    new_embedding: list[float],
    editor_id: str,
) -> Optional[Kb2Sentence]:
    """세무사 직접 수정(로드맵 4단계) — 즉시 반영 + locked_by_auditor=true 전환(재합성
    보호막) + attribution 전량 편집자로 교체(기존 기여자는 이 문장의 KB 크레딧을 잃는다 —
    RAG 크레딧은 원본 passage 가 살아있는 한 별개로 유지) + sentence_versions 에
    editor_type='auditor_edit' 이력 기록(관리자가 나중에 번복할 근거)."""
    conn = _get_conn()
    new_attribution = [{"auditorId": editor_id, "weight": 1.0}]
    with conn.cursor() as cur:
        cur.execute(
            f"""
            update kb2.sentences set
              content = %s, embedding = %s::vector, attribution = %s::jsonb,
              locked_by_auditor = true, version = version + 1,
              locked_by = null, lock_acquired_at = null,
              updated_at = (extract(epoch from now()) * 1000)::bigint
            where id = %s
            returning {_SENTENCE_COLS}
            """,
            (new_content, new_embedding, json.dumps(new_attribution), sentence_id),
        )
        row = cur.fetchone()
        if row is None:
            return None
        cur.execute(
            """
            insert into kb2.sentence_versions
              (sentence_id, version_no, content, attribution_snapshot, editor_type, editor_id)
            values (%s, %s, %s, %s::jsonb, 'auditor_edit', %s)
            """,
            (sentence_id, row[7], new_content, json.dumps(new_attribution), editor_id),
        )
    return _row_to_sentence(row)


def move_sentence(sentence_id: str, target_document_id: str, editor_id: str) -> Optional[Kb2Sentence]:
    """다른 세목으로 이동 — document_id 변경 + order_index=대상 문서 끝 + version+1 +
    sentence_versions 에 editor_type='moved' 기록(meta 에 from/to document id). 이동은
    분류 정리이지 내용 수정이 아니므로 attribution(크레딧)은 그대로 둔다."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute("select document_id, content, attribution from kb2.sentences where id = %s", (sentence_id,))
        before = cur.fetchone()
        if before is None:
            return None
        from_document_id, content, attribution = str(before[0]), before[1], list(before[2] or [])

        cur.execute(
            "select coalesce(max(order_index), -1) + 1 from kb2.sentences where document_id = %s",
            (target_document_id,),
        )
        next_index = cur.fetchone()[0]

        cur.execute(
            f"""
            update kb2.sentences set
              document_id = %s, order_index = %s, version = version + 1,
              updated_at = (extract(epoch from now()) * 1000)::bigint
            where id = %s
            returning {_SENTENCE_COLS}
            """,
            (target_document_id, next_index, sentence_id),
        )
        row = cur.fetchone()
        if row is None:
            return None
        meta = json.dumps({"fromDocumentId": from_document_id, "toDocumentId": target_document_id})
        cur.execute(
            """
            insert into kb2.sentence_versions
              (sentence_id, version_no, content, attribution_snapshot, editor_type, editor_id, meta)
            values (%s, %s, %s, %s::jsonb, 'moved', %s, %s::jsonb)
            """,
            (sentence_id, row[7], content, json.dumps(attribution), editor_id, meta),
        )
    return _row_to_sentence(row)


def acquire_lock(sentence_id: str, auditor_id: str) -> tuple[bool, Optional[str]]:
    """편집 락 획득 — locked_by IS NULL, 자기 자신이 이미 보유, 또는 TTL(5분) 초과 시
    성공(획득/갱신). 아니면 실패 + 현재 보유자 id 반환("OOO님이 수정 중" 표시용)."""
    conn = _get_conn()
    now_ms = int(time.time() * 1000)
    cutoff = now_ms - LOCK_TTL_MS
    with conn.cursor() as cur:
        cur.execute(
            """
            update kb2.sentences set locked_by = %s, lock_acquired_at = %s
            where id = %s
              and (locked_by is null or locked_by = %s or lock_acquired_at < %s)
            returning locked_by
            """,
            (auditor_id, now_ms, sentence_id, auditor_id, cutoff),
        )
        row = cur.fetchone()
        if row is not None:
            return True, None
        cur.execute("select locked_by from kb2.sentences where id = %s", (sentence_id,))
        current = cur.fetchone()
        return False, (current[0] if current else None)


def release_lock(sentence_id: str, auditor_id: str) -> None:
    """auditor_id 가 현재 락 보유자와 일치할 때만 해제(다른 사람이 실수로 남의 락을
    풀지 못하게)."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "update kb2.sentences set locked_by = null, lock_acquired_at = null "
            "where id = %s and locked_by = %s",
            (sentence_id, auditor_id),
        )


@dataclass
class Kb2SentenceVersion:
    id: str
    sentence_id: str
    version_no: int
    content: str
    attribution_snapshot: list[dict]
    editor_type: str
    editor_id: str
    created_at: int
    meta: Optional[dict] = None


def list_sentence_versions(sentence_id: str) -> list[Kb2SentenceVersion]:
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "select id, sentence_id, version_no, content, attribution_snapshot, "
            "editor_type, editor_id, created_at, meta "
            "from kb2.sentence_versions where sentence_id = %s order by version_no desc",
            (sentence_id,),
        )
        rows = cur.fetchall()
    return [
        Kb2SentenceVersion(
            id=str(r[0]), sentence_id=str(r[1]), version_no=r[2], content=r[3],
            attribution_snapshot=list(r[4] or []), editor_type=r[5], editor_id=r[6],
            created_at=int(r[7]), meta=r[8],
        )
        for r in rows
    ]


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
