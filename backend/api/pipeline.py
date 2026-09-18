"""
Seam A hybrid pipeline — the heart of the product (docs API 계약 §2.5).

    history + userInput
       │  ① Solar function-calling → extract ClinicProfile / ExpenseInput
       │     required missing? → follow-up Message (no verdict) ─── return
       │     엔진 규칙 밖(etype='기타')? → RAG 자문 Message (판정·uiBlocks 없음) ─── return
       │  ② clinic_expense_engine.evaluate() → ExpenseResult   (deterministic)
       │  ③ case refs from engine 근거          (RAG proper = follow-up, §5 step4)
       │  ④ Solar writes segments grounded on ②③ (natural-language argument)
       │  ⑤ ExpenseResult → verdict_card + evidence_checklist  (deterministic)
       │  ⑥ assemble assistant Message (A-3 id rules) → return
"""

from __future__ import annotations

import logging
import re

import os

import clinic_expense_engine as eng
from api import engine_adapter as adapter
from api import llm
from api import numeric_guard
from api.rag import get_retriever
from api.rag.retriever import FusionRetriever, NullRetriever
from api.schema import ChatMeta, ChatResponse, Message, Segment

log = logging.getLogger("api.pipeline")

# ③ 판례 사건번호 정규식 — 이제 RAG 의 보조(엔진 근거 안의 직접 인용)일 뿐.
# 실 그라운딩은 get_retriever()(rag.passages 벡터 검색)가 담당(마스터 §5 step4).
_CASE_REF = re.compile(r"조심\s?\d{4}[가-힣]{1,2}\d+")


def _rag_top_k() -> int:
    return int(os.environ.get("RAG_TOP_K", "5"))


def _rag_source_label(retriever, passages) -> str:
    """meta.ragSource / chat_turns.rag_source 값. fusion 결과는 코퍼스가 섞여 있어
    passages[0] 하나로 추정하면 1위가 kb2 냐에 따라 'kb2'/'rag' 로 오기록된다 — 그래서
    검색기 종류로 먼저 가른다. 그 외 갈래는 종전 규칙 그대로."""
    if not passages:
        return "none"
    if isinstance(retriever, FusionRetriever):
        return "fusion"
    return "kb2" if passages[0].source_kind == "kb2" else "rag"


def _corpus_distribution(passages) -> tuple[dict[str, int], list[dict]]:
    """근거의 코퍼스 분포 — (개수, 원시 목록). meta 와 rag.chat_turns 가 함께 쓴다(0033).

    `ragSource` 는 "어느 검색기를 탔나"만 말한다. fusion 은 코퍼스가 섞여 있어서, 근거가
    실제로 어느 층에서 왔는지는 그 값으로 알 수 없었다 — P3P4 프로덕션 스모크가 여기서
    막혔다(기록 §3). 개수만이 아니라 원시 목록을 함께 남기는 이유는 0027 주석 그대로다:
    지표는 나중에 바뀌지만 원시값은 그대로 쓸 수 있다.

    rank 는 **프롬프트에 박힌 순서**(1-based)다 — 융합·정렬이 끝난 최종 자리라, 나중에
    "몇 번째 근거를 모델이 따라갔나"를 답변과 맞춰볼 수 있다. 본문은 싣지 않는다(원본
    테이블에 있고, 복사하면 같은 지식이 두 곳에서 갈라진다)."""
    counts: dict[str, int] = {}
    raw: list[dict] = []
    for rank, p in enumerate(passages or [], start=1):
        corpus = p.corpus or "unknown"
        counts[corpus] = counts.get(corpus, 0) + 1
        raw.append({
            "corpus": corpus,
            "sourceKind": p.source_kind,
            "score": round(float(p.score), 4),
            "rank": rank,
            "id": p.id,
        })
    return counts, raw


def _number_sources(history: list[Message], user_text: str, passages: list,
                    engine_block: str = "") -> tuple[list[str], list[str]]:
    """numeric_guard 의 출처 (sources, derive_from) — P8 C.

    sources 는 모델이 본 것 중 수치의 근거가 될 수 있는 것 전부, derive_from 은 그중 **이 사안의**
    수(사용자 발화·엔진 판정) — 산술 피연산자는 여기서만 뽑는다(근거는 남의 사안이다).
    이전 턴은 **사용자 발화만** 넣는다: 앞선 답변의 수가 날조였다면 그걸 근거로 되살리면 안 된다."""
    from api.prompts import load_norms

    own = [user_text, engine_block] + [s.text for m in history if m.role == "user" for s in m.segments]
    return own + [load_norms() or ""] + [p.content for p in passages or []], own


