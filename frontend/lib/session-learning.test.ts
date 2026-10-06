import assert from "node:assert/strict";
import { test } from "node:test";
import { createPractice, practiceSchema } from "./agent-practice";
import { createAgent, loadAgents, saveAgents } from "./agent-studio";
import { importSession, proposeLesson, applySessionLesson } from "./session-learning";

const transcript = "[00:01] 고객: 장비를 업무와 개인 용도로 사용합니다.\n[00:05] 전문가: 사용 목적을 구분할 수 있나요?\n[00:12] 고객: 아직 모릅니다.\n[00:18] 전문가: 사용 내역을 정리한 뒤 함께 확인하겠습니다.";
test("unprocessed transcript intake survives a saved agent without implying learning permission", () => {
  const intake = { title: "작성 중인 상담", transcript, kind: "transcript", permitted: false };
  const practice = practiceSchema.parse({ ...createPractice(), learning: { sessions: [], intake } });
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
  saveAgents(storage, "expert", [{ ...createAgent("expert"), practice }]);
  assert.deepEqual((loadAgents(storage, "expert")[0].practice?.learning as { intake?: unknown })?.intake, intake);
});
function draft() {
  const session = importSession({ title: "장비 사용 상담", kind: "transcript", transcript, permitted: true });
  return { ...proposeLesson(session), judgment: "개인 용도와 업무 용도가 섞여 있어 판단을 보류합니다.", keywords: "장비", scope: "혼합 사용 상담", evidenceConfirmed: true, scenario: "업무용으로만 썼다면?", expected: "사용 증빙부터 확인한다.", tested: true };
}

test("session import requires permission and identified speakers", () => {
  assert.throws(() => importSession({ title: "상담", kind: "chat", transcript, permitted: false }), /동의|권한/);
  assert.throws(() => importSession({ title: "상담", kind: "chat", transcript: "아무 화자도 없는 문장", permitted: true }), /화자/);
});
test("proposals preserve verbatim source and timestamps without inventing reasoning", () => {
  const session = importSession({ title: "상담", kind: "transcript", transcript, permitted: true });
  const proposal = proposeLesson(session);
  assert.equal(session.turns[0].at, "00:01");
  assert.equal(session.turns[0].text, "장비를 업무와 개인 용도로 사용합니다.");
  assert.match(proposal.facts, /아직 모릅니다/);
  assert.equal(proposal.judgment, "");
  assert.equal(proposal.questions, "사용 목적을 구분할 수 있나요?");
  assert.equal(proposal.conclusion, "사용 내역을 정리한 뒤 함께 확인하겠습니다.");
});
test("unreviewed, session-only or untested proposals cannot become reusable knowledge", () => {
  const valid = draft();
  for (const patch of [{ judgment: "" }, { evidenceConfirmed: false }, { applicability: "session-only" }, { tested: false }, { scope: "" }]) {
    assert.throws(() => applySessionLesson(createPractice(), { ...valid, ...patch } as typeof valid));
  }
});
test("applying a reviewed lesson preserves source lineage and is idempotent", () => {
  const lesson = draft();
  const once = applySessionLesson(createPractice(), lesson);
  const twice = applySessionLesson(once, lesson);
  assert.equal(twice.cases.length, 3);
  assert.equal(twice.cases[2].sourceSessionId, lesson.session.id);
  assert.equal(twice.learning.sessions[0].turns[0].text, "장비를 업무와 개인 용도로 사용합니다.");
  assert.equal(twice.questions.filter((q: { origin: string }) => q.origin === "expert").length, 1);
});
test("session lessons and source records survive existing agent persistence", () => {
  const practice = applySessionLesson(createPractice(), draft());
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
  saveAgents(storage, "expert", [{ ...createAgent("expert"), practice }]);
  const loaded = loadAgents(storage, "expert")[0].practice!;
  assert.equal(loaded.cases[2].sourceSessionId, practice.cases[2].sourceSessionId);
  assert.equal(loaded.learning?.sessions[0].turns.length, 4);
});
