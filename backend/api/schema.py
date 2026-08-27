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


UiBlock = Union[VerdictCard, EvidenceChecklist]


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
    followUp: bool = False
    # 자문 경로 — 엔진 규칙 밖(etype=기타 등) 질문에 판정 대신 RAG 지식으로 답한 응답.
    # 판정(uiBlocks)이 없다는 뜻이고, "RAG 가 답할 수 있는 범위를 넓힌다"는 임팩트의 측정 지점이다.
    advisory: bool = False


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
