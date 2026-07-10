"""
Seam A hybrid pipeline — the heart of the product (docs API 계약 §2.5).

    history + userInput
       │  ① Solar function-calling → extract ClinicProfile / ExpenseInput
       │     required missing? → follow-up Message (no verdict) ─── return
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
    missing = adapter.missing_required(extracted) if extracted else list(adapter.REQUIRED_FOR_VERDICT)

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

    # unsupported etype — Solar 가 enum 밖 지출유형(예: '이자비용')을 추출한 경우.
    # function-calling enum 은 소프트 제약이라 발생 가능 → 엔진 규칙이 없으니 크래시(500) 대신
    # 지원 목록을 알려주는 우아한 안내로 전환(제품 흐름 유지, 마스터 §2.3 graceful 패턴).
    if extracted.get("etype") not in adapter.SUPPORTED_ETYPES:
        seg = Segment(
            id=f"{message_id}_s0",
            text=(f"'{extracted.get('etype')}' 항목은 아직 병의원 비용 판정 규칙에 포함되지 않았습니다. "
                  f"현재 지원하는 지출 유형은 {', '.join(adapter.SUPPORTED_ETYPES)} 입니다. "
                  "상담하시려는 지출을 이 유형 중 하나로 다시 설명해 주시겠어요?"),
            type="caveat",
        )
        return ChatResponse(
            message=Message(id=message_id, role="assistant", order=order, segments=[seg]),
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
