"""
v2(LLM1 역할 축소) 파이프라인. 설계 design/LLM1v2_역할축소_구현설계.md §3·§6.

    턴1   LLM1 추출(누락 사실 최대 3, 결정력 순) → 있으면 ask(상위 2) · 없으면 proceed
    턴2~  LLM1 닫힌 대조(물은 사실만) → stated=filled · 모르겠어요=D3 대체 질문 1회 · 남으면 ask
    상한  D4 — 되묻기 2턴 뒤 무조건 진행, 빈 사실은 proceed_with_gap(조건부 답변)
    버튼  "이대로 답변 받기"(ChatRequest.action) → 즉시 proceed_with_gap

턴 간 상태는 되묻기 턴의 assistant `Message.askState` 로 history 를 왕복한다(O-2, 서버 무상태).
**LLM1 은 "충분"을 판정하지 않는다** — 멈춤은 여기 카운터(LLM 없음)가 보장한다.

답변 단계 = LLM2(`api/llm2.py`, 설계 design/W5_LLM2_답변단계_설계.md): 근거 rag·kb3·kbdict(`source="v2"`)로
판정 + 설명. 근거 없는 판정은 llm2 가 코드로 '판정 보류'로 내린다(M1). 엔진은 판정 경로 밖에서
병렬 대조만 한다(M4, `api/engine_contrast.py` — meta.llm2.engine). v1 으로 위임하지 않는 이유:
v1 이 다시 되묻기(missing_inputs/undecided)를 내면 D4 의 종료 보장이 깨진다.

격리 규칙(docs/doing/v2격리_원복설계.md §2): `pipeline.py`·`llm.py`·`handoff.py` 는 고치지 않는다.
계측 outcome 은 v2 전용 값만 쓴다(§5 — 같은 값을 재해석하면 v1 지표가 조용히 섞인다):
  v2_ask · v2_proceed · v2_proceed_with_gap(상한/D3 소진) · v2_proceed_skip(버튼) · v2_handoff_request · v2_congested
"""

from __future__ import annotations

import logging
import os
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeout

# openai SDK 는 client.chat / client.embeddings 를 처음 건드릴 때 모듈을 지연 import 한다. 엔진 대조 스레드와
# 본 스레드가 동시에 처음 건드리면 import 교착(_DeadlockError, 2026-09-27 로컬 스모크)이 난다 — 미리 올려 둔다.
import openai.resources.chat  # noqa: F401,E402
import openai.resources.embeddings  # noqa: F401,E402

from api import engine_contrast, handoff, llm1, llm2, numeric_guard, pipeline
from api.rag import get_retriever
from api.rag.retriever import NullRetriever
from api.schema import AskedFact, AskState, ChatMeta, ChatResponse, Message, Segment

log = logging.getLogger("api.pipeline_agentic")

PIPELINES = ("v1", "v2")

# D4 (회신_정책확정_260924 §1) — 값 재논의 금지.
ASK_PER_TURN = 2
MAX_ASK_TURNS = 2

SKIP_TEXT = "이대로 답변 받기"   # 프론트 버튼 문구와 같다 — 대화 기록에 사용자의 선택이 남는다


def selected(override: str | None) -> str:
    """이 요청이 탈 파이프라인. `?pipeline=` 이 env `CHAT_PIPELINE` 을 이긴다(`?rag=`·`RAG_ENABLED`
    와 같은 모양). 모르는 값은 v1 — 오타 하나로 v2 에 들어가지 않게."""
    raw = (override or os.environ.get("CHAT_PIPELINE") or "v1").strip().lower()
    if raw not in PIPELINES:
        log.warning("알 수 없는 pipeline 값 %r → v1", raw)
        return "v1"
    return raw


# ── 상태 ───────────────────────────────────────────────────────────────────────

