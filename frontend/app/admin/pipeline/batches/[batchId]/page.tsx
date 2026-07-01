import { BatchDetailView } from "@/components/admin/batch-detail-view";

export default async function AdminBatchDetailPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;
  return (
    <div className="flex-1 overflow-y-auto">
      <BatchDetailView batchId={decodeURIComponent(batchId)} />
    </div>
  );
}
