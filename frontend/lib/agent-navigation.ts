export const agentTasks = ["overview", "teach", "knowledge", "contributions", "principles", "preview", "advanced", "inbox"] as const;
export type AgentTask = typeof agentTasks[number];
export function agentHref(task: AgentTask, agentId?: string): string {
  const query = new URLSearchParams();
  if (agentId) query.set("agent", agentId);
  if (task === "inbox") query.set("kind", "participation");
  const path = task === "inbox" ? "/audit/consultations" : task === "overview" ? "/audit/agents" : `/audit/agents/${task}`;
  return `${path}${query.size ? `?${query}` : ""}`;
}
export function taskFromPath(path: string): AgentTask | null {
  if (path === "/audit/agents" || path === "/audit/agents/") return "overview";
  const task = path.split("/")[3];
  return path.split("/").length === 4 && task !== "inbox" && path.startsWith("/audit/agents/") && (agentTasks as readonly string[]).includes(task) ? task as AgentTask : null;
}
