"""
Seam A response schema — pydantic mirror of frontend `lib/conversation-schema.ts`.

The assistant `Message` this service returns MUST match, field-for-field, what the
frontend renders. Keep the two files in sync; the frontend Zod schema is the source
of truth (see docs API 계약 §2.1).
"""

from __future__ import annotations

from typing import Literal, Optional, Union

from pydantic import BaseModel, Field

# ── segment ───────────────────────────────────────────────────────────────────

SegmentType = Literal[
    "context", "question", "ack", "issue_framing", "rule_statement",
    "application", "evidence_request", "conclusion", "caveat", "follow_up",
]

Framework = Literal[
    "문언해석", "목적론해석", "체계적해석", "실질과세원칙",
    "신의성실원칙", "엄격해석", "입증책임", "유추해석",
]


class Segment(BaseModel):
    id: str = Field(min_length=1)
    text: str = Field(min_length=1)
    type: SegmentType
    framework: Optional[Framework] = None
    citations: Optional[list[str]] = None


# ── uiBlocks (discriminated union on `kind`) ────────────────────────────────────

Verdict = Literal["전부인정", "안분인정", "부인", "조건부"]


class VerdictCard(BaseModel):
    kind: Literal["verdict_card"] = "verdict_card"
    verdict: Verdict
    title: str
    summary: str


class ChecklistItem(BaseModel):
    label: str
    required: bool
    note: Optional[str] = None


class EvidenceChecklist(BaseModel):
    kind: Literal["evidence_checklist"] = "evidence_checklist"
    title: str
    items: list[ChecklistItem] = Field(min_length=1)


class ExpertHandoff(BaseModel):
    """세무사 연결 카드. 명단은 싣지 않는다 — 프론트가 렌더 시점에 list_experts() 로 조회.
    발행 조건은 api/handoff.py (명시 요청 / 자문 / 선례 없음 / 되묻기 누적)."""
    kind: Literal["expert_handoff"] = "expert_handoff"
    reason: str
    note: Optional[str] = None


UiBlock = Union[VerdictCard, EvidenceChecklist, ExpertHandoff]


# ── message ─────────────────────────────────────────────────────────────────────

class Message(BaseModel):
    id: str = Field(min_length=1)
    role: Literal["user", "assistant"]
    order: int = Field(ge=0)
    segments: list[Segment] = Field(min_length=1)
    uiBlocks: Optional[list[UiBlock]] = None


# ── request / response (docs API 계약 §2.4) ─────────────────────────────────────

Occupation = Literal["general", "clinic", "online-seller", "beauty"]


class UserInput(BaseModel):
    text: str = Field(min_length=1)


class ChatRequest(BaseModel):
    conversationId: str = Field(min_length=1)
    occupation: Occupation
    history: list[Message] = Field(default_factory=list)
    userInput: UserInput


class ChatMeta(BaseModel):
    """Audit/debug only — the frontend ignores this for rendering."""
    engine: Optional[str] = None
    extracted: Optional[dict] = None
    ragCaseRefs: list[str] = Field(default_factory=list)
    ragHits: int = 0                       # 검색된 RAG passage 수 (임팩트 측정용)
    ragSource: Optional[str] = None        # "kb2" | "rag" | "fusion" | "none" — A/B 비교용 (설계 §03)
    # 근거가 **어느 코퍼스에서 몇 개** 왔나 (로드맵 P7 A, 2026-09-18). ragSource 는 "어느
    # 검색기를 탔나"만 말해서, fusion 응답에서 kbdict 가 실제로 기여했는지 볼 수 없었다
    # (P3P4 기록 §3: "meta 에 코퍼스가 없어 kbdict 포함 여부 확인 불가").
    ragCorpora: Optional[dict[str, int]] = None      # {"kb2": 2, "rag": 2, "kbdict": 1}
    # 그 개수의 원시 목록 — 코퍼스·점수·순위·행 id. 개수만 남기면 "왜 그 청크가 들어왔나"를
    # 나중에 못 되짚는다(0027 의 교훈: 원시 목록을 버려 회차를 더 돌렸다).
    ragPassages: Optional[list[dict]] = None
    followUp: bool = False
    # 자문 경로 — 엔진 규칙 밖(etype=기타 등) 질문에 판정 대신 RAG 지식으로 답한 응답.
    # 판정 카드가 없다는 뜻이고(세무사 연결 카드는 붙을 수 있다), "RAG 가 답할 수 있는 범위를 넓힌다"는 임팩트의 측정 지점이다.
    advisory: bool = False
    # Upstage 호출 줄(upstage_gate)에서 턴당 대기 상한을 넘겨 답하지 않은 응답(P8 B). 판정·자문 없음.
    congested: bool = False
    # 세무사 연결 카드를 붙였다면 그 사유 — explicit | advisory | no_precedent | stalled.
    handoff: Optional[str] = None
    # 이 응답을 만든 파이프라인 — v2(api/pipeline_agentic.py)만 채운다. v1 응답엔 없다(exclude_none).
    pipeline: Optional[str] = None


