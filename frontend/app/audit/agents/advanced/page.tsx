import { notFound } from "next/navigation";
import { AgentStudio } from "@/components/audit/agents/agent-studio";
import { agentStudioEnabled } from "@/lib/data-mode";

export default function AdvancedAgentsPage() {
  if (!agentStudioEnabled) notFound();
  return <AgentStudio />;
}
