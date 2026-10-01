import assert from "node:assert/strict";
import { test } from "node:test";
import { applyLesson, blankLesson, canAgentReply, createPractice, rehearse, replyAsAgent, replyAsExpert, requestReview, retrieveCases, returnToAgent, takeOver, upgradePractice, validateLesson } from "./agent-practice";
import { createAgent, loadAgents, saveAgents } from "./agent-studio";

function taughtPractice() {
  const practice = createPractice();
  practice.lesson = { ...blankLesson(), title: "독립적인 장비 사례", facts: "장비 구매, 증빙 있음", judgment: "업무 사용 목적을 확인한다.", conclusion: "구입 증빙과 사용 목적을 함께 정리해 주세요.", exceptions: "공동 사용이면 직접 검토", questions: "업무용인가요?\n증빙이 있나요?", keywords: "장비, 구매" };
  return applyLesson(practice);
}

test("incomplete teaching cannot add a case or questions", () => {
  const practice = createPractice();
  assert.ok(validateLesson(practice.lesson, 0).length > 0);
  assert.throws(() => applyLesson(practice));
  assert.equal(practice.cases.length, 2);
});

test("reviewed teaching preserves expert wording and applying twice does not duplicate knowledge", () => {
  const practice = taughtPractice();
  const again = applyLesson(practice);
  assert.equal(again.cases.length, 3);
  const entry = again.cases.find((item) => item.id === practice.lesson.id)!;
  assert.equal(entry.judgment, "업무 사용 목적을 확인한다.");
  assert.equal(entry.conclusion, "구입 증빙과 사용 목적을 함께 정리해 주세요.");
  assert.deepEqual(again.questions.filter((item) => item.caseId === entry.id).map((item) => item.prompt), ["업무용인가요?", "증빙이 있나요?"]);
});

test("retrieval rejects disabled and unrelated preferred knowledge", () => {
  const practice = taughtPractice();
  practice.cases.forEach((item) => { item.enabled = false; });
  assert.deepEqual(retrieveCases(practice, "장비 구매"), []);
  practice.cases[0].enabled = true;
  practice.cases[0].keywords = "부동산";
  practice.cases[0].priority = "preferred";
  assert.deepEqual(retrieveCases(practice, "장비 구매"), []);
});

test("priority changes the chosen relevant case and edits affect the rehearsal", () => {
  const practice = taughtPractice();
  const entry = practice.cases.find((item) => item.id === practice.lesson.id)!;
  entry.priority = "preferred";
  entry.conclusion = "수정한 전문가의 답변";
  const result = rehearse(practice, "장비 구매", "normal");
  assert.equal(result.caseId, entry.id);
  assert.match(result.answer, /수정한 전문가의 답변/);
  assert.equal(result.needsHuman, false);
});

test("missing facts withhold conclusions and ask only enabled collection questions", () => {
  const practice = taughtPractice();
  practice.questions.forEach((item) => { item.enabled = false; });
  practice.questions[0].enabled = true;
  practice.questions[0].prompt = "확인이 필요한 질문";
  practice.policy.onMissing = false;
  const result = rehearse(practice, "장비 구매", "missing");
  assert.deepEqual(result.questions, ["확인이 필요한 질문"]);
  assert.equal(result.needsHuman, false);
  assert.equal(result.judgment, "");
  assert.doesNotMatch(result.answer, /구입 증빙과 사용 목적을 함께 정리/);
  practice.policy.onMissing = true;
  assert.equal(rehearse(practice, "장비 구매", "missing").needsHuman, true);
});

test("conflicting facts never produce the normal conclusion even if recommendation is disabled", () => {
  const practice = taughtPractice();
  practice.policy.onConflict = false;
  const result = rehearse(practice, "장비 구매", "conflict");
  assert.equal(result.judgment, "");
  assert.doesNotMatch(result.answer, /구입 증빙과 사용 목적을 함께 정리/);
  assert.equal(result.needsHuman, false);
});

test("explicit client requests require human engagement regardless of configured optional triggers", () => {
  const practice = taughtPractice();
  practice.policy.onMissing = false;
  practice.policy.onConflict = false;
  practice.policy.onException = false;
  assert.equal(rehearse(practice, "장비 구매", "request").needsHuman, true);
  assert.equal(rehearse(practice, "전혀 다른 질문", "normal").needsHuman, true);
});

