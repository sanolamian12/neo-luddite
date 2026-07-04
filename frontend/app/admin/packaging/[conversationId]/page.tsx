import { PackagingDetailView } from "@/components/admin/packaging-detail-view";

export default async function AdminPackagingDetailPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  return (
    <div className="flex-1 overflow-y-auto">
      <PackagingDetailView conversationId={decodeURIComponent(conversationId)} />
    </div>
  );
}
