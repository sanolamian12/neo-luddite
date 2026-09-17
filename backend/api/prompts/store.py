"""
norms.* 저장소 — L0 규범 DB 원본 + 초안→확정 이력 (KB통합 3층검색 로드맵 P5, 2026-09-17).

kbdict_store.py 와 같은 컨벤션(%s 바인딩, 접속 URL 은 kb2_store._db_url). 읽기는 모듈 캐시
커넥션, 여러 문장 트랜잭션인 쓰기는 호출마다 새 커넥션(_tx).
스키마: supabase/migrations/0030_norms_schema.sql.

두 게이트(사용자 결정 2026-09-17): 초안은 admin·auditor 누구나, 확정은 세무사(auditor)만.
확정 = documents.active_version_id 전환 = 다음 load_norms() 확인 주기에 전 답변 반영.
예산(NORMS_MAX_CHARS)은 초안 저장·확정 때 여기서 검사한다 — 초과 상태는 저장되지 않는다.
"""

from __future__ import annotations

import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Optional

_conn = None  # 지연 연결(모듈 캐시). 끊기면 재연결.

CONNECT_TIMEOUT_SEC = 5  # 챗 경로(load_norms 버전 확인)에서도 불리므로 DB 장애 시 오래 매달리지 않는다


class NormsStoreError(Exception):
    """사용자에게 그대로 보여줄 수 있는 거절 사유(권한·충돌·예산·상태)."""


def _get_conn():
    global _conn
    if _conn is None or _conn.closed:
        import psycopg

        from api.rag.kb2_store import _db_url

        _conn = psycopg.connect(_db_url(), autocommit=True, connect_timeout=CONNECT_TIMEOUT_SEC)
    return _conn


@contextmanager
def _tx():
    """쓰기 전용 새 커넥션 + 트랜잭션. 모듈 캐시 커넥션은 스레드풀 요청끼리 공유되므로
    여러 문장 트랜잭션을 거기서 열면 다른 요청의 문장이 섞일 수 있다. 쓰기는 드물다."""
    import psycopg

    from api.rag.kb2_store import _db_url

    try:
        with psycopg.connect(_db_url(), connect_timeout=CONNECT_TIMEOUT_SEC) as conn:
            with conn.transaction(), conn.cursor() as cur:
                yield cur
    except psycopg.errors.UniqueViolation as exc:
        # 두 사람이 같은 문서의 첫 초안을 동시에 만든 경우(norms_versions_one_draft)
        raise NormsStoreError("다른 사람이 방금 이 문서의 초안을 만들었습니다. 새로고침하세요") from exc


def is_configured() -> bool:
    from api.rag import kb2_store

    return kb2_store.is_configured()


def _now_ms() -> int:
    return int(time.time() * 1000)


# ── 도메인 타입 ────────────────────────────────────────────────────────────────

@dataclass
class NormVersion:
    id: str
    document_id: str
    version_no: Optional[int]
    content: str
    status: str
    base_version_id: Optional[str]
    note: Optional[str]
    author_id: str
    updated_by: str
    confirmed_by: Optional[str]
    confirmed_at: Optional[int]
    discarded_by: Optional[str]
    discarded_at: Optional[int]
    created_at: int
    updated_at: int


@dataclass
class NormDocument:
    id: str
    name: str
    title: str
    order_index: int
    active: Optional[NormVersion]
    draft: Optional[NormVersion]


_VERSION_COLS = (
    "id, document_id, version_no, content, status, base_version_id, note, author_id, updated_by, "
    "confirmed_by, confirmed_at, discarded_by, discarded_at, created_at, updated_at"
)


def _row_to_version(r) -> NormVersion:
    return NormVersion(
        id=str(r[0]), document_id=str(r[1]), version_no=r[2], content=r[3], status=r[4],
        base_version_id=str(r[5]) if r[5] else None, note=r[6], author_id=r[7], updated_by=r[8],
        confirmed_by=r[9], confirmed_at=r[10], discarded_by=r[11], discarded_at=r[12],
        created_at=r[13], updated_at=r[14],
    )


# ── 로더용 (챗 경로) ────────────────────────────────────────────────────────────

def active_token() -> str:
    """확정본 조합의 지문 — load_norms() 가 주기적으로 이것만 보고 재로딩 여부를 정한다."""
    with _get_conn().cursor() as cur:
        cur.execute(
            "select coalesce(string_agg(coalesce(active_version_id::text, '-'), ',' order by order_index), '') "
            "from norms.documents where status = 'active'"
        )
        return cur.fetchone()[0]


