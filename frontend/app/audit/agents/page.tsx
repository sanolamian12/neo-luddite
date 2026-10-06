import { notFound } from "next/navigation";
import { expertTeachingEnabled } from "@/lib/data-mode";

export default function AgentsPage() {
  if (!expertTeachingEnabled) notFound();
  return null;
}