def _open_state(history: list[Message]) -> AskState | None:
    """진행 중인 되묻기 — **직전** assistant 가 되묻기 턴일 때만. 답변이 한 번 나가면 상태는 닫힌다.

    `order` 가 아니라 **목록 위치**로 본다. 프론트는 user 에 `history.length`, 서버는 assistant 에
    `max(order)+1` 을 매겨 2턴부터 둘이 같은 order 를 갖는다(9/25 스모크에서 3턴 상태 유실로 드러남).
    목록 순서는 클라이언트 스토어가 append 한 순서라 믿을 수 있다."""
    last = history[-1] if history else None
    if last is None or last.role != "assistant":
        return None
    return last.askState


def _cycle_answers(history: list[Message]) -> list[str]:
    """이번 되묻기 사이클에서 사용자가 준 답(원 질문 뒤). 버튼 문구는 답이 아니므로 뺀다."""
    texts: list[str] = []
    started = False
    for m in history:                    # 목록 순서 — _open_state 와 같은 이유로 order 로 정렬하지 않는다
        if m.role == "assistant":
            started = m.askState is not None
            if not started:
                texts = []
            continue
        if started:
            t = " ".join(s.text for s in m.segments).strip()
            if t and t != SKIP_TEXT:
                texts.append(t)
    return texts


def _llm1_meta(action: str, state: AskState | None, **extra) -> dict:
    out = {"action": action}
    if state is not None:
        out["askTurn"] = state.askTurn
        out["facts"] = [f.model_dump() for f in state.facts]
    out.update({k: v for k, v in extra.items() if v is not None})
    return out


def _gaps(state: AskState | None) -> list[str]:
    return [f.fact for f in (state.facts if state else []) if f.status != "filled"]


def _drop_numeric_facts(history: list[Message], user_text: str, facts: list[str]) -> tuple[list[str], list[str]]:
    """출처 없는 수치가 든 누락 사실을 뺀다 → (남은 것, 뺀 것). 날조 방어(W3 — v1 verify_decisive 의 자리).

    사실 문구가 그대로 되묻기 질문이 된다. 실측(9/25 로컬): "골프 비용이 1인당 5만원 이하인지 여부" —
    사용자도 규범도 말한 적 없는 기준액을 질문으로 단정해 보여 준다. 사실을 고쳐 쓸 결정적 방법이 없어
    통째로 빼고 meta 로 센다(단계 4 에서 빈도를 본다)."""
    sources, own = pipeline._number_sources(history, user_text, [])
    src = numeric_guard._Sources(sources, own)
    kept = [f for f in facts if not src.unsourced(f)]
    dropped = [f for f in facts if f not in kept]
    if dropped:
        log.warning("출처 없는 수치가 든 누락 사실 제외: %s", dropped)
    return kept, dropped


def _apply_check(state: AskState, results: dict[int, str] | None) -> tuple[list[AskedFact], list[int], int]:
    """대조 결과를 상태에 반영 → (갱신된 사실들, D3 대체 질문이 필요한 index, 판정 누락 수).

    대조 범위 = 물었던 사실 + 아직 못 물은(pending) 사실. 목록 밖은 보지 않는다(§3 열린 재추출 금지).
    판정 누락(unjudged)·호출 실패는 '답 없음'으로 둔다 — 틀리면 한 번 더 묻는 쪽이고, D4 가 끝을 보장한다."""
    results = results or {}
    facts = [f.model_copy() for f in state.facts]
    rephrase: list[int] = []
    unjudged = 0
    for i, f in enumerate(facts):
        if f.status not in ("asked", "pending"):
            continue
        status = results.get(i)
        if status is None:
            unjudged += 1
        elif status == "stated":
            f.status = "filled"
        elif status == "unknown" and f.status == "asked":
            if f.rephrased:
                f.status = "unknown"          # D3 소진 — 비운 채 진행
            else:
                rephrase.append(i)
        # missing(또는 pending 의 unknown)은 그대로 — 다음 되묻기 후보
    return facts, rephrase, unjudged


# ── 응답 조립 ──────────────────────────────────────────────────────────────────

