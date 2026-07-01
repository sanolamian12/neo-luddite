import { VersionDetailView } from "@/components/admin/version-detail-view";

export default async function AdminVersionDetailPage({
  params,
}: {
  params: Promise<{ versionId: string }>;
}) {
  const { versionId } = await params;
  return (
    <div className="flex-1 overflow-y-auto">
      <VersionDetailView versionId={decodeURIComponent(versionId)} />
    </div>
  );
}
