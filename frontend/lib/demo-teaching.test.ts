import assert from "node:assert/strict";
import test from "node:test";
import * as demo from "./demo/domain";
import { applySessionLesson } from "./session-learning";

// Catches partly empty drafts and accidental replacement of the selected evidence.
test("creating a demo teaching draft fills review fields and preserves the selected source", () => {
  const run = demo.restoreCheckpoint(demo.createDemoRun("teaching-autofill"), "B2");
  run.selection.permitted = true;
  assert.equal(typeof demo.createTeachingDraft, "function", "Draft creation must include prepared review fields");
  const next = demo.createTeachingDraft(run);
  const draft = next.agent.practice.learning!.draft!;
  for (const key of ["title", "facts", "questions", "conclusion", "judgment", "scope", "exceptions", "keywords", "scenario", "expected"] as const) {
    assert.ok(draft[key].trim(), `${key} must be ready for review`);
  }
  assert.equal(draft.conclusion, demo.script.human);
  assert.equal(draft.facts, `${demo.script.facts}\n${demo.script.missing}`);
  assert.deepEqual(draft.session.source!.messageIds, run.selection.ids);
  assert.deepEqual(draft.session.turns.map(turn => turn.id), run.selection.ids);
  assert.equal(draft.evidenceConfirmed, false);
  assert.equal(draft.tested, false);
  assert.equal(next.scene, "B3");
  assert.equal(run.agent.practice.learning?.draft, undefined);
  assert.deepEqual(next.beforePractice, run.agent.practice);
  const reviewed = applySessionLesson(next.agent.practice, { ...draft, evidenceConfirmed: true, tested: true });
  assert.ok(reviewed.cases.some(item => item.id === draft.id));
});

test("draft creation still requires permission and both customer and expert evidence", () => {
  const run = demo.restoreCheckpoint(demo.createDemoRun("teaching-evidence"), "B2");
  assert.equal(typeof demo.createTeachingDraft, "function");
  assert.throws(() => demo.createTeachingDraft(run), /권한/);
  run.selection.permitted = true;
  run.selection.ids = run.messages.filter(message => message.author === "expert").map(message => message.id);
  assert.throws(() => demo.createTeachingDraft(run), /고객/);
  assert.equal(run.agent.practice.learning?.draft, undefined);
});
