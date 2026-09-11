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
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, Request
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
    CreateKb2DocumentRequest,
    CreateKb2DocumentResponse,
    CreateKb2GroupRequest,
    CreateKb2GroupResponse,
    Kb2AutoGroupResponse,
    Kb2CategorySynthesisResult,
    Kb2DocumentInfo,
    Kb2DocumentsResponse,
    Kb2GroupInfo,
    Kb2GroupsResponse,
    Kb2JobInfo,
    Kb2LockRequest,
    Kb2LockResponse,
    SetKb2SentenceStatusRequest,
    SetKb2SentenceStatusResponse,
    Kb2RestructureJobResponse,
    Kb2RestructureStartResponse,
    Kb2SentenceInfo,
    Kb2SentenceSourcesResponse,
    Kb2SentenceVersionInfo,
    Kb2SentenceVersionsResponse,
    Kb2SentencesResponse,
    Kb2SourcePassage,
    Kb2SynthesizeResponse,
    MoveKb2SentenceRequest,
    MoveKb2SentenceResponse,
    PassageEdge,
    PassageEdgesResponse,
    PassageEdit,
    PassageEditsResponse,
    PassageInfo,
    PassageNeighbor,
    PassageNeighborsResponse,
    PassagesResponse,
    ProposeEditRequest,
    ProposeEditResponse,
    RagSourceKindCount,
    RagStatsResponse,
    RagStatusResponse,
    RagToggleRequest,
    ReclassifyTaxCategoriesResponse,
    RebuildEdgesResponse,
    RetractRequest,
    RetractResponse,
    SearchPreviewMatch,
    SearchPreviewRequest,
    SearchPreviewResponse,
    CancelKb2ScheduleResponse,
    DeleteKb2GroupResponse,
    Kb2ScheduledJobsResponse,
    SetKb2DocumentStatusRequest,
    RenameKb2DocumentRequest,
    StartKb2RestructureRequest,
    ReviewEditRequest,
    ReviewEditResponse,
    SetKb2DocumentGroupRequest,
    UpdateKb2DocumentResponse,
    UpdateKb2SentenceRequest,
    UpdateKb2SentenceResponse,
)

@asynccontextmanager
async def _lifespan(_app: FastAPI):
    """kb2 재구조화 야간 예약 폴러를 앱과 함께 띄우고 내린다(2026-09-10). 예약 자체는
    DB(kb2.synthesis_jobs)에 있어 재시작해도 살아남는다 — 여기서 도는 건 폴러뿐."""
    from api.rag import kb2_scheduler

    tasks: list = []
    kb2_scheduler.start(tasks)
    try:
        yield
    finally:
        for t in tasks:
            t.cancel()


app = FastAPI(title="Neo-Luddite Seam A — /api/chat", version="0.1.0", lifespan=_lifespan)

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
    if out:
        _rebuild_edges_best_effort()
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
    if out:
        _rebuild_edges_best_effort()
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


@app.post(
    "/api/rag/search-preview",
    response_model=SearchPreviewResponse,
    response_model_exclude_none=True,
)
def rag_search_preview(req: SearchPreviewRequest) -> SearchPreviewResponse:
    """auditor 가 "이 질문이면 solar-pro3 가 KB 에서 뭘 참고할까"를 직접 확인하는 화면
    (§3.5 이어서, 2026-08-28) — 저장/기록 없는 읽기 전용 조회. RAG 파이프라인
    (SupabaseRetriever)과 정확히 같은 경로(embed_query → rag.match_passages)로 top-k 를
    구한다 — 실제 답변 시 참조될 후보와 동일한 결과."""
    from api.rag import embeddings, store

    if not store.is_configured():
        return SearchPreviewResponse(matches=[], dbConfigured=False)
    query = req.query.strip()
    if not query:
        return SearchPreviewResponse(matches=[], dbConfigured=True)
    vec = embeddings.embed_query(query)
    rows = store.search(vec, k=req.k)
    return SearchPreviewResponse(
        matches=[
            SearchPreviewMatch(
                id=r.id, content=r.content, sourceKind=r.source_kind,
                taxCategory=r.tax_category, occupation=r.occupation, score=r.score,
            )
            for r in rows
        ],
        dbConfigured=True,
    )


