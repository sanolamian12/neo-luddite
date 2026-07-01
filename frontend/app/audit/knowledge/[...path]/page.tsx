import { redirect } from "next/navigation";
import { KB_BASE } from "@/lib/kb-route";
import { ClientDocumentView } from "@/components/audit/kb/client-document-view";

/**
 * KB 문서 리더 — 한글 path 를 catch-all 로 받는다.
 * 시드와 user 문서를 모두 표시해야 하므로 클라이언트 컴포넌트에 위임.
 */
export default async function KnowledgeDocumentPage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path: segments } = await params;
  if (!segments?.length) redirect(KB_BASE);

  const path = segments.join("/");
  if (path === "skill") redirect(KB_BASE);

  return <ClientDocumentView path={path} />;
}
