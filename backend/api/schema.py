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
    "summary",   # 답 전체의 결론 문단(1~2문장) — 자문 답에도 쓰는 요약. 판정(conclusion)과 다르다(10/14, answer_display)
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
    ragSource: Optional[str] = None        # "kb3" | "none" (절단 S5 전 회차엔 "kb2" | "rag" | "fusion" 도)
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
    # 근로소득세 계산 갈래(R2-c) — calc.income_tax 결과(단계 trace·결정세액·가정한 슬롯). 화면은 아직 안 쓴다(프론트는
    # message 만 검증하므로 새 필드여도 파싱 실패 없음). 계측·R2-d 블록의 원천.
    calc: Optional[dict] = None


class ChatResponse(BaseModel):
    message: Message
    meta: ChatMeta


# (옛 검수 흐름의 적재·dedup·포장실·검색 미리보기·재분류·KB2·간선·중복·정산·수정 제안·통계·규범 편집
#  모델은 그 API 와 함께 절단 S3, 검색 토글 요청·응답 모델은 S5(10/16)에서 지웠다.)


# ── 세무사 사례(kb3_expert) — 에이전트 스튜디오 서버 저장 (0043, 2026-10-06) ──────────────
class ExpertCaseInfo(BaseModel):
    id: str                                         # kb3.documents.id
    agentId: str
    localId: str                                    # 스튜디오 KnowledgeCase.id
    title: str
    facts: str = ""
    judgment: str = ""
    conclusion: str = ""
    exceptions: str = ""
    keywords: str = ""
    publishState: str                               # draft | published
    shareState: Optional[str] = None                # None | pending | approved | rejected
    shareNote: Optional[str] = None
    caseNumber: Optional[str] = None
    expertName: Optional[str] = None
    updatedAt: int


class SaveExpertCaseRequest(BaseModel):
    agentId: str = Field(min_length=1, max_length=200)
    localId: str = Field(min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=100)
    facts: str = Field(min_length=1, max_length=6000)
    judgment: str = Field(min_length=1, max_length=6000)
    conclusion: str = Field(min_length=1, max_length=6000)
    exceptions: str = Field(default="", max_length=6000)
    keywords: str = Field(default="", max_length=500)


class PublishExpertCaseRequest(BaseModel):
    published: bool


class ShareExpertCasesRequest(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=100)


class ExpertCaseResponse(BaseModel):
    ok: bool = False
    case: Optional[ExpertCaseInfo] = None
    cases: list[ExpertCaseInfo] = Field(default_factory=list)
    error: Optional[str] = None
    dbConfigured: bool = True


class ExpertPreviewRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class ShareQueueItem(BaseModel):
    case: ExpertCaseInfo
    expertDomainId: Optional[str] = None
    requestedAt: int
    content: str


class ShareQueueResponse(BaseModel):
    ok: bool = False
    items: list[ShareQueueItem] = Field(default_factory=list)
    error: Optional[str] = None
    dbConfigured: bool = True


class ReviewShareRequest(BaseModel):
    approve: bool
    note: Optional[str] = Field(default=None, max_length=1000)


class WithdrawShareRequest(BaseModel):
    note: Optional[str] = Field(default=None, max_length=1000)


class ReviewShareResponse(BaseModel):
    ok: bool = False
    shareState: Optional[str] = None
    ledgerId: Optional[str] = None
    error: Optional[str] = None


# ── 3자 대화방 agent (0044) ─────────────────────────────────────────────────────
class RoomAgentReplyRequest(BaseModel):
    triggerMessageId: str = Field(min_length=1, max_length=200)
    retry: bool = False          # failed·expired 를 다시 잡는다('다시 시도')


class RoomAgentReplyResponse(BaseModel):
    ok: bool = False
    # running = 이 호출이 잡아 백그라운드로 돈다 · busy = 방에 다른 run · off = 스위치 꺼짐 · 그 밖 = 기존 run 상태
    status: Optional[str] = None
    error: Optional[str] = None
