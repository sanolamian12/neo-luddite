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

import clinic_expense_engine as eng
from api import engine_adapter as adapter
from api import llm
from api.schema import ChatMeta, ChatResponse, Message, Segment

# ③ RAG stub: pull case-decision refs out of the engine 근거 text.
# Proper Upstage-embedding RAG over backend/data replaces this (design §5 step4).
_CASE_REF = re.compile(r"조심\s?\d{4}[가-힣]{1,2}\d+")


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


def run_clinic(conversation_id: str, history: list[Message], user_text: str) -> ChatResponse:
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

    # ② engine (authoritative verdict)
    profile, expense = adapter.to_engine_inputs(extracted)
    result: eng.ExpenseResult = eng.evaluate(profile, expense)

    # ③ case refs (RAG stub)
    case_refs = sorted(set(_CASE_REF.findall(result.근거)))

    # ④ segments (LLM prose grounded on ②③)
    raw = llm.write_segments(
        user_text=user_text,
        verdict_label=result.verdict.value,
        reason=result.근거,
        accepted_won=result.인정금액,
        amount=expense.amount,
        evidences=result.필요증빙,
        case_refs=case_refs,
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
                      ragCaseRefs=case_refs, followUp=False),
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
