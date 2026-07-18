import { PackagingDetailView } from "@/components/admin/packaging-detail-view";

export default async function AdminPackagingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<{ auditorId?: string }>;
}) {
  const { conversationId } = await params;
  // 목록이 Task×세무사 단위라 상세도 세무사를 물고 온다(같은 대화, 다른 세무사 = 다른 항목).
  const { auditorId } = await searchParams;
  return (
    <div className="flex-1 overflow-y-auto">
      <PackagingDetailView
        conversationId={decodeURIComponent(conversationId)}
        auditorId={auditorId ? decodeURIComponent(auditorId) : undefined}
      />
    </div>
  );
}
