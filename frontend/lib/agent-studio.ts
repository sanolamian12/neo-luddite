import { z } from "zod";
import { practiceSchema } from "./agent-practice";

const nodeSchema = z.object({
  id: z.string().min(1), name: z.string().max(100),
  kind: z.enum(["facts", "answer", "handoff"]),
  instructions: z.string().max(12000), sources: z.string().max(4000),
  model: z.enum(["fast", "thorough"]),
  threshold: z.number().min(0).max(100), onMissing: z.boolean(),
});
const edgeSchema = z.object({
  id: z.string().min(1), from: z.string(), to: z.string(),
  condition: z.enum(["always", "low", "missing"]),
  payload: z.enum(["all", "facts", "answer"]),
});
export const agentSchema = z.object({
  id: z.string(), owner: z.string(), name: z.string().max(100), entry: z.string(),
  nodes: z.array(nodeSchema).max(12), edges: z.array(edgeSchema).max(132),
  practice: practiceSchema.optional(),
});
export type Stage = z.infer<typeof nodeSchema>;
export type Connection = z.infer<typeof edgeSchema>;
export type Agent = z.infer<typeof agentSchema>;
export type Scenario = "complete" | "missing" | "conflict";
export const stageLabels = { facts: "사실 수집", answer: "답변 생성", handoff: "전문가 연결 판단" } as const;
export const conditionLabels = { always: "항상 실행", low: "신뢰도 70% 미만", missing: "누락된 사실이 있을 때" } as const;
export const payloadLabels = { all: "모든 결과", facts: "사실 기반만", answer: "답변만" } as const;
export const scenarioLabels = { complete: "자료가 충분한 상담", missing: "사실이 부족한 상담", conflict: "자료가 상충하는 상담" } as const;
const instructions = {
  facts: "질문에서 확인된 사실과 아직 모르는 사실을 구분하세요.\n출처가 없는 내용은 추측하지 말고 추가 질문으로 남기세요.",
  answer: "앞 단계에서 전달된 사실 기반으로 답변하세요.\n근거와 한계를 설명하고, 확인되지 않은 내용은 단정하지 마세요.",
  handoff: "답변의 신뢰도와 누락된 사실을 확인하세요.\n설정된 조건에 해당하면 사람 전문가와의 상담을 권하고 그 이유를 설명하세요.",
};
export function createStage(kind: Stage["kind"], id = crypto.randomUUID()): Stage {
  return { id, kind, name: stageLabels[kind], instructions: instructions[kind], sources: kind === "facts" ? "고객이 제공한 자료 · 전문가 지식 베이스" : "이전 단계의 결과", model: kind === "facts" ? "fast" : "thorough", threshold: 70, onMissing: true };
}
export function createAgent(owner: string): Agent {
  return {
    id: crypto.randomUUID(), owner, name: "나의 세무 상담 에이전트", entry: "facts",
    nodes: [createStage("facts", "facts"), createStage("answer", "answer"), createStage("handoff", "handoff")],
    edges: [
      { id: "facts-answer", from: "facts", to: "answer", condition: "always", payload: "facts" },
      { id: "answer-handoff", from: "answer", to: "handoff", condition: "always", payload: "all" },
    ],
  };
}

export function orderedStages(agent: Agent): Stage[] {
  const degree = new Map(agent.nodes.map((node) => [node.id, agent.edges.filter((edge) => edge.to === node.id).length]));
  const queue = agent.nodes.filter((node) => degree.get(node.id) === 0);
  const result: Stage[] = [];
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index];
    result.push(node);
    for (const edge of agent.edges.filter((edge) => edge.from === node.id)) {
      degree.set(edge.to, (degree.get(edge.to) ?? 0) - 1);
      const next = agent.nodes.find((candidate) => candidate.id === edge.to);
      if (next && degree.get(edge.to) === 0) queue.push(next);
    }
  }
  return result;
}

