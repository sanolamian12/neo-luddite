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
    # 마지막 상태 전환 사유/행위자(kb2.document_events 최신 1건) — 화면에서 "왜 끊겼는지"를
    # 바로 보여주기 위해 목록 쿼리에 얹는다. 전체 이력은 kb2.document_events 에 다 남는다.
    status_reason: Optional[str] = None
    status_actor: Optional[str] = None


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
    status: str = "active"

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


_DOCUMENT_COLS_BARE = "id, tax_category, title, status, created_at, updated_at, group_id"
# 조회 쿼리는 사유(document_events)를 lateral 로 붙이느라 테이블 별칭 d 가 필요하고,
# update…returning 은 별칭이 없다 — 둘을 섞으면 컬럼 참조가 깨져서 따로 둔다.
_DOCUMENT_COLS = ", ".join(f"d.{c}" for c in _DOCUMENT_COLS_BARE.split(", "))

# 마지막 상태 전환 사유 1건만 곁들인다 — 문서 row 에 사유 컬럼을 두면 "끊었다 다시
# 연결"의 앞부분이 덮여 사라지므로, 이력은 kb2.document_events 에만 두고 여기선 최신
# 1건을 lateral 로 끌어온다.
_DOCUMENT_FROM = """
  from kb2.documents d
  left join lateral (
    select reason, actor_id from kb2.document_events e
     where e.document_id = d.id order by e.created_at desc limit 1
  ) ev on true
"""


def _row_to_document(r) -> Kb2Document:
    return Kb2Document(
        id=str(r[0]), tax_category=r[1], title=r[2], status=r[3],
        created_at=int(r[4]), updated_at=int(r[5]), group_id=str(r[6]) if r[6] else None,
        status_reason=r[7] if len(r) > 7 else None,
        status_actor=r[8] if len(r) > 8 else None,
    )


def list_documents(status: str | list[str] | None = "active") -> list[Kb2Document]:
    """status='active'(디폴트) — 재구조화로 archived 처리된 이전 문서는 auditor 화면에
    안 보이게. status=None 이면 전체(관리자 보관함 조회용은 status='archived').
    리스트를 주면 그중 아무거나(auditor 화면은 ['active','retired'] — 연결 끊긴 세목도
    옅게 남아 보여야 재연결할 수 있다)."""
    cols = f"select {_DOCUMENT_COLS}, ev.reason, ev.actor_id {_DOCUMENT_FROM}"
    conn = _get_conn()
    with conn.cursor() as cur:
        if status is None:
            cur.execute(f"{cols} order by d.tax_category")
        elif isinstance(status, list):
            cur.execute(f"{cols} where d.status = any(%s) order by d.tax_category", (status,))
        else:
            cur.execute(f"{cols} where d.status = %s order by d.tax_category", (status,))
        rows = cur.fetchall()
    return [_row_to_document(r) for r in rows]


def get_document(document_id: str) -> Optional[Kb2Document]:
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            f"select {_DOCUMENT_COLS}, ev.reason, ev.actor_id {_DOCUMENT_FROM} where d.id = %s",
            (document_id,),
        )
        row = cur.fetchone()
    return _row_to_document(row) if row else None


def set_document_status(
    document_id: str, status: str, reason: str, actor_id: str
) -> Optional[Kb2Document]:
    """세목 연결 끊기('retired') / 재연결('active'). 삭제가 아니라 상태 전환 —
    문장·버전이력·기여 attribution 은 그대로 남고 검색(kb2.match_sentences 가
    d.status='active' 만 본다)에서만 빠진다. 사유는 필수로 이력에 남긴다.

    재구조화가 갈아엎어 'archived' 가 된 문서는 대상이 아니다(그건 세대교체지 사람이
    끊은 게 아니라, 되살리려면 재구조화 쪽 얘기가 된다)."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "update kb2.documents set status = %s, "
            "updated_at = (extract(epoch from now()) * 1000)::bigint "
            "where id = %s and status in ('active', 'retired')",
            (status, document_id),
        )
        if cur.rowcount == 0:
            return None
        cur.execute(
            "insert into kb2.document_events (document_id, event_type, reason, actor_id) "
            "values (%s, %s, %s, %s)",
            (document_id, "retired" if status == "retired" else "reconnected", reason, actor_id),
        )
    return get_document(document_id)


def delete_group(group_id: str, actor_id: str) -> int:
    """대목 삭제 — 대목은 지식이 없는 순수 정리 계층이라 지워도 된다. 속한 세목은
    같이 지우지 않고 group_id=null("미분류")로 풀어주고, 각 세목에 왜 미분류가 됐는지
    이력을 남긴다. 반환: 풀려난 세목 수."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute("select id from kb2.documents where group_id = %s", (group_id,))
        detached = [str(r[0]) for r in cur.fetchall()]
        cur.execute("update kb2.documents set group_id = null where group_id = %s", (group_id,))
        for document_id in detached:
            cur.execute(
                "insert into kb2.document_events (document_id, event_type, reason, actor_id) "
                "values (%s, 'group_detached', %s, %s)",
                (document_id, "대목 삭제로 미분류 전환", actor_id),
            )
        cur.execute(
            "update kb2.groups set status = 'deleted', "
            "updated_at = (extract(epoch from now()) * 1000)::bigint where id = %s",
            (group_id,),
        )
    return len(detached)


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
            returning {_DOCUMENT_COLS_BARE}
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
            returning {_DOCUMENT_COLS_BARE}
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
    (kb2.match_sentences 가 이미 status='active'만 검색).

    'unsorted'('기타', 0025)도 함께 내린다 — 그것도 재구조화가 매 회차 새로 만드는
    것이라 세대에 속한다. 안 내리면 '기타'만 남아 회차마다 하나씩 쌓인다(0023 이
    카테고리에서 고쳤던 그 버그와 같은 모양)."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "update kb2.documents set status = 'archived' "
            "where status in ('active', 'unsorted')"
        )
        return cur.rowcount


