"""3자 대화방(고객·세무사·세무사 agent) — agent 답변 (0044, design/세무사에이전트_3자방_설계.md).

브라우저는 "이 메시지에 답해 달라"(트리거 메시지 id)만 말한다. 누가 부를 수 있나·답해도 되나·검색 범위는
전부 여기서 DB 로 확인한다 — 본문 값(expertId 등)은 받지 않는다(남의 게시 사례가 새지 않게, U7).

  claim()  : 토큰 신원 → 방 참여 · 트리거가 이 방의 메시지 · 보낸 역할 ↔ 스위치 → room_agent_runs 선점(PK 가 중복 차단, D1)
  run()    : (백그라운드) 방 메시지 → history → run_clinic(room_mode, 방 세무사의 게시 사례·원칙)
             → 180초 안이면 agent 메시지 1건 · 넘으면 expired(답 버림, D2) → 그 사이 온 자격 메시지가 있으면 최신 것 하나로 한 번 더
연결은 호출마다 새로 연다(백그라운드 스레드와 공유하지 않는다). 서비스 연결이라 auth uid 가 없다 → 0044 트리거가 agent 로 받는다.
"""
from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass
from typing import Optional

import psycopg

from api import llm, pipeline, upstage_gate
from api.rag.kb2_store import _db_url
from api.schema import Message, Segment

log = logging.getLogger(__name__)

DEADLINE_MS = 180_000          # U6 — 사용자 대기 3분과 같은 값
STALE_MS = 185_000             # running 이 이보다 오래면 고아(서버 재시작·마감 초과)로 보고 다시 잡을 수 있다
HISTORY_LIMIT = 20             # U4 — 방 메시지만, 최근 20개
BODY_MAX = 4000                # consultation_messages.body check 와 같다
PRINCIPLES_MAX = 3000
QUESTIONS_MAX = 20
REFS_MAX = 8                   # 방 답 끝 '참고 자료' 줄에 싣는 출처 수
_VOICE = {"clear": "명확하고 차분하게", "warm": "따뜻하고 공감하며", "concise": "짧고 간결하게"}


class RoomAgentError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


@dataclass
class Claim:
    status: str                 # running(이번에 잡음) · busy(방에 다른 run) · 기존 run 상태(running/done/…)
    room_id: str
    trigger_id: str
    attempts: int = 0
    mine: bool = False          # True 면 이 호출이 run() 을 돌려야 한다


def _now() -> int:
    return int(time.time() * 1000)


def _conn():
    return psycopg.connect(_db_url(), autocommit=True)


def _eligible(role: str, customer_on: bool, expert_on: bool) -> bool:
    return (role == "user" and customer_on) or (role == "auditor" and expert_on)


# ── 선점 ─────────────────────────────────────────────────────────────────────────

def claim(room_id: str, trigger_id: str, caller_domain_id: str, retry: bool = False) -> Claim:
    with _conn() as conn, conn.cursor() as cur:
        cur.execute("select viewer_id, expert_id, status, agent_reply_customer, agent_reply_expert"
                    " from public.consultation_rooms where id = %s", (room_id,))
        room = cur.fetchone()
        if not room or caller_domain_id not in (room[0], room[1]):
            raise RoomAgentError(403, "이 채팅방의 참여자만 부를 수 있습니다")
        if room[2] != "open":
            raise RoomAgentError(409, "닫힌 채팅방입니다")
        cur.execute("select sender_role, deleted_at from public.consultation_messages where id = %s and room_id = %s",
                    (trigger_id, room_id))
        msg = cur.fetchone()
        if not msg or msg[1] is not None:
            raise RoomAgentError(404, "이 방의 메시지가 아닙니다")
        if not _eligible(msg[0], room[3], room[4]):
            return Claim("off", room_id, trigger_id)

        now = _now()
        # 고아 running(서버 재시작 등) 정리 — 방당 running 하나 제약을 영영 막지 않게.
        cur.execute("update public.room_agent_runs set status = 'expired', finished_at = %s, error = 'stale'"
                    " where room_id = %s and status = 'running' and started_at < %s", (now, room_id, now - STALE_MS))
        cur.execute("insert into public.room_agent_runs (trigger_message_id, room_id, status, caller_id, started_at)"
                    " values (%s, %s, 'running', %s, %s) on conflict do nothing returning attempts",
                    (trigger_id, room_id, caller_domain_id, now))
        row = cur.fetchone()
        if row:
            return Claim("running", room_id, trigger_id, row[0], mine=True)
        cur.execute("select status, attempts from public.room_agent_runs where trigger_message_id = %s", (trigger_id,))
        existing = cur.fetchone()
        if not existing:
            return Claim("busy", room_id, trigger_id)          # 이 방에 다른 트리거가 도는 중
        if retry and existing[0] in ("failed", "expired"):
            try:
                cur.execute("update public.room_agent_runs set status = 'running', attempts = attempts + 1,"
                            " started_at = %s, finished_at = null, error = null, caller_id = %s"
                            " where trigger_message_id = %s and status in ('failed', 'expired') returning attempts",
                            (now, caller_domain_id, trigger_id))
            except psycopg.errors.UniqueViolation:
                return Claim("busy", room_id, trigger_id)
            row = cur.fetchone()
            if row:
                return Claim("running", room_id, trigger_id, row[0], mine=True)
        return Claim(existing[0], room_id, trigger_id, existing[1])


