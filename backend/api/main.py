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
    ContributionCount,
    ContributionsResponse,
    IngestFeedbackRequest,
    IngestFeedbackResponse,
    IngestedPassage,
    PassageInfo,
    PassagesResponse,
    RagSourceKindCount,
    RagStatsResponse,
    RagStatusResponse,
    RagToggleRequest,
    RetractRequest,
    RetractResponse,
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
            auditor_id=item.auditorId,
            tags=item.tags,
            occupation=item.occupation,
            tax_category=item.taxCategory,
            case_refs=item.caseRefs,
        )
        out.append(IngestedPassage(feedbackId=item.feedbackId, passageId=passage_id))
    return IngestFeedbackResponse(ingested=out, skipped=0, dbConfigured=True)


@app.get("/api/rag/passages", response_model=PassagesResponse, response_model_exclude_none=True)
def list_rag_passages(conversationId: str | None = None) -> PassagesResponse:
    """포장실 조회 — RAG 로 실린 데이터셋(대화 귀속 passage)을 provenance·status 와 함께.
    conversationId 주면 그 대화만(상세화면). DB 미설정이면 빈 목록."""
    from api.rag import store

    if not store.is_configured():
        return PassagesResponse(passages=[], dbConfigured=False)
    rows = store.list_passages(conversation_id=conversationId)
    return PassagesResponse(
        passages=[
            PassageInfo(
                id=r.id, dedupeKey=r.dedupe_key, content=r.content, sourceKind=r.source_kind,
                conversationId=r.conversation_id, segmentId=r.segment_id, feedbackId=r.feedback_id,
                reviewer=r.reviewer, auditorId=r.auditor_id, taxCategory=r.tax_category,
                occupation=r.occupation, feedbackTags=r.feedback_tags, status=r.status,
                createdAt=r.created_at, updatedAt=r.updated_at,
            )
            for r in rows
        ],
        dbConfigured=True,
    )


@app.post("/api/rag/retract", response_model=RetractResponse)
def retract_rag_passages(req: RetractRequest) -> RetractResponse:
    """연결끊기/재연결 — passage status 를 retired/active 로 전환(삭제 아님, 추적 보존).
    retired 는 rag.match_passages 에서 빠져 KB 검색 대상에서 제외된다."""
    from api.rag import store

    if not store.is_configured():
        return RetractResponse(updated=0, dbConfigured=False)
    status = req.status if req.status in ("retired", "active") else "retired"
    n = store.set_status(req.passageIds, status)
    return RetractResponse(updated=n, dbConfigured=True)


@app.get("/api/rag/contributions", response_model=ContributionsResponse)
def rag_contributions(
    periodFrom: int | None = None, periodTo: int | None = None
) -> ContributionsResponse:
    """정산 존속연동 — 세무사별 **살아있는 RAG 기여도**(status='active' passage 수) 집계.

    정산 분배의 파생 기준(메모리 project_operational_flow). 포장실 연결끊기로 passage 가
    retired 되면 그 세무사 기여도가 자동 감소한다 → "버려지면 기여도 소멸"이 저장이 아니라
    이 집계의 파생으로 성립. periodFrom/To(created_at 밀리초 epoch) 주면 그 기간에 생성됐고
    지금도 살아있는 기여만. DB 미설정이면 빈 목록(정산 폼이 '기여 없음'으로 처리)."""
    from api.rag import store

    if not store.is_configured():
        return ContributionsResponse(contributions=[], dbConfigured=False)
    rows = store.contribution_counts(period_from=periodFrom, period_to=periodTo)
    return ContributionsResponse(
        contributions=[
            ContributionCount(auditorId=a, activeCount=c) for a, c in rows
        ],
        dbConfigured=True,
    )


@app.post("/api/rag/toggle", response_model=RagStatusResponse)
def toggle_rag(req: RagToggleRequest) -> RagStatusResponse:
    """전역 RAG on/off — admin 화면 버튼. app_config.rag_enabled(1/0)에 영속 → 다음
    요청부터 rag_enabled() 가 이 값을 읽어 즉시 반영(서버 재시작 불필요). DB 미설정이면
    저장 못 하고 요청값을 에코하되 dbConfigured=false 로 알린다."""
    from api.rag import retriever, store

    if not store.is_configured():
        return RagStatusResponse(ragEnabled=req.enabled, dbConfigured=False)
    store.set_app_config("rag_enabled", 1 if req.enabled else 0)
    return RagStatusResponse(ragEnabled=retriever.rag_enabled(), dbConfigured=True)


@app.get("/api/rag/stats", response_model=RagStatsResponse)
def rag_stats() -> RagStatsResponse:
    """RAG 구성 요약 — 무엇이(source_kind) 얼마나 실렸는지 + 기여 대화/세무사 수 + 현재
    on/off 상태. admin 'RAG' 화면이 소비. DB 미설정이면 0 통계 + dbConfigured=false."""
    from api.rag import retriever, store

    if not store.is_configured():
        return RagStatsResponse(dbConfigured=False, ragEnabled=retriever.rag_enabled())
    s = store.stats()
    return RagStatsResponse(
        dbConfigured=True,
        ragEnabled=retriever.rag_enabled(),
        totalActive=s.total_active,
        totalRetired=s.total_retired,
        conversations=s.conversations,
        auditors=s.auditors,
        bySourceKind=[
            RagSourceKindCount(sourceKind=k, count=c) for k, c in s.by_source_kind
        ],
    )


@app.post("/api/chat", response_model=ChatResponse, response_model_exclude_none=True)
def chat(req: ChatRequest, rag: bool | None = None) -> ChatResponse:
    # `?rag=false` → RAG off 로 baseline 응답(A/B 임팩트 측정). 미지정 시 RAG_ENABLED env.
    if req.occupation == "clinic":
        return pipeline.run_clinic(req.conversationId, req.history, req.userInput.text,
                                   rag_override=rag)
    return pipeline.run_coming_occupation(req.conversationId, req.history, req.occupation)
