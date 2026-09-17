"""
norms.* 저장소 — L0 규범 DB 원본 + 초안→공개→반영 이력 (KB통합 3층검색 로드맵 P5·P6, 2026-09-17).

kbdict_store.py 와 같은 컨벤션(%s 바인딩, 접속 URL 은 kb2_store._db_url). 읽기는 모듈 캐시
커넥션, 여러 문장 트랜잭션인 쓰기는 호출마다 새 커넥션(_tx).
스키마: supabase/migrations/0030_norms_schema.sql, 0031_norms_objection_period.sql.

확정 거버넌스(P6 ②, 사용자 결정 2026-09-17) — 세무사 1명 즉시 확정을 대체한다:
  draft   초안. admin·세무사 누구나 작성·수정·폐기.
  pending 공개 중. 이의 기간(OBJECTION_PERIOD_SEC, 기본 1일) 시작.
          · 작성자·공개자를 뺀 세무사 승인 ≥ FAST_APPROVALS(기본 2 — 데모 세무사 계정 수에 맞춤, 원래 결정은 3)
            이고 유효 이의 0 → 즉시 반영.
          · 기한 경과 + 유효 이의 0 → 자동 반영(침묵 = 동의, 폴러 apply_due).
          · 이의가 있으면 보류. 이의 철회 또는 수정(→ draft, 승인·이의 무효, 재공개 필요)으로만 풀린다.
  confirmed 반영 = documents.active_version_id 전환 = 다음 load_norms() 확인 주기에 전 답변 반영.
예산(NORMS_MAX_CHARS)은 초안 저장·공개·반영 때 여기서 검사한다 — 초과 상태는 반영되지 않는다.
"""

from __future__ import annotations

import logging
import os
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Optional

log = logging.getLogger("api.prompts")

_conn = None  # 지연 연결(모듈 캐시). 끊기면 재연결.

CONNECT_TIMEOUT_SEC = 5  # 챗 경로(load_norms 버전 확인)에서도 불리므로 DB 장애 시 오래 매달리지 않는다

FAST_APPROVALS = int(os.environ.get("NORMS_FAST_APPROVALS", "2"))
OBJECTION_PERIOD_SEC = int(os.environ.get("NORMS_OBJECTION_PERIOD_SEC", str(24 * 3600)))


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
        # 두 사람이 같은 문서의 첫 초안을 동시에 만든 경우(norms_versions_one_open),
        # 또는 같은 세무사가 동시에 두 결정을 남긴 경우(norms_decisions_one_live)
        raise NormsStoreError("다른 요청과 동시에 처리됐습니다. 새로고침 후 다시 시도하세요") from exc


def is_configured() -> bool:
    from api.rag import kb2_store

    return kb2_store.is_configured()


def _now_ms() -> int:
    return int(time.time() * 1000)


# ── 도메인 타입 ────────────────────────────────────────────────────────────────

@dataclass
class NormDecision:
    auditor_id: str
    decision: str  # approve | object
    reason: Optional[str]
    created_at: int


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
    published_by: Optional[str] = None
    published_at: Optional[int] = None
    deadline_at: Optional[int] = None
    applied_via: Optional[str] = None
    decisions: list[NormDecision] = field(default_factory=list)  # 유효(철회 안 된) 결정만

    def excluded_voters(self) -> set[str]:
        """승인 집계에서 빠지는 사람 — 셀프 반영 방지."""
        return {x for x in (self.author_id, self.published_by) if x}

    @property
    def approvals(self) -> int:
        excluded = self.excluded_voters()
        return sum(1 for d in self.decisions if d.decision == "approve" and d.auditor_id not in excluded)

    @property
    def objections(self) -> int:
        return sum(1 for d in self.decisions if d.decision == "object")


@dataclass
class NormDocument:
    id: str
    name: str
    title: str
    order_index: int
    active: Optional[NormVersion]
    draft: Optional[NormVersion]  # 열린 제안(draft 또는 pending)


_VERSION_COLS = (
    "id, document_id, version_no, content, status, base_version_id, note, author_id, updated_by, "
    "confirmed_by, confirmed_at, discarded_by, discarded_at, created_at, updated_at, "
    "published_by, published_at, deadline_at, applied_via"
)


