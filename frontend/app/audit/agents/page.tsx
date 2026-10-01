import { notFound } from "next/navigation";
import { AgentPractice } from "@/components/audit/agents/agent-practice";
import { isPrototype } from "@/lib/data-mode";

export default function AgentsPage() {
  if (!isPrototype) notFound();
  return <AgentPractice />;
}