def _rebuild_edges_best_effort() -> None:
    """새 지식 적재/수정승인/소급정리 직후 그래프를 즉시 갱신 — pg_cron 5분 주기를
    기다리지 않는다(2026-08-28, 사용자 지적: 배선될 때마다 재계산이 맞다). 지금 규모
    (수백 건)에서 전체 재계산은 1초 미만이라 요청 경로에서 동기 호출해도 부담 없다.
    실패해도 원래 동작(적재/승인/정리)은 막지 않는다 — 다음 pg_cron 틱이 만회한다."""
    from api.rag import store

    try:
        store.rebuild_passage_edges()
    except Exception:
        pass


@app.get("/api/rag/edges", response_model=PassageEdgesResponse, response_model_exclude_none=True)
def rag_edges() -> PassageEdgesResponse:
    """KB 전체 거미줄 그래프용 edge 목록 — 조회 시점 계산이 아니라 pg_cron 이 5분마다
    미리 채워둔 rag.passage_edges 를 그대로 읽는다(2026-08-28). RAG 검색 경로와 무관."""
    from api.rag import store

    if not store.is_configured():
        return PassageEdgesResponse(edges=[], dbConfigured=False)
    rows = store.list_passage_edges()
    return PassageEdgesResponse(
        edges=[PassageEdge(sourceId=r.source_id, targetId=r.target_id, score=r.score) for r in rows],
        dbConfigured=True,
    )


@app.post("/api/rag/edges/rebuild", response_model=RebuildEdgesResponse)
def rag_edges_rebuild(k: int = 8) -> RebuildEdgesResponse:
    """그래프 즉시 재계산(수동 트리거) — admin 이 소급 정리/수정 승인 직후 반영 지연 없이
    보고 싶을 때 쓴다. pg_cron 이 5분마다 같은 함수를 자동 호출하므로 평상시엔 안 눌러도 됨."""
    from api.rag import store

    if not store.is_configured():
        return RebuildEdgesResponse(edgeCount=0, dbConfigured=False)
    n = store.rebuild_passage_edges(k=k)
    return RebuildEdgesResponse(edgeCount=n, dbConfigured=True)


@app.post(
    "/api/rag/reclassify-tax-categories",
    response_model=ReclassifyTaxCategoriesResponse,
)
def rag_reclassify_tax_categories() -> ReclassifyTaxCategoriesResponse:
    """KB 전체 active passage 의 tax_category 소급 재분류(2026-08-28) — 프론트가 라이브
    채팅 스냅샷에서 항상 "미분류" 플레이스홀더를 채워 넣던 문제(`conversation.ts:76`)를
    메운다. Upstage(solar-pro3)로 `api/rag/taxonomy.TAX_CATEGORIES` 중 하나를 고르고
    안 맞으면 '미분류' 그대로 둔다. 재임베딩 없음(메타데이터만 갱신) — 관리자가 필요할
    때 재실행 가능(일회성 스크립트 아님)."""
    from api import llm
    from api.rag import store
    from api.rag.taxonomy import TAX_CATEGORIES

    if not store.is_configured():
        return ReclassifyTaxCategoriesResponse(updated=0, distribution={}, dbConfigured=False)

    rows = store.list_active_passage_contents()
    distribution: dict[str, int] = {}
    for passage_id, content in rows:
        category = llm.classify_tax_category(content, TAX_CATEGORIES)
        store.set_tax_category(passage_id, category)
        distribution[category] = distribution.get(category, 0) + 1
    return ReclassifyTaxCategoriesResponse(
        updated=len(rows), distribution=distribution, dbConfigured=True
    )


@app.post("/admin/kb2/synthesize", response_model=Kb2SynthesizeResponse)
def kb2_synthesize(taxCategory: str | None = None) -> Kb2SynthesizeResponse:
    """지식베이스2 재구성(admin 전용, 프론트 /admin/kb2 에서만 노출) — 지금 시점
    rag.passages(active) 를 세목별로 Solar Pro 에 투입해 kb2.sentences 를 재생성한다.
    locked_by_auditor=true 인 문장(세무사 수정분)은 건드리지 않는다."""
    from api.rag import kb2_synthesis

    result = kb2_synthesis.synthesize(tax_category=taxCategory)
    return Kb2SynthesizeResponse(
        results=[
            Kb2CategorySynthesisResult(
                taxCategory=r.taxCategory, documentId=r.documentId,
                created=r.created, lockedSkipped=r.lockedSkipped,
            )
            for r in result.results
        ],
        dbConfigured=result.dbConfigured,
    )


