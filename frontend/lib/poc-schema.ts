import { z } from "zod";

/**
 * PoC 단계의 추가 엔터티 스키마.
 *
 * 세무사 레지스트리 · 상담 프로필·신청 · 상담사 풀 · 제안 · 채팅방 · 기여 원장 · 우편 —
 * 모두 zod 로 검증되며 store / service 가 같이 사용.
 *
 * 옛 검수 흐름(하차장 Pool·AuditTask·Audit·Review·Inquiry·SettlementRound)의 스키마는
 * 절단 S2(10/16)에서 지웠다. 원장·우편의 옛 source/kind 값은 DB 에 옛 행이 남아 있어 유지한다.
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
// revoked = 세무사 승인 취소(0050) — 행은 상담·원장 FK 때문에 남고 계정은 일반 회원으로 강등됐다.
export const auditorStatusSchema = z.enum(["active", "suspended", "revoked"]);
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
  /** 즉시 연결(0054) — 고르면 수락 없이 바로 3자 방이 열린다(데모용 가상 세무사). 프로토타입 데이터엔 없음. */
  instantConnect: z.boolean().optional(),
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

/**
 * 관리자 풀 화면(§4.3)이 보는 동의 한 건 — `conversation_pool_consents` 직접 조회(Realtime 아님).
 * `masked_payload` 는 싣지 않는다: 집계·브레이크에 필요 없고, 관리자 화면에서 원문 사본을 들고 다닐 이유가 없다.
 */
export interface AdminPoolConsent extends PoolConsent {
  occupation?: string;
  taxCategory?: string;
  title?: string;
  maskedAt: number;
}

/** 풀 열람 기록 한 줄 (`pool_case_views`, 0037) — 읽기는 admin 만. */
export interface PoolCaseView {
  conversationId: string;
  auditorId: string;
  firstViewedAt: number;
  lastViewedAt: number;
  viewCount: number;
}

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
  /** 내 연결 요청 상태(0039) — 없으면 undefined. 만료는 DB 가 읽을 때 판정해 준다. */
  myOfferStatus?: OfferStatus;
}

// ── 연결 요청 = 제안 (0039) — 경로 B: 세무사가 풀에서 걸고 사장님이 승인 ───────────────
// 생성은 make_offer(), 전이는 transition_offer() 로만. 같은 대화에 세무사당 1회.
// pending → approved(사장님, 방 개설) | declined(사장님) | withdrawn(세무사) · 7일 → expired
export type OfferStatus = "pending" | "approved" | "declined" | "withdrawn" | "expired";

export interface ConsultationOffer {
  id: string;
  conversationId: string;
  expertId: string;
  viewerId: string;
  message?: string;
  status: OfferStatus;
  statusHistory: { status: OfferStatus; at: number; actor?: string; note?: string }[];
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

/** 대화당 대기 요청 상한 · 요청 만료 · 메시지 길이 — DB(make_offer)와 같은 값. */
export const OFFER_PENDING_LIMIT = 5;
export const OFFER_EXPIRY_DAYS = 7;
export const OFFER_MESSAGE_MAX = 300;

// ── 상담 채팅방 (0038) — (대화, 세무사) 쌍당 1:1 방 ─────────────────────────────
// 개설은 DB 의 open_room() 만(경로 A = 신청 수락). 종료는 close_room() — 양쪽 누구나 + admin.
export type RoomStatus = "open" | "closed";

export interface ConsultationRoom {
  id: string;
  conversationId: string;
  viewerId: string;
  expertId: string;
  origin: "request" | "offer";
  originId: string;
  status: RoomStatus;
  createdAt: number;
  closedAt?: number;
  lastMessageAt?: number;
  viewerLastReadAt?: number;
  expertLastReadAt?: number;
  /** 3자 방(0044) — 고객 메시지에 세무사 AI 가 답한다(기본 ON) · 세무사 메시지에도 답한다(기본 OFF). 바꾸는 건 그 방 세무사만. */
  agentReplyCustomer: boolean;
  agentReplyExpert: boolean;
}

/** 세무사 AI 호출 한 건(0044 room_agent_runs) — 트리거 메시지 하나에 하나. 대기 표시·다시 시도가 이걸 본다. */
export interface RoomAgentRun {
  triggerMessageId: string;
  roomId: string;
  status: "running" | "done" | "expired" | "failed" | "skipped";
  attempts: number;
  startedAt: number;
  finishedAt?: number;
  replyMessageId?: string;
  error?: string;
}

/** 사용자 대기 상한(U6) — 서버 마감(api/room_agent.DEADLINE_MS)과 같은 값. */
export const ROOM_AGENT_WAIT_MS = 180_000;

export interface RoomMessage {
  id: string;
  roomId: string;
  senderId: string;
  /** agent = 세무사 AI(0044, 서버만 쓴다 — senderId "agent:<세무사 domain id>"). */
  senderRole: "user" | "auditor" | "agent";
  body: string;
  createdAt: number;
  deletedAt?: number;
}

/** 메시지 본문 최대 길이 — DB check 와 같다. */
export const ROOM_MESSAGE_MAX = 4000;

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
    // 정성 평가(세션 총평) 검수 확정 — 옛 검수 흐름의 행(audit 과 함께 새로 생기지 않는다, 원장은 append-only).
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
  z.object({
    // 세무사 사례 공용 KB 반영(+1)·철회(−1) — DB 트리거가 쓴다(0056). 사례별 순합 = 지금 공용에 살아 있는지(0/1).
    kind: z.literal("kb3_share"),
    docId: z.string().min(1),
    caseNumber: z.string().nullable().optional(),
    title: z.string(),
    event: z.enum(["approved", "withdrawn"]),
    reason: z.string().nullable().optional(),
  }),
  z.object({
    kind: z.literal("kb_contribution"),
    contributionId: z.string(), revision: z.number().int(), batchId: z.string(), kbVersion: z.number().int(), author: z.string(),
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

// ── Mail (공지 / 이의 답변 / 정산 안내) ─────────────────────────────────────
// consultation = 상담 신청 알림(0035 — DB 트리거·transition_consultation() 이 넣는다).
export const mailKindSchema = z.enum(["notice", "inquiry_reply", "settlement", "consultation"]);
export type MailKind = z.infer<typeof mailKindSchema>;

export const mailRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("inquiry"), inquiryId: z.string().min(1) }),
  z.object({ kind: z.literal("settlement"), roundId: z.string().min(1) }),
  z.object({ kind: z.literal("audit"), auditId: z.string().min(1) }),
  z.object({ kind: z.literal("consultation"), requestId: z.string().min(1) }),
  // 채팅방 첫 메시지 알림(0038) — mail.kind 는 consultation 그대로.
  z.object({ kind: z.literal("room"), id: z.string().min(1) }),
  // 연결 요청(제안) 도착·승인·거절·철회 알림(0039) — mail.kind 는 consultation 그대로.
  z.object({ kind: z.literal("offer"), id: z.string().min(1) }),
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
