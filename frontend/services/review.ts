"use client";

import { useReviewStore } from "@/lib/review-store";
import { useAuditWorkStore } from "@/lib/audit-work-store";
import { useAuditStore } from "@/lib/audit-store";
import type { Review, FeedbackDecision } from "@/lib/poc-schema";
import * as ledgerService from "./ledger";

/**
 * Review service — admin 이 audit 을 검수한다.
 *
 * 라이프사이클:
 *  - audit submitted → admin 이 화면 진입 시 services/review.startOrGet 호출 (draft 검수 객체 생성)
 *  - 검수 중 decisions 갱신 → setDecision()
 *  - 완료 → finalize() → audit status `submitted` → `reviewed`, ledger entries 자동 생성
 *  - 이의제기 후 결정 변경 → amend()
 */

const DISPUTE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

/** auditId 에 대한 검수 객체를 가져오거나 새로 만든다. */
export async function startOrGet(
  auditId: string,
  reviewerId: string,
): Promise<Review> {
  const existing = useReviewStore
    .getState()
    .reviews.find((r) => r.auditId === auditId);
  if (existing) return existing;

  const review: Review = {
    id: makeId("review"),
    auditId,
    reviewerId,
    decisions: [],
    status: "draft",
    createdAt: Date.now(),
  };
  useReviewStore.getState()._upsert(review);
  return review;
}

export async function get(reviewId: string): Promise<Review | null> {
  return useReviewStore.getState().reviews.find((r) => r.id === reviewId) ?? null;
}

export async function getForAudit(auditId: string): Promise<Review | null> {
  return (
    useReviewStore.getState().reviews.find((r) => r.auditId === auditId) ?? null
  );
}

export async function setDecision(
  reviewId: string,
  decision: FeedbackDecision,
): Promise<Review | null> {
  const store = useReviewStore.getState();
  const review = store.reviews.find((r) => r.id === reviewId);
  if (!review) return null;
  const idx = review.decisions.findIndex(
    (d) => d.feedbackId === decision.feedbackId,
  );
  const decisions =
    idx === -1
      ? [...review.decisions, decision]
      : review.decisions.map((d, i) => (i === idx ? decision : d));
  store._patch(reviewId, { decisions });
  return get(reviewId);
}

export async function setOverallNote(
  reviewId: string,
  note: string,
): Promise<Review | null> {
  useReviewStore.getState()._patch(reviewId, { overallNote: note });
  return get(reviewId);
}

/**
 * 검수 완료 — audit status 전환 + ledger entries 자동 생성.
 */
export async function finalize(reviewId: string): Promise<Review | null> {
  const store = useReviewStore.getState();
  const review = store.reviews.find((r) => r.id === reviewId);
  if (!review) return null;

  const audit = useAuditWorkStore
    .getState()
    .audits.find((a) => a.id === review.auditId);
  if (!audit) throw new Error(`Audit not found: ${review.auditId}`);

  // 결정되지 않은 피드백은 자동 인정 (편의 기본값 — 검수 화면에서 모두 결정 필요)
  const feedbackForAudit = useAuditStore
    .getState()
    .feedback.filter((f) => f.conversationId === audit.conversationId);

  const decisionMap = new Map(
    review.decisions.map((d) => [d.feedbackId, d] as const),
  );
  const acceptedCount = feedbackForAudit.filter((f) => {
    const d = decisionMap.get(f.id);
    return d ? d.accepted : true; // 결정 없으면 인정
  }).length;
  const rejectedCount = feedbackForAudit.length - acceptedCount;

  const now = Date.now();
  store._patch(reviewId, {
    status: "finalized",
    finalizedAt: now,
    disputeWindowEndsAt: now + DISPUTE_WINDOW_MS,
  });
  useAuditWorkStore.getState()._patch(audit.id, {
    status: "reviewed",
  });

  // ledger entries
  await ledgerService.recordReviewOutcome({
    auditorId: audit.auditorId,
    auditId: audit.id,
    acceptedCount,
    rejectedCount,
    timestamp: now,
  });

  return get(reviewId);
}

/** 이의제기 답변 후 결정 변경. ledger 도 재계산. */
export async function amendDecision(
  reviewId: string,
  feedbackId: string,
  patch: { accepted: boolean; reason?: string },
): Promise<Review | null> {
  const review = await get(reviewId);
  if (!review) return null;

  const idx = review.decisions.findIndex((d) => d.feedbackId === feedbackId);
  const next: FeedbackDecision = {
    feedbackId,
    accepted: patch.accepted,
    reason: patch.reason,
    decidedAt: Date.now(),
  };
  const decisions =
    idx === -1
      ? [...review.decisions, next]
      : review.decisions.map((d, i) => (i === idx ? next : d));
  useReviewStore.getState()._patch(reviewId, { decisions });

  // ledger 재계산
  const audit = useAuditWorkStore
    .getState()
    .audits.find((a) => a.id === review.auditId);
  if (audit) {
    const feedbackForAudit = useAuditStore
      .getState()
      .feedback.filter((f) => f.conversationId === audit.conversationId);
    const accepted = feedbackForAudit.filter((f) => {
      const d = decisions.find((x) => x.feedbackId === f.id);
      return d ? d.accepted : true;
    }).length;
    await ledgerService.recordReviewOutcome({
      auditorId: audit.auditorId,
      auditId: audit.id,
      acceptedCount: accepted,
      rejectedCount: feedbackForAudit.length - accepted,
      timestamp: Date.now(),
    });
  }

  return get(reviewId);
}

export async function markSeenByAuditor(reviewId: string): Promise<void> {
  useReviewStore.getState()._patch(reviewId, {
    seenByAuditorAt: Date.now(),
  });
}

export interface ReviewSummary {
  pendingCount: number;
}
export async function summary(): Promise<ReviewSummary> {
  const submitted = useAuditWorkStore
    .getState()
    .audits.filter((a) => a.status === "submitted").length;
  return { pendingCount: submitted };
}
