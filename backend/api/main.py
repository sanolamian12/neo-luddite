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
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# load backend/.env before anything reads UPSTAGE_API_KEY
load_dotenv(os.path.join(os.path.dirname(__file__), os.pardir, ".env"))

from api import pipeline  # noqa: E402  (import after load_dotenv)
from api.schema import (  # noqa: E402
    ChatRequest,
    ChatResponse,
    ContributionCount,
    ContributionsResponse,
    DedupCheckFeedbackRequest,
    DedupCheckResponse,
    DedupCheckResult,
    DedupCheckSessionEvalRequest,
    DedupMatch,
    DuplicateCluster,
    DuplicateClustersResponse,
    IngestFeedbackRequest,
    IngestFeedbackResponse,
    IngestSessionEvalRequest,
    IngestSessionEvalResponse,
    IngestedPassage,
    IngestedSessionEval,
    PassageInfo,
    PassageNeighbor,
    PassageNeighborsResponse,
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
_CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """미처리 예외를 CORS 헤더가 붙은 JSON 500 으로 변환.

    Starlette 의 기본 500(ServerErrorMiddleware)은 CORSMiddleware 바깥에서 나가 CORS 헤더가
    없다 → 브라우저가 응답을 차단하고 프론트엔 실제 상태 대신 'Failed to fetch'(연결 실패)만
    뜬다. 여기서 Origin 을 되비춰 앞으로는 프론트가 진짜 status/detail 을 보게 한다."""
    origin = request.headers.get("origin")
    headers: dict[str, str] = {}
    if origin and origin in _CORS_ORIGINS:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Vary"] = "Origin"
    return JSONResponse(status_code=500, content={"detail": "internal server error"},
                        headers=headers)


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


@app.post("/api/rag/ingest-session-eval", response_model=IngestSessionEvalResponse)
def ingest_session_eval_batch(req: IngestSessionEvalRequest) -> IngestSessionEvalResponse:
    """정성 평가 write-path — 인정된 세션 총평을 KB 로 적재(검수실(정성 평가) 최종 승인).

    /api/rag/ingest 와 대칭이되 단위가 다르다: 저기는 문장 코멘트 1건, 여기는 세션 총평 1건.
    · 멱등: dedupe_key=session_eval:<id>.
    · Graceful: DB 미설정이면 건너뛰고 skipped 로 알린다(최종 승인 자체는 이미 성공).
    """
    from api.rag import ingest, store

    if not store.is_configured():
        return IngestSessionEvalResponse(ingested=[], skipped=len(req.items), dbConfigured=False)

    out: list[IngestedSessionEval] = []
    for item in req.items:
        passage_id = ingest.ingest_session_eval(
            evaluation_id=item.evaluationId,
            conversation_id=item.conversationId,
            topic=item.topic,
            transcript_digest=item.transcriptDigest,
            qualitative=item.qualitative,
            writing_score=item.writingScore,
            legal_accuracy_score=item.legalAccuracyScore,
            reviewer=item.reviewer,
            auditor_id=item.auditorId,
            occupation=item.occupation,
            tax_category=item.taxCategory,
            case_refs=item.caseRefs,
        )
        out.append(
            IngestedSessionEval(evaluationId=item.evaluationId, passageId=passage_id)
        )
    return IngestSessionEvalResponse(ingested=out, skipped=0, dbConfigured=True)


# ── dedup 사전검토 (검수실 — 인정/거절 결정 전에 미리 임베딩해 기존 KB 와 비교) ─────
# ingest 와 같은 번들 조립 함수를 쓰되 upsert 는 하지 않는다 — "저장하면 뭐가 나올지"를
# 저장 전에 미리 보여줘서, 이미 유사한 지식이 있는 코멘트에 검수자가 실수로 중복 크레딧을
# 승인하는 걸 막는다(2026-08-27). 결정은 여전히 사람이 한다 — 여기서 자동 거절하지 않는다.


@app.post("/api/rag/dedup-check-feedback", response_model=DedupCheckResponse)
def dedup_check_feedback(req: DedupCheckFeedbackRequest) -> DedupCheckResponse:
    from api.rag import embeddings, ingest, store

    if not store.is_configured():
        return DedupCheckResponse(results=[], dbConfigured=False)
    results: list[DedupCheckResult] = []
    for item in req.items:
        content = ingest.build_bundle_text(item.question, item.answerSegment, item.comment, item.tags)
        vec = embeddings.embed_passage(content)
        matches = store.find_similar(vec, k=req.k)
        results.append(DedupCheckResult(
            key=item.feedbackId,
            matches=[
                DedupMatch(
                    id=m.id, content=m.content, sourceKind=m.source_kind,
                    reviewer=m.reviewer, auditorId=m.auditor_id,
                    createdAt=m.created_at, score=m.score,
                )
                for m in matches
            ],
        ))
    return DedupCheckResponse(results=results, dbConfigured=True)


@app.post("/api/rag/dedup-check-session-eval", response_model=DedupCheckResponse)
def dedup_check_session_eval(req: DedupCheckSessionEvalRequest) -> DedupCheckResponse:
    from api.rag import embeddings, ingest, store

    if not store.is_configured():
        return DedupCheckResponse(results=[], dbConfigured=False)
    results: list[DedupCheckResult] = []
    for item in req.items:
        content = ingest.session_eval_bundle_text(
            item.topic, item.transcriptDigest, item.qualitative,
            item.writingScore, item.legalAccuracyScore,
        )
        vec = embeddings.embed_passage(content)
        matches = store.find_similar(vec, k=req.k)
        results.append(DedupCheckResult(
            key=item.evaluationId,
            matches=[
                DedupMatch(
                    id=m.id, content=m.content, sourceKind=m.source_kind,
                    reviewer=m.reviewer, auditorId=m.auditor_id,
                    createdAt=m.created_at, score=m.score,
                )
                for m in matches
            ],
        ))
    return DedupCheckResponse(results=results, dbConfigured=True)


@app.get("/api/rag/passages", response_model=PassagesResponse, response_model_exclude_none=True)
def list_rag_passages(
    conversationId: str | None = None, sourceKind: str | None = None
) -> PassagesResponse:
    """포장실 조회 — RAG 로 실린 데이터셋(대화 귀속 passage)을 provenance·status 와 함께.
    conversationId 주면 그 대화만(상세화면). sourceKind 로 배선실 두 갈래를 가른다
    ('feedback'=문장 단위 / 'session_eval'=정성 평가). DB 미설정이면 빈 목록."""
    from api.rag import store

    if not store.is_configured():
        return PassagesResponse(passages=[], dbConfigured=False)
    rows = store.list_passages(conversation_id=conversationId, source_kind=sourceKind)
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


@app.get(
    "/api/rag/passages/{passageId}/neighbors",
    response_model=PassageNeighborsResponse,
    response_model_exclude_none=True,
)
def rag_passage_neighbors(passageId: str, k: int = 8) -> PassageNeighborsResponse:
    """passage 중심 유사도 이웃(코사인) — auditor KB 지도 상세뷰의 거미줄 근접 노드.
    저장된 edge 가 아니라 조회 시점에 계산(KB 는 flat 벡터 리스트, 2026-08-27 구조 분석).
    DB 미설정이면 빈 이웃."""
    from api.rag import store

    if not store.is_configured():
        return PassageNeighborsResponse(neighbors=[], dbConfigured=False)
    rows = store.neighbors(passageId, k=k)
    return PassageNeighborsResponse(
        neighbors=[
            PassageNeighbor(
                id=r.id, dedupeKey=r.dedupe_key, content=r.content, sourceKind=r.source_kind,
                taxCategory=r.tax_category, occupation=r.occupation,
                feedbackTags=r.feedback_tags, score=r.score,
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


@app.get(
    "/api/rag/duplicate-clusters",
    response_model=DuplicateClustersResponse,
    response_model_exclude_none=True,
)
def rag_duplicate_clusters(threshold: float = 0.85) -> DuplicateClustersResponse:
    """소급 중복 탐지(§3.1) — KB 전체를 훑어 유사도 threshold 이상으로 서로 연결된
    passage 클러스터를 찾는다. dedup 사전검토(위 DedupCheck*)와 달리 신규 유입이 아니라
    **이미 저장된** KB 대상 1회성 배치 조회. 실제 정리(retired)는 이 결과를 admin이 확인한
    뒤 기존 /api/rag/retract 를 그대로 호출해서 한다 — 별도 삭제 경로를 만들지 않는다.
    O(n²) exact scan(§3.2와 같은 비용 구조)이라 KB 규모가 커지면 재검토 필요."""
    from api.rag import store

    if not store.is_configured():
        return DuplicateClustersResponse(clusters=[], threshold=threshold, dbConfigured=False)
    clusters = store.find_duplicate_clusters(threshold=threshold)
    return DuplicateClustersResponse(
        clusters=[
            DuplicateCluster(
                ids=c.ids,
                maxScore=c.max_score,
                passages=[
                    PassageInfo(
                        id=p.id, dedupeKey=p.dedupe_key, content=p.content,
                        sourceKind=p.source_kind, conversationId=p.conversation_id,
                        segmentId=p.segment_id, feedbackId=p.feedback_id,
                        reviewer=p.reviewer, auditorId=p.auditor_id,
                        taxCategory=p.tax_category, occupation=p.occupation,
                        feedbackTags=p.feedback_tags, status=p.status,
                        createdAt=p.created_at, updatedAt=p.updated_at,
                    )
                    for p in c.passages
                ],
            )
            for c in clusters
        ],
        threshold=threshold,
        dbConfigured=True,
    )


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