def _ids(conversation_id: str, history: list[Message]) -> tuple[int, str]:
    order = pipeline._next_order(history)
    return order, f"asst_{conversation_id}_{order}"


def _ask(conversation_id: str, history: list[Message], user_text: str, question: str,
         facts: list[AskedFact], ask_turn: int, rephrase: set[int], rag_source_override: str | None,
         **meta_extra) -> ChatResponse:
    """되묻기 턴. 결정력 순으로 D3 대체 질문·못 답한 사실·pending 중 상위 2개를 묻는다.
    `handoff.is_stalled` 제외(D4 ↔ STALLED_TURNS): LLM1 되묻기는 정상 동작이라 '막힌 대화' 제안을 붙이지 않는다."""
    order, message_id = _ids(conversation_id, history)
    picks = [i for i, f in enumerate(facts)
             if f.status in ("asked", "pending") or i in rephrase][:ASK_PER_TURN]
    facts = [f.model_copy() for f in facts]
    items = []
    for i in picks:
        again = i in rephrase
        facts[i].status = "asked"
        facts[i].rephrased = facts[i].rephrased or again
        items.append((facts[i].fact, again))
    state = AskState(askTurn=ask_turn, question=question, facts=facts)
    raw = llm1.write_questions(history, user_text, items)
    msg = Message(id=message_id, role="assistant", order=order,
                  segments=pipeline._clean_segment_dicts(raw, message_id), askState=state)
    resp = ChatResponse(message=msg, meta=ChatMeta(
        followUp=True, pipeline="v2",
        llm1=_llm1_meta("ask", state, asked=[f for f, _ in items],
                        rephrased=[f for f, again in items if again] or None, **meta_extra)))
    return pipeline._recorded(resp, conversation_id, "clinic", "v2_ask", rag_source_override, None)


CONTRAST_WAIT = float(os.environ.get("V2_ENGINE_CONTRAST_WAIT", "5"))   # 답이 나온 뒤 대조를 더 기다리는 상한(초)

# 근거 출처 문구 — corpus 별로 조립한다. KB3(판례·질의회신)를 '세무사 검수 의견'이라 부르면 거짓 출처다.
_SOURCE_PHRASE = (("rag", "유사 사례의 세무사 검수 의견"), ("kb3", "판례 요지·국세청 질의회신"),
                  ("kbdict", "일반 세무 용어·법리 자료"))


def _answer_lead(verdict: str, passages) -> str:
    """선두 caveat — LLM 이 아니라 여기서 결정적으로 박는다(모델이 면책을 빠뜨려도 화면에 남게)."""
    present = {("kb3" if (p.corpus or "").startswith("kb3") else
                "kbdict" if p.corpus == "kbdict" else "rag") for p in passages}
    sources = "·".join(ph for key, ph in _SOURCE_PHRASE if key in present)
    last = ord(sources[-1]) - 0xAC00 if sources else -1
    obj = sources + ("을" if 0 <= last < 11172 and last % 28 else "를")   # 받침 있으면 '을'
    if verdict == llm2.WITHHELD:
        return f"아래 내용은 판정이 아니라 참고 의견입니다. {obj} 참고했습니다."
    return (f"아래 판단은 AI 가 {obj} 근거로 낸 것이며, 세무사가 이 사안을 확인한 것은 아닙니다. "
            f"판단: {verdict}.")


def _contrast_result(fut) -> dict:
    try:
        return fut.result(timeout=CONTRAST_WAIT)
    except FuturesTimeout:
        return {"status": "timeout"}
    except Exception as exc:  # noqa: BLE001 — engine_contrast.run 은 스스로 삼키지만 한 겹 더
        return {"status": "failed", "error": type(exc).__name__}


