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

/** 결과가 열렸는데(저장·최종승인) 이 평가자가 아직 열어보지 않은 audit 수 — 배지 도트용. */
export function countUnseenResults(
  reviews: Review[],
  audits: Audit[],
  auditorId: string,
): number {
  return audits.filter((a) => {
    if (a.auditorId !== auditorId) return false;
    const review = reviewForAudit(reviews, audits, a);
    if (!review) return false;
    if (review.status !== "saved" && review.status !== "finalized") return false;
    return !review.seenByAuditors[auditorId];
  }).length;
}
