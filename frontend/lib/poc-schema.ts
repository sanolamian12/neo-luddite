import { z } from "zod";

/**
 * PoC 단계의 추가 엔터티 스키마.
 *
 * Pool / AuditTask / Audit (metadata wrapper) /
 * Inquiry / Mail / LedgerEntry — 모두 zod 로 검증되며 store / service 가 같이 사용.
 *
 * 라인 피드백 / 세션 평가 자체는 기존 `lib/audit-schema.ts` 의 LineFeedback /
 * SessionEval 를 그대로 재사용한다 (현재는 conversationId 키, P2 에서 auditId 로 마이그레이션).
 */

// ── Auditor Registry ─────────────────────────────────────────────────────────
/**
 * 평가자 레지스트리 — `account-store` 의 세션 계정과 분리된 다중 평가자 데이터.
 *
 * PoC 가정:
 *  - 세션은 단일 `auditor` 계정으로 고정 (account-store 에 1개).
 *  - 그러나 admin 의 "평가자 관리" 화면은 다중 평가자를 표시해야 하므로,
 *    여기서 별도 registry 를 둔다.
 *  - 시드 auditor (id="auditor") 는 registry 에도 있어야 한다 (관리 화면에서 노출됨).
 *  - 추가 시드 평가자는 historical 활동 (audit / ledger entry) 의 출처로 사용된다.
 */
export const auditorStatusSchema = z.enum(["active", "suspended"]);
export type AuditorStatus = z.infer<typeof auditorStatusSchema>;

export const auditorEntrySchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  email: z.string().email().or(z.string().min(1)), // PoC: 느슨한 검증
  phone: z.string().optional(),
  qualifications: z.array(z.string()).default([]),
  status: auditorStatusSchema.default("active"),
  createdAt: z.number().int().nonnegative(),
  lastActiveAt: z.number().int().nonnegative().optional(),
  note: z.string().optional(),
});
export type AuditorEntry = z.infer<typeof auditorEntrySchema>;

// ── 세무사 상담 프로필 (채팅 연결 카드에 뜨는 정보, 0034) ─────────────────────────
// 세무사가 /audit/profile 에서 직접 기입. 연락처는 채널별 공개 범위를 가진다.
export const consultationAvailabilitySchema = z.enum(["available", "busy", "offline"]);
export type ConsultationAvailability = z.infer<typeof consultationAvailabilitySchema>;

export const contactVisibilitySchema = z.enum(["public", "after_accept", "hidden"]);
export type ContactVisibility = z.infer<typeof contactVisibilitySchema>;

export const CONTACT_CHANNELS = ["phone", "email", "kakao"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export const expertContactSchema = z.object({
  /** 호출자에게 공개되지 않으면 undefined (list_experts 가 걸러 준다). */
  value: z.string().optional(),
  visibility: contactVisibilitySchema,
});
export type ExpertContact = z.infer<typeof expertContactSchema>;

/** 세무사 본인이 편집하는 프로필 원본. */
export const expertProfileSchema = z.object({
  auditorId: z.string().min(1),
  listed: z.boolean(),
  bio: z.string(),
  specialties: z.array(z.string()),
  yearsExperience: z.number().int().nonnegative(),
  availability: consultationAvailabilitySchema,
  avatarUrl: z.string().optional(),
  contacts: z.record(z.enum(CONTACT_CHANNELS), expertContactSchema),
  updatedAt: z.number().int().nonnegative(),
});
export type ExpertProfile = z.infer<typeof expertProfileSchema>;

/** 채팅 카드용 세무사 한 명 (list_experts() 결과). */
export const expertCardSchema = z.object({
  auditorId: z.string().min(1),
  displayName: z.string().min(1),
  qualifications: z.array(z.string()),
  bio: z.string(),
  specialties: z.array(z.string()),
  yearsExperience: z.number().int().nonnegative(),
  availability: consultationAvailabilitySchema,
  avatarUrl: z.string().optional(),
  avatarColor: z.string().optional(),
  contacts: z.record(z.enum(CONTACT_CHANNELS), expertContactSchema),
  likeCount: z.number().int().nonnegative(),
  likedByMe: z.boolean(),
  /** 실제 검수 이력(제출 이상) 건수 — 카드의 "누적 검수 N건" 뱃지. */
  reviewedCount: z.number().int().nonnegative(),
  /** 이 대화를 검수한 적이 있는지 — 목록 맨 앞 정렬. */
  reviewedThisCase: z.boolean(),
});
export type ExpertCard = z.infer<typeof expertCardSchema>;

// ── 상담 신청 (0034 신청 · 0035 상태 전이) ─────────────────────────────────────
// 전이는 transition_consultation() RPC 로만: pending → accepted | declined | cancelled,
// accepted → completed.
export const consultationStatusSchema = z.enum([
  "pending",
  "accepted",
  "declined",
  "completed",
  "cancelled",
]);
export type ConsultationStatus = z.infer<typeof consultationStatusSchema>;

export const statusHistoryEntrySchema = z.object({
  status: consultationStatusSchema,
  at: z.number().int().nonnegative(),
  actor: z.string().optional(),
  note: z.string().optional(),
});

export const consultationRequestSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  viewerId: z.string().min(1),
  expertId: z.string().min(1),
  message: z.string().optional(),
  status: consultationStatusSchema,
  statusHistory: z.array(statusHistoryEntrySchema),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});