class ChatResponse(BaseModel):
    message: Message
    meta: ChatMeta


# ── RAG write path (검수 확정 → 코멘트 C → KB 적재) ─────────────────────────────
# 운영 흐름 6단계의 마지막 삽: 세무사 검수가 확정(review.finalize)되면 accepted
# line_feedback(코멘트 C)이 질문 A + 답변 B 와 묶여 rag.passages 로 적재된다.
# 프론트가 정지 스냅샷에서 A/B 를 해소해 보내고, 백엔드가 Upstage 임베딩 + upsert.


class IngestFeedbackItem(BaseModel):
    feedbackId: str = Field(min_length=1)
    conversationId: str = Field(min_length=1)
    segmentId: str = Field(min_length=1)
    question: str = Field(min_length=1)          # 질문 A (정지 스냅샷에서 해소)
    answerSegment: str = ""                       # 답변 B (코멘트가 달린 세그먼트)
    comment: str = Field(min_length=1)            # 코멘트 C (세무사 원문 — 실 지식)
    reviewer: str = Field(min_length=1)           # 표시이름
    auditorId: Optional[str] = None               # 신원(도메인 id) — attribution/정산 연동
    tags: list[str] = Field(default_factory=list)
    occupation: Optional[str] = None
    taxCategory: Optional[str] = None
    caseRefs: list[str] = Field(default_factory=list)


class IngestFeedbackRequest(BaseModel):
    items: list[IngestFeedbackItem] = Field(default_factory=list)


class IngestedPassage(BaseModel):
    feedbackId: str
    passageId: str


class IngestFeedbackResponse(BaseModel):
    ingested: list[IngestedPassage] = Field(default_factory=list)
    skipped: int = 0                              # DB 미설정 등으로 건너뛴 건수
    dbConfigured: bool = True


# ── 정성 평가 적재 (검수실(정성 평가) 최종 승인 → 세션 총평 → KB) ────────────────
# 문장 단위 코멘트와 나란한 두 번째 write-path. 총평은 특정 segment 에 걸리지 않으므로
# segmentId 가 없고, 대신 세션 점수(문장력·법률적 정확성)를 함께 싣는다(0015).


class IngestSessionEvalItem(BaseModel):
    evaluationId: str = Field(min_length=1)       # session_evaluations.id
    conversationId: str = Field(min_length=1)
    topic: str = Field(min_length=1)              # 상담 주제 — 번들의 [질문] 자리
    transcriptDigest: str = ""                    # 상담 요지 발췌 — [AI 답변] 자리
    qualitative: str = Field(min_length=1)        # 총평 원문 (실 지식)
    writingScore: int = Field(ge=1, le=5)
    legalAccuracyScore: int = Field(ge=1, le=5)
    reviewer: str = Field(min_length=1)           # 표시이름
    auditorId: Optional[str] = None               # 신원(도메인 id)
    occupation: Optional[str] = None
    taxCategory: Optional[str] = None
    caseRefs: list[str] = Field(default_factory=list)


class IngestSessionEvalRequest(BaseModel):
    items: list[IngestSessionEvalItem] = Field(default_factory=list)


class IngestedSessionEval(BaseModel):
    evaluationId: str
    passageId: str


class IngestSessionEvalResponse(BaseModel):
    ingested: list[IngestedSessionEval] = Field(default_factory=list)
    skipped: int = 0
    dbConfigured: bool = True


