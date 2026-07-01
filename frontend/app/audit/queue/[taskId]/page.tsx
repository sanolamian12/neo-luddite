import { QueueDetailView } from "@/components/auditor/queue-detail-view";

export default async function AuditQueueDetailPage({
  params,
}: {
  params: Promise<{ taskId: string }>;
}) {
  const { taskId } = await params;
  return (
    <div className="flex-1 overflow-y-auto">
      <QueueDetailView taskId={decodeURIComponent(taskId)} />
    </div>
  );
}