def archive_all_active_categories() -> int:
    """재구조화 시작 전, 지금 활성 카테고리 레이블도 전부 보관 처리(2026-09-10).
    이전에는 문서만 archive 하고 카테고리는 그대로 둬서 재실행할 때마다 지난 회차
    레이블이 계속 쌓였다(실측: 활성 카테고리 31 vs 활성 문서 17). documents.category_id
    참조는 그대로 유지되므로 보관된 문서에서 카테고리를 거슬러 올라가는 건 여전히
    가능하다."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute("update kb2.categories set status = 'archived' where status = 'active'")
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


UNSORTED_LABEL = "기타"
UNSORTED_TITLE = "기타 — 분류되지 않은 상담"


def create_unsorted_document() -> str:
    """'기타' 세목(0025) — 분류가 '미분류'로 끝난 상담을 담는 그릇.

    status='unsorted' 로 만든다: 트리에는 보이고 kb2.match_sentences(d.status='active')
    에서는 자동으로 빠진다. category_id 는 없다 — AI 가 제안한 주제가 아니라 '남은 것'을
    담는 자리이고, 카테고리 정체성을 주면 다음 회차 목차에 '기타'가 섞여 들어간다."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "insert into kb2.documents (category_id, tax_category, title, status) "
            "values (null, %s, %s, 'unsorted') returning id",
            (UNSORTED_LABEL, UNSORTED_TITLE),
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
    scheduled_at: Optional[int] = None
    trigger_source: str = "manual"


_JOB_COLUMNS = (
    "id, status, stage, total_categories, completed_categories, result, error, "
    "created_at, updated_at, scheduled_at, trigger_source"
)


def _row_to_job(r) -> Kb2SynthesisJob:
    return Kb2SynthesisJob(
        id=str(r[0]), status=r[1], stage=r[2], total_categories=r[3],
        completed_categories=r[4], result=r[5], error=r[6],
        created_at=int(r[7]), updated_at=int(r[8]),
        scheduled_at=int(r[9]) if r[9] is not None else None,
        trigger_source=r[10],
    )


def create_job(scheduled_at: Optional[int] = None) -> str:
    """scheduled_at 이 없으면 즉시 실행 job(status='running', 기존 동작), 있으면 예약
    job(status='scheduled') — 폴러가 그 시각 이후에 집어간다."""
    conn = _get_conn()
    with conn.cursor() as cur:
        if scheduled_at is None:
            cur.execute("insert into kb2.synthesis_jobs default values returning id")
        else:
            cur.execute(
                "insert into kb2.synthesis_jobs (status, stage, scheduled_at, trigger_source) "
                "values ('scheduled', 'scheduled', %s, 'scheduled') returning id",
                (scheduled_at,),
            )
        return str(cur.fetchone()[0])