# ── dedup 사전검토 (검수실 — 인정/거절 결정 전에 기존 KB 와 겹치는지 확인) ─────────
# 같은 질문/유사 질문에 다른 세무사가 이미 같은 지식을 남겼는데, 검수자가 그걸 모른 채
# 또 인정하면 KB 에 중복 passage 가 쌓이고 정산 기여도도 중복으로 부풀려진다(2026-08-27
# 세션에서 발견 — 실제로 KB 에 이미 벌어져 있던 사례로 확인). 최종승인 전, 검수 단계에서
# 후보 텍스트를 미리 임베딩해 기존 active passage 와 비교해 보여준다.


class DedupMatch(BaseModel):
    id: str
    content: str
    sourceKind: str
    reviewer: Optional[str] = None
    auditorId: Optional[str] = None
    createdAt: int
    score: float                                    # 코사인 유사도, 1에 가까울수록 유사


class DedupCheckResult(BaseModel):
    key: str                                        # 호출부 상관관계 키(feedbackId/evaluationId)
    matches: list[DedupMatch] = Field(default_factory=list)


class DedupCheckFeedbackRequest(BaseModel):
    items: list[IngestFeedbackItem] = Field(default_factory=list)
    k: int = 3


class DedupCheckSessionEvalRequest(BaseModel):
    items: list[IngestSessionEvalItem] = Field(default_factory=list)
    k: int = 3


class DedupCheckResponse(BaseModel):
    results: list[DedupCheckResult] = Field(default_factory=list)
    dbConfigured: bool = True


# ── 포장실 추적 (RAG 로 실린 데이터셋 조회 + 연결끊기/재연결) ─────────────────────
# 검수 확정으로 RAG 에 실린 코멘트를 대화(=방) 단위로 추적하고, status 를 retired 로
# 내려 KB 검색에서 제외(삭제 아님 → 추적 보존)한다.


class PassageInfo(BaseModel):
    id: str
    dedupeKey: str
    content: str
    sourceKind: str
    conversationId: Optional[str] = None
    segmentId: Optional[str] = None
    feedbackId: Optional[str] = None
    reviewer: Optional[str] = None
    auditorId: Optional[str] = None
    taxCategory: Optional[str] = None
    occupation: Optional[str] = None
    feedbackTags: list[str] = Field(default_factory=list)
    status: str                                    # 'active' | 'retired'
    createdAt: int
    updatedAt: int


class PassagesResponse(BaseModel):
    passages: list[PassageInfo] = Field(default_factory=list)
    dbConfigured: bool = True


class PassageNeighbor(BaseModel):
    """passage 중심의 유사도 이웃 — auditor KB 지도 상세뷰(거미줄 근접 노드)."""
    id: str
    dedupeKey: str
    content: str
    sourceKind: str
    taxCategory: Optional[str] = None
    occupation: Optional[str] = None
    feedbackTags: list[str] = Field(default_factory=list)
    score: float                                    # 코사인 유사도, 1에 가까울수록 유사


class PassageNeighborsResponse(BaseModel):
    neighbors: list[PassageNeighbor] = Field(default_factory=list)
    dbConfigured: bool = True


class RetractRequest(BaseModel):
    passageIds: list[str] = Field(default_factory=list)
    status: str = "retired"                         # 'retired'(연결끊기) | 'active'(재연결)


class RetractResponse(BaseModel):
    updated: int = 0
    dbConfigured: bool = True


# ── 질문 기반 검색 미리보기 (§3.5 이어서, 2026-08-28) ─────────────────────────
# auditor 가 "이 질문이면 solar-pro3 가 KB 에서 뭘 참고할까"를 직접 확인하는 화면.
# 저장/기록 없는 읽기 전용 조회 — RAG 파이프라인(SupabaseRetriever)과 정확히 같은
# 경로(embed_query → rag.match_passages)로 top-k 를 구한다.


class SearchPreviewMatch(BaseModel):
    id: str
    content: str
    sourceKind: str
    taxCategory: Optional[str] = None
    occupation: Optional[str] = None
    score: float                                    # 코사인 유사도, 1에 가까울수록 유사


class SearchPreviewRequest(BaseModel):
    query: str
    k: int = 8