def _kb2_document_info(d) -> Kb2DocumentInfo:
    return Kb2DocumentInfo(
        id=d.id, taxCategory=d.tax_category, title=d.title, status=d.status,
        createdAt=d.created_at, updatedAt=d.updated_at, groupId=d.group_id,
        statusReason=d.status_reason, statusActor=d.status_actor,
    )


def _kb2_sentence_info(s) -> Kb2SentenceInfo:
    return Kb2SentenceInfo(
        id=s.id, documentId=s.document_id, orderIndex=s.order_index, content=s.content,
        sourcePassageIds=s.source_passage_ids, attribution=s.attribution,
        lockedByAuditor=s.locked_by_auditor, version=s.version,
        createdAt=s.created_at, updatedAt=s.updated_at,
        lockedBy=s.locked_by if s.effectively_locked else None,
        effectivelyLocked=s.effectively_locked,
        status=s.status,
    )


@app.get("/api/kb2/groups", response_model=Kb2GroupsResponse)
def list_kb2_groups() -> Kb2GroupsResponse:
    """대목 목록 — auditor /audit/kb2 트리 좌측 상위 그룹."""
    from api.rag import kb2_store

    if not kb2_store.is_configured():
        return Kb2GroupsResponse(groups=[], dbConfigured=False)
    groups = kb2_store.list_groups()
    return Kb2GroupsResponse(
        groups=[
            Kb2GroupInfo(id=g.id, label=g.label, status=g.status, createdAt=g.created_at, updatedAt=g.updated_at)
            for g in groups
        ],
        dbConfigured=True,
    )


@app.post("/api/kb2/groups", response_model=CreateKb2GroupResponse)
def create_kb2_group(req: CreateKb2GroupRequest) -> CreateKb2GroupResponse:
    """"대목 추가" — 순수 생성, 문서 0개로 시작."""
    from api.rag import kb2_store

    if not kb2_store.is_configured():
        return CreateKb2GroupResponse(group=None, dbConfigured=False)
    group_id = kb2_store.create_group(req.label)
    groups = kb2_store.list_groups()
    match = next((g for g in groups if g.id == group_id), None)
    if match is None:
        return CreateKb2GroupResponse(group=None, dbConfigured=True)
    return CreateKb2GroupResponse(
        group=Kb2GroupInfo(
            id=match.id, label=match.label, status=match.status,
            createdAt=match.created_at, updatedAt=match.updated_at,
        ),
        dbConfigured=True,
    )


@app.post("/api/kb2/documents/auto-group", response_model=Kb2AutoGroupResponse)
def auto_group_kb2_documents() -> Kb2AutoGroupResponse:
    """"미분류" 세목만 Solar Pro가 표준 세무 대분류로 묶어 자동 배정(로드맵 4.6단계
    후속, 2026-09-09) — 하드코딩 목록 대신 AI 판단으로 대목을 만든다. 이미 대목이
    지정된 세목은 건드리지 않는다."""
    from api.rag import kb2_store, kb2_taxonomy

    if not kb2_store.is_configured():
        return Kb2AutoGroupResponse(groupsCreated=0, documentsGrouped=0, dbConfigured=False)
    result = kb2_taxonomy.auto_group_ungrouped_documents()
    return Kb2AutoGroupResponse(
        groupsCreated=result["groupsCreated"], documentsGrouped=result["documentsGrouped"], dbConfigured=True,
    )


@app.get("/api/kb2/documents", response_model=Kb2DocumentsResponse)
def list_kb2_documents() -> Kb2DocumentsResponse:
    """지식베이스2 문서(세목) 목록 — auditor /audit/kb2 화면."""
    from api.rag import kb2_store

    if not kb2_store.is_configured():
        return Kb2DocumentsResponse(documents=[], dbConfigured=False)
    # 연결 끊긴('retired') 세목도 함께 — 화면에서 옅게 남아야 재연결할 수 있다(문장
    # 단위와 같은 철학). 재구조화로 세대교체된 'archived' 는 여전히 안 보인다.
    docs = kb2_store.list_documents(status=["active", "retired"])
    return Kb2DocumentsResponse(documents=[_kb2_document_info(d) for d in docs], dbConfigured=True)


