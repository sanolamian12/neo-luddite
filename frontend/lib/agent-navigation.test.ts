import assert from "node:assert/strict";
import { test } from "node:test";
import { agentHref, taskFromPath, selectAgentHref, teachingHref, knowledgeHref } from "./agent-navigation";

test("task links preserve agent identities without allowing them to alter routing", () => {
  const url = new URL(agentHref("teach", "a/b?x=1"), "https://example.test");
  assert.equal(url.pathname, "/audit/agents/teach");
  assert.equal(url.searchParams.get("agent"), "a/b?x=1");
  assert.equal(taskFromPath(url.pathname), "teach");
  assert.equal(taskFromPath("/audit/agents/unknown"), null);
});
test("participation opens the shared requests destination with agent context", () => {
  const url = new URL(agentHref("inbox", "expert-agent"), "https://example.test");
  assert.equal(url.pathname, "/audit/consultations");
  assert.equal(url.searchParams.get("kind"), "participation");
  assert.equal(url.searchParams.get("agent"), "expert-agent");
});

test("shared contributions have expert scope outside agent tasks", () => {
  assert.equal(agentHref("contributions", "agent-a"), "/audit/contributions?agent=agent-a");
  assert.equal(taskFromPath("/audit/agents/contributions"), null);
  assert.equal(taskFromPath("/audit/contributions"), null);
});

test("teaching and personal knowledge links retain the intended method and record", () => {
  assert.equal(new URL(teachingHref("a", "manual"), "https://example.test").searchParams.get("method"), "manual");
  const source = new URL(knowledgeHref("a", "question", "q/1?"), "https://example.test");
  assert.equal(source.pathname, "/audit/agents/knowledge");
  assert.equal(source.searchParams.get("question"), "q/1?");
});

test("switching agents drops prior record IDs but keeps the teaching method", () => {
  const next = new URL(selectAgentHref("/audit/agents/teach", "agent=a&method=manual&case=c&question=q&review=r&contribution=x", "b"), "https://example.test");
  assert.equal(next.searchParams.get("agent"), "b");
  assert.equal(next.searchParams.get("method"), "manual");
  for (const key of ["case", "question", "review", "contribution"]) assert.equal(next.searchParams.has(key), false);
});
