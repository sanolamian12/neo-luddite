"use client";

import { usePathname } from "next/navigation";

export type AdminSection =
  | "dashboard"
  | "pool"
  | "tasks"
  | "inspection"
  | "inquiries"
  | "auditors"
  | "settlement"
  | "pipeline"
  | "mail"
  | "root";

export interface AdminRouteContext {
  section: AdminSection;
  resourceId: string | null;
  subRoute: string | null;
}

const SECTION_TOKENS: AdminSection[] = [
  "dashboard",
  "pool",
  "tasks",
  "inspection",
  "inquiries",
  "auditors",
  "settlement",
  "pipeline",
  "mail",
];

/**
 * 현재 admin 라우트의 의미를 해석한다.
 * - `/admin`                           → { section: "root" }
 * - `/admin/<section>`                 → { section }
 * - `/admin/<section>/<resourceId>`    → { section, resourceId }
 * - `/admin/<section>/<sub>/<id>`      → { section, subRoute: <sub>, resourceId: <id> }
 */
export function useAdminRouteContext(): AdminRouteContext {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean);

  if (parts[0] !== "admin") {
    return { section: "root", resourceId: null, subRoute: null };
  }

  const sectionToken = parts[1];
  if (!sectionToken) {
    return { section: "root", resourceId: null, subRoute: null };
  }

  const section = (SECTION_TOKENS as readonly string[]).includes(sectionToken)
    ? (sectionToken as AdminSection)
    : "root";

  if (parts.length === 2) {
    return { section, resourceId: null, subRoute: null };
  }

  if (parts.length === 3) {
    return {
      section,
      resourceId: decodeURIComponent(parts[2]),
      subRoute: null,
    };
  }

  return {
    section,
    subRoute: parts[2] ?? null,
    resourceId: parts[3] ? decodeURIComponent(parts[3]) : null,
  };
}