@app.post("/api/kb2/documents", response_model=CreateKb2DocumentResponse)
def create_kb2_document(req: CreateKb2DocumentRequest) -> CreateKb2DocumentResponse:
    """"세목 추가" — 순수 생성(AI 파이프라인과 무관), 문장 0개로 시작."""
    from api.rag import kb2_store

    if not kb2_store.is_configured():
        return CreateKb2DocumentResponse(document=None, dbConfigured=False)
    document_id = kb2_store.create_empty_document(req.groupId, req.title)
    docs = kb2_store.list_documents(status=None)
    match = next((d for d in docs if d.id == document_id), None)
    return CreateKb2DocumentResponse(
        document=_kb2_document_info(match) if match else None, dbConfigured=True,
    )


@app.patch("/api/kb2/documents/{documentId}", response_model=UpdateKb2DocumentResponse)
def rename_kb2_document(documentId: str, req: RenameKb2DocumentRequest) -> UpdateKb2DocumentResponse:
    """"이름 수정" — title만 갱신."""
    from api.rag import kb2_store

    if not kb2_store.is_configured():
        return UpdateKb2DocumentResponse(document=None, dbConfigured=False)
    updated = kb2_store.rename_document(documentId, req.title)
    return UpdateKb2DocumentResponse(
        document=_kb2_document_info(updated) if updated else None, dbConfigured=True,
    )


@app.patch("/api/kb2/documents/{documentId}/group", response_model=UpdateKb2DocumentResponse)
def set_kb2_document_group(documentId: str, req: SetKb2DocumentGroupRequest) -> UpdateKb2DocumentResponse:
    """"그룹 지정" — 기존/신규 세목을 원하는 대목으로 재배치(groupId=null 이면 미분류로)."""
    from api.rag import kb2_store

    if not kb2_store.is_configured():
        return UpdateKb2DocumentResponse(document=None, dbConfigured=False)
    updated = kb2_store.set_document_group(documentId, req.groupId)
    return UpdateKb2DocumentResponse(
        document=_kb2_document_info(updated) if updated else None, dbConfigured=True,
    )


@app.patch("/api/kb2/documents/{documentId}/status", response_model=UpdateKb2DocumentResponse)
def set_kb2_document_status(
    documentId: str, req: SetKb2DocumentStatusRequest
) -> UpdateKb2DocumentResponse:
    """세목 연결 끊기/재연결(2026-09-10) — 삭제가 아니라 상태 전환. retired 세목의
    문장은 kb2.match_sentences 가 d.status='active' 만 보므로 검색에서 자동으로 빠지고,
    문장·버전이력·기여 attribution 은 그대로 남는다. 사유는 필수로 이력에 남긴다."""
    from api.rag import kb2_store

    if not kb2_store.is_configured():
        return UpdateKb2DocumentResponse(document=None, dbConfigured=False)
    updated = kb2_store.set_document_status(
        documentId, req.status, req.reason, req.editorAuditorId
    )
    return UpdateKb2DocumentResponse(
        document=_kb2_document_info(updated) if updated else None, dbConfigured=True,
    )


@app.delete("/api/kb2/groups/{groupId}", response_model=DeleteKb2GroupResponse)
def delete_kb2_group(groupId: str, actorId: str = "") -> DeleteKb2GroupResponse:
    """대목 삭제(2026-09-10) — 대목은 지식이 없는 순수 정리 계층이라 지워도 된다.
    속한 세목은 같이 지우지 않고 "미분류"로 풀려난다(각 세목에 이력을 남긴다)."""
    from api.rag import kb2_store

    if not kb2_store.is_configured():
        return DeleteKb2GroupResponse(deleted=False, dbConfigured=False)
    detached = kb2_store.delete_group(groupId, actorId)
    return DeleteKb2GroupResponse(deleted=True, detachedDocuments=detached, dbConfigured=True)


@app.get("/api/kb2/documents/{documentId}/sentences", response_model=Kb2SentencesResponse)
def list_kb2_sentences(documentId: str) -> Kb2SentencesResponse:
    from api.rag import kb2_store

    if not kb2_store.is_configured():
        return Kb2SentencesResponse(sentences=[], dbConfigured=False)
    rows = kb2_store.list_sentences(documentId)
    return Kb2SentencesResponse(sentences=[_kb2_sentence_info(s) for s in rows], dbConfigured=True)


