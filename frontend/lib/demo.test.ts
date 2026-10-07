import test from "node:test";
import assert from "node:assert/strict";
import { createDemoRun, sendMessage, finishReply, selectExpert, takeOver, returnToAgent, completeConsultation, teachingSource, createBatch, incorporateBatch, commonAnswer, restoreCheckpoint, demoHref, demoRunSchema, reconcileRetractions } from "./demo/domain";
import { reviewContribution } from "./knowledge-contributions";
import { loadRun, saveRun, runKey } from "./demo/storage";

const checks = { evidence: true, privacy: true, duplicates: true, applicability: true };
test("selecting an expert starts one personalized welcome in the original conversation", () => {
  const before = restoreCheckpoint(createDemoRun("welcome"), "A3");
  const selected = selectExpert(before, before.experts[1].auditorId);
  assert.equal(selected.conversationId, before.conversationId);
  assert.deepEqual(selected.messages.slice(0, before.messages.length), before.messages);
  assert.equal(selected.pending?.author, "expert_ai");
  assert.match(selected.pending!.reply, /김도현 세무사/);
  assert.match(selected.pending!.reply, /앞서/);
  assert.throws(() => selectExpert(selected, selected.expertId!), /선택/);
});

test("AI replies stream into a single message and stop safely on human takeover", () => {
  const ready = restoreCheckpoint(createDemoRun("stream"), "A4");
  const queued = sendMessage(ready, "customer", "자료를 준비하려면 어떻게 해야 하나요?");
  const token = queued.pending!.id;
  const partial = finishReply(queued, token, 6);
  assert.ok(partial.pending, "A small chunk must not complete the entire reply");
  assert.equal(partial.pending.visibleChars, 6);
  assert.equal(partial.messages.length, queued.messages.length);
  const persisted = demoRunSchema.parse(JSON.parse(JSON.stringify(partial)));
  assert.equal(persisted.pending?.visibleChars, 6);
  const human = takeOver(persisted);
  assert.equal(human.pending, undefined);
  assert.equal(human.messages.at(-2)?.text, Array.from(queued.pending!.reply).slice(0, 6).join(""));
  assert.equal(human.messages.at(-2)?.interrupted, true);
  assert.deepEqual(finishReply(human, token, 6), human);
  const complete = finishReply(partial, token);
  assert.equal(complete.pending, undefined);
  assert.equal(complete.messages.at(-1)?.text, queued.pending!.reply);
  assert.equal(complete.messages.length, queued.messages.length + 1);
});

function conversation() {
  let run = createDemoRun("test-run");
  for (const text of ["병원 상담용 태블릿을 집에서도 써요", "진료 설명에 쓰고 가족도 사용해요. 영수증은 있어요."]) {
    run = sendMessage(run, "customer", text); run = finishReply(run, run.pending!.id);
  }
  run = selectExpert(run, run.experts[0].auditorId);
  if (run.pending) run = finishReply(run, run.pending.id);
  run = sendMessage(run, "customer", "영수증은 있지만 사용 기록은 없어요");
  return run;
}

test("expert selection preserves the customer thread; takeover cancels a delayed AI reply", () => {
  const run = conversation();
  const firstId = run.messages[0].id;
  const pending = run.pending!.id;
  const human = takeOver(run);
  const late = finishReply(human, pending);
  assert.equal(late.messages.length, human.messages.length);
  assert.equal(late.messages[0].id, firstId);
  assert.equal(late.conversationId, run.conversationId);
  assert.equal(late.controller, "expert");
  assert.equal(late.presence, "observing");
  const replied = sendMessage(late, "expert", "원문으로 남길 직접 답변");
  assert.equal(replied.messages.at(-1)?.author, "expert");
  const returned = returnToAgent(replied);
  assert.equal(returned.completed, false);
  assert.equal(completeConsultation(returned).completed, true);
});

test("teaching excerpts retain original IDs and order and exclude unselected content", () => {
  let run = sendMessage(takeOver(conversation()), "expert", "자료로 확인할 수 있는 사실부터 검토합니다.");
  run = completeConsultation(run);
  const client = run.messages.find((message) => message.author === "customer")!;
  const expert = run.messages.find((message) => message.author === "expert")!;
  const source = teachingSource(run, "selected", [expert.id, client.id]);
  assert.deepEqual(source.turns.map((turn) => turn.id), [client.id, expert.id]);
  assert.deepEqual(source.turns.map((turn) => turn.speaker), ["client", "expert"]);
  assert.equal(source.source?.conversationId, run.conversationId);
  assert.equal(source.turns.length, 2);
  assert.ok(teachingSource(run, "all", []).turns.length > 2);
  assert.throws(() => teachingSource(run, "selected", []), /선택/);
  assert.throws(() => teachingSource(run, "selected", [expert.id]), /고객/);
});