def active_sources() -> list[tuple[str, str]]:
    """(이름, 확정본) 목록 — 주입 순서대로. 확정본 없는 문서가 있으면 NormsStoreError."""
    with _get_conn().cursor() as cur:
        cur.execute(
            "select d.name, v.content from norms.documents d "
            "left join norms.versions v on v.id = d.active_version_id "
            "where d.status = 'active' order by d.order_index"
        )
        rows = cur.fetchall()
    if not rows:
        raise NormsStoreError("norms.documents 가 비어 있음")
    missing = [name for name, content in rows if content is None]
    if missing:
        raise NormsStoreError(f"확정본 없는 규범 문서: {', '.join(missing)}")
    return [(name, content) for name, content in rows]


# ── 조회 (편집 화면) ────────────────────────────────────────────────────────────

def list_documents() -> list[NormDocument]:
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "select id, name, title, order_index, active_version_id from norms.documents "
            "where status = 'active' order by order_index"
        )
        docs = cur.fetchall()
        cur.execute(
            f"select {_VERSION_COLS} from norms.versions v "
            "where v.status = 'draft' or v.id in (select active_version_id from norms.documents)"
        )
        versions = [_row_to_version(r) for r in cur.fetchall()]
    by_id = {v.id: v for v in versions}
    drafts = {v.document_id: v for v in versions if v.status == "draft"}
    return [
        NormDocument(
            id=str(d[0]), name=d[1], title=d[2], order_index=d[3],
            active=by_id.get(str(d[4])) if d[4] else None,
            draft=drafts.get(str(d[0])),
        )
        for d in docs
    ]


def list_versions(name: str) -> list[NormVersion]:
    """확정·폐기 이력(최신 먼저). 초안은 list_documents 쪽에서 본다."""
    with _get_conn().cursor() as cur:
        cur.execute(
            f"select {', '.join('v.' + c.strip() for c in _VERSION_COLS.split(','))} "
            "from norms.versions v join norms.documents d on d.id = v.document_id "
            "where d.name = %s and v.status <> 'draft' "
            "order by coalesce(v.confirmed_at, v.discarded_at, v.updated_at) desc",
            (name,),
        )
        return [_row_to_version(r) for r in cur.fetchall()]


# ── 쓰기 ───────────────────────────────────────────────────────────────────────

def _role_of(cur, domain_id: str) -> Optional[str]:
    cur.execute("select role::text from public.profiles where domain_id = %s", (domain_id,))
    row = cur.fetchone()
    return row[0] if row else None


def _check_budget(cur, document_id: str, content: str) -> int:
    """이 문서를 content 로 바꿨을 때 주입 블록이 예산 안인지. 초과·빈 본문이면 NormsStoreError."""
    from api.prompts import NormsError, build_norms

    cur.execute(
        "select d.id, d.name, v.content from norms.documents d "
        "left join norms.versions v on v.id = d.active_version_id "
        "where d.status = 'active' order by d.order_index"
    )
    sources = [
        (name, content if str(doc_id) == document_id else (active or ""))
        for doc_id, name, active in cur.fetchall()
    ]
    try:
        return len(build_norms(sources))
    except NormsError as exc:
        raise NormsStoreError(str(exc)) from exc


def _document_id(cur, name: str) -> str:
    cur.execute("select id from norms.documents where name = %s and status = 'active'", (name,))
    row = cur.fetchone()
    if row is None:
        raise NormsStoreError(f"규범 문서 없음: {name}")
    return str(row[0])


def _get_version(cur, version_id: str, *, for_update: bool = False) -> NormVersion:
    try:
        uuid.UUID(version_id)
    except ValueError:
        raise NormsStoreError("버전을 찾을 수 없음") from None
    cur.execute(
        f"select {_VERSION_COLS} from norms.versions where id = %s" + (" for update" if for_update else ""),
        (version_id,),
    )
    row = cur.fetchone()
    if row is None:
        raise NormsStoreError("버전을 찾을 수 없음")
    return _row_to_version(row)


