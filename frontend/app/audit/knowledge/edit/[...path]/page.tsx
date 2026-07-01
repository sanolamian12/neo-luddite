import { redirect } from "next/navigation";
import { KB_BASE } from "@/lib/kb-route";
import { ClientEditView } from "@/components/audit/kb/client-edit-view";

/**
 * KB 문서 편집 라우트. catch-all 은 마지막에만 올 수 있으므로
 * 편집 의도를 정적 세그먼트 `edit/` 로 표현한다 (`/audit/knowledge/edit/<path>`).
 */
export default async function KnowledgeEditPage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path: segments } = await params;
  if (!segments?.length) redirect(KB_BASE);
  const path = segments.join("/");
  return <ClientEditView path={path} />;
}
