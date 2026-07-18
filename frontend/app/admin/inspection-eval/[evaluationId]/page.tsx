import { InspectionEvalWorkspace } from "@/components/admin/inspection-eval-workspace";

export default async function AdminInspectionEvalDetailPage({
  params,
}: {
  params: Promise<{ evaluationId: string }>;
}) {
  const { evaluationId } = await params;
  return (
    <InspectionEvalWorkspace evaluationId={decodeURIComponent(evaluationId)} />
  );
}
