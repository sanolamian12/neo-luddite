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
 * 라이프사이클 (두 게이트):
 *  - audit submitted → admin 진입 시 startOrGet 호출 (draft 검수 객체 생성)
 *  - 검수 중 decisions 갱신 → setDecision()
 *  - [검수 저장] → save() → review `draft`→`saved`, audit `submitted`→`reviewed`.
 *      결과가 세무사에게 열리고, "저장~최종승인" 사이가 이의 가능 구간. 관리자는 계속 수정 가능.
 *      ledger·RAG 는 아직 건드리지 않는다.
 *  - [최종 승인] → finalize() → review `saved`→`finalized`, audit `reviewed`→`finalized`.
 *      이 시점에만 ledger 기여 적립 + RAG 포장실 적재. 이후 불변(뒤집힘 없음 → retract 불필요).
 *  - 이의제기 후 결정 변경 → amendDecision() — 오직 saved 상태에서만(finalized 면 거부).
 */

/**
 * 같은 대화를 평가한 모든 audit(대표 + 공동 평가자).
 * 검수는 대화 단위(모든 평가자의 피드백을 한 화면에서 결정)이므로,
 * 저장·최종 승인의 상태 전이도 형제 audit 에 함께 전파해야 한다.
 * 그렇지 않으면 공동 평가자의 완료 화면이 영원히 "검수 중"에 머문다.
 */
function siblingAudits(conversationId: string) {
  return useAuditWorkStore
    .getState()
    .audits.filter(
      (a) =>
        a.conversationId === conversationId &&
        (a.status === "submitted" ||
          a.status === "reviewed" ||
          a.status === "finalized"),
    );
}

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
    seenByAuditors: {},
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
    seen_by_auditors: review.seenByAuditors,
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
  if (review.status === "finalized") {
    throw new Error("최종 승인된 검수는 결정을 변경할 수 없습니다.");
  }
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
 * [검수 저장] — 결과를 세무사에게 열고 "이의 가능" 구간을 시작한다.
 * review draft→saved, audit submitted→reviewed. ledger·RAG 는 최종 승인까지 미룬다.
 * (재저장/이미 saved 는 멱등. finalized 는 되돌릴 수 없어 거부.)
 */
export async function save(reviewId: string): Promise<Review | null> {
  const store = useReviewStore.getState();
  const review = store.reviews.find((r) => r.id === reviewId);
  if (!review) return null;
  if (review.status === "finalized") {
    throw new Error("최종 승인된 검수는 다시 저장할 수 없습니다.");
  }

  const audit = useAuditWorkStore
    .getState()
    .audits.find((a) => a.id === review.auditId);
  if (!audit) throw new Error(`Audit not found: ${review.auditId}`);

  const sb = getSupabase();
  const { error } = await sb
    .from("reviews")
    .update({ status: "saved" })
    .eq("id", reviewId);
  if (error) throw error;
  store._patch(reviewId, { status: "saved" });

  // 세무사 결과 화면 노출·목록 배지를 위해 audit 상태도 영속(Realtime·새로고침 생존).
  // 같은 대화의 공동 평가자 audit 도 함께 열어 준다(결정은 이 review 하나를 공유).
  const targets = siblingAudits(audit.conversationId).filter(
    (a) => a.status === "submitted",
  );
  if (targets.length > 0) {
    const { error: auditErr } = await sb
      .from("audits")
      .update({ status: "reviewed" })
      .in(
        "id",
        targets.map((a) => a.id),
      );
    if (auditErr) throw auditErr;
    for (const a of targets) {
      useAuditWorkStore.getState()._patch(a.id, { status: "reviewed" });
    }
  }

  return get(reviewId);
}

/**
 * [최종 승인] — saved 검수를 확정한다. **이 게이트에서만** ledger 기여 적립 + RAG 포장실 적재.
 * 확정 후에는 결정이 뒤집히지 않으므로(setDecision/amend 가 거부됨) retract 가 필요 없다.
 */
