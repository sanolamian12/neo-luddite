import { notFound } from "next/navigation";
import { AgentPractice } from "@/components/audit/agents/agent-practice";
import { agentStudioEnabled } from "@/lib/data-mode";

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  if (!agentStudioEnabled) notFound();
  return <AgentPractice>{children}</AgentPractice>;
}
