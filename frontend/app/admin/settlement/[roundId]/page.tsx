import { SettlementDetailView } from "@/components/admin/settlement-detail-view";

export default async function AdminSettlementDetailPage({
  params,
}: {
  params: Promise<{ roundId: string }>;
}) {
  const { roundId } = await params;
  return (
    <div className="flex-1 overflow-y-auto">
      <SettlementDetailView roundId={decodeURIComponent(roundId)} />
    </div>
  );
}
