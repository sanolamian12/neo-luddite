export const agentTasks = ["overview", "teach", "knowledge", "principles", "preview", "advanced"] as const;
export type AgentTask = typeof agentTasks[number] | "contributions" | "inbox";
export const agentTaskLabels: Record<typeof agentTasks[number], string> = { overview: "한눈에 보기", teach: "가르치기", knowledge: "지식 모음", principles: "운영 원칙", preview: "미리보기", advanced: "고급 설정" };
export function agentHref(task: AgentTask, agentId?: string): string {
  const query = new URLSearchParams();
  if (agentId) query.set("agent", agentId);
  if (task === "inbox") query.set("kind", "participation");
  const path = task === "inbox" ? "/audit/consultations" : task === "contributions" ? "/audit/contributions" : task === "overview" ? "/audit/agents" : `/audit/agents/${task}`;
  return `${path}${query.size ? `?${query}` : ""}`;
}
export function teachingHref(agentId: string, method: "session" | "manual") { return `${agentHref("teach", agentId)}&method=${method}`; }
export function knowledgeHref(agentId: string, kind: "case" | "question", id?: string) {
  return `${agentHref("knowledge", agentId)}&collection=${kind === "question" ? "questions" : "cases"}${id ? `&${kind}=${encodeURIComponent(id)}` : ""}`;
}
export function selectAgentHref(path: string, search: string, id: string) {
  const query = new URLSearchParams(search);
  query.set("agent", id);
  for (const key of ["case", "question", "review", "contribution"]) query.delete(key);
  return `${path}?${query}`;
}
export function taskFromPath(path: string): AgentTask | null {
  if (path === "/audit/agents" || path === "/audit/agents/") return "overview";
  const task = path.split("/")[3];
  return path.split("/").length === 4 && task !== "inbox" && path.startsWith("/audit/agents/") && (agentTasks as readonly string[]).includes(task) ? task as AgentTask : null;
}
