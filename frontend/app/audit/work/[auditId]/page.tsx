import { AuditWorkspace } from "@/components/audit/work/audit-workspace";

export default async function AuditWorkDetailPage({
  params,
}: {
  params: Promise<{ auditId: string }>;
}) {
  const { auditId } = await params;
  return <AuditWorkspace auditId={decodeURIComponent(auditId)} />;
}
