import assert from "node:assert/strict";
import { test } from "node:test";
import { agentHref, taskFromPath } from "./agent-navigation";

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