def _answer(conversation_id: str, history: list[Message], user_text: str, state: AskState | None,
            outcome: str, rag_override: bool | None, rag_source_override: str | None,
            skipped: bool = False, **meta_extra) -> ChatResponse:
    """답변 단계 — LLM2 판정 + 설명(W5). 빈 사실(gap)이 있으면 조건부라고 결정적으로 밝힌다."""
    order, message_id = _ids(conversation_id, history)
    gaps = _gaps(state)
    action = "proceed_with_gap" if gaps else "proceed"

    question = state.question if state else user_text
    answers = _cycle_answers(history) + ([] if skipped or state is None else [user_text])
    query = " ".join([question] + answers)

    # 엔진 대조(M4)는 검색·LLM2 와 병렬 — 답을 기다리게 하지 않는다(W5 설계 §5).
    pool = ThreadPoolExecutor(max_workers=1) if engine_contrast.enabled() else None
    contrast = pool.submit(engine_contrast.run, history, user_text) if pool else None

    source = rag_source_override or "v2"     # LLM2 근거 = rag·kb3·kbdict(W5 설계 §2). ?ragSource= 는 비교용
    retriever = get_retriever(force_enabled=rag_override, source=source)
    rag_searched = not isinstance(retriever, NullRetriever)
    passages = retriever.retrieve(query, k=pipeline._rag_top_k(), occupation="clinic")
    case_refs = sorted({ref for p in passages for ref in p.case_refs})
    rag_source_used = ("v2" if source == "v2" and passages else
                       pipeline._rag_source_label(retriever, passages))
    corpora, corpus_raw = pipeline._corpus_distribution(passages)

    gap_lead = (f"다음 사실이 확인되지 않아, 아래 안내는 그 사실에 따라 달라질 수 있는 조건부 의견입니다: "
                f"{', '.join(gaps)}." if gaps else None)
    answer = None
    if not passages:
        raw = ([{"text": gap_lead, "type": "caveat"}] if gap_lead else []) + [{
            "text": ("이 사안은 참고할 선례를 아직 찾지 못해 확정적인 안내를 드리기 어렵습니다. "
                     "세무사와 직접 상담해 보시기를 권합니다."),
            "type": "caveat"}]
        offer_key = "no_precedent"
    else:
        answer = llm2.write_answer(history, question, answers, gaps, passages)
        raw = ([{"text": gap_lead, "type": "caveat"}] if gap_lead else []) + [
            {"text": _answer_lead(answer.verdict, passages), "type": "caveat"}]
        raw += numeric_guard.drop_unsourced_numbers(
            answer.segments,
            *pipeline._number_sources(history, " ".join([question] + answers), passages),
            where=f"v2 answer {message_id}")
        offer_key = "advisory"

    llm2_meta = answer.meta() if answer else None
    if contrast is not None:
        engine = _contrast_result(contrast)
        pool.shutdown(wait=False)
        if answer is not None and engine.get("status") == "compared":
            engine["agree"] = engine["engineVerdict"] == answer.verdict
        llm2_meta = {**(llm2_meta or {}), "engine": engine}
        log.info("v2 엔진 대조 %s", engine)

    blocks, offered = pipeline._offer(history, offer_key)
    msg = Message(id=message_id, role="assistant", order=order,
                  segments=pipeline._clean_segment_dicts(raw, message_id), uiBlocks=blocks)
    resp = ChatResponse(message=msg, meta=ChatMeta(
        ragCaseRefs=case_refs, ragHits=len(passages), ragSource=rag_source_used,
        ragCorpora=corpora, ragPassages=corpus_raw, followUp=False,
        advisory=bool(passages) and (answer is None or answer.verdict == llm2.WITHHELD),
        handoff=offered, pipeline="v2", llm2=llm2_meta,
        llm1=_llm1_meta(action, state, unresolved=gaps or None, skipped=skipped or None, **meta_extra)))
    return pipeline._recorded(resp, conversation_id, "clinic", outcome, rag_source_override, rag_searched)


# ── 진입점 ─────────────────────────────────────────────────────────────────────

