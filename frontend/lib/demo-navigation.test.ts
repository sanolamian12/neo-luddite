import test from "node:test";
import assert from "node:assert/strict";
import { createDemoRun, restoreCheckpoint } from "./demo/domain";
import { demoNavigation } from "./demo/navigation";

test("switching roles derives the visible act without advancing or resetting the consultation", () => {
  const run = restoreCheckpoint(createDemoRun("navigation"), "C4");
  const before = JSON.stringify(run);
  const chat = demoNavigation(run, "/chat/clinic", false);
  assert.equal(chat.scene, "A7");
  assert.equal(chat.actIndex, 0);
  assert.equal(chat.role, "customer");
  assert.equal(demoNavigation(run, "/audit/ledger", false).role, "expert");
  assert.equal(demoNavigation(run, "/admin/knowledge-contributions", false).role, "admin");
  assert.equal(demoNavigation(run, "/chat/clinic", true).scene, "C5");
  assert.equal(JSON.stringify(run), before);
});

test("handoffs appear only when ready and preserve the run and selected agent", () => {
  const initial = createDemoRun("handoff");
  assert.equal(demoNavigation(initial, "/chat/clinic", false).next, null);
  const requested = restoreCheckpoint(initial, "A5");
  const next = demoNavigation(requested, "/chat/clinic", false).next!;
  const url = new URL(next.href, "http://demo.test");
  assert.equal(url.pathname, "/audit/consultations");
  assert.equal(url.searchParams.get("demo"), "handoff");
  assert.equal(url.searchParams.get("agent"), requested.agent.id);
  assert.equal(demoNavigation(initial, "/audit/ledger", false).next, null);
  const complete = restoreCheckpoint(initial, "A7");
  assert.equal(demoNavigation(complete, "/audit/consultations", false).next?.scene, "B1");
});

test("opening future screens and prepared review entries do not mark unfinished acts complete", () => {
  const run = createDemoRun("early-review");
  const view = demoNavigation(run, "/admin/knowledge-contributions", false);
  assert.deepEqual(view.completedActs, [false, false, false]);
  assert.equal(view.next, null);
  assert.equal(demoNavigation(run, "/audit/agents/teach", false).scene, "B1");
  run.selection.opened = true;
  assert.equal(demoNavigation(run, "/audit/agents/teach", false).scene, "B2");
});

test("knowledge publication alone does not complete the final common-AI demonstration", () => {
  const run = restoreCheckpoint(createDemoRun("final-act"), "C4");
  assert.deepEqual(demoNavigation(run, "/audit/ledger", false).completedActs, [true, true, false]);
  assert.equal(demoNavigation(run, "/audit/ledger", false).next?.scene, "C5");
  run.commonQuery = "업무와 개인 사용을 어떻게 확인하나요?";
  assert.deepEqual(demoNavigation(run, "/chat/clinic", true).completedActs, [true, true, true]);
});

test("ready human replies and published knowledge expose the next person's actual screen", () => {
  const human = restoreCheckpoint(createDemoRun("human-handoff"), "A7");
  assert.equal(human.completed, true);
  const replying = { ...human, completed: false };
  const next = demoNavigation(replying, "/audit/consultations", false).next;
  assert.ok(next);
  assert.equal(new URL(next.href, "http://demo.test").pathname, "/chat/clinic");
  assert.equal(demoNavigation(replying, "/chat/clinic", false).next?.label, "세무사 화면에서 상담 마무리");
  const approved = restoreCheckpoint(createDemoRun("credit-handoff"), "C4");
  const credit = demoNavigation(approved, "/admin/knowledge-contributions", false).next;
  assert.ok(credit);
  assert.equal(new URL(credit.href, "http://demo.test").pathname, "/audit/ledger");
  assert.equal(new URL(credit.href, "http://demo.test").searchParams.get("author"), approved.credits.at(-1)!.authorId);
});