def _row_to_version(r) -> NormVersion:
    return NormVersion(
        id=str(r[0]), document_id=str(r[1]), version_no=r[2], content=r[3], status=r[4],
        base_version_id=str(r[5]) if r[5] else None, note=r[6], author_id=r[7], updated_by=r[8],
        confirmed_by=r[9], confirmed_at=r[10], discarded_by=r[11], discarded_at=r[12],
        created_at=r[13], updated_at=r[14], published_by=r[15], published_at=r[16],
        deadline_at=r[17], applied_via=r[18],
    )


def _load_decisions(cur, versions: list[NormVersion]) -> None:
    ids = [v.id for v in versions if v.status == "pending"]
    if not ids:
        return
    cur.execute(
        "select version_id, auditor_id, decision, reason, created_at from norms.decisions "
        "where version_id = any(%s::uuid[]) and withdrawn_at is null order by created_at",
        (ids,),
    )
    by_version: dict[str, list[NormDecision]] = {}
    for vid, auditor_id, decision, reason, created_at in cur.fetchall():
        by_version.setdefault(str(vid), []).append(NormDecision(auditor_id, decision, reason, created_at))
    for v in versions:
        v.decisions = by_version.get(v.id, [])


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
            "where v.status in ('draft', 'pending') or v.id in (select active_version_id from norms.documents)"
        )
        versions = [_row_to_version(r) for r in cur.fetchall()]
        _load_decisions(cur, versions)
    by_id = {v.id: v for v in versions}
    open_ = {v.document_id: v for v in versions if v.status in ("draft", "pending")}
    return [
        NormDocument(
            id=str(d[0]), name=d[1], title=d[2], order_index=d[3],
            active=by_id.get(str(d[4])) if d[4] else None,
            draft=open_.get(str(d[0])),
        )
        for d in docs
    ]


