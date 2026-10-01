import assert from "node:assert/strict";
import { test } from "node:test";
import { createPractice, requestReview } from "./agent-practice";
import { rehearsePolicy } from "./agent-rehearsal";

test("actual facts gate a retrieved answer and the chosen source remains attributable", () => {
  const practice = createPractice();
  const input = { query: "장비 구입", facts: {}, rounds: 0, asked: {} };
  const missing = rehearsePolicy(practice, input);
  assert.equal(missing.evaluation.status, "ask");
  assert.doesNotMatch(missing.answer, /구입 영수증, 거래 일자/);
  assert.doesNotMatch(missing.facts, /준비했습니다/);
  const ready = rehearsePolicy(practice, { ...input, facts: { purpose: { client: "업무" }, date: { document: "10월 1일" }, receipt: { client: "있음" } } });
  assert.equal(ready.evaluation.status, "ready");
  assert.equal(ready.source, "sample");
  assert.match(ready.answer, /구입 영수증/);
  const review = requestReview(practice, ready).reviews[0];
  assert.equal(review.facts, ready.facts);
  assert.deepEqual(review.policyTrace, ready.evaluation.trace);
});

test("changing structured rules changes rehearsal and unmatched knowledge never becomes an answer", () => {
  const practice = createPractice();
  const input = { query: "장비", facts: {}, rounds: 1, asked: {} };
  assert.equal(rehearsePolicy(practice, input).evaluation.status, "hold");
  practice.rules![0].followUp.maxRounds = 2;
  assert.equal(rehearsePolicy(practice, input).evaluation.status, "ask");
  practice.rules![0].fields.forEach((field) => { field.required = false; });
  practice.cases.forEach((entry) => { entry.enabled = false; });
  const result = rehearsePolicy(practice, input);
  assert.equal(result.needsHuman, true);
  assert.match(result.answer, /참고할/);
});