# ── 실행 ─────────────────────────────────────────────────────────────────────────

def _history(rows: list[tuple], trigger_role: str) -> list[Message]:
    """방 메시지 → run_clinic history(U4). rows = (id, sender_role, body) 시간순, 트리거 제외."""
    out = []
    for i, (_, role, body) in enumerate(rows[-HISTORY_LIMIT:]):
        if role == "user":
            r, text = "user", body
        elif role == "agent":
            r, text = "assistant", body
        elif trigger_role == "user":           # 세무사가 고객에게 직접 한 말 — 상담자 쪽 발화
            r, text = "assistant", f"[세무사 직접 답변] {body}"
        else:                                  # 세무사 응답 ON — 세무사의 앞선 말도 묻는 쪽
            r, text = "user", f"[세무사] {body}"
        out.append(Message(id=f"room_h{i}", role=r, order=i,
                           segments=[Segment(id=f"room_h{i}_s0", text=text, type="context")]))
    return out


# 방에 누가 있는지 — 없으면 solar 가 고객을 "세무사님"이라 불렀다(10/6 밤 하네스, 세무사 발화가 history 에 있을 때).
_ROOM_CONTEXT = {
    "user": ("- 이 대화는 고객(사장님)·담당 세무사·당신(세무사의 AI 상담 도우미)이 함께 있는 채팅방입니다. 지금 질문한 사람은 "
             "**고객**입니다. 고객을 '세무사님'이라고 부르지 마세요. '[세무사 직접 답변]'으로 시작하는 말은 담당 세무사가 고객에게 "
             "직접 한 말이니, 그 내용과 어긋나게 답하지 마세요."),
    "auditor": ("- 이 대화는 고객(사장님)·담당 세무사·당신(세무사의 AI 상담 도우미)이 함께 있는 채팅방입니다. 지금 질문한 사람은 "
                "**담당 세무사**입니다. '[세무사]'로 시작하는 말도 세무사의 말이고, 나머지 user 발화는 고객의 말입니다. "
                "답은 채팅방의 고객도 함께 봅니다."),
}


def agent_profile(agent: Optional[dict], trigger_role: Optional[str] = None) -> tuple[Optional[str], tuple[str, ...]]:
    """스튜디오 Agent JSON → (원칙 블록, 확인 질문들). 세무사가 쓴(또는 그대로 둔) 문장만, 지어내지 않는다.
    trigger_role 을 주면 방 구성 줄을 맨 앞에 붙인다(에이전트 설정이 없어도)."""
    practice = (agent or {}).get("practice") or {}
    policy = practice.get("policy") or {}
    lines = [_ROOM_CONTEXT[trigger_role]] if trigger_role in _ROOM_CONTEXT else []

    def add(label, value):
        value = (value or "").strip()
        if value:
            lines.append(f"- {label}: {value}")

    add("상담 소개", practice.get("introduction"))
    if practice.get("voice") in _VOICE:
        lines.append(f"- 말투: {_VOICE[practice['voice']]}")
    add("다루는 상담", policy.get("scope"))
    if (policy.get("exclusions") or "").strip():
        add("다루지 않는 상담", policy["exclusions"])
        lines.append("- 질문이 '다루지 않는 상담'에 해당하면 답을 쓰지 말고, 이 부분은 세무사님이 직접 답변드린다고만 안내하세요.")
    add("항상 지킬 원칙", policy.get("rules"))
    # D6 — 참여 기준은 v1 에서 프롬프트 문구로만(자동 전환 없음).
    if policy.get("onMissing"):
        lines.append("- 판단에 필요한 사실이 부족하면, 세무사님의 확인이 필요한 부분이라고 밝히세요.")
    if policy.get("onConflict"):
        lines.append("- 자료나 진술이 서로 어긋나면, 세무사님의 확인이 필요한 부분이라고 밝히세요.")
    if policy.get("onException"):
        lines.append("- 일반 원칙의 예외에 해당할 수 있는 사정이 보이면, 세무사님의 확인이 필요한 부분이라고 밝히세요.")
    principles = "\n".join(lines)[:PRINCIPLES_MAX] or None
    questions = tuple(
        q["prompt"].strip()[:300] for q in (practice.get("questions") or [])
        if q.get("enabled") and (q.get("prompt") or "").strip()
    )[:QUESTIONS_MAX]
    return principles, questions