export type ConsultationRequest = z.infer<typeof consultationRequestSchema>;

// ── 비식별 상담사 풀 (0037) — 하차장 "Pool" 과 다른 것 ──────────────────────────
// 동의 = 대화 1건 · 7일 · 언제든 철회. 풀 노출 = 철회 안 됨 && 만료 전.
// 마스킹은 DB(mask_conversation_payload)가 한다 — 클라이언트는 결과만 받는다.
export const MASK_RULES = [
  "전화",
  "이메일",
  "사업자번호",
  "주민번호",
  "계좌",
  "카드",
  "주소",
  "상호",
  "이름",
] as const;
export type MaskRule = (typeof MASK_RULES)[number];
export type MaskReport = Partial<Record<MaskRule, number>>;

export interface PoolConsent {
  conversationId: string;
  viewerId: string;
  grantedAt: number;
  expiresAt: number;
  revokedAt?: number;
  maskReport: MaskReport;
}

export type PoolConsentState = "active" | "expired" | "revoked";

/** 세무사 풀 목록 한 건(본문 없음 — 상세는 openCase 로, 열람 기록이 남는다). */
export interface PoolCaseSummary {
  conversationId: string;
  occupation?: string;
  taxCategory?: string;
  title?: string;
  firstQuestion?: string;
  turnCount: number;
  grantedAt: number;
  expiresAt: number;
  maskReport: MaskReport;
  viewedByMe: boolean;
}

// ── Pool ─────────────────────────────────────────────────────────────────────
export const poolStatusSchema = z.enum(["new", "assigned", "excluded"]);
export type PoolStatus = z.infer<typeof poolStatusSchema>;

export const poolCandidateSchema = z.object({
  conversationId: z.string().min(1),
  occupation: z.string().min(1),
  topic: z.string().optional(),
  turnCount: z.number().int().nonnegative(),
  firstUserMessage: z.string().optional(),
  assistantTokenEstimate: z.number().int().nonnegative().optional(),
  addedAt: z.number().int().nonnegative(),
  status: poolStatusSchema.default("new"),
  excludedReason: z.string().optional(),
});
export type PoolCandidate = z.infer<typeof poolCandidateSchema>;

// ── AuditTask ────────────────────────────────────────────────────────────────
export const taskStatusSchema = z.enum(["open", "full", "in_progress", "closed"]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const taskConditionsSchema = z.object({
  minAcceptedContributions: z.number().int().nonnegative().optional(),
  minCategoryExperience: z
    .object({ category: z.string(), count: z.number().int().nonnegative() })
    .optional(),
  rankingPercentile: z.number().min(0).max(100).optional(),
});
export type TaskConditions = z.infer<typeof taskConditionsSchema>;

export const taskPickupSchema = z.object({
  auditorId: z.string().min(1),
  pickedAt: z.number().int().nonnegative(),
  auditId: z.string().min(1),
});
export type TaskPickup = z.infer<typeof taskPickupSchema>;

export const auditTaskSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  conversationIds: z.array(z.string().min(1)).min(1),
  capacity: z.number().int().positive(),
  conditions: taskConditionsSchema.optional(),
  deadline: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  createdBy: z.string().min(1),
  pickups: z.array(taskPickupSchema).default([]),
  status: taskStatusSchema.default("open"),
  note: z.string().optional(),
});
export type AuditTask = z.infer<typeof auditTaskSchema>;