class SearchPreviewResponse(BaseModel):
    matches: list[SearchPreviewMatch] = Field(default_factory=list)
    dbConfigured: bool = True


# ── 세목 소급 재분류 (KB "질문 관점" 클러스터링, 2026-08-28) ────────────────────
# 정책은 api/rag/taxonomy.py 참고 — tax_category 전량이 플레이스홀더("미분류")였던
# 문제를 Upstage 분류로 메운다. 재임베딩 없음(메타데이터만 갱신).


class ReclassifyTaxCategoriesResponse(BaseModel):
    updated: int = 0
    distribution: dict[str, int] = Field(default_factory=dict)
    dbConfigured: bool = True


# ── 지식베이스2 합성 (설계 아티팩트 §02, 2026-09-03) ────────────────────────────
# admin 전용 트리거 — 지금 시점 rag.passages(active) 로부터 kb2.sentences 를 재구성.


class Kb2CategorySynthesisResult(BaseModel):
    taxCategory: str
    documentId: str | None = None
    created: int = 0
    lockedSkipped: int = 0


class Kb2SynthesizeResponse(BaseModel):
    results: list[Kb2CategorySynthesisResult] = Field(default_factory=list)
    dbConfigured: bool = True


# ── 지식베이스2 조회·수정 (로드맵 4단계, auditor 직접 수정, 2026-09-09) ──────────


class Kb2DocumentInfo(BaseModel):
    id: str
    taxCategory: str
    title: str
    status: str  # 'active' | 'retired'(사람이 끊음) | 'archived'(재구조화로 세대교체)
    createdAt: int
    updatedAt: int
    groupId: str | None = None
    statusReason: str | None = None
    statusActor: str | None = None


class SetKb2DocumentStatusRequest(BaseModel):
    """세목 연결 끊기/재연결 — 문장 단위(SetKb2SentenceStatusRequest)와 같은 규약."""

    status: str  # 'active' | 'retired'
    editorAuditorId: str
    reason: str


class DeleteKb2GroupResponse(BaseModel):
    """대목 삭제 — detachedDocuments: 미분류로 풀려난 세목 수(세목은 안 지운다)."""

    deleted: bool = False
    detachedDocuments: int = 0
    dbConfigured: bool = True


class Kb2DocumentsResponse(BaseModel):
    documents: list[Kb2DocumentInfo] = Field(default_factory=list)
    dbConfigured: bool = True


class Kb2SentenceInfo(BaseModel):
    id: str
    documentId: str
    orderIndex: int
    content: str
    sourcePassageIds: list[str] = Field(default_factory=list)
    attribution: list[dict] = Field(default_factory=list)
    lockedByAuditor: bool = False
    version: int = 1
    createdAt: int
    updatedAt: int
    lockedBy: str | None = None
    effectivelyLocked: bool = False
    status: str = "active"


class Kb2SentencesResponse(BaseModel):
    sentences: list[Kb2SentenceInfo] = Field(default_factory=list)
    dbConfigured: bool = True


class UpdateKb2SentenceRequest(BaseModel):
    content: str
    editorAuditorId: str


class UpdateKb2SentenceResponse(BaseModel):
    sentence: Kb2SentenceInfo | None = None
    dbConfigured: bool = True


class Kb2SentenceVersionInfo(BaseModel):
    id: str
    versionNo: int
    content: str
    attributionSnapshot: list[dict] = Field(default_factory=list)
    editorType: str
    editorId: str
    createdAt: int
    meta: dict | None = None


class Kb2SentenceVersionsResponse(BaseModel):
    versions: list[Kb2SentenceVersionInfo] = Field(default_factory=list)
    dbConfigured: bool = True


class Kb2SourcePassage(BaseModel):
    id: str
    content: str
    taxCategory: str | None = None
    auditorId: str | None = None


class Kb2SentenceSourcesResponse(BaseModel):
    passages: list[Kb2SourcePassage] = Field(default_factory=list)
    dbConfigured: bool = True


# ── kb2 동적 카테고리 재구조화 (로드맵 4.5단계, 2026-09-09) ────────────────────────


