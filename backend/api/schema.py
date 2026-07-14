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


class RetractRequest(BaseModel):
    passageIds: list[str] = Field(default_factory=list)
    status: str = "retired"                         # 'retired'(연결끊기) | 'active'(재연결)


class RetractResponse(BaseModel):
    updated: int = 0
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
