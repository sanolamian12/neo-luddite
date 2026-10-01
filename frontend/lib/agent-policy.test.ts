import assert from "node:assert/strict";
import { test } from "node:test";
import { createPolicy, evaluatePolicies, recordQuestions, validatePolicy, type PolicyInput } from "./agent-policy";

const input = (patch: Partial<PolicyInput> = {}): PolicyInput => ({ query: "장비 구입", facts: {}, rounds: 0, asked: {}, ...patch });
function policy() {
  const rule = createPolicy();
  rule.keywords = ["장비"];
  rule.fields = [{ id: "purpose", label: "사용 목적", question: "사용 목적은 무엇인가요?", required: true }, { id: "receipt", label: "증빙", question: "증빙이 있나요?", required: true }];
  rule.conflicts.fieldIds = ["purpose"];
  return rule;
}

test("topic keywords select a rule but do not count as supplied facts", () => {
  const result = evaluatePolicies([policy()], input());
  assert.equal(result.status, "ask");
  assert.deepEqual(result.missing, ["purpose", "receipt"]);
  assert.equal(result.questions.length, 2);
});
test("all required facts are needed regardless of optional fact count", () => {
  const rule = policy();
  rule.fields.push({ id: "note", label: "메모", question: "참고 사항", required: false });
  assert.equal(evaluatePolicies([rule], input({ facts: { purpose: { client: "업무" }, note: { client: "참고" } } })).status, "ask");
  assert.equal(evaluatePolicies([rule], input({ facts: { purpose: { client: "업무" }, receipt: { document: "있음" } } })).status, "ready");
});
test("conversation follow-up limit stops questions while facts remain missing", () => {
  const rule = policy();
  rule.followUp.maxRounds = 1;
  rule.followUp.afterLimit = "hold";
  const first = evaluatePolicies([rule], input());
  const next = recordQuestions(input(), first);
  assert.equal(next.rounds, 1);
  const second = evaluatePolicies([rule], next);
  assert.equal(second.status, "hold");
  assert.equal(second.questions.length, 0);
  assert.equal(second.missing.length, 2);
  rule.followUp.maxRounds = 2;
  assert.equal(evaluatePolicies([rule], next).status, "ask");
});
test("per-field follow-up limits only stop exhausted fields", () => {
  const rule = policy(); rule.followUp.scope = "field";
  const result = evaluatePolicies([rule], input({ rounds: 1, asked: { purpose: 1 } }));
  assert.deepEqual(result.questions.map((item) => item.fieldId), ["receipt"]);
});
test("unknown skips repeat questioning but never makes a required fact complete", () => {
  const rule = policy();
  const state = input({ facts: { purpose: { unknown: true }, receipt: { client: "있음" } } });
  assert.equal(evaluatePolicies([rule], state).status, "hold");
  assert.equal(evaluatePolicies([rule], state).questions.length, 0);
  rule.followUp.onUnknown = "human";
  assert.equal(evaluatePolicies([rule], state).status, "human");
});
test("source comparison checks only the same configured field with two known values", () => {
  const rule = policy();
  const state = input({ facts: { purpose: { client: "업무", document: "개인" }, receipt: { client: "있음" } } });
  assert.deepEqual(evaluatePolicies([rule], state).conflicts, ["purpose"]);
  assert.equal(evaluatePolicies([rule], state).status, "human");
  rule.conflicts.action = "hold";
  assert.equal(evaluatePolicies([rule], state).status, "hold");
  rule.conflicts.fieldIds = ["receipt"];
  assert.equal(evaluatePolicies([rule], state).status, "ready");
});
test("editable exception conditions affect outcomes and absent values never match not-equals", () => {
  const rule = policy();
  rule.exceptions = [{ id: "mixed", fieldId: "purpose", operator: "contains", value: "개인", action: "human" }];
  const state = input({ facts: { purpose: { client: "업무와 개인" }, receipt: { client: "있음" } } });
  assert.equal(evaluatePolicies([rule], state).status, "human");
  rule.exceptions[0].value = "증여";
  assert.equal(evaluatePolicies([rule], state).status, "ready");
  rule.exceptions[0].operator = "not_equals";
  assert.equal(evaluatePolicies([rule], input()).exceptions.length, 0);
});
test("disabled and unrelated rules do not apply and invalid references cannot execute", () => {
  const rule = policy();
  assert.equal(evaluatePolicies([rule], input({ query: "새 사업" })).status, "no_rule");
  rule.enabled = false;
  assert.equal(evaluatePolicies([rule], input()).status, "no_rule");
  rule.enabled = true;
  rule.conflicts.fieldIds = ["deleted"];
  assert.ok(validatePolicy(rule).length);
  assert.equal(evaluatePolicies([rule], input()).status, "invalid");
});
test("all-keyword topics require every keyword and question counters do not mutate input", () => {
  const rule = policy(); rule.keywords = ["장비", "병원"]; rule.match = "all";
  assert.equal(evaluatePolicies([rule], input()).status, "no_rule");
  const state = input({ query: "병원 장비" });
  const next = recordQuestions(state, evaluatePolicies([rule], state));
  assert.equal(state.rounds, 0);
  assert.equal(next.asked.purpose, 1);
});