def get_latest_finished_job() -> Optional[Kb2SynthesisJob]:
    """가장 최근에 끝난(done/error) job. 화면 진입 시 지난 회차의 커버리지 계측을
    복원하기 위한 조회(2026-09-11).

    없으면 계측이 사실상 안 보인다 — job 상태는 "실행을 건 탭이 폴링하는 동안"에만
    화면에 있었는데, 정작 기본 실행 경로는 새벽 3시 예약이라 그 탭이 없다."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            f"select {_JOB_COLUMNS} from kb2.synthesis_jobs "
            "where status in ('done', 'error') order by updated_at desc limit 1"
        )
        row = cur.fetchone()
    return _row_to_job(row) if row is not None else None


def get_latest_generation_job() -> Optional[Kb2SynthesisJob]:
    """가장 최근에 **실제로 세대를 적재한** job — 나쁜 회차 가드의 기준선(2026-09-11).

    get_latest_finished_job 과 다른 점이 가드의 요점이다. 그쪽은 error 도 포함하는데,
    가드가 한 번 중단시키면 그 error job 이 '최근'이 된다 — 그걸 기준선으로 삼으면
    coverage 가 없어 비교가 무너지거나, 더 나쁘게는 중단된 회차의 낮은 수치가 기준이
    돼서 그 다음 나쁜 회차를 통과시킨다(가드가 스스로를 무력화한다).

    그래서 status='done' + coverage 계측이 실제로 있는 job 만 본다. 이게 곧 지금 활성
    세대를 만든 회차이고, 나쁜 회차가 덮어쓰려는 대상이다."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            f"select {_JOB_COLUMNS} from kb2.synthesis_jobs "
            "where status = 'done' and result -> 'coverage' is not null "
            "order by updated_at desc limit 1"
        )
        row = cur.fetchone()
    return _row_to_job(row) if row is not None else None


def list_scheduled_jobs() -> list[Kb2SynthesisJob]:
    """아직 실행되지 않은 예약 — 화면에 "예약됨"을 보여주기 위한 조회."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            f"select {_JOB_COLUMNS} from kb2.synthesis_jobs "
            "where status = 'scheduled' order by scheduled_at"
        )
        rows = cur.fetchall()
    return [_row_to_job(r) for r in rows]


def cancel_scheduled_job(job_id: str) -> bool:
    """예약 취소. 이미 실행에 들어갔거나(running) 끝난 job 은 건드리지 않는다 —
    반환값 False 가 "취소하기엔 늦었다"는 뜻."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "update kb2.synthesis_jobs set status = 'cancelled', stage = 'cancelled', "
            "updated_at = (extract(epoch from now()) * 1000)::bigint "
            "where id = %s and status = 'scheduled'",
            (job_id,),
        )
        return cur.rowcount > 0


# 이 시간 넘게 갱신이 없는 running job 은 죽은 것으로 본다.
#
# 값을 고를 때의 기준은 "정상 진행 중 가능한 가장 긴 침묵"보다 넉넉해야 한다는 것
# 하나다 — 짧게 잡으면 살아서 일하는 job 을 죽인다. 즉시 실행 경로에서는 파이프라인이
# background_tasks(별도 스레드)로 돌고 폴러 루프는 계속 순회하므로 리퍼가 자유롭게
# 돈다(예약 경로는 폴러가 to_thread 에서 막혀 있어 이 문제가 없다).
#
# 현재 최장 침묵 후보(모두 심장박동 사이의 단일 구간):
#   · 리듀스 1회: 600s × 재시도 2회 = 20분   ← 가장 김
#   · 분류 배치 실패 후 건별 폴백 20건: 건마다 심장박동을 찍어 해소됨
#   · 합성 1회: 240s × 2 = 8분
# 그래서 20분보다 여유 있게 30분. 죽은 job 이 30분 남는 건 감수한다 — 흔한 경우
# (배포·재시작)는 기동 직후 리퍼가 즉시 걷어가므로 이 값에 걸릴 일이 없다.
STALE_JOB_MS = 30 * 60 * 1000


def reap_stale_running_jobs(*, all_running: bool = False) -> list[str]:
    """죽은 running job 을 error 로 정리하고 정리한 id 들을 돌려준다.

    왜 필요한가: 파이프라인은 백엔드 프로세스 안의 백그라운드 작업이라, 배포
    (`deploy.sh` 가 systemctl restart 한다)나 크래시로 프로세스가 내려가면 **job 은
    'running' 인 채로 영원히 남는다** — 아무도 그걸 running 밖으로 꺼내주지 않는다.
    그러면 화면은 끝나지 않는 "재구조화 중…"을 계속 보여준다.

    all_running=True 는 기동 직후에만 쓴다. 방금 뜬 프로세스 안에서 도는 작업은
    있을 수 없으니, 그 시점의 running 은 정의상 전부 이전 생의 잔해다(전제:
    uvicorn --workers 1. 워커를 늘리면 다른 워커의 살아있는 job 을 죽이므로 이
    호출을 재검토해야 한다). 평소에는 STALE_JOB_MS 침묵 기준으로만 정리한다."""
    conn = _get_conn()
    with conn.cursor() as cur:
        if all_running:
            cur.execute(
                "update kb2.synthesis_jobs set status = 'error', "
                "error = '백엔드가 재시작되어 중단됨(재구조화는 이어서 진행되지 않습니다 — 다시 실행하세요)', "
                "updated_at = (extract(epoch from now()) * 1000)::bigint "
                "where status = 'running' returning id"
            )
        else:
            cur.execute(
                "update kb2.synthesis_jobs set status = 'error', "
                "error = '진행 신호가 끊겨 중단 처리됨(백엔드 재시작 또는 호출 지연). 다시 실행하세요.', "
                "updated_at = (extract(epoch from now()) * 1000)::bigint "
                "where status = 'running' and updated_at < %s returning id",
                (int(time.time() * 1000) - STALE_JOB_MS,),
            )
        return [str(r[0]) for r in cur.fetchall()]


