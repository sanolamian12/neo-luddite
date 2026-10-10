import assert from "node:assert/strict";
import test from "node:test";
import * as demo from "./demo/domain";
import { reviewContribution } from "./knowledge-contributions";

test("one approval publishes the submitted revision and gives its author exactly one credit", () => {
  const run = demo.restoreCheckpoint(demo.createDemoRun("approval"), "C1");
  const entry = run.board.entries.at(-1)!;
  assert.equal(typeof demo.approveAndPublish, "function");
  const next = demo.approveAndPublish(run, entry.id, entry.version);
  const accepted = next.board.entries.find(item => item.id === entry.id)!;
  assert.equal(accepted.status, "published");
  assert.deepEqual(accepted.payload, entry.revisions.at(-1)!.payload);
  assert.equal(next.kbVersion, 1);
  assert.equal(next.credits.length, 1);
  assert.equal(next.credits[0].authorId, entry.author.id);
  assert.equal(next.credits[0].amount, 1);
  assert.equal(next.credits[0].revision, entry.revisions.at(-1)!.number);
  assert.equal(next.batches[0].status, "complete");
  assert.equal(accepted.history.find(event => event.type === "approved")?.checks, undefined, "A single approval must not fabricate four separate verification checks");
  assert.deepEqual(demo.approveAndPublish(next, entry.id, entry.version), next, "Repeated clicks cannot duplicate credit");
  assert.equal(run.credits.length, 0);
});

test("approval rejects stale, self-authored and altered submissions without partial publication", () => {
  const run = demo.restoreCheckpoint(demo.createDemoRun("stale-approval"), "C1");
  const entry = run.board.entries.at(-1)!;
  assert.equal(typeof demo.approveAndPublish, "function");
  assert.throws(() => demo.approveAndPublish(run, entry.id, entry.version - 1), /변경|최신/);
  const self = { ...run, reviewer: { ...run.reviewer, id: entry.author.id } };
  assert.throws(() => demo.approveAndPublish(self, entry.id, entry.version), /작성자|검토/);
  const altered = structuredClone(run);
  altered.board.entries.at(-1)!.payload.conclusion = "제출하지 않은 변경";
  assert.throws(() => demo.approveAndPublish(altered, entry.id, entry.version), /제출본|내용/);
  assert.equal(run.kbVersion, 0);
  assert.equal(run.credits.length, 0);
});

test("distribution follows accepted and reversed credits, with stable author attribution", async () => {
  const analytics = await import("./contribution-insights").catch(() => null);
  assert.ok(analytics, "contribution insights are available");
  let run = demo.restoreCheckpoint(demo.createDemoRun("distribution"), "C1");
  for (const entry of [run.board.entries[0], run.board.entries.at(-1)!]) run = demo.approveAndPublish(run, entry.id, entry.version);
  const summary = analytics.summarizeCredits(run.credits);
  assert.equal(summary.total, 2);
  assert.equal(summary.contributors.length, 2);
  assert.deepEqual(summary.contributors.map(item => item.share), [0.5, 0.5]);
  const entry = run.board.entries[0];
  run.board = reviewContribution(run.board, entry.id, run.reviewer, "retract", "추가 검토가 필요합니다.", { evidence: false, privacy: false, duplicates: false, applicability: false }, entry.version);
  run = demo.reconcileRetractions(run);
  const reversed = analytics.summarizeCredits([...run.credits, run.credits[0]]);
  assert.equal(reversed.total, 1, "Duplicate event IDs are counted once");
  assert.equal(reversed.contributors.find(item => item.id === entry.author.id)?.amount, 0);
  assert.equal(reversed.contributors[0].id, run.agent.owner);
  assert.equal(analytics.summarizeCredits([]).total, 0);
});
