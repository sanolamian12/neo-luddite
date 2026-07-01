import { AuditorDetailView } from "@/components/admin/auditor-detail-view";

export default async function AdminAuditorDetailPage({
  params,
}: {
  params: Promise<{ auditorId: string }>;
}) {
  const { auditorId } = await params;
  return (
    <div className="flex-1 overflow-y-auto">
      <AuditorDetailView auditorId={decodeURIComponent(auditorId)} />
    </div>
  );
}
