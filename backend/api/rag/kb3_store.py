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
                 preview_expert_id: Optional[str] = None,
                 agent_expert_id: Optional[str] = None) -> list[MatchedDocument]:
    """kb3.match_chunks — 청크 코사인 → 문서 단위 top-k.

    세무사 사례 범위(0043): 공용 = 공유 승인분 · agent_expert_id = 그 세무사의 게시분(연결된 대화) ·
    preview_expert_id = 그 세무사의 초안까지(스튜디오 시험칸). 에이전트 인자는 줄 때만 넘긴다 —
    0043 전 DB(인자 4개 함수)에서도 공용 경로는 그대로 돈다."""
    conn = _get_conn()
    with conn.cursor() as cur:
        if agent_expert_id is None:
            cur.execute(
                "select document_id, case_id, corpus, case_number, content, law_articles, tax_category, "
                "source_url, section, score from kb3.match_chunks(%s::vector, %s, %s, %s)",
                (query_embedding, k, corpora, preview_expert_id),
            )
        else:
            cur.execute(
                "select document_id, case_id, corpus, case_number, content, law_articles, tax_category, "
                "source_url, section, score from kb3.match_chunks(%s::vector, %s, %s, %s, %s)",
                (query_embedding, k, corpora, preview_expert_id, agent_expert_id),
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


# ── 세무사 사례(kb3_expert) — 에이전트 스튜디오 (0043, 2026-10-06) ─────────────────────
# 세무사 전용 RAG: 게시분은 그 세무사에게 연결된 대화에만(match_chunks agent_expert_id), 공용 KB 로 보내
# 관리자가 승인하면 모든 챗. 승인 때 크레딧 ledger 행(금액 기획 미정 → 0, kind bonus · source manual).
# 문장은 세무사가 쓴 원문 그대로다(formatted_by='expert', D9 — 외산 모델 미개입).

EXPERT_CORPUS = "kb3_expert"
EXPERT_FIELDS = ("facts", "judgment", "conclusion", "exceptions", "keywords")


class ExpertCaseError(Exception):
    pass


@dataclass
class ExpertCase:
    id: str
    agent_id: str
    local_id: str
    title: str
    facts: str
    judgment: str
    conclusion: str
    exceptions: str
    keywords: str
    publish_state: str
    share_state: Optional[str]
    share_note: Optional[str]
    case_number: Optional[str]
    expert_name: Optional[str]
    updated_at: int


def expert_display_name(expert_id: str) -> str:
    """카드 머리줄에 쓸 세무사 이름 — profiles.display_name → label → '세무사'."""
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute("select coalesce(nullif(display_name, ''), label) from public.profiles where id = %s",
                    (expert_id,))
        r = cur.fetchone()
    return (r[0] if r and r[0] else None) or "세무사"


def expert_case_id(expert_id: str, agent_id: str, local_id: str) -> str:
    return f"expert_{expert_id}_{agent_id}_{local_id}"


def expert_card_content(expert_name: str, title: str, f: dict) -> str:
    """프롬프트·게이트에 들어가는 카드. 머리줄 = 종류·작성자·제목(게이트 _issue_view 가 머리줄 + 앞 300자를 본다)."""
    lines = [f"[세무사 사례 · {expert_name}] {title}", f"사실관계: {f['facts']}", f"판단: {f['judgment']}",
             f"답변: {f['conclusion']}"]
    if f.get("exceptions"):
        lines.append(f"예외: {f['exceptions']}")
    return "\n".join(lines)


def expert_embed_text(title: str, f: dict) -> str:
    """검색 단위 — 사용자는 자기 상황을 말하므로 제목·사실관계·판단·검색어로 찾는다."""
    return "\n".join(x for x in (title, f["facts"], f["judgment"], f.get("keywords") or "") if x)


_CASE_COLS = ["id", "title", "case_number", "card", "publish_state", "share_state", "share_note", "updated_at"]


def _row_to_case(r) -> ExpertCase:
    card = r[3] or {}
    return ExpertCase(
        id=str(r[0]), agent_id=card.get("agent_id", ""), local_id=card.get("local_id", ""), title=r[1],
        facts=card.get("facts", ""), judgment=card.get("judgment", ""), conclusion=card.get("conclusion", ""),
        exceptions=card.get("exceptions", ""), keywords=card.get("keywords", ""), publish_state=r[4],
        share_state=r[5], share_note=r[6], case_number=r[2], expert_name=card.get("expert_name"),
        updated_at=int(r[7]))


def _cols(prefix: str = "") -> str:
    return ", ".join(prefix + c for c in _CASE_COLS)


def save_expert_case(*, expert_id: str, expert_name: str, agent_id: str, local_id: str, title: str,
                     fields: dict, embedding: list[float], embed_text: str) -> ExpertCase:
    """초안 저장(멱등, case_id = 세무사·에이전트·로컬 id). 내용이 바뀌면 게시·공유를 초안으로 되돌린다 —
    승인받은 공용 사례를 관리자 검토 없이 고칠 수 없게. 내용이 같으면 상태를 그대로 둔다."""
    import hashlib

    content = expert_card_content(expert_name, title, fields)
    chash = hashlib.sha1((content + "\x1f" + embed_text).encode("utf-8")).hexdigest()
    case_id = expert_case_id(expert_id, agent_id, local_id)
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute("select content_hash, publish_state, status from kb3.documents where case_id = %s", (case_id,))
        prev = cur.fetchone()
    unchanged = bool(prev and prev[0] == chash and prev[2] == "active")
    state = prev[1] if unchanged else "draft"
    card = {**{k: fields.get(k) or "" for k in EXPERT_FIELDS}, "agent_id": agent_id, "local_id": local_id,
            "expert_name": expert_name}
    doc_id = upsert_document(
        case_id=case_id, corpus=EXPERT_CORPUS, origin="expert_studio",
        case_number=f"세무사사례-{hashlib.sha1(case_id.encode()).hexdigest()[:8]}", title=title,
        tax_law=None, tax_category=None, decision_date=None, decision_type=None, source_url=None,
        law_articles=[], summary=fields.get("conclusion") or None, card=card, content=content,
        formatted_by="expert", format_checks=None, content_hash=chash,
        chunks=[ChunkRow(chunk_index=0, section="expert", content=embed_text, embedding=embedding,
                         content_hash=hashlib.sha1(embed_text.encode("utf-8")).hexdigest())],
        expert_id=expert_id, publish_state=state)
    if not unchanged:
        with conn.cursor() as cur:
            cur.execute("update kb3.documents set share_state = null, share_requested_at = null, "
                        "share_reviewed_at = null, share_reviewed_by = null, share_note = null where id = %s",
                        (doc_id,))
    return get_expert_case(expert_id, doc_id)


def get_expert_case(expert_id: str, doc_id: str) -> ExpertCase:
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(f"select {_cols()} from kb3.documents where id = %s and expert_id = %s "
                    "and corpus = 'kb3_expert' and status = 'active'", (doc_id, expert_id))
        r = cur.fetchone()
    if r is None:
        raise ExpertCaseError("사례를 찾을 수 없습니다")
    return _row_to_case(r)


def list_expert_cases(expert_id: str) -> list[ExpertCase]:
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(f"select {_cols()} from kb3.documents where expert_id = %s and corpus = 'kb3_expert' "
                    "and status = 'active' order by updated_at desc", (expert_id,))
        return [_row_to_case(r) for r in cur.fetchall()]


def set_expert_publish(expert_id: str, doc_id: str, published: bool) -> ExpertCase:
    """게시 = 내 에이전트(연결된 대화)에 반영. 내리면 공용 공유 상태도 지운다(공용에서도 빠진다)."""
    get_expert_case(expert_id, doc_id)
    conn = _get_conn()
    with conn.cursor() as cur:
        if published:
            cur.execute("update kb3.documents set publish_state = 'published', "
                        "updated_at = (extract(epoch from now()) * 1000)::bigint where id = %s", (doc_id,))
        else:
            cur.execute("update kb3.documents set publish_state = 'draft', share_state = null, "
                        "share_requested_at = null, share_reviewed_at = null, share_reviewed_by = null, "
                        "share_note = null, updated_at = (extract(epoch from now()) * 1000)::bigint "
                        "where id = %s", (doc_id,))
    return get_expert_case(expert_id, doc_id)


def request_expert_share(expert_id: str, doc_ids: list[str]) -> list[ExpertCase]:
    """공용 KB 로 보내기 — 게시된 사례만, 이미 대기·승인된 것은 그대로. 거부된 것은 다시 보낼 수 있다."""
    cases = [get_expert_case(expert_id, d) for d in doc_ids]
    unpublished = [c.title for c in cases if c.publish_state != "published"]
    if unpublished:
        raise ExpertCaseError(f"게시한 사례만 공용 KB 로 보낼 수 있습니다: {', '.join(unpublished)}")
    conn = _get_conn()
    with conn.cursor() as cur:
        for c in cases:
            if c.share_state not in ("pending", "approved"):
                cur.execute("update kb3.documents set share_state = 'pending', "
                            "share_requested_at = (extract(epoch from now()) * 1000)::bigint, "
                            "share_reviewed_at = null, share_reviewed_by = null, share_note = null "
                            "where id = %s", (c.id,))
    return [get_expert_case(expert_id, d) for d in doc_ids]


@dataclass
class ShareRequest:
    case: ExpertCase
    expert_id: str
    expert_domain_id: Optional[str]
    requested_at: int
    content: str


def list_share_queue() -> list[ShareRequest]:
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute(f"select {_cols('d.')}, d.expert_id, p.domain_id, d.share_requested_at, d.content "
                    "from kb3.documents d left join public.profiles p on p.id = d.expert_id "
                    "where d.corpus = 'kb3_expert' and d.status = 'active' and d.share_state = 'pending' "
                    "order by d.share_requested_at")
        return [ShareRequest(case=_row_to_case(r[:8]), expert_id=str(r[8]), expert_domain_id=r[9],
                             requested_at=int(r[10] or 0), content=r[11]) for r in cur.fetchall()]


def review_expert_share(doc_id: str, approve: bool, admin_domain_id: str, note: Optional[str] = None) -> dict:
    """관리자 승인·거부. 승인 = 공용 KB3(모든 챗) + 크레딧 ledger 행(금액 기획 미정 → 0) — 한 트랜잭션.
    ledger 는 기존 화면 스키마 그대로(kind bonus · sourceRef manual) — 새 kind 를 넣으면 기여 로그 파싱이 깨진다."""
    import time

    conn = _get_conn()
    now = int(time.time() * 1000)
    with conn.transaction(), conn.cursor() as cur:
        cur.execute("select d.title, d.share_state, p.domain_id from kb3.documents d "
                    "left join public.profiles p on p.id = d.expert_id "
                    "where d.id = %s and d.corpus = 'kb3_expert' and d.status = 'active' for update of d",
                    (doc_id,))
        r = cur.fetchone()
        if r is None:
            raise ExpertCaseError("사례를 찾을 수 없습니다")
        title, state, domain_id = r
        if state != "pending":
            raise ExpertCaseError(f"승인 대기 상태가 아닙니다(현재 {state})")
        cur.execute("update kb3.documents set share_state = %s, share_reviewed_at = %s, share_reviewed_by = %s, "
                    "share_note = %s where id = %s",
                    ("approved" if approve else "rejected", now, admin_domain_id, note, doc_id))
        ledger_id = None
        if approve and domain_id:
            cur.execute("select balance_after from public.ledger_entries where auditor_id = %s "
                        "order by timestamp desc limit 1", (domain_id,))
            last = cur.fetchone()
            ledger_id = f"ledger-kb3share-{doc_id}-{now}"
            memo = f"공용 KB 공유 승인: {title} (크레딧 금액 미정)"
            cur.execute("insert into public.ledger_entries (id, auditor_id, kind, amount, source_ref, "
                        "balance_after, timestamp, note) values (%s, %s, 'bonus', 0, %s::jsonb, %s, %s, %s)",
                        (ledger_id, domain_id, json.dumps({"kind": "manual", "note": memo}, ensure_ascii=False),
                         int(last[0]) if last else 0, now, memo))
    return {"shareState": "approved" if approve else "rejected", "ledgerId": ledger_id}
