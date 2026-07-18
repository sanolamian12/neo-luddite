"""
RAG write path — 세무사 코멘트(C)/KB 문서/판례 → Q+A+C 번들 → embed_passage → upsert.

제품의 심장(메모리 project_rag_product_thesis): 배포(C) 후 세무사가 샘플 ~100개를
검수하며 다는 코멘트가 이 경로로 KB 를 채운다. 하차장→검수→포장실→RAG 루프의 마지막 삽.

번들 형식(검색 단위 = Q+A+C):
    [질문] …사장님 질문 A…
    [AI 답변] …Upstage 답변 B…            (해당 세그먼트만/전체)
    [세무사 코멘트] …사람 C…               ← 실제 지식이 담기는 곳
    (태그: 법적오류 …)
"""

from __future__ import annotations

from typing import Optional

from api.rag import embeddings, store
from api.rag.store import PassageRecord

_TAG_LABELS = {
    "legal_error": "법적 해석 오류",
    "grammar_error": "문법적 오류",
    "suggestion": "제안",
}


def build_bundle_text(
    question: str,
    answer: str = "",
    comment: str = "",
    tags: Optional[list[str]] = None,
    extra: str = "",
) -> str:
    """질문 A + 답변 B + 코멘트 C 를 하나의 임베딩 대상 텍스트로 조립."""
    parts = [f"[질문] {question.strip()}"]
    if answer.strip():
        parts.append(f"[AI 답변] {answer.strip()}")
    if comment.strip():
        parts.append(f"[세무사 코멘트] {comment.strip()}")
    if tags:
        labels = ", ".join(_TAG_LABELS.get(t, t) for t in tags)
        parts.append(f"(태그: {labels})")
    if extra.strip():
        parts.append(extra.strip())
    return "\n".join(parts)


def ingest_feedback(
    *,
    feedback_id: str,
    conversation_id: str,
    segment_id: str,
    question: str,
    answer_segment: str,
    comment: str,
    reviewer: str,
    auditor_id: Optional[str] = None,
    tags: Optional[list[str]] = None,
    occupation: Optional[str] = None,
    tax_category: Optional[str] = None,
    case_refs: Optional[list[str]] = None,
) -> str:
    """line_feedback 한 건(=세무사 코멘트 C) → KB passage. 멱등(feedback:<id>)."""
    content = build_bundle_text(question, answer_segment, comment, tags)
    rec = PassageRecord(
        dedupe_key=f"feedback:{feedback_id}",
        content=content,
        embedding=embeddings.embed_passage(content),
        source_kind="feedback",
        conversation_id=conversation_id,
        segment_id=segment_id,
        feedback_id=feedback_id,
        reviewer=reviewer,
        auditor_id=auditor_id,
        tax_category=tax_category,
        occupation=occupation,
        case_refs=case_refs or [],
        feedback_tags=tags or [],
    )
    return store.upsert(rec)


def ingest_session_eval(
    *,
    evaluation_id: str,
    conversation_id: str,
    topic: str,
    transcript_digest: str,
    qualitative: str,
    writing_score: int,
    legal_accuracy_score: int,
    reviewer: str,
    auditor_id: Optional[str] = None,
    occupation: Optional[str] = None,
    tax_category: Optional[str] = None,
    case_refs: Optional[list[str]] = None,
) -> str:
    """session_evaluations 한 건(=세무사 세션 총평) → KB passage. 멱등(session_eval:<id>).

    문장 단위 코멘트와 무엇이 다른가: 코멘트 C 는 "이 문장이 틀렸다"를 말하고,
    총평은 "이 상담이 전체적으로 왜 부족한가"를 말한다. 후자는 특정 segment 에 걸 수
    없어서 지금까지 RAG 로 흘러들 통로 자체가 없었다(0015 가 그 자리를 만들었다).

    번들 형식은 문장 단위와 대칭:
        [질문] …상담 주제…
        [AI 답변] …상담 요지(발췌)…
        [세무사 코멘트] …총평 원문…
        (평가: 문장력 4/5 · 법률적 정확성 3/5)
    """
    score_line = (
        f"(평가: 문장력 {writing_score}/5 · 법률적 정확성 {legal_accuracy_score}/5)"
    )
    content = build_bundle_text(
        topic,
        transcript_digest,
        qualitative,
        extra=score_line,
    )
    rec = PassageRecord(
        dedupe_key=f"session_eval:{evaluation_id}",
        content=content,
        embedding=embeddings.embed_passage(content),
        source_kind="session_eval",
        conversation_id=conversation_id,
        reviewer=reviewer,
        auditor_id=auditor_id,
        tax_category=tax_category,
        occupation=occupation,
        case_refs=case_refs or [],
        metadata={
            "evaluationId": evaluation_id,
            "scores": {
                "writing": writing_score,
                "legalAccuracy": legal_accuracy_score,
            },
        },
    )
    return store.upsert(rec)


def ingest_kb_document(
    *,
    doc_id: str,
    title: str,
    body: str,
    reviewer: str,
    occupation: Optional[str] = None,
    tax_category: Optional[str] = None,
    case_refs: Optional[list[str]] = None,
) -> str:
    """kb_documents 한 건(세무사 정제 지식) → KB passage. 멱등(kb:<id>)."""
    content = build_bundle_text(title, extra=body)
    rec = PassageRecord(
        dedupe_key=f"kb:{doc_id}",
        content=content,
        embedding=embeddings.embed_passage(content),
        source_kind="kb_document",
        kb_document_id=doc_id,
        reviewer=reviewer,
        tax_category=tax_category,
        occupation=occupation,
        case_refs=case_refs or [],
    )
    return store.upsert(rec)


def ingest_case_seed(case: dict, *, occupation: Optional[str] = None) -> str:
    """backend/data 판례 1건 → 최소 기본 지식 seed passage. 멱등(case:<case_id>).

    시드는 '기본 지식만' — 전량 인덱싱은 임팩트 측정을 무너뜨리므로 하지 않는다
    (메모리 project_rag_product_thesis). 소량 큐레이션만 이 경로로.
    """
    case_id = str(case.get("case_id") or case.get("case_number") or "").strip()
    if not case_id:
        raise ValueError("case_id/case_number 가 없는 판례는 시드할 수 없습니다.")
    title = (case.get("title") or "").strip()
    summary = (case.get("summary") or "").strip()
    content = build_bundle_text(title or case_id, extra=summary)
    case_number = str(case.get("case_number") or "").strip()
    rec = PassageRecord(
        dedupe_key=f"case:{case_id}",
        content=content,
        embedding=embeddings.embed_passage(content),
        source_kind="case_seed",
        case_id=case_id,
        reviewer=None,
        tax_category=(case.get("tax_category") or None),
        occupation=occupation,
        case_refs=[case_number] if case_number else [],
        law_articles=list(case.get("law_articles") or []),
        metadata={
            "decision_type": case.get("decision_type"),
            "agency": case.get("agency"),
            "source_url": case.get("source_url"),
        },
    )
    return store.upsert(rec)