@app.patch("/api/kb2/sentences/{sentenceId}", response_model=UpdateKb2SentenceResponse)
def update_kb2_sentence(sentenceId: str, req: UpdateKb2SentenceRequest) -> UpdateKb2SentenceResponse:
    """세무사 직접 수정(로드맵 4단계) — 즉시 반영, locked_by_auditor=true 전환(재합성
    보호막), attribution 전량 편집자로 교체. sentence_versions 에 editor_type='auditor_edit'
    이력을 남겨 관리자가 나중에 번복할 근거로 삼는다(5단계). 저장 성공 시 편집 락도
    같이 해제된다(kb2_store.update_sentence_content 가 locked_by 를 clear)."""
    from api.rag import embeddings, kb2_store

    if not kb2_store.is_configured():
        return UpdateKb2SentenceResponse(sentence=None, dbConfigured=False)
    new_embedding = embeddings.embed_passage(req.content)
    updated = kb2_store.update_sentence_content(
        sentenceId, req.content, new_embedding, editor_id=req.editorAuditorId,
    )
    if updated is None:
        return UpdateKb2SentenceResponse(sentence=None, dbConfigured=True)
    return UpdateKb2SentenceResponse(sentence=_kb2_sentence_info(updated), dbConfigured=True)


@app.post("/api/kb2/sentences/{sentenceId}/move", response_model=MoveKb2SentenceResponse)
def move_kb2_sentence(sentenceId: str, req: MoveKb2SentenceRequest) -> MoveKb2SentenceResponse:
    """롱프레스로 다른 세목으로 이동(로드맵 4.6단계) — 분류 정리이지 내용 수정이 아니므로
    attribution(크레딧)은 그대로 유지, sentence_versions 에 editor_type='moved' 기록."""
    from api.rag import kb2_store

    if not kb2_store.is_configured():
        return MoveKb2SentenceResponse(sentence=None, dbConfigured=False)
    updated = kb2_store.move_sentence(sentenceId, req.targetDocumentId, editor_id=req.editorAuditorId)
    return MoveKb2SentenceResponse(
        sentence=_kb2_sentence_info(updated) if updated else None, dbConfigured=True,
    )


@app.post("/api/kb2/sentences/{sentenceId}/lock", response_model=Kb2LockResponse)
def lock_kb2_sentence(sentenceId: str, req: Kb2LockRequest) -> Kb2LockResponse:
    """"수정" 버튼 클릭 시 편집 락 획득 시도 — 실패 시 현재 보유자 id 반환("OOO님이
    수정 중" 표시). 5분 TTL 지나면 자동으로 다른 사람이 획득 가능(브라우저 크래시 대비)."""
    from api.rag import kb2_store

    if not kb2_store.is_configured():
        return Kb2LockResponse(ok=False, lockedBy=None, dbConfigured=False)
    ok, locked_by = kb2_store.acquire_lock(sentenceId, req.auditorId)
    return Kb2LockResponse(ok=ok, lockedBy=locked_by, dbConfigured=True)


@app.post("/api/kb2/sentences/{sentenceId}/unlock", response_model=Kb2LockResponse)
def unlock_kb2_sentence(sentenceId: str, req: Kb2LockRequest) -> Kb2LockResponse:
    """"취소" 클릭 또는 1분 무입력 자동저장 후 편집 락 해제. auditorId 가 현재 보유자와
    일치할 때만 실제로 풀린다."""
    from api.rag import kb2_store

    if not kb2_store.is_configured():
        return Kb2LockResponse(ok=False, lockedBy=None, dbConfigured=False)
    kb2_store.release_lock(sentenceId, req.auditorId)
    return Kb2LockResponse(ok=True, lockedBy=None, dbConfigured=True)