export async function finalize(reviewId: string): Promise<Review | null> {
  const store = useReviewStore.getState();
  const review = store.reviews.find((r) => r.id === reviewId);
  if (!review) return null;
  if (review.status === "finalized") return review; // 멱등
  if (review.status !== "saved") {
    throw new Error("먼저 검수를 저장한 뒤 최종 승인할 수 있습니다.");
  }

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
  const isAccepted = (feedbackId: string) => {
    const d = decisionMap.get(feedbackId);
    return d ? d.accepted : true; // 결정 없으면 인정
  };
  const acceptedFeedback = feedbackForAudit.filter((f) => isAccepted(f.id));

  const now = Date.now();
  const sb = getSupabase();
  const { error } = await sb
    .from("reviews")
    .update({ status: "finalized", finalized_at: now })
    .eq("id", reviewId);
  if (error) throw error;
  store._patch(reviewId, { status: "finalized", finalizedAt: now });

  // 교차 도메인: audit 상태도 DB 에 영속해야 Realtime 동기화·새로고침에 살아남음.
  // 공동 평가자 audit 도 함께 확정 — 한 대화의 검수 결과는 참여자 전원에게 동시에 확정된다.
  const siblings = siblingAudits(audit.conversationId);
  const { error: auditErr } = await sb
    .from("audits")
    .update({ status: "finalized" })
    .in(
      "id",
      siblings.map((a) => a.id),
    );
  if (auditErr) throw auditErr;
  for (const a of siblings) {
    useAuditWorkStore.getState()._patch(a.id, { status: "finalized" });
  }

  // ledger 기여 적립 — 최종 결정 기준(멱등: auditId 단위 재작성).
  // 기여도는 audit 이 아니라 **피드백 작성자**에게 귀속한다. 한 대화에 여러 평가자가
  // 참여하면 각자 자기가 쓴 피드백의 인정/거절 수만 적립된다.
  for (const a of siblings) {
    const own = feedbackForAudit.filter((f) => f.auditorId === a.auditorId);
    const ownAccepted = own.filter((f) => isAccepted(f.id)).length;
    await ledgerService.recordReviewOutcome({
      auditorId: a.auditorId,
      auditId: a.id,
      acceptedCount: ownAccepted,
      rejectedCount: own.length - ownAccepted,
      timestamp: now,
    });
  }

  // RAG write-path(운영 흐름 6) — accepted 코멘트 C(+정지 스냅샷의 질문A/답변B)를 KB 로 적재.
  // 비차단: RAG/백엔드 장애가 최종 승인을 되돌리지 않는다(적재는 멱등이라 재시도 안전).
  try {
    const res = await ragService.ingestAcceptedFeedback(acceptedFeedback);
    if (res.skipped > 0) {
      console.warn(
        `[rag] KB 미설정으로 코멘트 ${res.skipped}건 적재 건너뜀(최종 승인은 완료).`,
      );
    }
  } catch (err) {
    console.warn("[rag] 코멘트 KB 적재 실패(최종 승인은 완료됨):", err);
  }

  return get(reviewId);
}

/**
 * 이의제기 답변 후 결정 변경 — 오직 saved 상태(이의 가능 구간)에서만.
 * finalized 면 거부한다. ledger·RAG 는 최종 승인에서 최종 결정 기준으로 한 번에 확정되므로
 * 여기선 decisions 만 갱신하면 된다(적재 전이라 retract 불필요).
 */
export async function amendDecision(
  reviewId: string,
  feedbackId: string,
  patch: { accepted: boolean; reason?: string },
): Promise<Review | null> {
  // read-modify-write: decisions jsonb 배열을 DB 최신본 기준으로 갱신.
  const sb = getSupabase();
  const review = await fetchReview(reviewId);
  if (!review) return null;
  if (review.status === "finalized") {
    throw new Error("최종 승인된 검수는 변경할 수 없습니다.");
  }

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

  return get(reviewId);
}

/**
 * 결과를 본 평가자를 기록한다. 공동 평가자는 review 하나를 공유하므로
 * "봤다"는 auditorId 별로 따로 남긴다(한 명이 열어도 다른 사람 도트는 유지).
 */
export async function markSeenByAuditor(
  reviewId: string,
  auditorId: string,
): Promise<void> {
  const sb = getSupabase();
  // read-modify-write: 다른 평가자가 방금 남긴 기록을 덮어쓰지 않도록 DB 최신본 기준.
  const review = await fetchReview(reviewId);
  if (!review) return;
  if (review.seenByAuditors[auditorId]) return; // 멱등

  const seen = { ...review.seenByAuditors, [auditorId]: Date.now() };
  const { error } = await sb
    .from("reviews")
    .update({ seen_by_auditors: seen })
    .eq("id", reviewId);
  if (error) throw error;
  useReviewStore.getState()._patch(reviewId, { seenByAuditors: seen });
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
