import { notFound } from "next/navigation";
import { ContributionInsights } from "@/components/admin/contribution-insights";
import { isPrototype } from "@/lib/data-mode";

export default function ContributionInsightsPage() {
  if (!isPrototype) notFound();
  return <ContributionInsights />;
}
