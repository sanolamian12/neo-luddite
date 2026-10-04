import { notFound } from "next/navigation";
import { agentStudioEnabled } from "@/lib/data-mode";

export default function AgentsPage() {
  if (!agentStudioEnabled) notFound();
  return null;
}
