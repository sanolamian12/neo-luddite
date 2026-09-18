import { ExpertConsultationsView } from "@/components/consultation/expert-consultations-view";

/** 상담 신청 — `/…/consultations` 목록, `/…/consultations/<id>` 해당 신청을 열고 시작. */
export default async function AuditConsultationsPage({
  params,
}: {
  params: Promise<{ id?: string[] }>;
}) {
  const { id } = await params;
  const initialId = id?.[0] ? decodeURIComponent(id[0]) : undefined;
  return <ExpertConsultationsView key={initialId ?? "list"} initialId={initialId} />;
}
