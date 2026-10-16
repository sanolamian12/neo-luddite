"use client";

import { usePathname } from "next/navigation";

export type AuditSection =
  | "agents"
  | "contributions"
  | "dashboard"
  | "mailbox"
  | "ledger"
  | "profile"
  | "consultations"
  | "pool"
  | "rooms"
  | "root";

export interface AuditRouteContext {
  section: AuditSection;
  resourceId: string | null;
}

const SECTION_TOKENS: AuditSection[] = [
  "agents",
  "contributions",
  "dashboard",
  "mailbox",
  "ledger",
  "profile",
  "consultations",
  "pool",
  "rooms",
];

/**
 * 현재 감사 모드 라우트의 의미를 해석한다.
 * - `/audit`                              → { section: "root" }
 * - `/audit/<section>`                    → { section }
 * - `/audit/<section>/<id>`               → { section, resourceId }
 * - 알 수 없는 `/audit/<token>`           → { section: "root" }
 */
export function useAuditRouteContext(): AuditRouteContext {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean);

  if (parts[0] !== "audit") {
    return { section: "root", resourceId: null };
  }

  if (!parts[1]) {
    return { section: "root", resourceId: null };
  }

  const token = parts[1];
  if (!(SECTION_TOKENS as readonly string[]).includes(token)) {
    return { section: "root", resourceId: null };
  }
  return {
    section: token as AuditSection,
    resourceId: parts[2] ? decodeURIComponent(parts[2]) : null,
  };
}