@app.post("/api/kb2/sentences/{sentenceId}/status", response_model=SetKb2SentenceStatusResponse)
def set_kb2_sentence_status(sentenceId: str, req: SetKb2SentenceStatusRequest) -> SetKb2SentenceStatusResponse:
    """연결 끊기/재연결(배선실 패턴을 KB2 문장에 적용, 2026-09-09) — 삭제 아님,
    status만 전환(retired는 검색에서 제외). 사유(reason)를 필수로 받아
    sentence_versions에 editor_type='retired'|'reconnected'로 기록 — 누가 왜 끊었는지
    추적 가능해야 한다는 요구사항."""
    from api.rag import kb2_store

    if not kb2_store.is_configured():
        return SetKb2SentenceStatusResponse(sentence=None, dbConfigured=False)
    status = "retired" if req.status == "retired" else "active"
    updated = kb2_store.set_sentence_status(sentenceId, status, req.editorAuditorId, req.reason)
    return SetKb2SentenceStatusResponse(
        sentence=_kb2_sentence_info(updated) if updated else None, dbConfigured=True,
    )


@app.get("/api/kb2/sentences/{sentenceId}/versions", response_model=Kb2SentenceVersionsResponse)
def kb2_sentence_versions(sentenceId: str) -> Kb2SentenceVersionsResponse:
    from api.rag import kb2_store

    if not kb2_store.is_configured():
        return Kb2SentenceVersionsResponse(versions=[], dbConfigured=False)
    rows = kb2_store.list_sentence_versions(sentenceId)
    return Kb2SentenceVersionsResponse(
        versions=[
            Kb2SentenceVersionInfo(
                id=v.id, versionNo=v.version_no, content=v.content,
                attributionSnapshot=v.attribution_snapshot, editorType=v.editor_type,
                editorId=v.editor_id, createdAt=v.created_at, meta=v.meta,
            )
            for v in rows
        ],
        dbConfigured=True,
    )


@app.get("/api/kb2/sentences/{sentenceId}/sources", response_model=Kb2SentenceSourcesResponse)
def kb2_sentence_sources(sentenceId: str) -> Kb2SentenceSourcesResponse:
    """'출처 보기' — 해당 문장의 source_passage_ids 로 원 rag.passages 내용을 펼쳐온다."""
    from api.rag import kb2_store, store

    if not kb2_store.is_configured() or not store.is_configured():
        return Kb2SentenceSourcesResponse(passages=[], dbConfigured=False)
    sentence = kb2_store.get_sentence(sentenceId)
    if sentence is None:
        return Kb2SentenceSourcesResponse(passages=[], dbConfigured=True)
    passages = store.get_passages_by_ids(sentence.source_passage_ids)
    return Kb2SentenceSourcesResponse(
        passages=[
            Kb2SourcePassage(
                id=p.id, content=p.content, taxCategory=p.tax_category, auditorId=p.auditor_id,
            )
            for p in passages
        ],
        dbConfigured=True,
    )


def _kb2_job_info(job) -> Kb2JobInfo:
    return Kb2JobInfo(
        id=job.id, status=job.status, stage=job.stage,
        totalCategories=job.total_categories, completedCategories=job.completed_categories,
        result=job.result, error=job.error, createdAt=job.created_at, updatedAt=job.updated_at,
        scheduledAt=job.scheduled_at, triggerSource=job.trigger_source,
    )


@app.post("/admin/kb2/restructure", response_model=Kb2RestructureStartResponse)
def start_kb2_restructure(
    background_tasks: BackgroundTasks, req: StartKb2RestructureRequest | None = None
) -> Kb2RestructureStartResponse:
    """AI로 카테고리 재구조화(로드맵 4.5단계) — 그 시점 RAG 전체를 Solar Pro가 분석해
    17개 고정 세목 대신 카테고리 자체를 새로 제안한다.

    두 가지 경로(2026-09-10): scheduleAt 을 주면 예약만 걸고 즉시 반환(야간 배치 —
    kb2_scheduler 폴러가 그 시각 이후에 실행), 안 주면 기존처럼 곧바로 백그라운드
    실행. 어느 쪽이든 프론트는 돌려받은 job id 로 폴링한다."""
    from api.rag import kb2_store, kb2_taxonomy

    if not kb2_store.is_configured():
        return Kb2RestructureStartResponse(jobId=None, dbConfigured=False)
    schedule_at = req.scheduleAt if req else None
    job_id = kb2_store.create_job(scheduled_at=schedule_at)
    if schedule_at is None:
        background_tasks.add_task(kb2_taxonomy.run_dynamic_restructure, job_id)
    return Kb2RestructureStartResponse(jobId=job_id, scheduledAt=schedule_at, dbConfigured=True)


