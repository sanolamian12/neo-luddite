import { FEEDBACK_TAGS, type FeedbackTag, type LineFeedback } from "./audit-schema";
import type { Audit, Review } from "./poc-schema";

/**
 * 운영 답변 문장 대조 집계 (A10, 10/16) — 일감 → 문장별 코멘트 → 검수 결정 → RAG 환류.
 * backend/eval/sentence_review_check.py 와 같은 정의:
 *   문장 = 답변 segment 하나 · 분류 = line_feedback.tags · 결정 = reviews.decisions[{feedbackId, accepted}] (없으면 미결정)
 *   범위 = 제출된 검수가 있는 대화의 문장 수(audits.progress.totalSegments 최댓값) 대비 코멘트 달린 문장
 *   (progress.feedbackCount 는 0012 정리 뒤 갱신되지 않아 실제보다 크다 → 쓰지 않는다)
 * 환류(RAG 적재)는 서버 쪽 rag.passages 라 화면에선 '최종 승인된 인정' 으로 대신 센다(finalize 가 적재한다).
 */

export interface Tally {
  comments: number;
  accepted: number;
  rejected: number;
  undecided: number;
}

export interface SentenceReviewSummary {
  total: Tally & { conversations: number; segments: number; auditors: number; first?: number; last?: number };
  finalizedAccepted: number;
  byTag: Record<FeedbackTag, Tally>;
  byAuditor: (Tally & { auditorId: string; conversations: number })[];
  byConversation: (Tally & { conversationId: string; segments: number; totalSegments: number })[];
  coverage: { audits: number; conversations: number; totalSegments: number; commentedSegments: number };
  byMonth: { month: string; comments: number; conversations: number; accepted: number }[];
}

const SUBMITTED: Audit["status"][] = ["submitted", "reviewed", "finalized"];
const empty = (): Tally => ({ comments: 0, accepted: 0, rejected: 0, undecided: 0 });

function add(t: Tally, d: boolean | undefined) {
  t.comments += 1;
  if (d === true) t.accepted += 1;
  else if (d === false) t.rejected += 1;
  else t.undecided += 1;
}

export function summarize(feedback: LineFeedback[], reviews: Review[], audits: Audit[], since = 0): SentenceReviewSummary {
  const decision = new Map<string, { accepted: boolean; finalized: boolean }>();
  for (const r of reviews) {
    for (const d of r.decisions) decision.set(d.feedbackId, { accepted: d.accepted, finalized: r.status === "finalized" });
  }
  const rows = feedback.filter((f) => f.createdAt >= since);

  const total = { ...empty(), conversations: 0, segments: 0, auditors: 0, first: undefined as number | undefined, last: undefined as number | undefined };
  const byTag = Object.fromEntries(FEEDBACK_TAGS.map((t) => [t, empty()])) as Record<FeedbackTag, Tally>;
  const aud = new Map<string, Tally & { auditorId: string; convs: Set<string> }>();
  const conv = new Map<string, Tally & { conversationId: string; segs: Set<string> }>();
  const month = new Map<string, { comments: number; convs: Set<string>; accepted: number }>();
  const segs = new Set<string>();
  let finalizedAccepted = 0;

  for (const f of rows) {
    const d = decision.get(f.id);
    add(total, d?.accepted);
    if (d?.accepted && d.finalized) finalizedAccepted += 1;
    total.first = total.first === undefined ? f.createdAt : Math.min(total.first, f.createdAt);
    total.last = total.last === undefined ? f.createdAt : Math.max(total.last, f.createdAt);
    segs.add(`${f.conversationId}\u0000${f.segmentId}`);
    for (const t of new Set(f.tags)) add(byTag[t], d?.accepted);

    const a = aud.get(f.auditorId) ?? { ...empty(), auditorId: f.auditorId, convs: new Set<string>() };
    add(a, d?.accepted); a.convs.add(f.conversationId); aud.set(f.auditorId, a);

    const c = conv.get(f.conversationId) ?? { ...empty(), conversationId: f.conversationId, segs: new Set<string>() };
    add(c, d?.accepted); c.segs.add(f.segmentId); conv.set(f.conversationId, c);

    const m = new Date(f.createdAt).toISOString().slice(0, 7);
    const mm = month.get(m) ?? { comments: 0, convs: new Set<string>(), accepted: 0 };
    mm.comments += 1; mm.convs.add(f.conversationId); if (d?.accepted) mm.accepted += 1; month.set(m, mm);
  }
  total.conversations = conv.size;
  total.segments = segs.size;
  total.auditors = aud.size;

  const totalSegs = new Map<string, number>();
  let submitted = 0;
  for (const a of audits) {
    if (!SUBMITTED.includes(a.status) || (a.submittedAt ?? a.pickedAt ?? 0) < since) continue;
    submitted += 1;
    totalSegs.set(a.conversationId, Math.max(totalSegs.get(a.conversationId) ?? 0, a.progress?.totalSegments ?? 0));
  }
  let commented = 0;
  for (const key of segs) if (totalSegs.has(key.split("\u0000")[0])) commented += 1;

  return {
    total,
    finalizedAccepted,
    byTag,
    byAuditor: [...aud.values()].map(({ convs, ...t }) => ({ ...t, conversations: convs.size })).sort((x, y) => y.comments - x.comments),
    byConversation: [...conv.values()]
      .map(({ segs: s, ...t }) => ({ ...t, segments: s.size, totalSegments: totalSegs.get(t.conversationId) ?? 0 }))
      .sort((x, y) => y.comments - x.comments),
    coverage: { audits: submitted, conversations: totalSegs.size, totalSegments: [...totalSegs.values()].reduce((s, n) => s + n, 0), commentedSegments: commented },
    byMonth: [...month.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([m, v]) => ({ month: m, comments: v.comments, conversations: v.convs.size, accepted: v.accepted })),
  };
}
