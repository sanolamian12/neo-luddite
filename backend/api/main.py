"""
Seam A — FastAPI service exposing POST /api/chat (docs API 계약 §2.4).

Run (from backend/):
    pip install -r requirements-api.txt
    cp .env.example .env   # fill UPSTAGE_API_KEY
    uvicorn api.main:app --reload --port 8787

Frontend calls this via NEXT_PUBLIC_API_BASE or a Next.js rewrite proxy.
"""

from __future__ import annotations

import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# load backend/.env before anything reads UPSTAGE_API_KEY
load_dotenv(os.path.join(os.path.dirname(__file__), os.pardir, ".env"))

from api import pipeline  # noqa: E402  (import after load_dotenv)
from api.schema import (  # noqa: E402
    ChatRequest,
    ChatResponse,
    IngestFeedbackRequest,
    IngestFeedbackResponse,
    IngestedPassage,
)

app = FastAPI(title="Neo-Luddite Seam A — /api/chat", version="0.1.0")

# dev CORS: Next.js dev server. Tighten for production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "service": "seam-a", "model": os.environ.get("UPSTAGE_CHAT_MODEL", "solar-pro3")}


@app.get("/rag/health")
def rag_health() -> dict:
    """RAG 뼈대 상태 — KB 크기·설정 확인(임팩트 측정 전 baseline 점검)."""
    from api.rag import retriever, store

    configured = store.is_configured()
    kb_size = None
    if configured:
        try:
            kb_size = store.count()
        except Exception as exc:  # noqa: BLE001
            kb_size = f"error: {exc}"
    return {"ragEnabled": retriever.rag_enabled(), "dbConfigured": configured, "kbPassages": kb_size}


# response_model_exclude_none: Optional 필드(framework·citations·uiBlocks·note 등)를
# null 로 직렬화하지 않고 생략 → 프론트 Zod `.optional()`(undefined-만 허용)과 정합.
@app.post("/api/rag/ingest", response_model=IngestFeedbackResponse)
def ingest_feedback_batch(req: IngestFeedbackRequest) -> IngestFeedbackResponse:
    """검수 확정 write-path — accepted 코멘트 C(+질문A/답변B) 를 KB 로 적재.

    · 멱등: dedupe_key=feedback:<id> (재확정/재적재 안전, 재임베딩 반영).
    · Graceful: DB 미설정이면 적재를 건너뛰고 skipped 로 알린다(검수 확정은 프론트에서
      이 호출과 무관하게 이미 성공 — RAG 가 없어도 루프는 계속). Upstage/DB 장애는 예외로
      올려 프론트가 로깅·재시도 판단.
    """
    from api.rag import ingest, store

    if not store.is_configured():
        return IngestFeedbackResponse(ingested=[], skipped=len(req.items), dbConfigured=False)

    out: list[IngestedPassage] = []
    for item in req.items:
        passage_id = ingest.ingest_feedback(
            feedback_id=item.feedbackId,
            conversation_id=item.conversationId,
            segment_id=item.segmentId,
            question=item.question,
            answer_segment=item.answerSegment,
            comment=item.comment,
            reviewer=item.reviewer,
            tags=item.tags,
            occupation=item.occupation,
            tax_category=item.taxCategory,
            case_refs=item.caseRefs,
        )
        out.append(IngestedPassage(feedbackId=item.feedbackId, passageId=passage_id))
    return IngestFeedbackResponse(ingested=out, skipped=0, dbConfigured=True)


@app.post("/api/chat", response_model=ChatResponse, response_model_exclude_none=True)
def chat(req: ChatRequest, rag: bool | None = None) -> ChatResponse:
    # `?rag=false` → RAG off 로 baseline 응답(A/B 임팩트 측정). 미지정 시 RAG_ENABLED env.
    if req.occupation == "clinic":
        return pipeline.run_clinic(req.conversationId, req.history, req.userInput.text,
                                   rag_override=rag)
    return pipeline.run_coming_occupation(req.conversationId, req.history, req.occupation)