@app.get("/admin/kb2/restructure/scheduled", response_model=Kb2ScheduledJobsResponse)
def list_kb2_scheduled_jobs() -> Kb2ScheduledJobsResponse:
    """아직 실행 안 된 예약 목록 — 화면 진입 시 "예약됨: …"을 복원하기 위한 조회.
    라우트 순서 주의: /restructure/{jobId} 보다 위에 있어야 'scheduled' 가 job id 로
    잡히지 않는다."""
    from api.rag import kb2_store

    if not kb2_store.is_configured():
        return Kb2ScheduledJobsResponse(jobs=[], dbConfigured=False)
    return Kb2ScheduledJobsResponse(
        jobs=[_kb2_job_info(j) for j in kb2_store.list_scheduled_jobs()], dbConfigured=True
    )


@app.get("/admin/kb2/restructure/latest", response_model=Kb2RestructureJobResponse)
def get_latest_kb2_restructure_job() -> Kb2RestructureJobResponse:
    """가장 최근에 끝난 재구조화 job — 화면 진입 시 지난 회차의 커버리지 계측을 복원한다.
    라우트 순서 주의: /restructure/{jobId} 보다 위에 있어야 'latest' 가 job id 로
    잡히지 않는다(scheduled 와 같은 이유)."""
    from api.rag import kb2_store

    if not kb2_store.is_configured():
        return Kb2RestructureJobResponse(job=None, dbConfigured=False)
    job = kb2_store.get_latest_finished_job()
    return Kb2RestructureJobResponse(
        job=_kb2_job_info(job) if job else None, dbConfigured=True
    )


@app.post("/admin/kb2/restructure/{jobId}/cancel", response_model=CancelKb2ScheduleResponse)
def cancel_kb2_scheduled_job(jobId: str) -> CancelKb2ScheduleResponse:
    """예약 취소. 이미 실행에 들어간 job 은 취소되지 않는다(cancelled=false)."""
    from api.rag import kb2_store

    if not kb2_store.is_configured():
        return CancelKb2ScheduleResponse(cancelled=False, dbConfigured=False)
    return CancelKb2ScheduleResponse(
        cancelled=kb2_store.cancel_scheduled_job(jobId), dbConfigured=True
    )


@app.get("/admin/kb2/restructure/{jobId}", response_model=Kb2RestructureJobResponse)
def get_kb2_restructure_job(jobId: str) -> Kb2RestructureJobResponse:
    from api.rag import kb2_store

    if not kb2_store.is_configured():
        return Kb2RestructureJobResponse(job=None, dbConfigured=False)
    job = kb2_store.get_job(jobId)
    if job is None:
        return Kb2RestructureJobResponse(job=None, dbConfigured=True)
    return Kb2RestructureJobResponse(job=_kb2_job_info(job), dbConfigured=True)


@app.get("/admin/kb2/documents", response_model=Kb2DocumentsResponse)
def admin_list_kb2_documents(status: str = "archived") -> Kb2DocumentsResponse:
    """admin 보관함 조회 — 재구조화로 archived 처리된 이전 문서(레거시 고정 세목 포함)를
    확인하기 위한 용도. 기본값 status='archived'."""
    from api.rag import kb2_store

    if not kb2_store.is_configured():
        return Kb2DocumentsResponse(documents=[], dbConfigured=False)
    docs = kb2_store.list_documents(status=status)
    return Kb2DocumentsResponse(documents=[_kb2_document_info(d) for d in docs], dbConfigured=True)


@app.post("/api/rag/retract", response_model=RetractResponse)
def retract_rag_passages(req: RetractRequest) -> RetractResponse:
    """연결끊기/재연결 — passage status 를 retired/active 로 전환(삭제 아님, 추적 보존).
    retired 는 rag.match_passages 에서 빠져 KB 검색 대상에서 제외된다."""
    from api.rag import store

    if not store.is_configured():
        return RetractResponse(updated=0, dbConfigured=False)
    status = req.status if req.status in ("retired", "active") else "retired"
    n = store.set_status(req.passageIds, status)
    if n:
        _rebuild_edges_best_effort()
    return RetractResponse(updated=n, dbConfigured=True)


