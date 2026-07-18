import { z } from "zod";

/**
 * 감사(Audit) 데이터 스키마 — 사람 평가자가 작성하는 라인 피드백 + 세션 평가.
 * 대화 데이터(conversation-schema.ts)는 불변이며, 본 데이터는 segmentId/conversationId 외래키로만 참조한다.
 */

// ── 라인 피드백 태그 (3종 고정, 다중 선택) ──────────────────────────────────────
export const FEEDBACK_TAGS = [
  "legal_error",
  "grammar_error",
  "suggestion",
] as const;

export const FEEDBACK_TAG_LABELS: Record<FeedbackTag, string> = {
  legal_error: "법적 해석 오류",
  grammar_error: "문법적 오류",
  suggestion: "제안사항",
};

// ── 세션 정량 평가 카테고리 (2종, 1–5점) ────────────────────────────────────────
export const SCORE_CATEGORIES = ["writing", "legalAccuracy"] as const;

export const SCORE_CATEGORY_LABELS: Record<ScoreCategory, string> = {
  writing: "문장력",
  legalAccuracy: "법률적 정확성",
};

// ── 스키마 ──────────────────────────────────────────────────────────────────────
export const feedbackTagSchema = z.enum(FEEDBACK_TAGS);

export const lineFeedbackSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  segmentId: z.string().min(1),
  /** 작성자 신원(도메인 id) — RLS 소유·RAG attribution 의 단일 진실. */
  auditorId: z.string().min(1),
  /** 표시이름(누가 달았는지 UI 표기). RLS/attribution 은 auditorId 를 신뢰. */
  reviewer: z.string().min(1),
  body: z.string().min(1),
  /**
   * 최소 1개 필수. 분류 없는 코멘트는 RAG 적재 시 어느 갈래로 넣을지 판단할 근거가
   * 없어 결국 버려진다 → 작성 시점에 막는다. (DB CHECK 0012 가 동일 규칙을 강제)
   */
  tags: z.array(feedbackTagSchema).min(1),
  /** 참조한 KB 문서 id 목록. 외래키이며 삭제된 문서는 UI 에서 orphan 표시. */
  relatedKbIds: z.array(z.string()).default([]),
  createdAt: z.number(),
});

/** 정성 평가 검수 결정 — null(미결정) | 인정 | 거절. (0015) */
export const evalDecisionSchema = z.enum(["accepted", "rejected"]);
export type EvalDecision = z.infer<typeof evalDecisionSchema>;

/**
 * 정성 평가 검수의 두 게이트 — 문장 단위 검수(reviews.status)와 같은 리듬.
 *  pending → saved([검수 저장]) → finalized([최종 승인] = ledger 적립 + RAG 적재)
 */
export const evalReviewStatusSchema = z.enum(["pending", "saved", "finalized"]);
export type EvalReviewStatus = z.infer<typeof evalReviewStatusSchema>;

export const sessionEvaluationSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  /** 작성자 신원(도메인 id) — 공용 보드에서 세무사마다 자기 평가를 남긴다. */
  auditorId: z.string().min(1),
  reviewer: z.string().min(1),
  qualitative: z.string().default(""),
  scores: z.object({
    writing: z.number().int().min(1).max(5),
    legalAccuracy: z.number().int().min(1).max(5),
  }),
  createdAt: z.number(),
  // ── 관리자 검수(검수실 · 정성 평가) ──────────────────────────────────────
  /** 미결정이면 undefined. 결정이 있어야 [검수 저장]을 누를 수 있다. */
  decision: evalDecisionSchema.optional(),
  decidedAt: z.number().optional(),
  /** 결정한 관리자의 도메인 id. */
  decidedBy: z.string().optional(),
  reviewStatus: evalReviewStatusSchema.default("pending"),
});

// ── 정성 평가 기여도 ────────────────────────────────────────────────────────
/**
 * 정성 평가 1건의 기여 단위 수 — 총평 길이 100자당 1, 최대 10.
 *
 * 문장 단위 코멘트 1건의 기여가 1인 것과 같은 축이다. 총평은 한 건이지만 분량이
 * 곧 정보량이라 길이로 환산한다(0자면 0 — 빈 총평에 기여를 주지 않는다).
 */
export const MAX_EVAL_CONTRIBUTION_UNITS = 10;

export function evalContributionUnits(qualitative: string): number {
  const len = qualitative.trim().length;
  if (len === 0) return 0;
  return Math.min(MAX_EVAL_CONTRIBUTION_UNITS, Math.ceil(len / 100));
}

/**
 * 글자수를 100자 단위 10구간으로 옮긴다.
 * [100자 이하, 200자 이하, …, 900자 이하, 1000자 이상]
 * 검수실(정성 평가)의 '피드백' 컬럼과 배선실의 '규모' 컬럼이 같은 눈금을 쓴다.
 */
export function volumeLabel(length: number): string {
  if (length >= 1000) return "1000자 이상";
  const bucket = Math.max(1, Math.ceil(length / 100));
  return `${bucket * 100}자 이하`;
}

/** 정성 평가 총평 분량 표기. */
export function feedbackVolumeLabel(qualitative: string): string {
  return volumeLabel(qualitative.trim().length);
}

// ── 중복 코멘트 판정 ────────────────────────────────────────────────────────────
/**
 * 같은 문장에 같은 말이 두 번 달리는 걸 막기 위한 스트링 비교 키.
 * 앞뒤 공백·중복 공백·대소문자 흔들림만 흡수한다(의미 비교가 아니라 문자열 비교).
 * DB 유니크 인덱스(0012)의 `lower(regexp_replace(btrim(body),'\s+',' ','g'))` 와 같은 규칙.
 */
export function feedbackDedupeKey(body: string): string {
  return body.trim().replace(/\s+/g, " ").toLowerCase();
}

// ── 타입 ────────────────────────────────────────────────────────────────────────
export type FeedbackTag = (typeof FEEDBACK_TAGS)[number];
export type ScoreCategory = (typeof SCORE_CATEGORIES)[number];
export type LineFeedback = z.infer<typeof lineFeedbackSchema>;
export type SessionEvaluation = z.infer<typeof sessionEvaluationSchema>;
export type SessionScores = SessionEvaluation["scores"];