export function validateAgent(agent: Agent): { code: string; message: string }[] {
  const issues: { code: string; message: string }[] = [];
  const ids = new Set(agent.nodes.map((node) => node.id));
  if (!agent.name.trim()) issues.push({ code: "name", message: "에이전트 이름을 입력하세요." });
  if (!ids.has(agent.entry)) issues.push({ code: "entry", message: "시작 단계를 선택하세요." });
  if (ids.size !== agent.nodes.length || new Set(agent.edges.map((edge) => edge.id)).size !== agent.edges.length) issues.push({ code: "duplicate", message: "중복된 단계 또는 연결 ID가 있습니다." });
  if (agent.nodes.some((node) => !node.name.trim() || !node.instructions.trim())) issues.push({ code: "instructions", message: "모든 단계의 이름과 지시문을 입력하세요." });
  if (agent.edges.some((edge) => !ids.has(edge.from) || !ids.has(edge.to))) issues.push({ code: "edge", message: "삭제된 단계로 이어지는 연결을 제거하세요." });
  if (agent.edges.some((edge) => edge.to === agent.entry)) issues.push({ code: "entry-input", message: "시작 단계로 들어오는 연결을 제거하세요." });
  if (orderedStages(agent).length !== agent.nodes.length) issues.push({ code: "cycle", message: "순환 연결이 있습니다. 이전 단계로 되돌아가는 연결을 제거하세요." });
  const reachable = new Set([agent.entry]);
  for (let pass = 0; pass < agent.nodes.length; pass++) {
    for (const edge of agent.edges) if (reachable.has(edge.from)) reachable.add(edge.to);
  }
  if (agent.nodes.some((node) => !reachable.has(node.id))) issues.push({ code: "disconnected", message: "연결되지 않은 단계가 있습니다. 시작 단계에서 이어지는 연결을 추가하세요." });
  return issues;
}
export function removeStage(agent: Agent, id: string): Agent {
  return { ...agent, nodes: agent.nodes.filter((node) => node.id !== id), edges: agent.edges.filter((edge) => edge.from !== id && edge.to !== id) };
}

export interface StageData { facts: string[]; missing: string[]; answer: string; confidence: number | null }
export interface RunStep {
  nodeId: string; name: string; kind: Stage["kind"]; status: "complete" | "skipped" | "blocked";
  instructions: string; sources: string; model: Stage["model"]; input: StageData; output: StageData;
  message: string; handoff: boolean | null; edgeIds: string[];
}
export interface AgentRun { question: string; scenario: Scenario; steps: RunStep[] }
const emptyData = (): StageData => ({ facts: [], missing: [], answer: "", confidence: null });
const examples: Record<Scenario, StageData> = {
  complete: { facts: ["업무용 장비 구입 자료 제공", "거래 일자와 영수증 확인", "사용 목적 확인"], missing: [], confidence: 88, answer: "제공된 자료에서 거래 일자, 증빙, 사용 목적을 확인했습니다. 이 사실을 바탕으로 검토 항목을 정리하고, 적용 판단은 추가 검토 후 안내합니다." },
  missing: { facts: ["장비 구입 사실 확인"], missing: ["구입 영수증", "업무 사용 비율"], confidence: 54, answer: "구입 영수증과 업무 사용 비율이 아직 확인되지 않았습니다. 자료를 보완한 뒤 답변을 구체화할 수 있습니다." },
  conflict: { facts: ["고객 진술과 제출 자료 확인"], missing: ["서로 다른 거래 일자의 정정 자료"], confidence: 36, answer: "고객 진술과 제출 자료의 거래 일자가 다릅니다. 어느 정보가 정확한지 확인하기 전에는 결론을 내리기 어렵습니다." },
};

