import { notFound } from "next/navigation";
import { AgentPractice } from "@/components/audit/agents/agent-practice";
import { isPrototype } from "@/lib/data-mode";

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  if (!isPrototype) notFound();
  return <AgentPractice>{children}</AgentPractice>;
}
