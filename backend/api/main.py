"""
Seam A — FastAPI service exposing POST /api/chat (docs API 계약 §2.4).

Run (from backend/):
    pip install -r requirements-api.txt
    cp .env.example .env   # fill UPSTAGE_API_KEY
    uvicorn api.main:app --reload --port 8787
    # 로컬 dev 는 VEC_MEMORY=off 권장 — 기동마다 운영 DB 에서 벡터를 받는다(egress, 10/12). 디스크 캐시
    # (VEC_CACHE_DIR, 기본 backend/.cache/vec/)가 있어도 --reload 연속 재시작 중엔 쓰다 만 캐시로 다시 받을 수 있다.

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
from api import upstage_gate  # noqa: E402
from api.schema import (  # noqa: E402
    ChatRequest,
    ChatResponse,
    RagStatusResponse,
    RagToggleRequest,
)

@asynccontextmanager
async def _lifespan(_app: FastAPI):
    """기동 예열을 띄운다. (옛 kb2 재구조화 폴러·규범 디폴트 승인 폴러는 절단 S3(10/16)에서 지웠다.)"""
    # 예열(10/8) — 기동은 막지 않는다. ① 메모리 벡터(KB3 정적 코퍼스·법령 조문, api/rag/vec_memory) — 올라가기 전 요청은
    # DB 검색으로 간다 ② LLM3 법령 저장소(조문 메타·원문, 첫 로드 8.7초를 첫 사용자가 떠안지 않게).
    import threading

    from api import law_select
    from api.rag import vec_memory

    def _warm():
        if law_select.enabled():
            law_select.warm()
        vec_memory.load_all()
    threading.Thread(target=_warm, name="warm", daemon=True).start()
    yield


app = FastAPI(title="Neo-Luddite Seam A — /api/chat", version="0.1.0", lifespan=_lifespan)

# dev CORS: Next.js dev server. Tighten for production.
_CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 쓰기 API 인증(P6 ①) — CORS 보다 바깥에 걸린다(401/403 응답은 auth._error 가 CORS 헤더를 직접 붙임).
from api.auth import auth_middleware  # noqa: E402

app.middleware("http")(auth_middleware)


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
    return {"ok": True, "service": "seam-a", "model": os.environ.get("UPSTAGE_CHAT_MODEL", "solar-pro3"),
            "upstageGate": upstage_gate.stats()}   # 전시 중 줄 길이 확인용(P8 B)


@app.get("/rag/health")
def rag_health() -> dict:
    """검색 on/off·DB 설정·규범 주입 상태. (옛 rag.passages 크기 kbPassages 는 절단 S3 에서 뺐다.)"""
    from api.rag import retriever, store

    from api.prompts import norms_status

    return {"ragEnabled": retriever.rag_enabled(), "dbConfigured": store.is_configured(),
            "norms": norms_status()}


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


# 옛 검수 흐름(검수 코멘트 적재·rag.passages 조회·수정 제안·KB2·규범 편집 API)은 절단 S3(10/16)에서 지웠다.
# 규범은 답변 주입(api/prompts)만 남고, 바꿀 땐 개발자가 DB(norms.*)에서 고친다(D3).

# response_model_exclude_none: Optional 필드(framework·citations·uiBlocks·note 등)를
# null 로 직렬화하지 않고 생략 → 프론트 Zod `.optional()`(undefined-만 허용)과 정합.
@app.post("/api/chat", response_model=ChatResponse, response_model_exclude_none=True)
def chat(req: ChatRequest, rag: bool | None = None, ragSource: str | None = None) -> ChatResponse:
    # `?rag=false` → RAG off 로 baseline 응답(A/B 임팩트 측정). 미지정 시 RAG_ENABLED env.
    # `?ragSource=kb2|rag|hybrid|fusion|kb3` → 어느 코퍼스를 검색할지(직교 축, 설계 §03). 미지정 시 RAG_SOURCE env(기본 rag).
    # clinic 외 직군도 같은 파이프라인(R1-e · D-2, 10/10) — 엔진 판정만 clinic 전용(run_clinic 안에서 가른다).
    # Upstage 호출 줄(P8 B) — 이 턴이 줄에서 기다린 합계가 상한을 넘으면 혼잡 안내로 답한다.
    try:
        with upstage_gate.turn_budget():
            return pipeline.run_clinic(req.conversationId, req.history, req.userInput.text,
                                       rag_override=rag, rag_source_override=ragSource,
                                       occupation=req.occupation)
    except upstage_gate.UpstageCongested:
        return pipeline.congested_response(req.conversationId, req.history, req.occupation, ragSource)


# ── 세무사 사례(kb3_expert) — 에이전트 스튜디오 서버 저장·게시·공용 공유 (0043, 2026-10-06) ──────────
# 쓰기는 auth_middleware 가 auditor·admin 토큰을 확인한다(/admin/ 은 admin). GET 은 미들웨어를 안 타므로
# 핸들러에서 직접 인증한다. 신원 = 토큰의 auth uid(kb3.documents.expert_id) — 본문 값은 받지 않는다.
from api.schema import (  # noqa: E402
    ExpertCaseInfo,
    ExpertCaseResponse,
    ExpertPreviewRequest,
    PublishExpertCaseRequest,
    ReviewShareRequest,
    WithdrawShareRequest,
    ReviewShareResponse,
    SaveExpertCaseRequest,
    ShareExpertCasesRequest,
    ShareQueueItem,
    ShareQueueResponse,
)


def _expert_user(request: Request, roles: tuple[str, ...] = ("auditor", "admin")):
    """요청의 세무사 신원. 미들웨어가 실은 값이 없으면(GET·AUTH_MODE=optional) 헤더로 직접 확인한다."""
    from api import auth

    user = getattr(request.state, "user", None)
    if user is None:
        user = auth.authenticate(request.headers.get("authorization"))
    if user is None:
        raise auth.AuthError(401, "로그인이 필요합니다(Authorization: Bearer <token>)")
    if user.role not in roles:
        raise auth.AuthError(403, f"권한 없음 — {'/'.join(roles)} 만 가능합니다(현재 {user.role})")
    return user


def _case_info(c) -> ExpertCaseInfo:
    return ExpertCaseInfo(id=c.id, agentId=c.agent_id, localId=c.local_id, title=c.title, facts=c.facts,
                          judgment=c.judgment, conclusion=c.conclusion, exceptions=c.exceptions,
                          keywords=c.keywords, publishState=c.publish_state, shareState=c.share_state,
                          shareNote=c.share_note, caseNumber=c.case_number, expertName=c.expert_name,
                          updatedAt=c.updated_at)


def _expert_call(request: Request, fn, roles: tuple[str, ...] = ("auditor", "admin")):
    """인증 → 저장소 호출 → 오류를 응답 모양으로. fn(user) 는 ExpertCaseResponse 를 돌려준다."""
    from api import auth
    from api.rag import kb3_store

    try:
        user = _expert_user(request, roles)
    except auth.AuthError as exc:
        return auth._error(request, exc.status, exc.detail)
    if not kb3_store.is_configured():
        return ExpertCaseResponse(dbConfigured=False, error="DB 미설정")
    try:
        return fn(user)
    except kb3_store.ExpertCaseError as exc:
        return ExpertCaseResponse(error=str(exc))


@app.get("/api/kb3/expert/cases", response_model=ExpertCaseResponse, response_model_exclude_none=True)
def list_my_expert_cases(request: Request):
    from api.rag import kb3_store

    return _expert_call(request, lambda u: ExpertCaseResponse(
        ok=True, cases=[_case_info(c) for c in kb3_store.list_expert_cases(u.user_id)]))


@app.post("/api/kb3/expert/cases", response_model=ExpertCaseResponse, response_model_exclude_none=True)
def save_my_expert_case(req: SaveExpertCaseRequest, request: Request):
    """'검토한 지식 반영' — 서버 초안(답변엔 아직 안 쓰임). 임베딩은 Upstage embedding-passage."""
    from api.rag import embeddings, kb3_store

    def run(u):
        fields = {"facts": req.facts.strip(), "judgment": req.judgment.strip(),
                  "conclusion": req.conclusion.strip(), "exceptions": req.exceptions.strip(),
                  "keywords": req.keywords.strip()}
        text = kb3_store.expert_embed_text(req.title.strip(), fields)
        c = kb3_store.save_expert_case(
            expert_id=u.user_id, expert_name=kb3_store.expert_display_name(u.user_id), agent_id=req.agentId,
            local_id=req.localId, title=req.title.strip(), fields=fields,
            embedding=embeddings.embed_passage(text), embed_text=text,
            law_articles_fn=lambda: kb3_store.expert_law_articles(req.title.strip(), fields))
        return ExpertCaseResponse(ok=True, case=_case_info(c))

    return _expert_call(request, run)


@app.post("/api/kb3/expert/cases/{docId}/publish", response_model=ExpertCaseResponse,
          response_model_exclude_none=True)
def publish_my_expert_case(docId: str, req: PublishExpertCaseRequest, request: Request):
    """게시 = 내 에이전트(연결된 대화)에 반영 · 내리기 = 초안으로(공용 공유도 해제)."""
    from api.rag import kb3_store

    return _expert_call(request, lambda u: ExpertCaseResponse(
        ok=True, case=_case_info(kb3_store.set_expert_publish(u.user_id, docId, req.published))))


@app.post("/api/kb3/expert/share", response_model=ExpertCaseResponse, response_model_exclude_none=True)
def share_my_expert_cases(req: ShareExpertCasesRequest, request: Request):
    """공용 KB 로 보내기 — 관리자 승인 대기(pending)."""
    from api.rag import kb3_store

    return _expert_call(request, lambda u: ExpertCaseResponse(
        ok=True, cases=[_case_info(c) for c in kb3_store.request_expert_share(u.user_id, req.ids)]))


@app.post("/api/kb3/expert/preview", response_model=ChatResponse, response_model_exclude_none=True)
def preview_my_expert_agent(req: ExpertPreviewRequest, request: Request):
    """스튜디오 실제 AI 시험칸 — 실제 챗 파이프라인 + 내 사례(초안 포함) + 공용 KB3.
    계측 행은 conversationId 접두 `studio_` 로 남는다(G3 집계에서 뺀다)."""
    import time as _time

    from api import auth

    try:
        user = _expert_user(request)
    except auth.AuthError as exc:
        return auth._error(request, exc.status, exc.detail)
    cid = f"studio_{user.domain_id}_{int(_time.time() * 1000)}"
    try:
        with upstage_gate.turn_budget():
            return pipeline.run_clinic(cid, [], req.text, rag_override=True,
                                       agent_expert_id=user.user_id, preview_expert_id=user.user_id)
    except upstage_gate.UpstageCongested:
        return pipeline.congested_response(cid, [], "clinic", None)


@app.get("/api/kb3/share-queue", response_model=ShareQueueResponse, response_model_exclude_none=True)
def list_kb3_share_queue(request: Request, state: str = "pending"):
    """관리자 — 공용 KB 승인 대기 목록(state=pending) · 지금 공용에 반영된 사례(state=approved, 철회 대상)."""
    from api import auth
    from api.rag import kb3_store

    try:
        _expert_user(request, ("admin",))
    except auth.AuthError as exc:
        return auth._error(request, exc.status, exc.detail)
    if not kb3_store.is_configured():
        return ShareQueueResponse(dbConfigured=False, error="DB 미설정")
    try:
        rows = kb3_store.list_share_queue(state)
    except kb3_store.ExpertCaseError as exc:
        return ShareQueueResponse(error=str(exc))
    return ShareQueueResponse(ok=True, items=[
        ShareQueueItem(case=_case_info(r.case), expertDomainId=r.expert_domain_id, requestedAt=r.requested_at,
                       content=r.content) for r in rows])


@app.post("/admin/kb3/share/{docId}/review", response_model=ReviewShareResponse, response_model_exclude_none=True)
def review_kb3_share(docId: str, req: ReviewShareRequest, request: Request):
    """관리자 승인 = 공용 KB3(모든 챗) + 기여 원장 +1(DB 트리거 0056) · 거부 = 세무사 전용 그대로."""
    from api import auth
    from api.rag import kb3_store

    try:
        admin = _expert_user(request, ("admin",))
    except auth.AuthError as exc:
        return auth._error(request, exc.status, exc.detail)
    try:
        out = kb3_store.review_expert_share(docId, req.approve, admin.domain_id, req.note)
    except kb3_store.ExpertCaseError as exc:
        return ReviewShareResponse(error=str(exc))
    return ReviewShareResponse(ok=True, **out)


@app.post("/admin/kb3/share/{docId}/withdraw", response_model=ReviewShareResponse, response_model_exclude_none=True)
def withdraw_kb3_share(docId: str, req: WithdrawShareRequest, request: Request):
    """관리자 철회 = 공용 KB3 검색에서 빠짐 + 기여 원장 −1(DB 트리거 0056) · 세무사 전용 RAG 는 그대로."""
    from api import auth
    from api.rag import kb3_store

    try:
        admin = _expert_user(request, ("admin",))
    except auth.AuthError as exc:
        return auth._error(request, exc.status, exc.detail)
    try:
        out = kb3_store.withdraw_expert_share(docId, admin.domain_id, req.note)
    except kb3_store.ExpertCaseError as exc:
        return ReviewShareResponse(error=str(exc))
    return ReviewShareResponse(ok=True, **out)


# ── 3자 대화방 agent (0044, design/세무사에이전트_3자방_설계.md) ─────────────────────────
# /api/chat 은 손대지 않는다(인증 없음 — expert 범위를 열면 남의 게시 사례가 샌다). 여기는 토큰 필수, 방 참여자만.
# 선점은 동기(중복 차단 결과를 바로 돌려준다), 답 쓰기는 백그라운드 — 대기 표시는 room_agent_runs Realtime 으로.
from api.schema import RoomAgentReplyRequest, RoomAgentReplyResponse  # noqa: E402


@app.post("/api/rooms/{roomId}/agent-greet", response_model=RoomAgentReplyResponse,
          response_model_exclude_none=True)
def room_agent_greet(roomId: str, request: Request):
    """즉시 연결(R3, 0054) 직후 세무사 AI 첫 인사 — 방이 비어 있을 때만 1건(결정론 문장). 방 참여자만."""
    from api import auth, room_agent

    user = getattr(request.state, "user", None)
    if user is None:
        return auth._error(request, 401, "로그인이 필요합니다(Authorization: Bearer <token>)")
    try:
        status = room_agent.greet(roomId, user.domain_id)
    except room_agent.RoomAgentError as exc:
        return auth._error(request, exc.status, exc.detail)
    return RoomAgentReplyResponse(ok=True, status=status)


@app.post("/api/rooms/{roomId}/agent-reply", response_model=RoomAgentReplyResponse,
          response_model_exclude_none=True)
def room_agent_reply(roomId: str, req: RoomAgentReplyRequest, request: Request, background_tasks: BackgroundTasks):
    from api import auth, room_agent

    user = getattr(request.state, "user", None)
    if user is None:
        return auth._error(request, 401, "로그인이 필요합니다(Authorization: Bearer <token>)")
    try:
        c = room_agent.claim(roomId, req.triggerMessageId, user.domain_id, retry=req.retry)
    except room_agent.RoomAgentError as exc:
        return auth._error(request, exc.status, exc.detail)
    if c.mine:
        background_tasks.add_task(room_agent.run, c)
    return RoomAgentReplyResponse(ok=True, status=c.status)
