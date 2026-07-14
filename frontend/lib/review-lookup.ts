import type { Audit, Review } from "./poc-schema";

/**
 * 검수는 **대화 단위**다. 한 대화를 여러 평가자가 평가해도 review 는 대표 audit
 * 하나에만 붙고(모든 평가자의 피드백을 한 화면에서 결정), 참여자 전원이 그 결과를 공유한다.
 * 따라서 내 auditId 로 review 를 못 찾으면 같은 대화의 형제 audit 까지 훑어야 한다.
 */
export function reviewForAudit(
  reviews: Review[],
  audits: Audit[],
  audit: Audit,
): Review | null {
  const own = reviews.find((r) => r.auditId === audit.id);
  if (own) return own;
  const siblingIds = new Set(
    audits
      .filter((a) => a.conversationId === audit.conversationId)
      .map((a) => a.id),
  );
  return reviews.find((r) => siblingIds.has(r.auditId)) ?? null;
}

/**
 * 이 대화의 검수가 최종 확정됐는가 — 확정 뒤엔 공용 코멘트 보드를 잠근다.
 *
 * 확정 시점에 인정/거절이 닫히고(setDecision 거부) 인정분만 RAG 로 적재된다. 그 뒤에
 * 들어온 코멘트는 관리자가 승인도 거절도 못 하는 '보류'로 영영 남아 검수 큐를 오염시킨다.
 * 검수는 대화 단위라 형제 audit 중 하나라도 확정이면 그 대화 전체가 잠긴 것으로 본다.
 */
export function isConversationFinalized(
  reviews: Review[],
  audits: Audit[],
  conversationId: string,
): boolean {
  const auditIds = new Set(
    audits.filter((a) => a.conversationId === conversationId).map((a) => a.id),
  );
  return reviews.some(
    (r) => auditIds.has(r.auditId) && r.status === "finalized",
  );
}

/**
 * 결과가 열렸는데(저장·최종승인) 이 평가자가 아직 열어보지 않은 audit 수 — 배지 도트용.
 *
 * 모집단은 **완료 화면(ResultsTable)과 같아야 한다** = 내가 제출한 audit(submitted 이상).
 * 아직 작성 중(draft)인 audit 을 빼지 않으면, 그 대화를 공동 평가자가 먼저 제출해
 * 형제 audit 에 review 가 붙은 순간 reviewForAudit 폴백에 걸려 "안 본 결과"로 잡힌다
 * → 배지가 완료 건수보다 커지는 현상(완료 40건인데 배지 98).
 */
export function countUnseenResults(
  reviews: Review[],
  audits: Audit[],
  auditorId: string,
): number {
  return audits.filter((a) => {
    if (a.auditorId !== auditorId) return false;
    if (a.status !== "submitted" && a.status !== "reviewed" && a.status !== "finalized")
      return false;
    const review = reviewForAudit(reviews, audits, a);
    if (!review) return false;
    if (review.status !== "saved" && review.status !== "finalized") return false;
    return !review.seenByAuditors[auditorId];
  }).length;
}