def save_draft(name: str, content: str, editor_id: str, note: Optional[str],
               expected_updated_at: Optional[int] = None,
               base_version_id: Optional[str] = None) -> NormVersion:
    """초안 생성 또는 갱신. 문서당 초안은 하나.
    - 초안이 없으면 새로 만든다. base_version_id 를 주면(되돌리기) 그 확정본을 기준으로 기록.
    - 초안이 있으면 expected_updated_at 가 맞을 때만 덮어쓴다(다른 사람이 먼저 고쳤으면 거절)."""
    content = content.strip()
    with _tx() as cur:
        role = _role_of(cur, editor_id)
        if role not in ("admin", "auditor"):
            raise NormsStoreError("초안은 운영자·세무사 계정만 작성할 수 있습니다")
        doc_id = _document_id(cur, name)
        _check_budget(cur, doc_id, content)
        now = _now_ms()
        cur.execute(
            f"select {_VERSION_COLS} from norms.versions where document_id = %s and status = 'draft' for update",
            (doc_id,),
        )
        row = cur.fetchone()
        if row is None:
            if expected_updated_at is not None:
                raise NormsStoreError("편집하던 초안이 이미 확정·폐기됐습니다. 새로고침 후 다시 시작하세요")
            if base_version_id is None:
                cur.execute("select active_version_id from norms.documents where id = %s", (doc_id,))
                active = cur.fetchone()[0]
                base_version_id = str(active) if active else None
            else:
                base = _get_version(cur, base_version_id)
                if base.document_id != doc_id or base.status != "confirmed":
                    raise NormsStoreError("되돌리기 기준은 이 문서의 확정본이어야 합니다")
            cur.execute(
                "insert into norms.versions (document_id, content, status, base_version_id, note, "
                "author_id, updated_by, created_at, updated_at) "
                f"values (%s, %s, 'draft', %s, %s, %s, %s, %s, %s) returning {_VERSION_COLS}",
                (doc_id, content, base_version_id, note, editor_id, editor_id, now, now),
            )
        else:
            draft = _row_to_version(row)
            if expected_updated_at is None or draft.updated_at != expected_updated_at:
                raise NormsStoreError("다른 사람이 이 초안을 먼저 고쳤습니다. 새로고침해 최신 초안에서 이어 쓰세요")
            cur.execute(
                "update norms.versions set content = %s, note = %s, updated_by = %s, updated_at = %s "
                f"where id = %s returning {_VERSION_COLS}",
                (content, note, editor_id, max(now, draft.updated_at + 1), draft.id),
            )
        return _row_to_version(cur.fetchone())


def discard_draft(version_id: str, editor_id: str) -> NormVersion:
    with _tx() as cur:
        if _role_of(cur, editor_id) not in ("admin", "auditor"):
            raise NormsStoreError("초안은 운영자·세무사 계정만 폐기할 수 있습니다")
        draft = _get_version(cur, version_id, for_update=True)
        if draft.status != "draft":
            raise NormsStoreError("초안 상태가 아닙니다(이미 확정·폐기됨)")
        now = _now_ms()
        cur.execute(
            "update norms.versions set status = 'discarded', discarded_by = %s, discarded_at = %s, updated_at = %s "
            f"where id = %s returning {_VERSION_COLS}",
            (editor_id, now, now, version_id),
        )
        return _row_to_version(cur.fetchone())


def confirm_draft(version_id: str, confirmer_id: str, expected_updated_at: int,
                  note: Optional[str]) -> NormVersion:
    """세무사 확정 — 활성 확정본 교체. 문서당 초안이 하나뿐이라(0030 부분 유니크 인덱스) 초안을
    만든 뒤 다른 확정이 끼어드는 경우는 없다. 막을 것은 '확인한 뒤 초안이 고쳐진 경우'뿐."""
    with _tx() as cur:
        if _role_of(cur, confirmer_id) != "auditor":
            raise NormsStoreError("확정은 세무사(평가자) 계정만 할 수 있습니다")
        draft = _get_version(cur, version_id, for_update=True)
        if draft.status != "draft":
            raise NormsStoreError("초안 상태가 아닙니다(이미 확정·폐기됨)")
        if draft.updated_at != expected_updated_at:
            raise NormsStoreError("확인하신 뒤 초안이 수정됐습니다. 새로고침해 최신 내용을 보고 확정하세요")
        note = (note or draft.note or "").strip()
        if not note:
            raise NormsStoreError("변경 사유(항목 번호 등)를 적어야 확정할 수 있습니다")
        cur.execute(
            "select active_version_id from norms.documents where id = %s for update", (draft.document_id,),
        )
        active = cur.fetchone()[0]
        active = str(active) if active else None
        if active is not None:
            current = _get_version(cur, active)
            if current.content.strip() == draft.content.strip():
                raise NormsStoreError("현재 확정본과 내용이 같습니다")
        _check_budget(cur, draft.document_id, draft.content)
        cur.execute(
            "select coalesce(max(version_no), 0) + 1 from norms.versions where document_id = %s",
            (draft.document_id,),
        )
        version_no = cur.fetchone()[0]
        now = _now_ms()
        cur.execute(
            "update norms.versions set status = 'confirmed', version_no = %s, note = %s, "
            "confirmed_by = %s, confirmed_at = %s, updated_at = %s "
            f"where id = %s returning {_VERSION_COLS}",
            (version_no, note, confirmer_id, now, now, version_id),
        )
        confirmed = _row_to_version(cur.fetchone())
        cur.execute(
            "update norms.documents set active_version_id = %s, updated_at = %s where id = %s",
            (version_id, now, draft.document_id),
        )
        return confirmed
