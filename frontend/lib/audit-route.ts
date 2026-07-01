"use client";

import { usePathname } from "next/navigation";

export type AuditSection =
  | "dashboard"
  | "queue"
  | "work"
  | "results"
  | "mailbox"
  | "ledger"
  | "chat-logs"
  | "knowledge"
  | "root";

export interface AuditRouteContext {
  section: AuditSection;
  resourceId: string | null;
  /** 레거시 호환 — chat-logs 섹션의 conversationId. */
  conversationId: string | null;
}

const SECTION_TOKENS: AuditSection[] = [
  "dashboard",
  "queue",
  "work",
  "results",
  "mailbox",
  "ledger",
  "chat-logs",
  "knowledge",
];

/**
 * 현재 감사 모드 라우트의 의미를 해석한다.
 * - `/audit`                              → { section: "root" }
 * - `/audit/<section>`                    → { section }
 * - `/audit/<section>/<id>`               → { section, resourceId }
 * - `/audit/chat-logs/<id>`               → { section: "chat-logs", conversationId, resourceId } (레거시 호환)
 * - 레거시 `/audit/<id>` (리다이렉트 직전) → { section: "chat-logs", conversationId }
 */
export function useAuditRouteContext(): AuditRouteContext {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean);

  if (parts[0] !== "audit") {
    return { section: "root", resourceId: null, conversationId: null };
  }

  if (!parts[1]) {
    return { section: "root", resourceId: null, conversationId: null };
  }

  const token = parts[1];
  if ((SECTION_TOKENS as readonly string[]).includes(token)) {
    const section = token as AuditSection;
    const resourceId = parts[2] ? decodeURIComponent(parts[2]) : null;
    return {
      section,
      resourceId,
      conversationId: section === "chat-logs" ? resourceId : null,
    };
  }

  // 레거시 `/audit/<id>` — 리다이렉트 직전 한순간 보일 수 있음.
  return {
    section: "chat-logs",
    resourceId: decodeURIComponent(token),
    conversationId: decodeURIComponent(token),
  };
}

/** 호환 헬퍼 — 현재 라우트의 대화 ID(있다면)만 추출. */
export function useAuditConversationId(): string | null {
  return useAuditRouteContext().conversationId;
}
