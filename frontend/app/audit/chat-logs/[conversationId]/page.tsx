import { AuditExperience } from "@/components/audit/audit-experience";

/**
 * 챗 로그 감사 워크스페이스 — 대화 단위 라우트.
 * conversationId(레지스트리 키)를 외래키로 일관 사용 (conv.id는 내부 id라 미사용).
 *
 * 서버에서는 대화를 찾지 않는다 — 라이브 대화는 클라이언트 스토어(`"use client"`)에만 있어
 * 여기서 부르면 서버 오류가 난다(설계 §12 #4). 정적 번들·라이브 판별과 "없음" 안내는 AuditExperience 가 한다.
 */
export default async function AuditChatLogPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  return <AuditExperience conversationId={decodeURIComponent(conversationId)} />;
}
