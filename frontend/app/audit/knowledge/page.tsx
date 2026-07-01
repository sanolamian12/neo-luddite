import { notFound } from "next/navigation";
import { KB_SEEDS } from "@/lib/kb-seeds";
import { DocumentReader } from "@/components/audit/kb/document-reader";

/**
 * KB 인덱스 — 마스터 문서(`스킬`)를 렌더한다.
 * 폴더 트리는 사이드바(`AuditSidebar` → KB 섹션)에서 노출.
 */
export default function KnowledgeIndexPage() {
  const master = KB_SEEDS.find((d) => d.category === "skill-master");
  if (!master) notFound();
  return <DocumentReader doc={master} />;
}