// ── Audit (metadata wrapper) ─────────────────────────────────────────────────
export const auditStatusSchema = z.enum([
  "draft",
  "submitted",
  "reviewed",
  "finalized",
  "cancelled",
]);
export type AuditStatus = z.infer<typeof auditStatusSchema>;

// ── Review (admin 가 audit 을 검수) ─────────────────────────────────────────
export const feedbackDecisionSchema = z.object({
  feedbackId: z.string().min(1),
  accepted: z.boolean(),
  reason: z.string().optional(),
  decidedAt: z.number().int().nonnegative(),
});
export type FeedbackDecision = z.infer<typeof feedbackDecisionSchema>;

export const reviewStatusSchema = z.enum(["draft", "saved", "finalized"]);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

export const reviewSchema = z.object({
  id: z.string().min(1),
  auditId: z.string().min(1),
  reviewerId: z.string().min(1),
  decisions: z.array(feedbackDecisionSchema).default([]),
  overallNote: z.string().optional(),
  finalizedAt: z.number().int().nonnegative().optional(),
  disputeWindowEndsAt: z.number().int().nonnegative().optional(),
  status: reviewStatusSchema.default("draft"),
  createdAt: z.number().int().nonnegative(),
  /**
   * 평가자별로 결과를 본 시각 (배지 도트용). auditorId → ms.
   * 검수는 대화 단위라 공동 평가자가 review 하나를 공유하므로, "봤다"는 각자 따로 기록한다.
   */
  seenByAuditors: z.record(z.string(), z.number().int().nonnegative()).default({}),
});
export type Review = z.infer<typeof reviewSchema>;

// ── Inquiry (auditor 가 review 결과에 이의제기) ─────────────────────────────
export const inquiryStatusSchema = z.enum(["open", "replied", "resolved"]);
export type InquiryStatus = z.infer<typeof inquiryStatusSchema>;

export const inquiryMessageSchema = z.object({
  id: z.string().min(1),
  authorId: z.string().min(1),
  authorRole: z.enum(["auditor", "admin"]),
  body: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
});
export type InquiryMessage = z.infer<typeof inquiryMessageSchema>;

export const inquirySchema = z.object({
  id: z.string().min(1),
  auditId: z.string().min(1),
  feedbackId: z.string().optional(),
  raisedBy: z.string().min(1),
  raisedAt: z.number().int().nonnegative(),
  messages: z.array(inquiryMessageSchema).min(1),
  status: inquiryStatusSchema.default("open"),
  /** 결정 변경이 일어났을 때 보정된 decision feedbackId 기록 */
  amendedFeedbackIds: z.array(z.string()).default([]),
});
export type Inquiry = z.infer<typeof inquirySchema>;

// ── LedgerEntry (기여 통장) ─────────────────────────────────────────────────
export const ledgerKindSchema = z.enum([
  "contribution_accepted",
  "contribution_rejected",
  "settlement_round",
  "bonus",
  "adjustment",
]);
export type LedgerKind = z.infer<typeof ledgerKindSchema>;

export const ledgerSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("audit"),
    auditId: z.string().min(1),
    acceptedCount: z.number().int().nonnegative(),
    rejectedCount: z.number().int().nonnegative(),
  }),
  z.object({
    // 정성 평가(세션 총평) 검수 확정 — 문장 단위 audit 과 별개 축으로 적립된다.
    // 기여 단위는 총평 분량 6구간 → 0–5 — audit-schema.evalContributionUnits.
    kind: z.literal("session_eval"),
    evaluationId: z.string().min(1),
    conversationId: z.string().min(1),
    units: z.number().int().nonnegative(),
    accepted: z.boolean(),
  }),
  z.object({
    kind: z.literal("settlement"),
    roundId: z.string().min(1),
    includedAuditIds: z.array(z.string()).default([]),
  }),
  z.object({
    kind: z.literal("manual"),
    note: z.string().optional(),
  }),
]);
export type LedgerSource = z.infer<typeof ledgerSourceSchema>;

