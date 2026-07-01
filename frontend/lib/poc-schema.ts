import { z } from "zod";

/**
 * PoC 단계의 추가 엔터티 스키마.
 *
 * Pool / AuditTask / Audit (metadata wrapper) / TrainingBatch / ModelVersion /
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

export const reviewStatusSchema = z.enum(["draft", "finalized"]);
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
  /** 평가자가 결과를 본 적이 있는지 (배지 도트용) */
  seenByAuditorAt: z.number().int().nonnegative().optional(),
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
});
export type SettlementAllocation = z.infer<typeof settlementAllocationSchema>;

export const settlementRoundStatusSchema = z.enum(["draft", "published"]);
export type SettlementRoundStatus = z.infer<typeof settlementRoundStatusSchema>;

export const settlementRoundSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1), // 예: "2026-07-1"
  periodFrom: z.number().int().nonnegative(),
  periodTo: z.number().int().nonnegative(),
  pool: z.number().int().nonnegative(),
  distributionModel: settlementDistributionModelSchema,
  allocations: z.array(settlementAllocationSchema).default([]),
  status: settlementRoundStatusSchema.default("draft"),
  createdAt: z.number().int().nonnegative(),
  createdBy: z.string().min(1),
  publishedAt: z.number().int().nonnegative().optional(),
  note: z.string().optional(),
});
export type SettlementRound = z.infer<typeof settlementRoundSchema>;

// ── TrainingBatch / ModelVersion (모델 파이프라인 mock) ─────────────────────
export const batchStatusSchema = z.enum([
  "queued",
  "in_pipeline",
  "merged",
  "deployed",
  "cancelled",
  "pipeline_failed",
]);
export type BatchStatus = z.infer<typeof batchStatusSchema>;

export const prMetaSchema = z.object({
  prNumber: z.number().int().nonnegative(),
  prUrl: z.string().min(1),
  branch: z.string().min(1),
  ciStatus: z.enum(["pending", "green", "red"]).optional(),
});
export type PrMeta = z.infer<typeof prMetaSchema>;

export const acceptedFeedbackRefSchema = z.object({
  auditId: z.string().min(1),
  feedbackId: z.string().min(1),
});
export type AcceptedFeedbackRef = z.infer<typeof acceptedFeedbackRefSchema>;

export const trainingBatchSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  acceptedFeedbacks: z.array(acceptedFeedbackRefSchema).default([]),
  contributorIds: z.array(z.string()).default([]),
  createdAt: z.number().int().nonnegative(),
  createdBy: z.string().min(1),
  status: batchStatusSchema.default("queued"),
  prMeta: prMetaSchema.optional(),
  targetModelVersion: z.string().optional(),
  notes: z.string().optional(),
  failureReason: z.string().optional(),
});
export type TrainingBatch = z.infer<typeof trainingBatchSchema>;

export const versionStatusSchema = z.enum([
  "candidate",
  "production",
  "rolled_back",
  "superseded",
]);
export type VersionStatus = z.infer<typeof versionStatusSchema>;

export const modelMetricsSchema = z.object({
  accuracy: z.number().min(0).max(1).optional(),
  coverage: z.number().min(0).max(1).optional(),
});
export type ModelMetrics = z.infer<typeof modelMetricsSchema>;

export const modelVersionSchema = z.object({
  id: z.string().min(1),
  semver: z.object({
    major: z.number().int().nonnegative(),
    minor: z.number().int().nonnegative(),
    patch: z.number().int().nonnegative(),
  }),
  status: versionStatusSchema.default("candidate"),
  createdAt: z.number().int().nonnegative(),
  promotedAt: z.number().int().nonnegative().optional(),
  retiredAt: z.number().int().nonnegative().optional(),
  mergedFromBatchIds: z.array(z.string()).default([]),
  sourcePr: prMetaSchema.optional(),
  metrics: modelMetricsSchema.optional(),
  notes: z.string().optional(),
});
export type ModelVersion = z.infer<typeof modelVersionSchema>;

// ── Mail (공지 / 이의 답변 / 정산 안내) ─────────────────────────────────────
export const mailKindSchema = z.enum(["notice", "inquiry_reply", "settlement"]);
export type MailKind = z.infer<typeof mailKindSchema>;

export const mailRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("inquiry"), inquiryId: z.string().min(1) }),
  z.object({ kind: z.literal("settlement"), roundId: z.string().min(1) }),
  z.object({ kind: z.literal("audit"), auditId: z.string().min(1) }),
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