class StartKb2RestructureRequest(BaseModel):
    """scheduleAt: 실행 예약 시각(epoch ms). 생략하면 기존처럼 즉시 실행.
    시각은 브라우저(사용자 로컬=KST)가 계산해 보낸다 — 서버가 도쿄 박스라 서버
    로컬 시간으로 '새벽 3시'를 해석하면 의도와 어긋난다."""

    scheduleAt: int | None = None


class Kb2RestructureStartResponse(BaseModel):
    jobId: str | None = None
    scheduledAt: int | None = None
    dbConfigured: bool = True


class Kb2JobInfo(BaseModel):
    id: str
    status: str
    stage: str
    totalCategories: int = 0
    completedCategories: int = 0
    result: dict | None = None
    error: str | None = None
    createdAt: int
    updatedAt: int
    scheduledAt: int | None = None
    triggerSource: str = "manual"


class Kb2RestructureJobResponse(BaseModel):
    job: Kb2JobInfo | None = None
    dbConfigured: bool = True


class Kb2ScheduledJobsResponse(BaseModel):
    jobs: list[Kb2JobInfo] = []
    dbConfigured: bool = True


class CancelKb2ScheduleResponse(BaseModel):
    cancelled: bool = False
    dbConfigured: bool = True


# ── kb2 2단 트리(대목/세목) + 문장 이동 + 편집 락 (로드맵 4.6단계, 2026-09-09) ────────


class Kb2GroupInfo(BaseModel):
    id: str
    label: str
    status: str
    createdAt: int
    updatedAt: int


class Kb2GroupsResponse(BaseModel):
    groups: list[Kb2GroupInfo] = Field(default_factory=list)
    dbConfigured: bool = True


class CreateKb2GroupRequest(BaseModel):
    label: str


class CreateKb2GroupResponse(BaseModel):
    group: Kb2GroupInfo | None = None
    dbConfigured: bool = True


class CreateKb2DocumentRequest(BaseModel):
    groupId: str | None = None
    title: str


class CreateKb2DocumentResponse(BaseModel):
    document: Kb2DocumentInfo | None = None
    dbConfigured: bool = True


class RenameKb2DocumentRequest(BaseModel):
    title: str


class SetKb2DocumentGroupRequest(BaseModel):
    groupId: str | None = None


class UpdateKb2DocumentResponse(BaseModel):
    document: Kb2DocumentInfo | None = None
    dbConfigured: bool = True


class MoveKb2SentenceRequest(BaseModel):
    targetDocumentId: str
    editorAuditorId: str


class MoveKb2SentenceResponse(BaseModel):
    sentence: Kb2SentenceInfo | None = None
    dbConfigured: bool = True


class Kb2LockRequest(BaseModel):
    auditorId: str


class Kb2LockResponse(BaseModel):
    ok: bool
    lockedBy: str | None = None
    dbConfigured: bool = True


class Kb2AutoGroupResponse(BaseModel):
    groupsCreated: int = 0
    # 기존 대목을 그대로 쓴 건수(2026-09-16). 생성과 합치지 않는다 — 재사용은 정상이고
    # 생성이 반복되는 것이 사고라, 한 숫자로 접으면 화면에서 둘을 구분할 수 없다.
    groupsReused: int = 0
    documentsGrouped: int = 0
    # 모델이 빠뜨려 미분류로 남은 세목 수 — 0 이 정상. 화면이 "몇 건은 그대로 미분류"를
    # 말할 수 있어야 사람이 손볼 자리를 안다.
    documentsUngrouped: int = 0
    dbConfigured: bool = True


class SetKb2SentenceStatusRequest(BaseModel):
    status: str  # 'active' | 'retired'
    editorAuditorId: str
    reason: str


class SetKb2SentenceStatusResponse(BaseModel):
    sentence: Kb2SentenceInfo | None = None
    dbConfigured: bool = True


# ── 미리 계산된 유사도 그래프 (KB 전체 거미줄 그래프 시각화, 2026-08-28) ──────────
# rag.passage_edges 를 그대로 읽어온다 — 조회 시점 계산이 아니라 pg_cron 이 5분마다
# 미리 채워둔 값. 화면(force-directed 그래프)은 이 edge 목록 + listPassages() 만으로 그린다.


class PassageEdge(BaseModel):
    sourceId: str
    targetId: str
    score: float


