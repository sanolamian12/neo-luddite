import { ResultDetailView } from "@/components/auditor/result-detail-view";

export default async function AuditResultDetailPage({
  params,
}: {
  params: Promise<{ auditId: string }>;
}) {
  const { auditId } = await params;
  return (
    <div className="flex-1 overflow-y-auto">
      <ResultDetailView auditId={decodeURIComponent(auditId)} />
    </div>
  );
}