/** Deterministic demonstration: honors graph/data routing, never interprets prompts or calls an LLM. */
export function simulateAgent(agent: Agent, scenario: Scenario, question: string): AgentRun {
  const issues = validateAgent(agent);
  if (issues.length) throw new Error(issues[0].message);
  if (!question.trim()) throw new Error("테스트 질문을 입력하세요.");
  const steps: RunStep[] = [];
  for (const node of orderedStages(agent)) {
    const arrivals = agent.edges.filter((edge) => edge.to === node.id).flatMap((edge) => {
      const previous = steps.find((step) => step.nodeId === edge.from);
      if (!previous || previous.status !== "complete") return [];
      const data = previous.output;
      const matches = edge.condition === "always" || (edge.condition === "low" && data.confidence !== null && data.confidence < 70) || (edge.condition === "missing" && data.missing.length > 0);
      if (!matches) return [];
      return [{ edge, data: { ...data, facts: edge.payload === "answer" ? [] : data.facts, missing: edge.payload === "answer" ? [] : data.missing, answer: edge.payload === "facts" ? "" : data.answer } }];
    });
    const confidence = arrivals.flatMap(({ data }) => data.confidence === null ? [] : [data.confidence]);
    const input: StageData = {
      facts: [...new Set(arrivals.flatMap(({ data }) => data.facts))], missing: [...new Set(arrivals.flatMap(({ data }) => data.missing))],
      answer: arrivals.map(({ data }) => data.answer).filter(Boolean).join("\n"), confidence: confidence.length ? Math.min(...confidence) : null,
    };
    const step: RunStep = { nodeId: node.id, name: node.name, kind: node.kind, status: "complete", instructions: node.instructions, sources: node.sources, model: node.model, input, output: emptyData(), message: "", handoff: null, edgeIds: arrivals.map(({ edge }) => edge.id) };
    if (node.id !== agent.entry && arrivals.length === 0) {
      step.status = "skipped"; step.message = "조건에 맞는 입력이 없어 이 단계를 건너뛰었습니다.";
    } else if (node.kind === "facts") {
      step.output = { ...examples[scenario], answer: "" }; step.message = "샘플 자료에서 사실과 누락 항목을 분리했습니다.";
    } else if (node.kind === "answer" && input.facts.length === 0) {
      step.status = "blocked"; step.message = "사실 기반이 전달되지 않았습니다. 입력 연결의 전달 데이터를 확인하세요.";
    } else if (node.kind === "answer") {
      step.output = { ...input, answer: examples[scenario].answer }; step.message = step.output.answer;
    } else if (input.confidence === null) {
      step.status = "blocked"; step.message = "판단할 결과가 없습니다. 사실 수집 또는 답변 단계를 연결하세요.";
    } else {
      step.output = input;
      step.handoff = input.confidence < node.threshold || (node.onMissing && input.missing.length > 0);
      step.message = step.handoff ? `전문가 상담을 권합니다. ${input.confidence < node.threshold ? `샘플 신뢰도가 기준 ${node.threshold}% 미만입니다.` : "확인되지 않은 사실이 남아 있습니다."}` : "설정된 전문가 연결 조건에 해당하지 않습니다.";
    }
    steps.push(step);
  }
  return { question: question.trim(), scenario, steps };
}

type AgentStorage = Pick<Storage, "getItem" | "setItem">;
const storageKey = (owner: string) => `neo-agent-studio-v1:${encodeURIComponent(owner)}`;
const librarySchema = z.object({ version: z.literal(1), agents: z.array(agentSchema).max(30) });
export function loadAgents(storage: AgentStorage, owner: string): Agent[] {
  const raw = storage.getItem(storageKey(owner));
  if (!raw) return [];
  const library = librarySchema.parse(JSON.parse(raw));
  if (library.agents.some((agent) => agent.owner !== owner)) throw new Error("다른 계정의 설정은 불러올 수 없습니다.");
  return library.agents;
}
export function saveAgents(storage: AgentStorage, owner: string, agents: Agent[]): void {
  const library = librarySchema.parse({ version: 1, agents });
  if (agents.some((agent) => agent.owner !== owner)) throw new Error("다른 계정의 설정은 저장할 수 없습니다.");
  storage.setItem(storageKey(owner), JSON.stringify(library));
}