@app.post("/api/rag/edits", response_model=ProposeEditResponse)
def propose_rag_edit(req: ProposeEditRequest) -> ProposeEditResponse:
    """passage 수정 제안 등록(§3.4) — auditor KB 상세뷰에서 호출. 대기(pending) 상태로만
    쌓이고 rag.passages 는 승인 전까지 그대로다. 같은 passage 에 이미 대기 중인 제안이
    있으면 DB 유니크 인덱스가 막는다(한 번에 하나만 검토)."""
    from api.rag import store

    if not store.is_configured():
        return ProposeEditResponse(editId=None, dbConfigured=False)
    edit_id = store.propose_edit(
        passage_id=req.passageId,
        proposed_content=req.proposedContent,
        editor_auditor_id=req.editorAuditorId,
        editor_reviewer=req.editorReviewer,
    )
    return ProposeEditResponse(editId=edit_id, dbConfigured=True)


@app.get("/api/rag/edits", response_model=PassageEditsResponse, response_model_exclude_none=True)
def list_rag_edits(status: str | None = None, passageId: str | None = None) -> PassageEditsResponse:
    """수정 제안 목록 — admin 승인 큐(status=pending 기본 필터는 프론트에서) 및 auditor
    상세뷰의 "이 passage 에 대기 중인 제안이 있나" 조회 겸용. DB 미설정이면 빈 목록."""
    from api.rag import store

    if not store.is_configured():
        return PassageEditsResponse(edits=[], dbConfigured=False)
    rows = store.list_edits(status=status)
    if passageId:
        rows = [r for r in rows if r.passage_id == passageId]
    return PassageEditsResponse(
        edits=[
            PassageEdit(
                id=r.id, passageId=r.passage_id, originalContent=r.original_content,
                proposedContent=r.proposed_content, editorAuditorId=r.editor_auditor_id,
                editorReviewer=r.editor_reviewer, status=r.status, adminId=r.admin_id,
                adminNote=r.admin_note, createdAt=r.created_at, reviewedAt=r.reviewed_at,
            )
            for r in rows
        ],
        dbConfigured=True,
    )


@app.post("/api/rag/edits/{editId}/approve", response_model=ReviewEditResponse)
def approve_rag_edit(editId: str, req: ReviewEditRequest) -> ReviewEditResponse:
    """수정 제안 승인 — 제안 텍스트를 재임베딩(Upstage embedding-passage)한 뒤 passages.
    content/embedding 을 갱신한다. **귀속(reviewer/auditor_id)은 원작성자 그대로 유지**
    (기여 정책 2026-08-27: 수정은 이력만, 크레딧 이동 없음) — 정산 존속기간 집계에
    영향 없음. 이미 처리된 제안이면 ok=False."""
    from api.rag import embeddings, store

    if not store.is_configured():
        return ReviewEditResponse(ok=False, dbConfigured=False)
    edit = store.get_edit(editId)
    if edit is None or edit.status != "pending":
        return ReviewEditResponse(ok=False, dbConfigured=True)
    new_embedding = embeddings.embed_passage(edit.proposed_content)
    passage_id = store.approve_edit(editId, admin_id=req.adminId, new_embedding=new_embedding)
    if passage_id is not None:
        _rebuild_edges_best_effort()
    return ReviewEditResponse(ok=passage_id is not None, passageId=passage_id, dbConfigured=True)


@app.post("/api/rag/edits/{editId}/reject", response_model=ReviewEditResponse)
def reject_rag_edit(editId: str, req: ReviewEditRequest) -> ReviewEditResponse:
    """수정 제안 반려 — passages 는 손대지 않는다."""
    from api.rag import store

    if not store.is_configured():
        return ReviewEditResponse(ok=False, dbConfigured=False)
    ok = store.reject_edit(editId, admin_id=req.adminId, admin_note=req.adminNote)
    return ReviewEditResponse(ok=ok, dbConfigured=True)


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
def chat(req: ChatRequest, rag: bool | None = None, ragSource: str | None = None) -> ChatResponse:
    # `?rag=false` → RAG off 로 baseline 응답(A/B 임팩트 측정). 미지정 시 RAG_ENABLED env.
    # `?ragSource=kb2|rag|hybrid` → 어느 코퍼스를 검색할지(직교 축, 설계 §03). 미지정 시 RAG_SOURCE env(기본 rag).
    if req.occupation == "clinic":
        return pipeline.run_clinic(req.conversationId, req.history, req.userInput.text,
                                   rag_override=rag, rag_source_override=ragSource)
    return pipeline.run_coming_occupation(req.conversationId, req.history, req.occupation)