def run_clinic(conversation_id: str, history: list[Message], user_text: str,
               rag_override: bool | None = None, rag_source_override: str | None = None,
               action: str | None = None) -> ChatResponse:
    # 세무사 연결 명시 요청 — v1 과 같은 결정적 갈래(Upstage 0회), outcome 만 v2 값.
    if handoff.is_explicit_request(user_text):
        order, message_id = _ids(conversation_id, history)
        seg = Segment(id=f"{message_id}_s0", text=handoff.EXPLICIT_REPLY, type="ack")
        resp = ChatResponse(
            message=Message(id=message_id, role="assistant", order=order, segments=[seg],
                            uiBlocks=[handoff.block("explicit")]),
            meta=ChatMeta(handoff="explicit", pipeline="v2", llm1={"action": "handoff"}))
        return pipeline._recorded(resp, conversation_id, "clinic", "v2_handoff_request",
                                  rag_source_override, None)

    state = _open_state(history)
    rag = dict(rag_override=rag_override, rag_source_override=rag_source_override)

    # 턴1 — 새 질문(열린 되묻기 없음). 추출만 하고 충분 판정 값은 쓰지 않는다.
    if state is None:
        if action:
            log.info("action=%s 무시 — 열린 되묻기 없음", action)
        extracted = llm1.extract_facts(history, user_text)
        missing, numeric = _drop_numeric_facts(history, user_text, extracted or [])
        if not missing:
            return _answer(conversation_id, history, user_text, None, "v2_proceed", **rag,
                           extractFailed=True if extracted is None else None, droppedNumeric=numeric or None)
        facts = [AskedFact(fact=f, status="pending") for f in missing]
        return _ask(conversation_id, history, user_text, user_text, facts, 1, set(),
                    rag_source_override, extracted=extracted, droppedNumeric=numeric or None)

    # 버튼 — 되묻기를 건너뛰고 빈 사실은 비운 채 진행(A1-1). 대조 호출도 하지 않는다.
    if action == "proceed_with_gap":
        return _answer(conversation_id, history, user_text, state, "v2_proceed_skip", **rag, skipped=True)

    # 턴2~ — 물은 사실만 대조.
    to_check = [f.fact for f in state.facts]
    results = llm1.check_asked(history, user_text, to_check)
    facts, rephrase, unjudged = _apply_check(state, results)
    checked = {to_check[i]: s for i, s in (results or {}).items()}
    extra = dict(checked=checked, unjudged=unjudged or None,
                 checkFailed=True if results is None else None)
    after = AskState(askTurn=state.askTurn, question=state.question, facts=facts)

    remaining = [i for i, f in enumerate(facts) if f.status in ("asked", "pending")]
    if not remaining and not rephrase:       # 다 찼거나, 남은 건 D3 소진(unknown)뿐
        return _answer(conversation_id, history, user_text, after,
                       "v2_proceed_with_gap" if _gaps(after) else "v2_proceed", **rag, **extra)
    if state.askTurn >= MAX_ASK_TURNS:       # D4 상한 — 남은 것은 비운 채 진행
        return _answer(conversation_id, history, user_text, after, "v2_proceed_with_gap", **rag,
                       capped=True, **extra)
    return _ask(conversation_id, history, user_text, state.question, facts, state.askTurn + 1,
                set(rephrase), rag_source_override, **extra)


def congested_response(conversation_id: str, history: list[Message],
                       rag_source_override: str | None = None) -> ChatResponse:
    """혼잡 안내(v1 `pipeline.congested_response` 와 같은 문안) — 열린 되묻기 상태를 **그대로 넘긴다**.
    안 넘기면 사용자가 같은 답을 다시 보냈을 때 1턴 추출부터 새로 시작한다."""
    order, message_id = _ids(conversation_id, history)
    seg = Segment(id=f"{message_id}_s0", text=pipeline.CONGESTED_TEXT, type="caveat")
    resp = ChatResponse(
        message=Message(id=message_id, role="assistant", order=order, segments=[seg],
                        askState=_open_state(history)),
        meta=ChatMeta(congested=True, pipeline="v2", llm1={"action": "congested"}))
    return pipeline._recorded(resp, conversation_id, "clinic", "v2_congested", rag_source_override, None)