_VERDICT_LABEL = {"전부인정": "전부 인정", "안분인정": "안분 인정", "부인": "부인", "조건부": "조건부 인정"}


def to_text(resp) -> str:
    """응답 → 방 메시지 텍스트(U5). 블록은 버리고, 판정이면 엔진 결과로 한 줄을 앞에 박는다(LLM 아님)."""
    parts = []
    for b in resp.message.uiBlocks or []:
        if getattr(b, "kind", None) == "verdict_card":
            parts.append(f"판정: {_VERDICT_LABEL.get(b.verdict, b.verdict)}")
    parts += [s.text.strip() for s in resp.message.segments if s.text.strip()]
    # 출처 한 줄(S1b, 사용자 10/6) — 세무사가 어떤 근거로 답했는지 보고 필요하면 가르치기로 고친다.
    # 본문을 먼저 자르고 붙인다(길게 쓴 답에서 출처 줄이 잘려 나가지 않게).
    # 배지는 문장당 3개로 줄였으니(_tidy_citations) 방 줄은 응답의 근거 번호 목록(ragCaseRefs)까지 합친다 — 쓴 근거가 빠지지 않게.
    cited = [c for s in resp.message.segments for c in (s.citations or []) if c]
    refs = list(dict.fromkeys(cited + list(getattr(resp.meta, "ragCaseRefs", None) or [])))[:REFS_MAX]
    tail = ("\n\n참고 자료: " + ", ".join(refs))[:600] if refs else ""
    text = "\n\n".join(parts)
    limit = BODY_MAX - len(tail)
    if len(text) > limit:
        cut = text[: limit - 20]
        dot = max(cut.rfind(". "), cut.rfind("다."), cut.rfind("\n"))
        text = (cut[: dot + 2] if dot > limit // 2 else cut).rstrip() + "\n…(이하 생략)"
    return text + tail


def _finish(cur, trigger_id: str, attempts: int, status: str, reply_id: Optional[str] = None,
            error: Optional[str] = None) -> None:
    # attempts 가 같을 때만 — 그 사이 '다시 시도'로 다시 잡혔으면 이 늦은 결과는 아무것도 바꾸지 않는다.
    cur.execute("update public.room_agent_runs set status = %s, finished_at = %s, reply_message_id = %s, error = %s"
                " where trigger_message_id = %s and attempts = %s and status = 'running'",
                (status, _now(), reply_id, error, trigger_id, attempts))


def run(c: Claim, _depth: int = 0) -> None:
    """선점한 run 을 끝까지 돈다(백그라운드). 예외를 밖으로 내지 않는다 — run 행에 남긴다."""
    started = _now()
    try:
        with _conn() as conn, conn.cursor() as cur:
            cur.execute("select expert_id, status from public.consultation_rooms where id = %s", (c.room_id,))
            expert_domain, room_status = cur.fetchone()
            cur.execute("select created_at, sender_role, body from public.consultation_messages where id = %s",
                        (c.trigger_id,))
            trig_at, trig_role, trig_body = cur.fetchone()
            cur.execute("select id, sender_role, body from public.consultation_messages"
                        " where room_id = %s and deleted_at is null and created_at <= %s and id <> %s"
                        " order by created_at", (c.room_id, trig_at, c.trigger_id))
            prior = cur.fetchall()
            cur.execute("select id from public.profiles where domain_id = %s", (expert_domain,))
            r = cur.fetchone()
            expert_uid = str(r[0]) if r else None
            agent = None
            if expert_uid:
                cur.execute("select agent from public.expert_agents where expert_id = %s"
                            " order by is_room_agent desc, created_at asc limit 1", (expert_uid,))
                r = cur.fetchone()
                agent = r[0] if r else None
        if room_status != "open":
            raise RoomAgentError(409, "closed")

        principles, questions = agent_profile(agent, trig_role)
        t1, t2 = llm.AGENT_PRINCIPLES.set(principles), llm.AGENT_QUESTIONS.set(questions)
        try:
            with upstage_gate.turn_budget():
                resp = pipeline.run_clinic(f"room_{c.room_id}", _history(prior, trig_role), trig_body,
                                           agent_expert_id=expert_uid, room_mode=True)
        finally:
            llm.AGENT_PRINCIPLES.reset(t1)
            llm.AGENT_QUESTIONS.reset(t2)
        text = to_text(resp)

        with _conn() as conn, conn.cursor() as cur:
            if _now() - started > DEADLINE_MS:
                _finish(cur, c.trigger_id, c.attempts, "expired", error="deadline")
                return
            cur.execute("select status from public.consultation_rooms where id = %s", (c.room_id,))
            if cur.fetchone()[0] != "open":
                _finish(cur, c.trigger_id, c.attempts, "skipped", error="closed")
                return
            reply_id = f"rmsg-agent-{uuid.uuid4().hex[:16]}"
            cur.execute("insert into public.consultation_messages (id, room_id, sender_id, sender_role, body, created_at)"
                        " values (%s, %s, '-', 'agent', %s, 0)", (reply_id, c.room_id, text or "답변을 만들지 못했습니다."))
            _finish(cur, c.trigger_id, c.attempts, "done", reply_id=reply_id)
    except upstage_gate.UpstageCongested:
        _safe_finish(c, "failed", "congested")
        return
    except Exception as exc:  # noqa: BLE001 — 방 agent 는 부가 기능. 오류는 run 행으로만 알린다.
        log.exception("room agent 실패 room=%s trigger=%s", c.room_id, c.trigger_id)
        _safe_finish(c, "failed", str(exc)[:300])
        return
    if _depth == 0:
        _follow_up(c)


def _safe_finish(c: Claim, status: str, error: str) -> None:
    try:
        with _conn() as conn, conn.cursor() as cur:
            _finish(cur, c.trigger_id, c.attempts, status, error=error)
    except Exception:  # noqa: BLE001
        log.exception("room agent run 행 갱신 실패 trigger=%s", c.trigger_id)


def _follow_up(c: Claim) -> None:
    """도는 사이 온 자격 메시지 — 최신 것 하나로 한 번 더(앞의 것들은 history 로 들어가고 skipped)."""
    try:
        with _conn() as conn, conn.cursor() as cur:
            cur.execute("select agent_reply_customer, agent_reply_expert, status from public.consultation_rooms"
                        " where id = %s", (c.room_id,))
            cust, exp, status = cur.fetchone()
            if status != "open":
                return
            cur.execute("select m.id, m.sender_role, m.sender_id from public.consultation_messages m"
                        " where m.room_id = %s and m.deleted_at is null and m.sender_role in ('user', 'auditor')"
                        "   and m.created_at > (select created_at from public.consultation_messages where id = %s)"
                        "   and not exists (select 1 from public.room_agent_runs r where r.trigger_message_id = m.id)"
                        " order by m.created_at", (c.room_id, c.trigger_id))
            pending = [p for p in cur.fetchall() if _eligible(p[1], cust, exp)]
            if not pending:
                return
            now = _now()
            for mid, _, sender in pending[:-1]:
                cur.execute("insert into public.room_agent_runs (trigger_message_id, room_id, status, caller_id,"
                            " started_at, finished_at, error) values (%s, %s, 'skipped', %s, %s, %s, 'superseded')"
                            " on conflict do nothing", (mid, c.room_id, "server", now, now))
            last_id = pending[-1][0]
        nxt = claim(c.room_id, last_id, _room_member(c.room_id))
        if nxt.mine:
            run(nxt, _depth=1)
    except Exception:  # noqa: BLE001
        log.exception("room agent 후속 실패 room=%s", c.room_id)


def _room_member(room_id: str) -> str:
    with _conn() as conn, conn.cursor() as cur:
        cur.execute("select viewer_id from public.consultation_rooms where id = %s", (room_id,))
        return cur.fetchone()[0]
