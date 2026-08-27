import { KbPassageDetailView } from "@/components/audit/kb/kb-passage-detail-view";

export default async function KbMapPassagePage({
  params,
}: {
  params: Promise<{ passageId: string }>;
}) {
  const { passageId } = await params;
  return <KbPassageDetailView passageId={decodeURIComponent(passageId)} />;
}
