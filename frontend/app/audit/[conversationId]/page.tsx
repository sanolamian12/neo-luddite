import { redirect } from "next/navigation";

/**
 * 레거시 라우트 — 프토 2의 `/audit/<key>`를 새 위치(`/audit/chat-logs/<key>`)로 보낸다.
 * `chat-logs` / `knowledge`는 정적 세그먼트이므로 본 catch-all 에 잡히지 않는다.
 */
export default async function LegacyAuditPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  redirect(`/audit/chat-logs/${conversationId}`);
}