class PassageEdgesResponse(BaseModel):
    edges: list[PassageEdge] = Field(default_factory=list)
    dbConfigured: bool = True


class RebuildEdgesResponse(BaseModel):
    edgeCount: int = 0
    dbConfigured: bool = True


# ── 소급 중복 탐지 (§3.1 — 정산 기여도 오염 방지) ────────────────────────────────
# dedup 사전검토(위 DedupCheck*)는 신규 유입만 막는다. 이건 이미 저장된 KB 전체를
# 훑어 유사도 threshold 이상인 클러스터를 찾는 1회성 배치 조회 — 실제 정리(retired)는
# 위 RetractRequest 를 그대로 재사용한다(admin 수동 확인 후).


class DuplicateCluster(BaseModel):
    ids: list[str] = Field(default_factory=list)
    maxScore: float                                 # 클러스터 내 최댓값 쌍 유사도
    passages: list[PassageInfo] = Field(default_factory=list)


class DuplicateClustersResponse(BaseModel):
    clusters: list[DuplicateCluster] = Field(default_factory=list)
    threshold: float = 0.85
    dbConfigured: bool = True


# ── 정산 존속연동 (세무사별 살아있는 RAG 기여도) ─────────────────────────────────
# 정산 분배의 파생 원천: status='active' passage 를 auditor_id 로 집계한 "지금 살아있는
# 기여도". 포장실 연결끊기로 passage 가 retired 되면 여기서 자동으로 빠진다
# (메모리 project_operational_flow — 기여=RAG 존속기간).


class ContributionCount(BaseModel):
    auditorId: str
    activeCount: int                                # 살아있는(active) passage 수


class ContributionsResponse(BaseModel):
    contributions: list[ContributionCount] = Field(default_factory=list)
    dbConfigured: bool = True


# ── 수정 제안 큐 (§3.4 admin 승인/반려 워크플로우) ──────────────────────────────
# 기여 정책(2026-08-27): 수정해도 원작성자 존속기간 기여는 그대로, 수정은 이력만 남는다.
# pending 동안은 rag.passages 불변 — 승인 시점에만 content/embedding 갱신.


class ProposeEditRequest(BaseModel):
    passageId: str
    proposedContent: str
    editorAuditorId: str
    editorReviewer: Optional[str] = None


class ProposeEditResponse(BaseModel):
    editId: Optional[str] = None
    dbConfigured: bool = True


class PassageEdit(BaseModel):
    id: str
    passageId: str
    originalContent: str
    proposedContent: str
    editorAuditorId: str
    editorReviewer: Optional[str] = None
    status: str                                     # 'pending' | 'approved' | 'rejected'
    adminId: Optional[str] = None
    adminNote: Optional[str] = None
    createdAt: int
    reviewedAt: Optional[int] = None


class PassageEditsResponse(BaseModel):
    edits: list[PassageEdit] = Field(default_factory=list)
    dbConfigured: bool = True


class ReviewEditRequest(BaseModel):
    adminId: str
    adminNote: Optional[str] = None                 # 반려 사유(승인 시 무시)


class ReviewEditResponse(BaseModel):
    ok: bool = False
    passageId: Optional[str] = None                 # 승인 시에만 채워짐
    dbConfigured: bool = True


# ── RAG on/off 토글 + 구성 통계 (admin 'RAG' 화면) ──────────────────────────────
# 전역 RAG on/off 를 app_config.rag_enabled 에 영속 → rag_enabled() 가 요청 단위로 읽음.
# stats 는 "무엇이 어떻게 실렸는지"(source_kind 분포·기여 대화/세무사)를 요약한다.


class RagToggleRequest(BaseModel):
    enabled: bool


class RagStatusResponse(BaseModel):
    ragEnabled: bool
    dbConfigured: bool


class RagSourceKindCount(BaseModel):
    sourceKind: str                                # feedback | case_seed | kb_document | conversation
    count: int


class RagStatsResponse(BaseModel):
    dbConfigured: bool
    ragEnabled: bool
    totalActive: int = 0                            # 검색에 살아있는 passage 수
    totalRetired: int = 0                           # 연결끊긴 passage 수(추적 보존)
    conversations: int = 0                          # 기여 대화 수
    auditors: int = 0                               # 기여 세무사 수
    bySourceKind: list[RagSourceKindCount] = Field(default_factory=list)


