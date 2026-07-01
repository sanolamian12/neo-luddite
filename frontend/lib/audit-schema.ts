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
  reviewer: z.string().min(1),
  body: z.string().min(1),
  tags: z.array(feedbackTagSchema).default([]),
  /** 참조한 KB 문서 id 목록. 외래키이며 삭제된 문서는 UI 에서 orphan 표시. */
  relatedKbIds: z.array(z.string()).default([]),
  createdAt: z.number(),
});

export const sessionEvaluationSchema = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  reviewer: z.string().min(1),
  qualitative: z.string().default(""),
  scores: z.object({
    writing: z.number().int().min(1).max(5),
    legalAccuracy: z.number().int().min(1).max(5),
  }),
  createdAt: z.number(),
});

// ── 타입 ────────────────────────────────────────────────────────────────────────
export type FeedbackTag = (typeof FEEDBACK_TAGS)[number];
export type ScoreCategory = (typeof SCORE_CATEGORIES)[number];
export type LineFeedback = z.infer<typeof lineFeedbackSchema>;
export type SessionEvaluation = z.infer<typeof sessionEvaluationSchema>;
export type SessionScores = SessionEvaluation["scores"];
