import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFeedbackAddress, FEEDBACK_EMAIL, FEEDBACK_MAILTO } from "./feedback-contact";

test("feedback draft uses only the public mailbox and fixed product feedback prompts", () => {
  const draft = new URL(FEEDBACK_MAILTO);
  assert.equal(draft.protocol, "mailto:");
  assert.equal(draft.pathname, "credigraph.contact@gmail.com");
  assert.deepEqual([...draft.searchParams.keys()].sort(), ["body", "subject"]);
  assert.match(draft.searchParams.get("subject") ?? "", /사용 의견/);
  assert.match(draft.searchParams.get("body") ?? "", /어떤 점/);
});

test("address copy reports success only after clipboard write completes", async () => {
  let copied = "";
  let complete: (() => void) | undefined;
  const pending = copyFeedbackAddress({ writeText: (text) => {
    copied = text;
    return new Promise<void>((resolve) => { complete = resolve; });
  } });
  assert.equal(copied, FEEDBACK_EMAIL);
  let settled = false;
  void pending.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  complete?.();
  assert.equal(await pending, "copied");
});

test("clipboard denial leaves the visible-address fallback available", async () => {
  assert.equal(await copyFeedbackAddress({ writeText: async () => { throw new Error("Permission denied"); } }), "unavailable");
});

test("missing clipboard support reports fallback instead of success", async () => {
  assert.equal(await copyFeedbackAddress(undefined), "unavailable");
});