def claim_due_scheduled_job(now_ms: int) -> Optional[str]:
    """만기된 예약 하나를 원자적으로 집어(running 전환) id 를 돌려준다. 없으면 None.
    단일 update…where status='scheduled' 라 폴러가 두 번 겹쳐 돌아도(또는 훗날 워커가
    늘어도) 같은 job 을 두 번 실행하지 않는다 — 조건이 안 맞으면 rowcount 0."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(
            "update kb2.synthesis_jobs set status = 'running', stage = 'discovering_categories', "
            "updated_at = (extract(epoch from now()) * 1000)::bigint "
            "where id = ("
            "  select id from kb2.synthesis_jobs "
            "   where status = 'scheduled' and scheduled_at <= %s "
            "   order by scheduled_at limit 1 for update skip locked"
            ") returning id",
            (now_ms,),
        )
        row = cur.fetchone()
    return str(row[0]) if row else None


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
        cur.execute(f"select {_JOB_COLUMNS} from kb2.synthesis_jobs where id = %s", (job_id,))
        row = cur.fetchone()
    return _row_to_job(row) if row is not None else None


# ── kb2.sentences ────────────────────────────────────────────────────────────

_SENTENCE_COLS = (
    "id, document_id, order_index, content, source_passage_ids, attribution, "
    "locked_by_auditor, version, created_at, updated_at, locked_by, lock_acquired_at, status"
)


def _row_to_sentence(r) -> Kb2Sentence:
    return Kb2Sentence(
        id=str(r[0]), document_id=str(r[1]), order_index=r[2], content=r[3],
        source_passage_ids=[str(x) for x in (r[4] or [])],
        attribution=list(r[5] or []), locked_by_auditor=bool(r[6]),
        version=r[7], created_at=int(r[8]), updated_at=int(r[9]),
        locked_by=r[10], lock_acquired_at=int(r[11]) if r[11] is not None else None,
        status=r[12],
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
    editor_type: str = "system_synthesis",
) -> str:
    """문장 insert + 같은 attribution 으로 sentence_versions v1 기록.

    editor_type 을 받는 이유(0025): '기타'에 담기는 건 합성 결과가 아니라 **원문 그대로**
    라서 'system_synthesis' 로 기록하면 이력이 거짓말을 한다. 그 문장이 나중에 진짜
    세목으로 옮겨지면 이력만이 출처를 말해준다."""
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
            values (%s, 1, %s, %s::jsonb, %s, %s)
            """,
            (sentence_id, content, json.dumps(attribution), editor_type, editor_id),
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


def set_sentence_status(
    sentence_id: str, status: str, editor_id: str, reason: str,
) -> Optional[Kb2Sentence]:
    """연결 끊기/재연결(배선실 재연결 패턴을 kb2.sentences 에 적용) — 삭제 아님, status만
    전환하고(retired 는 kb2.match_sentences 검색에서 빠짐) sentence_versions 에
    editor_type='retired'|'reconnected' + meta.reason 으로 사유를 남긴다(누가 왜 끊었는지
    추적 가능해야 한다는 요구사항, rag.passages 의 set_status 와 달리 사유 필수)."""
    editor_type = "retired" if status == "retired" else "reconnected"
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute("select content, attribution from kb2.sentences where id = %s", (sentence_id,))
        before = cur.fetchone()
        if before is None:
            return None
        content, attribution = before[0], list(before[1] or [])

        cur.execute(
            f"""
            update kb2.sentences set
              status = %s, version = version + 1,
              updated_at = (extract(epoch from now()) * 1000)::bigint
            where id = %s
            returning {_SENTENCE_COLS}
            """,
            (status, sentence_id),
        )
        row = cur.fetchone()
        if row is None:
            return None
        meta = json.dumps({"reason": reason})
        cur.execute(
            """
            insert into kb2.sentence_versions
              (sentence_id, version_no, content, attribution_snapshot, editor_type, editor_id, meta)
            values (%s, %s, %s, %s::jsonb, %s, %s, %s::jsonb)
            """,
            (sentence_id, row[7], content, json.dumps(attribution), editor_type, editor_id, meta),
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
