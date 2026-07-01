import { PoolDetailView } from "@/components/admin/pool-detail-view";

export default async function AdminPoolDetailPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  return (
    <div className="flex-1 overflow-y-auto">
      <PoolDetailView conversationId={decodeURIComponent(conversationId)} />
    </div>
  );
}
