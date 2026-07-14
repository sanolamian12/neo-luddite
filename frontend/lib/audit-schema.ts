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
});

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