def _next_order(history: list[Message]) -> int:
    return (max((m.order for m in history), default=0)) + 1


def _clean_segment_dicts(raw: list[dict], message_id: str) -> list[Segment]:
    """Assign deterministic ids (A-3) and coerce LLM output into Segment models.

    같은 문장이 다시 나오면 버린다. solar-pro3 도구 출력이 가끔 반복 루프에 빠진다 — 한 문장 ×65,
    네 문장 ×26 (2026-09-17 로컬, 자문 경로 24회 중 1~4회 · 09-16 프로덕션 7문장 ×4). 원인
    치료가 아니라 화면 보호용 가드이고, 빈도를 볼 수 있게 버린 개수를 로그로 남긴다."""
    segments: list[Segment] = []
    seen: set[str] = set()
    dropped = 0
    for i, s in enumerate(raw):
        text = (s.get("text") or "").strip()
        if not text:
            continue
        if text in seen:
            dropped += 1
            continue
        seen.add(text)
        framework = s.get("framework") or None
        citations = [c for c in (s.get("citations") or []) if c] or None
        segments.append(Segment(
            id=f"{message_id}_s{len(segments)}",
            text=text,
            type=s.get("type") or "context",
            framework=framework,
            citations=citations,
        ))
    if dropped:
        log.warning("segment 반복 제거 %d건 (남은 %d) — %s", dropped, len(segments), message_id)
    if not segments:  # never return an empty-segment message (schema requires ≥1)
        segments.append(Segment(id=f"{message_id}_s0",
                                text="죄송합니다. 답변을 생성하지 못했습니다.", type="caveat"))
    return segments


def _recorded(resp: ChatResponse, conversation_id: str, occupation: str, outcome: str,
              rag_requested: str | None, rag_searched: bool | None,
              etype: str | None = None) -> ChatResponse:
    """응답을 그대로 돌려주면서 G3 계측을 한 줄 남긴다(2026-09-12, 마이그레이션 0027).

    각 return 자리마다 outcome 을 **손으로** 붙인다. meta 만 보고 갈래를 되추론하지
    않는 이유는, `followUp=True` 가 서로 성격이 다른 세 갈래에서 나오기 때문이다 —
    필수정보 부족·결정변수 부족은 RAG 와 무관하고 '선례 없음'만 G3 의 지표다. 되추론은
    그 셋을 한 덩어리로 만들어 지표를 조용히 오염시킨다.

    rag_searched 는 이 자리에서 판정하지 않고 넘겨받는다 — 검색을 아예 안 탄 갈래
    (되묻기)에서는 retriever 를 만들지 않으므로 app_config 를 한 번 더 조회하게 되는데,
    계측 때문에 사용자 경로에 DB 왕복을 더하지는 않는다. 그런 갈래는 **None 으로 남긴다**
    (0027 주석: 'RAG 를 껐다'와 '검색 단계에 도달 못 했다'는 다른 사실이다)."""
    from api.rag import store

    meta = resp.meta
    store.record_chat_turn(
        conversation_id=conversation_id,
        message_id=resp.message.id,
        occupation=occupation,
        outcome=outcome,
        rag_searched=rag_searched,
        rag_source=meta.ragSource,
        rag_requested=rag_requested,
        rag_hits=meta.ragHits,
        follow_up=meta.followUp,
        advisory=meta.advisory,
        etype=etype,
        # 0033 — meta 에 실린 값을 그대로 넘긴다(계측이 제 손으로 다시 계산하면 화면에 간
        # 분포와 DB 에 남은 분포가 갈라질 수 있다). 검색 미도달 갈래는 None → null.
        rag_corpus_counts=meta.ragCorpora,
        rag_passages=meta.ragPassages,
    )
    return resp


CONGESTED_TEXT = "지금 상담 요청이 몰려 답변을 드리지 못했습니다. 잠시 후 같은 질문을 다시 보내 주세요."


