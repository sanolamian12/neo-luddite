import assert from "node:assert/strict";
import { test } from "node:test";
import type { LineFeedback } from "./audit-schema";
import type { Audit, Review } from "./poc-schema";
import { summarize } from "./sentence-review-summary";

// A10 — 일감 → 문장 코멘트 → 검수 결정 → 집계. 정의는 backend/eval/sentence_review_check.py 와 같다.
const fb = (id: string, conv: string, seg: string, auditor: string, tags: LineFeedback["tags"], at: number): LineFeedback =>
  ({ id, conversationId: conv, segmentId: seg, auditorId: auditor, reviewer: auditor, body: "의견", tags, relatedKbIds: [], createdAt: at });
const audit = (id: string, conv: string, auditor: string, status: Audit["status"], totalSegments: number): Audit =>
  ({ id, taskId: "t", conversationId: conv, auditorId: auditor, pickedAt: 1, submittedAt: 2, status, progress: { feedbackCount: 99, hasSessionEval: false, totalSegments } });
const review = (auditId: string, status: Review["status"], decisions: [string, boolean][]): Review =>
  ({ id: `r-${auditId}`, auditId, reviewerId: "admin", status, createdAt: 1, decisions: decisions.map(([feedbackId, accepted]) => ({ feedbackId, accepted, decidedAt: 1 })) } as Review);

const JUL = Date.UTC(2026, 6, 11);
const OCT = Date.UTC(2026, 9, 16);
const feedback = [
  fb("f1", "c1", "m1_s0", "a1", ["legal_error"], JUL),
  fb("f2", "c1", "m1_s0", "a2", ["legal_error", "grammar_error"], JUL),
  fb("f3", "c1", "m1_s2", "a1", ["suggestion"], JUL),
  fb("f4", "c2", "m9_s1", "a1", ["grammar_error"], OCT),
];
const audits = [audit("au1", "c1", "a1", "finalized", 5), audit("au2", "c1", "a2", "finalized", 5), audit("au3", "c2", "a1", "submitted", 4), audit("au4", "c3", "a2", "draft", 7)];
const reviews = [review("au1", "finalized", [["f1", true], ["f2", false], ["f3", true]]), review("au3", "saved", [["f4", true]])];

test("전체·분류·평가자·대화 집계", () => {
  const s = summarize(feedback, reviews, audits);
  assert.deepEqual([s.total.comments, s.total.accepted, s.total.rejected, s.total.undecided], [4, 3, 1, 0]);
  assert.deepEqual([s.total.conversations, s.total.segments, s.total.auditors], [2, 3, 2]);
  assert.equal(s.finalizedAccepted, 2); // f4 는 검수 저장(saved)만 — 아직 환류 전
  assert.deepEqual(s.byTag.legal_error, { comments: 2, accepted: 1, rejected: 1, undecided: 0 });
  assert.deepEqual(s.byTag.grammar_error, { comments: 2, accepted: 1, rejected: 1, undecided: 0 });
  assert.equal(s.byAuditor[0].auditorId, "a1");
  assert.deepEqual([s.byAuditor[0].comments, s.byAuditor[0].conversations], [3, 2]);
  assert.deepEqual(s.byConversation.find((c) => c.conversationId === "c1"), { conversationId: "c1", comments: 3, accepted: 2, rejected: 1, undecided: 0, segments: 2, totalSegments: 5 });
});

test("범위는 제출된 검수만 · progress.feedbackCount 는 안 쓴다", () => {
  const s = summarize(feedback, reviews, audits);
  assert.deepEqual(s.coverage, { audits: 3, conversations: 2, totalSegments: 9, commentedSegments: 3 });
});

test("결정 없는 코멘트 = 미결정 · since 로 기간을 자른다", () => {
  const s = summarize([...feedback, fb("f5", "c2", "m9_s2", "a2", ["suggestion"], OCT)], reviews, audits, Date.UTC(2026, 9, 1));
  assert.deepEqual([s.total.comments, s.total.accepted, s.total.undecided], [2, 1, 1]);
  assert.deepEqual(s.byMonth, [{ month: "2026-10", comments: 2, conversations: 1, accepted: 1 }]);
});
