import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyBoard, createContribution, editContribution, submitContribution, reviewContribution, contributionSummary, boardSchema } from "./knowledge-contributions";

const author = { id: "expert-a", name: "전문가 A", role: "expert" as const };
const reviewer = { id: "admin", name: "운영자", role: "reviewer" as const };
const payload = { title: "혼합 사용 자료 확인", facts: "업무와 개인 용도 혼합", judgment: "용도를 나누어 확인", conclusion: "사용 자료를 정리해 주세요.", exceptions: "확인 불가 시 직접 검토", questions: "사용 목적은 무엇인가요?", keywords: "장비", scope: "혼합 사용 자료 준비", sources: "공개 지침의 자료 확인 절차", kind: "case" as const };
const checks = { evidence: true, privacy: true, duplicates: true, applicability: true };
function prepared() {
  return createContribution(emptyBoard(), { agentId: "agent-a", sourceId: "case-a", payload }, author);
}
function submitted() {
  const board = prepared();
  return submitContribution(board, board.entries[0].id, author, { privacy: true, permission: true }, 1);
}
test("contribution drafts snapshot approved fields without private transcripts", () => {
  const raw = { ...payload, rawTranscript: "SECRET", session: { turns: ["SECRET"] } };
  const board = createContribution(emptyBoard(), { agentId: "a", sourceId: "s", payload: raw }, author);
  raw.facts = "changed later";
  assert.equal(board.entries[0].payload.facts, "업무와 개인 용도 혼합");
  assert.ok(!JSON.stringify(board).includes("SECRET"));
  assert.equal(board.entries[0].author.id, "expert-a");
  assert.equal(contributionSummary(board, author.id).eligible, 0);
});
test("submission requires evidence, applicability, permission and privacy review", () => {
  const board = prepared(), id = board.entries[0].id;
  assert.throws(() => submitContribution(board, id, author, { privacy: false, permission: true }, 1));
  assert.throws(() => submitContribution(board, id, author, { privacy: true, permission: false }, 1));
  const incomplete = editContribution(board, id, author, { ...payload, sources: "" }, 1);
  assert.throws(() => submitContribution(incomplete, id, author, { privacy: true, permission: true }, 2));
});
test("other authors cannot edit and stale edits do not overwrite a newer revision", () => {
  const board = prepared(), id = board.entries[0].id;
  assert.throws(() => editContribution(board, id, { ...author, id: "b" }, payload, 1));
  const changed = editContribution(board, id, author, { ...payload, title: "새 제목" }, 1);
  assert.throws(() => editContribution(changed, id, author, payload, 1), /최신|변경/);
  assert.equal(changed.entries[0].payload.title, "새 제목");
});
test("only a reviewer can publish, with all review checks and feedback", () => {
  const board = submitted(), id = board.entries[0].id;
  assert.throws(() => reviewContribution(board, id, author, "publish", "확인", checks, 2));
  assert.throws(() => reviewContribution(board, id, reviewer, "publish", "확인", { ...checks, evidence: false }, 2));
  assert.throws(() => reviewContribution(board, id, reviewer, "changes", "", checks, 2));
  assert.equal(contributionSummary(board, author.id).eligible, 0);
});
test("requested changes retain old submitted content and resubmit under the same attribution", () => {
  let board = submitted(); const id = board.entries[0].id;
  board = reviewContribution(board, id, reviewer, "changes", "근거를 보완해 주세요", checks, 2);
  board = editContribution(board, id, author, { ...payload, sources: "보완된 공개 출처" }, 3);
  board = submitContribution(board, id, author, { privacy: true, permission: true }, 4);
  assert.equal(board.entries[0].revisions.length, 2);
  assert.equal(board.entries[0].revisions[0].payload.sources, "공개 지침의 자료 확인 절차");
  assert.equal(board.entries[0].revisions[1].payload.sources, "보완된 공개 출처");
  assert.equal(board.entries[0].author.id, author.id);
  assert.ok(board.entries[0].history.some((event: { note: string }) => event.note === "근거를 보완해 주세요"));
});
test("publication records one version and one credit; replay cannot double reward", () => {
  const board = submitted(), id = board.entries[0].id;
  const published = reviewContribution(board, id, reviewer, "publish", "근거와 적용 범위 확인", checks, 2);
  assert.equal(published.entries[0].publication?.version, 1);
  assert.equal(published.entries[0].credit?.status, "eligible");
  assert.deepEqual(published.entries[0].history.at(-1)?.checks, { evidence: true, privacy: true, duplicates: true, applicability: true });
  assert.equal(contributionSummary(published, author.id).eligible, 1);
  assert.throws(() => reviewContribution(published, id, reviewer, "publish", "재실행", checks, 3));
  assert.equal(contributionSummary(board, author.id).eligible, 0);
  assert.equal(contributionSummary(published, "someone-else").eligible, 0);
});
test("retraction keeps attribution and review history but reverses credit eligibility", () => {
  let board = submitted(); const id = board.entries[0].id;
  board = reviewContribution(board, id, reviewer, "publish", "확인", checks, 2);
  board = reviewContribution(board, id, reviewer, "retract", "근거 변경으로 재검토", checks, 3);
  assert.equal(board.entries[0].credit?.status, "reversed");
  assert.equal(board.entries[0].author.name, author.name);
  assert.equal(contributionSummary(board, author.id).eligible, 0);
  assert.equal(boardSchema.parse(JSON.parse(JSON.stringify(board))).entries[0].history.length, 4);
});
test("copying the same personal source does not create duplicate contributions", () => {
  const board = prepared();
  assert.throws(() => createContribution(board, { agentId: "agent-copy", sourceId: "case-a", payload }, author), /이미/);
});

test("missing review checks cannot be treated as unanimous approval", () => {
  const board = submitted();
  assert.throws(() => reviewContribution(board, board.entries[0].id, reviewer, "publish", "확인", {} as typeof checks, 2));
});

test("obvious personal identifiers are blocked even after the author checks privacy", () => {
  const board = prepared(), id = board.entries[0].id;
  const edited = editContribution(board, id, author, { ...payload, facts: "고객 연락처 010-1234-5678" }, 1);
  assert.throws(() => submitContribution(edited, id, author, { privacy: true, permission: true }, 2), /연락처/);
});
