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

import re

import os

import clinic_expense_engine as eng
from api import engine_adapter as adapter
from api import llm
from api.rag import get_retriever
from api.schema import ChatMeta, ChatResponse, Message, Segment

# ③ 판례 사건번호 정규식 — 이제 RAG 의 보조(엔진 근거 안의 직접 인용)일 뿐.
# 실 그라운딩은 get_retriever()(rag.passages 벡터 검색)가 담당(마스터 §5 step4).
_CASE_REF = re.compile(r"조심\s?\d{4}[가-힣]{1,2}\d+")


def _rag_top_k() -> int:
    return int(os.environ.get("RAG_TOP_K", "5"))


def _next_order(history: list[Message]) -> int:
    return (max((m.order for m in history), default=0)) + 1


def _clean_segment_dicts(raw: list[dict], message_id: str) -> list[Segment]:
    """Assign deterministic ids (A-3) and coerce LLM output into Segment models."""
    segments: list[Segment] = []
    for i, s in enumerate(raw):
        text = (s.get("text") or "").strip()
        if not text:
            continue
        framework = s.get("framework") or None
        citations = [c for c in (s.get("citations") or []) if c] or None
        segments.append(Segment(
            id=f"{message_id}_s{len(segments)}",
            text=text,
            type=s.get("type") or "context",
            framework=framework,
            citations=citations,
        ))
    if not segments:  # never return an empty-segment message (schema requires ≥1)
        segments.append(Segment(id=f"{message_id}_s0",
                                text="죄송합니다. 답변을 생성하지 못했습니다.", type="caveat"))
    return segments


def run_clinic(conversation_id: str, history: list[Message], user_text: str,
               rag_override: bool | None = None) -> ChatResponse:
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
        return ChatResponse(
            message=msg,
            meta=ChatMeta(engine="clinic_expense_engine", extracted=extracted or None,
                          followUp=True),
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
        retriever = get_retriever(force_enabled=rag_override)
        passages = retriever.retrieve(user_text, k=_rag_top_k(), occupation="clinic")
        case_refs = sorted({ref for p in passages for ref in p.case_refs})

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
            return ChatResponse(
                message=Message(id=message_id, role="assistant", order=order, segments=[seg]),
                meta=ChatMeta(engine="clinic_expense_engine", extracted=extracted,
                              ragHits=0, followUp=True),
            )

        # 선례 있음 — 판정 대신 자문. 선두 caveat 은 LLM 이 아니라 여기서 결정적으로 박는다
        # (모델이 면책 문구를 빠뜨려도 "판정이 아님"은 반드시 화면에 남아야 한다).
        raw = [{"text": f"{lead}. 다만 유사 사례에서 세무사들이 남긴 검수 의견을 근거로 "
                        "참고 의견을 드립니다.", "type": "caveat"}]
        raw += llm.write_advisory(history, user_text, etype, [p.content for p in passages])
        segments = _clean_segment_dicts(raw, message_id)
        return ChatResponse(
            message=Message(id=message_id, role="assistant", order=order, segments=segments),
            meta=ChatMeta(engine="clinic_expense_engine", extracted=extracted,
                          ragCaseRefs=case_refs, ragHits=len(passages),
                          followUp=False, advisory=True),
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
        return ChatResponse(
            message=msg,
            meta=ChatMeta(engine="clinic_expense_engine", extracted=extracted, followUp=True),
        )

    # ② engine (authoritative verdict)
    profile, expense = adapter.to_engine_inputs(extracted)
    result: eng.ExpenseResult = eng.evaluate(profile, expense)

    # ③ RAG 검색 — 세무사 코멘트(C)/판례 KB 벡터 검색이 정규식 스텁을 대체.
    #    KB 가 비면(제품 출발 상태) passages=[] → 스텁 refs 만으로 graceful.
    retriever = get_retriever(force_enabled=rag_override)
    passages = retriever.retrieve(user_text, k=_rag_top_k(), occupation="clinic")
    stub_refs = _CASE_REF.findall(result.근거)
    rag_refs = [ref for p in passages for ref in p.case_refs]
    case_refs = sorted(set(stub_refs) | set(rag_refs))

    # ④ segments (LLM prose grounded on ②③ — 엔진 판정 + RAG 지식)
    raw = llm.write_segments(
        user_text=user_text,
        verdict_label=result.verdict.value,
        reason=result.근거,
        accepted_won=result.인정금액,
        amount=expense.amount,
        evidences=result.필요증빙,
        case_refs=case_refs,
        rag_passages=[p.content for p in passages] or None,
    )
    segments = _clean_segment_dicts(raw, message_id)

    # ⑤ uiBlocks (deterministic)
    card, checklist = adapter.result_to_ui_blocks(result, expense.amount)
    ui_blocks = [card] + ([checklist] if checklist else [])

    # ⑥ assemble
    msg = Message(id=message_id, role="assistant", order=order,
                  segments=segments, uiBlocks=ui_blocks)
    return ChatResponse(
        message=msg,
        meta=ChatMeta(engine="clinic_expense_engine", extracted=extracted,
                      ragCaseRefs=case_refs, ragHits=len(passages), followUp=False),
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
    return ChatResponse(
        message=Message(id=message_id, role="assistant", order=order, segments=[seg]),
        meta=ChatMeta(followUp=True),
    )
