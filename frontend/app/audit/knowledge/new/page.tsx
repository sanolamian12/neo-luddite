import { DocumentEditor } from "@/components/audit/kb/document-editor";

/**
 * KB 신규 문서 — 빈 폼. 카테고리 선택 후 저장 시 path 자동 생성.
 */
export default function KnowledgeNewPage() {
  return <DocumentEditor mode="new" />;
}
