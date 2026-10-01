import { notFound } from "next/navigation";
import { isPrototype } from "@/lib/data-mode";

export default function AgentsPage() {
  if (!isPrototype) notFound();
  return null;
}
