import { notFound } from "next/navigation";
import { getConversation } from "@/lib/load-conversation";
import { AuditExperience } from "@/components/audit/audit-experience";

/**
 * 챗 로그 감사 워크스페이스 — 대화 단위 라우트.
 * conversationId(레지스트리 키)를 외래키로 일관 사용 (conv.id는 내부 id라 미사용).
 */
export default async function AuditChatLogPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const conv = getConversation(conversationId);
  if (!conv) {
    notFound();
  }
  return <AuditExperience conversationId={conversationId} />;
}