def list_versions(name: str) -> list[NormVersion]:
    """반영·폐기 이력(최신 먼저). 열린 제안은 list_documents 쪽에서 본다."""
    with _get_conn().cursor() as cur:
        cur.execute(
            f"select {', '.join('v.' + c.strip() for c in _VERSION_COLS.split(','))} "
            "from norms.versions v join norms.documents d on d.id = v.document_id "
            "where d.name = %s and v.status in ('confirmed', 'discarded') "
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
    v = _row_to_version(row)
    _load_decisions(cur, [v])
    return v


def _withdraw_all(cur, version_id: str, by: str, reason: str, now: int) -> None:
    cur.execute(
        "update norms.decisions set withdrawn_at = %s, withdrawn_by = %s, withdraw_reason = %s "
        "where version_id = %s and withdrawn_at is null",
        (now, by, reason, version_id),
    )


def save_draft(name: str, content: str, editor_id: str, note: Optional[str],
               expected_updated_at: Optional[int] = None,
               base_version_id: Optional[str] = None) -> NormVersion:
    """초안 생성 또는 갱신. 문서당 열린 제안(draft|pending)은 하나.
    - 없으면 새 초안. base_version_id 를 주면(되돌리기) 그 확정본을 기준으로 기록.
    - 있으면 expected_updated_at 가 맞을 때만 덮어쓴다(다른 사람이 먼저 고쳤으면 거절).
    - 공개 중(pending)을 고치면 초안으로 돌아간다 — 승인·이의는 전부 무효, 기한도 사라진다(재공개 필요)."""
    content = content.strip()
    with _tx() as cur:
        role = _role_of(cur, editor_id)
        if role not in ("admin", "auditor"):
            raise NormsStoreError("초안은 운영자·세무사 계정만 작성할 수 있습니다")
        doc_id = _document_id(cur, name)
        _check_budget(cur, doc_id, content)
        now = _now_ms()
        cur.execute(
            f"select {_VERSION_COLS} from norms.versions "
            "where document_id = %s and status in ('draft', 'pending') for update",
            (doc_id,),
        )
        row = cur.fetchone()
        if row is None:
            if expected_updated_at is not None:
                raise NormsStoreError("편집하던 초안이 이미 반영·폐기됐습니다. 새로고침 후 다시 시작하세요")
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
            if draft.status == "pending":
                _withdraw_all(cur, draft.id, editor_id, "reset:edited", now)
            cur.execute(
                "update norms.versions set content = %s, note = %s, updated_by = %s, updated_at = %s, "
                "status = 'draft', published_by = null, published_at = null, deadline_at = null "
                f"where id = %s returning {_VERSION_COLS}",
                (content, note, editor_id, max(now, draft.updated_at + 1), draft.id),
            )
        return _row_to_version(cur.fetchone())


def discard_draft(version_id: str, editor_id: str) -> NormVersion:
    """초안은 운영자·세무사 누구나 폐기. 공개 중 제안은 작성자·공개자만 거둬들일 수 있다
    (다른 사람이 막고 싶으면 이의를 남긴다 — admin 거부는 ③ 사후 브레이크)."""
    with _tx() as cur:
        if _role_of(cur, editor_id) not in ("admin", "auditor"):
            raise NormsStoreError("초안은 운영자·세무사 계정만 폐기할 수 있습니다")
        draft = _get_version(cur, version_id, for_update=True)
        if draft.status == "pending":
            if editor_id not in draft.excluded_voters():
                raise NormsStoreError("공개 중인 제안은 작성자·공개자만 거둬들일 수 있습니다. 반대라면 이의를 남기세요")
        elif draft.status != "draft":
            raise NormsStoreError("초안 상태가 아닙니다(이미 반영·폐기됨)")
        now = _now_ms()
        if draft.status == "pending":
            _withdraw_all(cur, draft.id, editor_id, "reset:discarded", now)
        cur.execute(
            "update norms.versions set status = 'discarded', discarded_by = %s, discarded_at = %s, updated_at = %s "
            f"where id = %s returning {_VERSION_COLS}",
            (editor_id, now, now, version_id),
        )
        return _row_to_version(cur.fetchone())


def publish_draft(version_id: str, publisher_id: str, expected_updated_at: int,
                  note: Optional[str]) -> NormVersion:
    """초안 공개 — 이의 기간 시작. 답변은 아직 안 바뀐다."""
    with _tx() as cur:
        if _role_of(cur, publisher_id) not in ("admin", "auditor"):
            raise NormsStoreError("공개는 운영자·세무사 계정만 할 수 있습니다")
        draft = _get_version(cur, version_id, for_update=True)
        if draft.status != "draft":
            raise NormsStoreError("초안 상태가 아닙니다(이미 공개·반영·폐기됨)")
        if draft.updated_at != expected_updated_at:
            raise NormsStoreError("확인하신 뒤 초안이 수정됐습니다. 새로고침해 최신 내용을 보고 공개하세요")
        note = (note or draft.note or "").strip()
        if not note:
            raise NormsStoreError("변경 사유(항목 번호 등)를 적어야 공개할 수 있습니다")
        _check_not_same_as_active(cur, draft)
        _check_budget(cur, draft.document_id, draft.content)
        now = _now_ms()
        cur.execute(
            "update norms.versions set status = 'pending', note = %s, published_by = %s, published_at = %s, "
            f"deadline_at = %s, updated_at = %s where id = %s returning {_VERSION_COLS}",
            (note, publisher_id, now, now + OBJECTION_PERIOD_SEC * 1000, now, version_id),
        )
        return _row_to_version(cur.fetchone())


def _check_not_same_as_active(cur, draft: NormVersion) -> None:
    cur.execute("select active_version_id from norms.documents where id = %s", (draft.document_id,))
    active = cur.fetchone()[0]
    if active is not None:
        current = _get_version(cur, str(active))
        if current.content.strip() == draft.content.strip():
            raise NormsStoreError("현재 확정본과 내용이 같습니다")


def decide(version_id: str, auditor_id: str, decision: str, reason: Optional[str],
           expected_updated_at: int) -> tuple[NormVersion, bool]:
    """세무사 승인·이의. 같은 사람의 이전 결정은 철회 처리 후 새로 기록한다.
    반환: (제안의 최신 상태, 이번 결정으로 반영됐는지)."""
    if decision not in ("approve", "object"):
        raise NormsStoreError("결정은 approve 또는 object 여야 합니다")
    reason = (reason or "").strip() or None
    if decision == "object" and not reason:
        raise NormsStoreError("이의에는 사유를 적어야 합니다")
    with _tx() as cur:
        if _role_of(cur, auditor_id) != "auditor":
            raise NormsStoreError("승인·이의는 세무사(평가자) 계정만 할 수 있습니다")
        v = _get_version(cur, version_id, for_update=True)
        if v.status != "pending":
            raise NormsStoreError("공개 중인 제안이 아닙니다(이미 반영·폐기됐거나 수정 중)")
        if v.updated_at != expected_updated_at:
            raise NormsStoreError("확인하신 뒤 제안이 바뀌었습니다. 새로고침해 최신 내용을 보고 결정하세요")
        if decision == "approve" and auditor_id in v.excluded_voters():
            raise NormsStoreError("작성자·공개자는 자기 제안을 승인할 수 없습니다")
        now = _now_ms()
        cur.execute(
            "update norms.decisions set withdrawn_at = %s, withdrawn_by = %s, withdraw_reason = 'changed' "
            "where version_id = %s and auditor_id = %s and withdrawn_at is null",
            (now, auditor_id, version_id, auditor_id),
        )
        cur.execute(
            "insert into norms.decisions (version_id, auditor_id, decision, reason, created_at) "
            "values (%s, %s, %s, %s, %s)",
            (version_id, auditor_id, decision, reason, now),
        )
        v = _get_version(cur, version_id, for_update=True)
        applied = _try_apply(cur, v, auditor_id, now)
        return (_get_version(cur, version_id) if applied else v), applied


def withdraw_decision(version_id: str, auditor_id: str) -> tuple[NormVersion, bool]:
    """본인 결정 철회. 이의를 거두면 조건(승인 문턱 또는 기한 경과)에 따라 곧바로 반영될 수 있다."""
    with _tx() as cur:
        v = _get_version(cur, version_id, for_update=True)
        if v.status != "pending":
            raise NormsStoreError("공개 중인 제안이 아닙니다")
        now = _now_ms()
        cur.execute(
            "update norms.decisions set withdrawn_at = %s, withdrawn_by = %s, withdraw_reason = 'withdrawn' "
            "where version_id = %s and auditor_id = %s and withdrawn_at is null",
            (now, auditor_id, version_id, auditor_id),
        )
        if cur.rowcount == 0:
            raise NormsStoreError("철회할 결정이 없습니다")
        v = _get_version(cur, version_id, for_update=True)
        applied = _try_apply(cur, v, auditor_id, now)
        return (_get_version(cur, version_id) if applied else v), applied


def _try_apply(cur, v: NormVersion, actor_id: str, now: int) -> bool:
    """반영 조건을 보고 되면 반영. 이의가 하나라도 있으면 어떤 경우에도 안 된다."""
    if v.status != "pending" or v.objections > 0:
        return False
    if v.approvals >= FAST_APPROVALS:
        _apply(cur, v, actor_id, "approvals", now)
        return True
    if v.deadline_at is not None and v.deadline_at <= now:
        _apply(cur, v, "system:deadline", "deadline", now)
        return True
    return False


def _apply(cur, v: NormVersion, confirmer_id: str, via: str, now: int) -> None:
    """활성 확정본 교체. 문서당 열린 제안이 하나라(부분 유니크 인덱스) 공개 뒤 다른 반영이 끼어드는
    경우는 없다 — 다만 다른 문서의 반영으로 합계 예산이 바뀌었을 수 있어 여기서 다시 검사한다."""
    _check_not_same_as_active(cur, v)
    _check_budget(cur, v.document_id, v.content)
    cur.execute("select id from norms.documents where id = %s for update", (v.document_id,))
    cur.execute(
        "select coalesce(max(version_no), 0) + 1 from norms.versions where document_id = %s", (v.document_id,),
    )
    version_no = cur.fetchone()[0]
    cur.execute(
        "update norms.versions set status = 'confirmed', version_no = %s, confirmed_by = %s, confirmed_at = %s, "
        "applied_via = %s, updated_at = %s where id = %s",
        (version_no, confirmer_id, now, via, now, v.id),
    )
    cur.execute(
        "update norms.documents set active_version_id = %s, updated_at = %s where id = %s",
        (v.id, now, v.document_id),
    )
    log.warning("L0 규범 반영 — version %s v%s via %s by %s: %s", v.id, version_no, via, confirmer_id, v.note)


def apply_due(now: Optional[int] = None) -> list[str]:
    """기한이 지났고 유효 이의가 없는 공개 제안을 반영(디폴트 승인). 폴러가 60초마다 부른다.
    반영한 version id 목록. 예산 초과 등으로 반영 못 한 제안은 공개 상태로 두고 로그만 남긴다."""
    now = now or _now_ms()
    with _get_conn().cursor() as cur:
        cur.execute(
            "select id from norms.versions where status = 'pending' and deadline_at <= %s order by deadline_at",
            (now,),
        )
        due = [str(r[0]) for r in cur.fetchall()]
    applied: list[str] = []
    for version_id in due:
        try:
            with _tx() as cur:
                v = _get_version(cur, version_id, for_update=True)
                if _try_apply(cur, v, "system:deadline", now):
                    applied.append(version_id)
        except NormsStoreError as exc:
            log.warning("L0 규범 자동 반영 보류 — version %s: %s", version_id, exc)
    return applied
