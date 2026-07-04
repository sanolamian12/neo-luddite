"use client";

import { getSupabase } from "@/lib/supabase/client";
import { useReviewStore, rowToReview, type ReviewRow } from "@/lib/review-store";
import { useAuditWorkStore } from "@/lib/audit-work-store";
import { useAuditStore } from "@/lib/audit-store";
import type { Review, FeedbackDecision } from "@/lib/poc-schema";
import * as ledgerService from "./ledger";
import * as ragService from "./rag";

/**
 * Review service — admin 이 audit 을 검수한다.
 *
 * 쓰기: Supabase `reviews` 에 반영 + 낙관적 스토어 갱신(Realtime echo 는 멱등).
 * 읽기: Realtime 동기화된 스토어 캐시에서 필터/정렬 (형태·로직 불변, §3-3).
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

/** reviewId 의 최신 상태를 DB 에서 직접 읽는다(read-modify-write 용). */
async function fetchReview(reviewId: string): Promise<Review | null> {
  const { data, error } = await getSupabase()
    .from("reviews")
    .select("*")
    .eq("id", reviewId)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToReview(data as ReviewRow) : null;
}

/** auditId 로 DB 에서 review 직접 조회(경쟁 확인용). unique(audit_id)라 최대 1행. */
async function fetchReviewByAudit(auditId: string): Promise<Review | null> {
  const { data, error } = await getSupabase()
    .from("reviews")
    .select("*")
    .eq("audit_id", auditId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToReview(data as ReviewRow) : null;
}

/**
 * 진행 중 startOrGet 프로미스 캐시 — 검수 진입 이펙트가 (dev strict-mode 이중 실행 등으로)
 * 스토어 반영 전에 두 번 불려도 같은 프로미스를 공유해 중복 review 생성을 막는다.
 */
const startInflight = new Map<string, Promise<Review>>();

/** auditId 에 대한 검수 객체를 가져오거나 새로 만든다(경쟁 안전, audit 당 1개). */
export function startOrGet(auditId: string, reviewerId: string): Promise<Review> {
  const cached = startInflight.get(auditId);
  if (cached) return cached;
  const p = _startOrGet(auditId, reviewerId).finally(() =>
    startInflight.delete(auditId),
  );
  startInflight.set(auditId, p);
  return p;
}

async function _startOrGet(
  auditId: string,
  reviewerId: string,
): Promise<Review> {
  const existing = useReviewStore
    .getState()
    .reviews.find((r) => r.auditId === auditId);
  if (existing) return existing;

  // 다른 이펙트/탭이 이미 만들었을 수 있으니 DB 최신본을 먼저 확인.
  const fromDb = await fetchReviewByAudit(auditId);
  if (fromDb) {
    useReviewStore.getState()._upsert(fromDb);
    return fromDb;
  }

  const sb = getSupabase();
  const review: Review = {
    id: makeId("review"),
    auditId,
    reviewerId,
    decisions: [],
    status: "draft",
    createdAt: Date.now(),
  };
  const { error } = await sb.from("reviews").insert({
    id: review.id,
    audit_id: review.auditId,
    reviewer_id: review.reviewerId,
    decisions: review.decisions,
    overall_note: review.overallNote ?? null,
    finalized_at: review.finalizedAt ?? null,
    dispute_window_ends_at: review.disputeWindowEndsAt ?? null,
    status: review.status,
    created_at: review.createdAt,
    seen_by_auditor_at: review.seenByAuditorAt ?? null,
  });
  if (error) {
    // unique(audit_id) 충돌 = 경쟁한 다른 호출이 먼저 생성 → 그 행을 조회해 반환.
    const raced = await fetchReviewByAudit(auditId);
    if (raced) {
      useReviewStore.getState()._upsert(raced);
      return raced;
    }
    throw error;
  }
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
  // read-modify-write: decisions jsonb 배열을 DB 최신본 기준으로 갱신.
  const sb = getSupabase();
  const review = await fetchReview(reviewId);
  if (!review) return null;
  const idx = review.decisions.findIndex(
    (d) => d.feedbackId === decision.feedbackId,
  );
  const decisions =
    idx === -1
      ? [...review.decisions, decision]
      : review.decisions.map((d, i) => (i === idx ? decision : d));
  const { error } = await sb
    .from("reviews")
    .update({ decisions })
    .eq("id", reviewId);
  if (error) throw error;
  useReviewStore.getState()._patch(reviewId, { decisions });
  return get(reviewId);
}

export async function setOverallNote(
  reviewId: string,
  note: string,
): Promise<Review | null> {
  const sb = getSupabase();
  const { error } = await sb
    .from("reviews")
    .update({ overall_note: note })
    .eq("id", reviewId);
  if (error) throw error;
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
  const acceptedFeedback = feedbackForAudit.filter((f) => {
    const d = decisionMap.get(f.id);
    return d ? d.accepted : true; // 결정 없으면 인정
  });
  const acceptedCount = acceptedFeedback.length;
  const rejectedCount = feedbackForAudit.length - acceptedCount;

  const now = Date.now();
  const sb = getSupabase();
  const { error } = await sb
    .from("reviews")
    .update({
      status: "finalized",
      finalized_at: now,
      dispute_window_ends_at: now + DISPUTE_WINDOW_MS,
    })
    .eq("id", reviewId);
  if (error) throw error;
  store._patch(reviewId, {
    status: "finalized",
    finalizedAt: now,
    disputeWindowEndsAt: now + DISPUTE_WINDOW_MS,
  });
  // 교차 도메인: audit 상태도 DB 에 영속해야 Realtime 동기화·새로고침에 살아남음.
  const { error: auditErr } = await sb
    .from("audits")
    .update({ status: "reviewed" })
    .eq("id", audit.id);
  if (auditErr) throw auditErr;
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

  // RAG write-path(운영 흐름 6) — accepted 코멘트 C(+정지 스냅샷의 질문A/답변B)를 KB 로 적재.
  // 비차단: RAG/백엔드 장애가 검수 확정을 되돌리지 않는다(적재는 멱등이라 재시도 안전).
  try {
    const res = await ragService.ingestAcceptedFeedback(acceptedFeedback);
    if (res.skipped > 0) {
      console.warn(
        `[rag] KB 미설정으로 코멘트 ${res.skipped}건 적재 건너뜀(검수 확정은 완료).`,
      );
    }
  } catch (err) {
    console.warn("[rag] 코멘트 KB 적재 실패(검수 확정은 완료됨):", err);
  }

  return get(reviewId);
}

/** 이의제기 답변 후 결정 변경. ledger 도 재계산. */
export async function amendDecision(
  reviewId: string,
  feedbackId: string,
  patch: { accepted: boolean; reason?: string },
): Promise<Review | null> {
  // read-modify-write: decisions jsonb 배열을 DB 최신본 기준으로 갱신.
  const sb = getSupabase();
  const review = await fetchReview(reviewId);
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
  const { error } = await sb
    .from("reviews")
    .update({ decisions })
    .eq("id", reviewId);
  if (error) throw error;
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
  const sb = getSupabase();
  const now = Date.now();
  const { error } = await sb
    .from("reviews")
    .update({ seen_by_auditor_at: now })
    .eq("id", reviewId);
  if (error) throw error;
  useReviewStore.getState()._patch(reviewId, {
    seenByAuditorAt: now,
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
