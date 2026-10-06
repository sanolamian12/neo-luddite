import { notFound } from "next/navigation";
import { agentTasks } from "@/lib/agent-navigation";

export function generateStaticParams() {
  return agentTasks.filter((task) => task !== "advanced" && task !== "inbox").map((task) => ({ task }));
}
export default async function AgentTaskPage({ params }: { params: Promise<{ task: string }> }) {
  const { task } = await params;
  if (!(["overview", "teach", "knowledge", "contributions", "principles", "preview"] as string[]).includes(task)) notFound();
  return null;
}