test("human requests retain context, deduplicate, and unavailable experts cannot take over", () => {
  const practice = taughtPractice();
  const run = rehearse(practice, "장비 구매", "request");
  const queued = requestReview(requestReview(practice, run), run);
  assert.equal(queued.reviews.length, 1);
  assert.equal(queued.reviews[0].facts, run.facts);
  assert.equal(queued.reviews[0].messages[0].text, "장비 구매");
  queued.policy.available = false;
  assert.throws(() => takeOver(queued, run.id));
});

test("only the expert in control can reply and returning control resumes AI", () => {
  const practice = taughtPractice();
  const run = rehearse(practice, "장비 구매", "request");
  const queued = requestReview(practice, run);
  assert.throws(() => replyAsExpert(queued, run.id, "확인했습니다."));
  const owned = takeOver(queued, run.id);
  assert.equal(canAgentReply(owned.reviews[0]), false);
  assert.throws(() => replyAsExpert(owned, run.id, "  "));
  const replied = replyAsExpert(owned, run.id, "제가 직접 확인하겠습니다.");
  assert.deepEqual(replied.reviews[0].messages.at(-1), { role: "expert", text: "제가 직접 확인하겠습니다." });
  const returned = returnToAgent(replied, run.id);
  assert.equal(canAgentReply(returned.reviews[0]), true);
  assert.equal(returned.reviews[0].status, "resolved");
  assert.throws(() => takeOver(queued, "missing-review"));
});

test("practice data and drafts survive storage alongside legacy graph configurations", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const old = createAgent("expert-a");
  const agent = { ...createAgent("expert-a"), practice: taughtPractice() };
  agent.practice.lesson.facts = "다음에 이어 쓸 사실";
  saveAgents(storage, "expert-a", [old, agent]);
  const loaded = loadAgents(storage, "expert-a");
  assert.deepEqual(loaded[0].nodes, old.nodes);
  assert.equal(loaded[1].practice?.lesson.facts, "다음에 이어 쓸 사실");
  assert.equal(loaded[1].practice?.cases.length, 3);
  assert.deepEqual(loadAgents(storage, "expert-b"), []);
  assert.throws(() => saveAgents(storage, "expert-b", [agent]));
});

test("resumed AI replies remain in the same thread and a later human request can reopen it", () => {
  const practice = taughtPractice();
  const run = rehearse(practice, "장비 구매", "request");
  const owned = takeOver(requestReview(practice, run), run.id);
  const next = { ...rehearse(practice, "장비 증빙", "normal"), id: run.id };
  assert.throws(() => replyAsAgent(owned, run.id, next));
  const resumed = replyAsAgent(returnToAgent(owned, run.id), run.id, next);
  assert.equal(resumed.reviews[0].messages.length, 4);
  assert.equal(resumed.reviews[0].messages[2].text, "장비 증빙");
  assert.equal(requestReview(resumed, next).reviews[0].status, "waiting");
});

test("incomplete enabled knowledge cannot supply a rehearsal answer", () => {
  const practice = createPractice();
  practice.cases[0].conclusion = "  ";
  assert.deepEqual(retrieveCases(practice, "장비"), []);
  assert.equal(rehearse(practice, "장비", "normal").needsHuman, true);
});

test("clear and concise voices preserve the conclusion while controlling the explanation", () => {
  const practice = createPractice();
  practice.voice = "clear";
  assert.match(rehearse(practice, "장비", "normal").answer, /실제 사용 목적/);
  practice.voice = "concise";
  assert.equal(rehearse(practice, "장비", "normal").answer, practice.cases[0].conclusion);
});

test("legacy edits to shared examples become personal without losing text or identities", () => {
  const legacy = createPractice();
  legacy.cases[0].judgment = "내가 수정한 판단";
  legacy.questions[0].prompt = "내가 수정한 질문";
  const migrated = upgradePractice(legacy);
  assert.equal(migrated.cases[0].origin, "expert");
  assert.equal(migrated.cases[0].id, legacy.cases[0].id);
  assert.equal(migrated.cases[0].judgment, "내가 수정한 판단");
  assert.equal(migrated.questions[0].origin, "expert");
  assert.equal(migrated.cases[1].origin, "sample");
  assert.deepEqual(upgradePractice(migrated), migrated);
});