test("approval alone changes neither retrieval nor credits; a batch activates exactly the reviewed revisions once", () => {
  let run = createDemoRun("batch-run");
  const entry = run.board.entries[0];
  const before = commonAnswer(run, "영수증 자료");
  run.board = reviewContribution(run.board, entry.id, run.reviewer, "approve", "근거와 적용 범위를 확인했습니다.", checks, entry.version);
  assert.equal(run.board.entries[0].status, "approved");
  assert.equal(run.board.entries[0].credit, undefined);
  assert.deepEqual(commonAnswer(run, "영수증 자료"), before);
  run = createBatch(run, [entry.id], "검토 지식 업데이트");
  assert.equal(run.credits.length, 0);
  run = incorporateBatch(run, run.batches[0].id);
  assert.equal(run.kbVersion, 1);
  assert.equal(run.credits.length, 1);
  assert.equal(run.credits[0].authorId, entry.author.id);
  assert.equal(run.credits[0].revision, 1);
  assert.equal(run.credits[0].amount, 1);
  assert.equal(commonAnswer(run, "영수증 자료").source?.author, entry.author.name);
  const repeated = incorporateBatch(run, run.batches[0].id);
  assert.deepEqual(repeated.credits, run.credits);
});

test("pending and stale revisions cannot enter or complete a batch", () => {
  let run = createDemoRun("invalid-batch");
  const entry = run.board.entries[0];
  assert.throws(() => createBatch(run, [entry.id], "미검토"), /검토/);
  run.board = reviewContribution(run.board, entry.id, run.reviewer, "approve", "확인", checks, entry.version);
  run = createBatch(run, [entry.id], "준비");
  run.board.entries[0].payload.conclusion = "검토 후 바뀐 내용";
  assert.throws(() => incorporateBatch(run, run.batches[0].id), /변경/);
  assert.equal(run.kbVersion, 0);
  assert.deepEqual(run.credits, []);
});

test("isolated persistence rejects stale writes and leaves normal storage and other runs intact", () => {
  const values = new Map<string, string>([["normal-account", "untouched"]]);
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const first = saveRun(storage, createDemoRun("one"), null);
  saveRun(storage, createDemoRun("two"), null);
  const current = saveRun(storage, { ...first, customerDraft: "작성 중인 질문" }, first.revision);
  assert.throws(() => saveRun(storage, first, first.revision), /변경/);
  assert.equal(loadRun(storage, "one")?.customerDraft, "작성 중인 질문");
  const restored = restoreCheckpoint(current, "A1");
  saveRun(storage, restored, current.revision);
  assert.equal(values.get("normal-account"), "untouched");
  assert.ok(values.has(runKey("two")));
  assert.equal(loadRun(storage, "one")?.messages.length, 0);
});

test("checkpoints produce coherent sources and submissions without contaminating the initial run", () => {
  const initial = createDemoRun("checkpoint");
  const teaching = restoreCheckpoint(initial, "B1");
  assert.equal(teaching.completed, true);
  assert.ok(teaching.messages.some((message) => message.author === "expert"));
  const review = restoreCheckpoint(initial, "C1");
  assert.equal(review.board.entries.filter((entry) => entry.status === "pending").length, 3);
  assert.equal(review.credits.length, 0);
  assert.equal(initial.messages.length, 0);
  assert.ok(demoRunSchema.safeParse(review).success);
});

test("demo links retain object context and reject external destinations", () => {
  assert.equal(demoHref("/audit/agents/teach?agent=a&method=session", "r"), "/audit/agents/teach?agent=a&method=session&demo=r");
  assert.throws(() => demoHref("https://example.com", "r"));
});

test("a reviewed payload changed before batching is rejected instead of replacing the submitted revision", () => {
  const run = createDemoRun("changed-approval");
  const entry = run.board.entries[0];
  run.board = reviewContribution(run.board, entry.id, run.reviewer, "approve", "확인", checks, entry.version);
  run.board.entries[0].payload.conclusion = "검토하지 않은 변경";
  assert.throws(() => createBatch(run, [entry.id], "변경된 초안"), /제출본/);
});

test("retraction removes shared retrieval and reverses author credit once", () => {
  let run = restoreCheckpoint(createDemoRun("retraction"), "C4");
  const entry = run.board.entries[0];
  run.board = reviewContribution(run.board, entry.id, run.reviewer, "retract", "재검토가 필요합니다.", checks, entry.version);
  run = reconcileRetractions(run);
  assert.equal(commonAnswer(run, "영수증 자료").source, undefined);
  assert.equal(run.credits.filter((credit) => credit.authorId === entry.author.id).reduce((sum, credit) => sum + credit.amount, 0), 0);
  assert.equal(reconcileRetractions(run).credits.length, run.credits.length);
});

test("a failed snapshot write cannot commit batch completion or credits", () => {
  const run = restoreCheckpoint(createDemoRun("failed-write"), "C3");
  const raw = JSON.stringify(run);
  const storage = { getItem: () => raw, setItem: () => { throw new Error("quota"); } };
  assert.throws(() => saveRun(storage, incorporateBatch(run, run.batches[0].id), run.revision), /quota/);
  const persisted = loadRun(storage, run.id)!;
  assert.equal(persisted.kbVersion, 0);
  assert.equal(persisted.credits.length, 0);
  assert.equal(persisted.batches[0].status, "prepared");
});
