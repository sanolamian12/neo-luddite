import { notFound } from "next/navigation";
import { AgentStudio } from "@/components/audit/agents/agent-studio";
import { isPrototype } from "@/lib/data-mode";

export default function AdvancedAgentsPage() {
  if (!isPrototype) notFound();
  return <AgentStudio />;
}
