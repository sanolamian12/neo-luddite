import { notFound } from "next/navigation";
import { AgentPractice } from "@/components/audit/agents/agent-practice";
import { expertTeachingEnabled } from "@/lib/data-mode";

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  if (!expertTeachingEnabled) notFound();
  return <AgentPractice>{children}</AgentPractice>;
}