export const ledgerEntrySchema = z.object({
  id: z.string().min(1),
  auditorId: z.string().min(1),
  kind: ledgerKindSchema,
  amount: z.number().int(),
  sourceRef: ledgerSourceSchema,
  balanceAfter: z.number().int(),
  timestamp: z.number().int().nonnegative(),
  note: z.string().optional(),
});
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;

// ── SettlementRound (정산 회차) ─────────────────────────────────────────────
export const settlementDistributionModelSchema = z.enum([
  "even",
  "weighted_by_count",
]);
export type SettlementDistributionModel = z.infer<
  typeof settlementDistributionModelSchema
>;

export const settlementAllocationSchema = z.object({
  auditorId: z.string().min(1),
  acceptedCount: z.number().int().nonnegative(),
  amount: z.number().int().nonnegative(),
  includedAuditIds: z.array(z.string()).default([]),
  /**
   * 세무사별 입금 상태 — 관리자가 실제 계좌이체(플랫폼 밖) 후 수동으로 세팅.
   * undefined = 입금 전, number = 입금 완료 시각. jsonb 내 처리라 마이그레이션 불필요.
   */
  paidAt: z.number().int().nonnegative().optional(),
});
export type SettlementAllocation = z.infer<typeof settlementAllocationSchema>;

export const settlementRoundStatusSchema = z.enum(["draft", "published"]);
export type SettlementRoundStatus = z.infer<typeof settlementRoundStatusSchema>;

export const settlementRoundSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1), // 예: "2026-07-1"
  periodFrom: z.number().int().nonnegative(),
  periodTo: z.number().int().nonnegative(),
  revenue: z.number().int().nonnegative(), // 이번 회차 소프트웨어 활동 총수익(원)
  distributionRatio: z.number().min(0).max(100), // 총수익 중 세무사 분배 비율(%)
  pool: z.number().int().nonnegative(), // = floor(revenue * distributionRatio / 100), 발행 시점 스냅샷
  distributionModel: settlementDistributionModelSchema,
  allocations: z.array(settlementAllocationSchema).default([]),
  status: settlementRoundStatusSchema.default("draft"),
  createdAt: z.number().int().nonnegative(),
  createdBy: z.string().min(1),
  publishedAt: z.number().int().nonnegative().optional(),
  note: z.string().optional(),
});
export type SettlementRound = z.infer<typeof settlementRoundSchema>;

// ── Mail (공지 / 이의 답변 / 정산 안내) ─────────────────────────────────────
// consultation = 상담 신청 알림(0035 — DB 트리거·transition_consultation() 이 넣는다).
export const mailKindSchema = z.enum(["notice", "inquiry_reply", "settlement", "consultation"]);
export type MailKind = z.infer<typeof mailKindSchema>;

export const mailRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("inquiry"), inquiryId: z.string().min(1) }),
  z.object({ kind: z.literal("settlement"), roundId: z.string().min(1) }),
  z.object({ kind: z.literal("audit"), auditId: z.string().min(1) }),
  z.object({ kind: z.literal("consultation"), requestId: z.string().min(1) }),
]);
export type MailRef = z.infer<typeof mailRefSchema>;

export const mailSchema = z.object({
  id: z.string().min(1),
  recipientId: z.string().min(1),
  senderId: z.string().min(1),
  kind: mailKindSchema,
  subject: z.string().min(1),
  body: z.string().default(""),
  ref: mailRefSchema.optional(),
  sentAt: z.number().int().nonnegative(),
  readAt: z.number().int().nonnegative().optional(),
});
export type Mail = z.infer<typeof mailSchema>;

export const auditSchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  conversationId: z.string().min(1),
  auditorId: z.string().min(1),
  pickedAt: z.number().int().nonnegative(),
  submittedAt: z.number().int().nonnegative().optional(),
  status: auditStatusSchema.default("draft"),
  /**
   * 진행도 캐시 — 라인 피드백·세션 평가는 audit-store 에 별도 저장되지만,
   * 빠른 list view 를 위해 캐시.
   */
  progress: z
    .object({
      feedbackCount: z.number().int().nonnegative().default(0),
      hasSessionEval: z.boolean().default(false),
      totalSegments: z.number().int().nonnegative().default(0),
    })
    .default({ feedbackCount: 0, hasSessionEval: false, totalSegments: 0 }),
});
export type Audit = z.infer<typeof auditSchema>;