def congested_response(conversation_id: str, history: list[Message], occupation: str,
                       rag_source_override: str | None = None) -> ChatResponse:
    """Upstage 호출 줄에서 턴 대기 상한을 넘겼을 때의 응답(P8 B, upstage_gate).

    500 이 아니라 평범한 답변 말풍선이다 — 프론트는 비정상 status 를 오류 배너로 띄운다.
    무한 대기는 타임아웃 멈춤과 체감이 같아서, 기다리게 하는 대신 다시 보내 달라고 한다.
    계측 outcome='congested' — 전시회에서 상한 k 가 모자랐는지 되짚는 자리."""
    order = _next_order(history)
    message_id = f"asst_{conversation_id}_{order}"
    seg = Segment(id=f"{message_id}_s0", text=CONGESTED_TEXT, type="caveat")
    return _recorded(
        ChatResponse(
            message=Message(id=message_id, role="assistant", order=order, segments=[seg]),
            meta=ChatMeta(engine="clinic_expense_engine" if occupation == "clinic" else None,
                          congested=True),
        ),
        conversation_id, occupation, "congested", rag_source_override, None,
    )


def run_clinic(conversation_id: str, history: list[Message], user_text: str,
               rag_override: bool | None = None, rag_source_override: str | None = None) -> ChatResponse:
    order = _next_order(history)
    message_id = f"asst_{conversation_id}_{order}"

    # ① extract
    tool = adapter.build_extraction_tool()
    extracted = llm.extract_engine_inputs(history, user_text, tool) or {}
    if extracted:
        adapter.normalize_etype(extracted)   # '접대비' → '접대성지출' (enum 은 소프트 제약)
    missing = adapter.missing_required(extracted) if extracted else list(adapter.REQUIRED_FOR_VERDICT)

    # 자문 경로는 amount 를 요구하지 않는다. 판정을 안 하니 금액이 무의미하고("고용증대 세액공제
    # 받을 수 있나요?"엔 금액이 없다), 요구하면 추출기가 금액을 지어냈는지에 따라 자문이 나가다
    # 말다 한다. etype 이 규칙 밖이면 amount 미확인은 판정 차단 사유가 아니다.
    if "etype" not in missing and extracted.get("etype") not in adapter.SUPPORTED_ETYPES:
        missing = []

    # follow-up path — insufficient info, no verdict
    if missing:
        raw = llm.write_followup(history, user_text, missing)
        segments = _clean_segment_dicts(raw, message_id)
        msg = Message(id=message_id, role="assistant", order=order, segments=segments)
        return _recorded(
            ChatResponse(
                message=msg,
                meta=ChatMeta(engine="clinic_expense_engine", extracted=extracted or None,
                              followUp=True),
            ),
            conversation_id, "clinic", "missing_inputs", rag_source_override, None,
            etype=extracted.get("etype") if extracted else None,
        )

    # 엔진 규칙 밖(etype='기타' 또는 enum 밖 값) — 판정하지 않는다. 대신 RAG 자문으로 답한다.
    #
    # 엔진 규칙은 9개 지출유형뿐이라 4대보험·세액공제·대손금 등은 판정 자체가 불가능하다.
    # 예전엔 여기서 "미지원"만 안내하고 즉시 return 했다 → 세무사 코멘트로 쌓은 KB 가 통째로
    # 사장됐다(실측: KB 질문의 55%가 이 갈래로 빠짐). 이제 검색을 태워, 유사 선례가 있으면
    # 판정 없는 자문을 준다. 선례가 없으면(=RAG_MIN_SCORE 컷) 종전대로 미지원 안내.
    #
    # ⚠️ 이 경로는 uiBlocks(판정 카드)를 절대 만들지 않는다 — 판정은 엔진만의 권위(마스터 §2).
    if extracted.get("etype") not in adapter.SUPPORTED_ETYPES:
        etype = extracted.get("etype")
        retriever = get_retriever(force_enabled=rag_override, source=rag_source_override)
        # 검색기가 실제로 살아 있었나 — RAG off(?rag=false / admin 토글)든 DB 미설정이든
        # NullRetriever 로 수렴한다. 계측에는 "선례가 없었다"와 "애초에 안 찾아봤다"를
        # 가르는 값이라, ragHits=0 하나로 뭉뚱그리면 G3 지표가 RAG off 회차에 오염된다.
        rag_searched = not isinstance(retriever, NullRetriever)
        passages = retriever.retrieve(user_text, k=_rag_top_k(), occupation="clinic")
        case_refs = sorted({ref for p in passages for ref in p.case_refs})
        rag_source_used = _rag_source_label(retriever, passages)
        # 검색을 탄 갈래는 근거가 0건이어도 {} / [] 를 남긴다 — null(미도달)과 다른 사실이다.
        corpora, corpus_raw = _corpus_distribution(passages)

        lead = (f"'{etype}' 사안은 규칙엔진의 판정 대상이 아닙니다"
                if etype and etype != "기타" else
                "이 사안은 규칙엔진의 판정 대상이 아닙니다")
        if not passages:
            # 선례 없음 — 근거 없이 자신 있게 틀리느니 지원 범위를 밝히는 쪽이 안전하다.
            seg = Segment(
                id=f"{message_id}_s0",
                text=(f"{lead}. 현재 판정을 지원하는 지출 유형은 "
                      f"{', '.join(adapter.SUPPORTED_ETYPES)} 입니다. "
                      "상담하시려는 지출을 이 유형 중 하나로 다시 설명해 주시겠어요?"),
                type="caveat",
            )
            # **G3 의 분자가 바로 이 자리다** — 자문 경로에 들어왔는데 선례가 없어
            # 되묻는 턴. KB2 가 커지면 이 갈래가 advisory 로 넘어가야 하고, 그게
            # "답할 수 있는 범위가 넓어졌다"의 조작적 정의다.
            return _recorded(
                ChatResponse(
                    message=Message(id=message_id, role="assistant", order=order, segments=[seg]),
                    meta=ChatMeta(engine="clinic_expense_engine", extracted=extracted,
                                  ragHits=0, ragSource=rag_source_used,
                                  ragCorpora=corpora, ragPassages=corpus_raw, followUp=True),
                ),
                conversation_id, "clinic", "no_precedent", rag_source_override,
                rag_searched, etype=etype,
            )

        # 선례 있음 — 판정 대신 자문. 선두 caveat 은 LLM 이 아니라 여기서 결정적으로 박는다
        # (모델이 면책 문구를 빠뜨려도 "판정이 아님"은 반드시 화면에 남아야 한다).
        # 근거가 참고 사전(kbdict)뿐이면 "세무사 검수 의견"이라고 말하는 순간 거짓이다(로드맵 P4).
        if any(p.corpus != "kbdict" for p in passages):
            lead_tail = "다만 유사 사례에서 세무사들이 남긴 검수 의견을 근거로 참고 의견을 드립니다."
        else:
            lead_tail = ("다만 일반 세무 용어·법리 자료를 참고해 의견을 드립니다"
                         "(세무사가 이 사안을 확인한 내용은 아닙니다).")
        raw = [{"text": f"{lead}. {lead_tail}", "type": "caveat"}]
        raw += numeric_guard.drop_unsourced_numbers(
            llm.write_advisory(history, user_text, etype, passages),
            *_number_sources(history, user_text, passages), where=f"advisory {message_id}")
        segments = _clean_segment_dicts(raw, message_id)
        # G3 분모의 나머지 한쪽 — 같은 자문 경로에 들어와 선례를 찾아 답한 턴.
        return _recorded(
            ChatResponse(
                message=Message(id=message_id, role="assistant", order=order, segments=segments),
                meta=ChatMeta(engine="clinic_expense_engine", extracted=extracted,
                              ragCaseRefs=case_refs, ragHits=len(passages), ragSource=rag_source_used,
                              ragCorpora=corpora, ragPassages=corpus_raw,
                              followUp=False, advisory=True),
            ),
            conversation_id, "clinic", "advisory", rag_source_override,
            rag_searched, etype=etype,
        )

    # ①-b 결정변수 검증 → 판정 금지 시 되묻기.
    # 엔진 기본값(False / ratio 1.0)은 사용자가 말한 적 없는 사실이다. 그대로 판정하면
    # 추출기가 필드를 채웠는지에 따라 같은 질문이 부인↔조건부로 뒤집힌다(실측). 판정은
    # 오직 대화에서 확인된 사실의 함수여야 한다.
    #   (1) 추출기가 채운 결정변수 중 사용자 발화에 근거 없는 값(날조)을 떨어낸다.
    #   (2) 그러고도 비어 있는 결정변수가 있으면 판정하지 않고 한 번에 되묻는다.
    filled = [k for k in adapter.DECISIVE_FIELDS if extracted.get(k) is not None]
    grounded = set(llm.verify_decisive(history, user_text, filled))
    for k in filled:
        if k not in grounded:
            extracted.pop(k, None)

    undecided = adapter.missing_decisive(extracted, profile_hint=extracted)
    if undecided:
        raw = llm.write_followup(history, user_text, undecided)
        segments = _clean_segment_dicts(raw, message_id)
        msg = Message(id=message_id, role="assistant", order=order, segments=segments)
        # ⚠️ 되묻기지만 **G3 지표가 아니다** — 판정형은 RAG 와 무관하게 결정변수를
        # 되묻는다. 'no_precedent' 와 같은 분모에 넣으면 지표가 오염된다.
        return _recorded(
            ChatResponse(
                message=msg,
                meta=ChatMeta(engine="clinic_expense_engine", extracted=extracted, followUp=True),
            ),
            conversation_id, "clinic", "undecided", rag_source_override, None,
            etype=extracted.get("etype"),
        )

    # ② engine (authoritative verdict)
    profile, expense = adapter.to_engine_inputs(extracted)
    result: eng.ExpenseResult = eng.evaluate(profile, expense)

    # ③ RAG 검색 — 세무사 코멘트(C)/판례 KB 벡터 검색이 정규식 스텁을 대체.
    #    KB 가 비면(제품 출발 상태) passages=[] → 스텁 refs 만으로 graceful.
    retriever = get_retriever(force_enabled=rag_override, source=rag_source_override)
    rag_searched = not isinstance(retriever, NullRetriever)
    passages = retriever.retrieve(user_text, k=_rag_top_k(), occupation="clinic")
    stub_refs = _CASE_REF.findall(result.근거)
    rag_refs = [ref for p in passages for ref in p.case_refs]
    case_refs = sorted(set(stub_refs) | set(rag_refs))
    rag_source_used = _rag_source_label(retriever, passages)
    corpora, corpus_raw = _corpus_distribution(passages)

    # ④ segments (LLM prose grounded on ②③ — 엔진 판정 + RAG 지식)
    raw = llm.write_segments(
        user_text=user_text,
        verdict_label=result.verdict.value,
        reason=result.근거,
        accepted_won=result.인정금액,
        amount=expense.amount,
        evidences=result.필요증빙,
        case_refs=case_refs,
        passages=passages or None,
    )
    # 엔진 블록은 write_segments 가 모델에게 준 것과 같은 수치를 담아야 한다(인정/총액·근거·증빙).
    engine_block = (f"{result.verdict.value} {result.인정금액:,} / {expense.amount:,}원 "
                    f"{result.근거} {' '.join(result.필요증빙)}")
    raw = numeric_guard.drop_unsourced_numbers(
        raw, *_number_sources(history, user_text, passages, engine_block), where=f"verdict {message_id}")
    segments = _clean_segment_dicts(raw, message_id)

    # ⑤ uiBlocks (deterministic)
    card, checklist = adapter.result_to_ui_blocks(result, expense.amount)
    ui_blocks = [card] + ([checklist] if checklist else [])

    # ⑥ assemble
    msg = Message(id=message_id, role="assistant", order=order,
                  segments=segments, uiBlocks=ui_blocks)
    return _recorded(
        ChatResponse(
            message=msg,
            meta=ChatMeta(engine="clinic_expense_engine", extracted=extracted,
                          ragCaseRefs=case_refs, ragHits=len(passages), ragSource=rag_source_used,
                          ragCorpora=corpora, ragPassages=corpus_raw, followUp=False),
        ),
        conversation_id, "clinic", "verdict", rag_source_override, rag_searched,
        etype=extracted.get("etype"),
    )


def run_coming_occupation(conversation_id: str, history: list[Message],
                          occupation: str) -> ChatResponse:
    """Non-clinic occupations have no engine yet (design §2.3). Return a graceful
    'coming soon' assistant message rather than erroring."""
    order = _next_order(history)
    message_id = f"asst_{conversation_id}_{order}"
    seg = Segment(
        id=f"{message_id}_s0",
        text=f"현재 '{occupation}' 직업군 상담은 준비 중입니다. 병의원(clinic) 상담을 먼저 지원합니다.",
        type="caveat",
    )
    return _recorded(
        ChatResponse(
            message=Message(id=message_id, role="assistant", order=order, segments=[seg]),
            meta=ChatMeta(followUp=True),
        ),
        conversation_id, occupation, "unsupported_occupation", None, None,
    )
