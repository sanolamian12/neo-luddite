import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgent, validateAgent, simulateAgent, saveAgents, loadAgents, removeStage } from "./agent-studio";

test("graph rejects cycles and disconnected stages before execution", () => {
  const agent = createAgent("expert-a");
  assert.deepEqual(validateAgent(agent), []);
  agent.edges.push({ id: "cycle", from: "handoff", to: "facts", condition: "always", payload: "all" });
  assert.ok(validateAgent(agent).some((issue) => issue.code === "cycle"));
  assert.throws(() => simulateAgent(agent, "complete", "질문"));
  agent.edges = [];
  assert.ok(validateAgent(agent).some((issue) => issue.code === "disconnected"));
});

test("run follows graph order and records edited instructions without claiming to interpret them", () => {
  const agent = createAgent("expert-a");
  agent.nodes.reverse();
  agent.nodes.find((node) => node.id === "answer")!.instructions = "답변은 세 문장으로 작성하세요.";
  const result = simulateAgent(agent, "complete", "장비 구입 자료를 확인해 주세요.");
  assert.deepEqual(result.steps.map((step) => step.nodeId), ["facts", "answer", "handoff"]);
  assert.equal(result.steps[1].instructions, "답변은 세 문장으로 작성하세요.");
  assert.ok(result.steps[1].input.facts.length > 0);
  assert.equal(result.steps[2].handoff, false);
  assert.equal(result.question, "장비 구입 자료를 확인해 주세요.");
});

test("handoff threshold changes the recommendation including the boundary", () => {
  const agent = createAgent("expert-a");
  agent.nodes.find((node) => node.id === "handoff")!.threshold = 88;
  assert.equal(simulateAgent(agent, "complete", "질문").steps.at(-1)?.handoff, false);
  agent.nodes.find((node) => node.id === "handoff")!.threshold = 89;
  assert.equal(simulateAgent(agent, "complete", "질문").steps.at(-1)?.handoff, true);
});

test("conditional edges skip downstream stages and payload selection prevents invented inputs", () => {
  const agent = createAgent("expert-a");
  agent.edges[1].condition = "missing";
  assert.equal(simulateAgent(agent, "complete", "질문").steps.at(-1)?.status, "skipped");
  assert.equal(simulateAgent(agent, "missing", "질문").steps.at(-1)?.handoff, true);
  agent.edges[0].payload = "answer";
  const steps = simulateAgent(agent, "missing", "질문").steps;
  assert.equal(steps[1].status, "blocked");
  assert.equal(steps[1].input.facts.length, 0);
  assert.equal(steps[2].status, "skipped");
});

test("removing a stage removes its connections without silently changing the entry", () => {
  const agent = removeStage(createAgent("expert-a"), "answer");
  assert.equal(agent.nodes.length, 2);
  assert.equal(agent.edges.length, 0);
  assert.ok(validateAgent(agent).length > 0);
  assert.ok(validateAgent(removeStage(agent, "facts")).some((issue) => issue.code === "entry"));
});

test("saved configurations survive reload and are separated by demo expert", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const agent = createAgent("expert-a");
  agent.name = "나의 상담 에이전트";
  saveAgents(storage, "expert-a", [agent]);
  assert.equal(loadAgents(storage, "expert-a")[0].name, "나의 상담 에이전트");
  assert.deepEqual(loadAgents(storage, "expert-b"), []);
  assert.throws(() => saveAgents(storage, "expert-b", [agent]));
  const key = [...values.keys()][0];
  values.set(key, '{"version":1,"agents":[{"nodes":null}]}');
  assert.throws(() => loadAgents(storage, "expert-a"));
});
