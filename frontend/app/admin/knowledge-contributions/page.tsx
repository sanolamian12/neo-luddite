import { notFound } from "next/navigation";
import { isPrototype } from "@/lib/data-mode";
import { KnowledgeContributionReview } from "@/components/admin/knowledge-contributions";

export default function KnowledgeContributionsPage() {
  if (!isPrototype) notFound();
  return <KnowledgeContributionReview />;
}
