import { InspectionWorkspace } from "@/components/admin/inspection-workspace";

export default async function AdminInspectionDetailPage({
  params,
}: {
  params: Promise<{ auditId: string }>;
}) {
  const { auditId } = await params;
  return <InspectionWorkspace auditId={decodeURIComponent(auditId)} />;
}