# ── L0 규범 검토·편집 (KB통합 3층검색 로드맵 P5, 2026-09-17) ─────────────────────
# 거버넌스(P6 ②): 초안(admin·auditor 누구나) → 공개(이의 기간 1일) → 반영(세무사 승인 문턱 또는 기한 경과).
# 신원은 토큰으로 서버가 정한다(P6 ①) — 본문의 editorId 등은 과도기 호환용, 토큰이 있으면 무시.
# 거절(권한·충돌·예산·상태)은 HTTP 오류가 아니라 ok=false + error 문구로 돌려준다.

class NormDecisionInfo(BaseModel):
    auditorId: str
    decision: str                                   # approve | object
    reason: Optional[str] = None
    createdAt: int


class NormVersionInfo(BaseModel):
    id: str
    versionNo: Optional[int] = None                 # 확정본만 번호가 있다
    content: str
    status: str                                     # draft | pending | confirmed | discarded
    baseVersionId: Optional[str] = None
    note: Optional[str] = None
    authorId: str
    updatedBy: str
    confirmedBy: Optional[str] = None
    confirmedAt: Optional[int] = None
    discardedBy: Optional[str] = None
    discardedAt: Optional[int] = None
    createdAt: int
    updatedAt: int
    publishedBy: Optional[str] = None
    publishedAt: Optional[int] = None
    deadlineAt: Optional[int] = None                # 이 시각이 지나고 이의가 없으면 자동 반영
    appliedVia: Optional[str] = None                # direct | approvals | deadline | rollback
    adminReason: Optional[str] = None               # admin 브레이크(거부·롤백) 사유
    decisions: list[NormDecisionInfo] = Field(default_factory=list)  # 공개 중일 때 유효 결정
    approvals: int = 0                              # 작성자·공개자 제외 승인 수
    objections: int = 0


class NormDocumentInfo(BaseModel):
    name: str                                       # master | frameworks | pitfalls
    title: str
    active: Optional[NormVersionInfo] = None
    draft: Optional[NormVersionInfo] = None


class NormsResponse(BaseModel):
    documents: list[NormDocumentInfo] = Field(default_factory=list)
    maxChars: int
    activeChars: int = 0                            # 확정본 조합의 주입 블록 길이
    injectedSource: str = "none"                    # 이 프로세스가 지금 주입 중인 출처: db | md | none
    injectedChars: int = 0
    fastApprovals: int = 0                          # 즉시 반영에 필요한 승인 수
    objectionPeriodSec: int = 0
    dbConfigured: bool = True


class NormVersionsResponse(BaseModel):
    versions: list[NormVersionInfo] = Field(default_factory=list)
    dbConfigured: bool = True


class SaveNormDraftRequest(BaseModel):
    content: str
    editorId: str = ""                              # 과도기 호환 — 토큰이 있으면 무시
    note: Optional[str] = None
    expectedUpdatedAt: Optional[int] = None         # 기존 초안 갱신 시 필수(낙관적 잠금)
    baseVersionId: Optional[str] = None             # 되돌리기: 이 확정본에서 새 초안


class DiscardNormDraftRequest(BaseModel):
    editorId: str = ""


class PublishNormDraftRequest(BaseModel):
    expectedUpdatedAt: int                          # 화면에서 본 초안의 updatedAt
    note: Optional[str] = None


class NormDecisionRequest(BaseModel):
    decision: str                                   # approve | object
    reason: Optional[str] = None                    # 이의는 필수
    expectedUpdatedAt: int                          # 화면에서 본 제안의 updatedAt


class RejectNormProposalRequest(BaseModel):
    reason: str                                     # 필수 — 이력에 남는다


class RollbackNormRequest(BaseModel):
    reason: str                                     # 필수
    expectedActiveVersionId: str                    # 화면에서 본 확정본 — 그 사이 바뀌었으면 거절


class NormVersionResponse(BaseModel):
    ok: bool = False
    applied: bool = False                           # 이 요청으로 반영까지 됐는지
    version: Optional[NormVersionInfo] = None
    error: Optional[str] = None
    dbConfigured: bool = True
