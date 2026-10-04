import { ExpertConsultationsView } from "@/components/consultation/expert-consultations-view";

import { agentStudioEnabled } from "@/lib/data-mode";
import { ConsultationHub } from "@/components/audit/agents/consultation-hub";

/** 상담 신청 — `/…/consultations` 목록, `/…/consultations/<id>` 해당 신청을 열고 시작. */
export default async function AuditConsultationsPage({
  params,
}: {
  params: Promise<{ id?: string[] }>;
}) {
  const { id } = await params;
  const initialId = id?.[0] ? decodeURIComponent(id[0]) : undefined;
  if (agentStudioEnabled) return <ConsultationHub initialId={initialId} />;
  return <ExpertConsultationsView key={initialId ?? "list"} initialId={initialId} />;
}
