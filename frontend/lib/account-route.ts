import type { Account, AccountId } from "./account-schema";
import { isActiveOccupation } from "./occupations";

/**
 * 계정에 해당하는 진입 라우트를 반환한다.
 * - viewer  → /chat/<occupation>. 비활성 직업군이면 /select.
 * - auditor → /audit/dashboard (기여 통장 대시보드 — PoC P0 부터 기본 랜딩 변경).
 * - admin   → /admin/dashboard (상황실).
 */
const AUDITOR_LANDING = "/audit/dashboard";
const ADMIN_LANDING = "/admin/dashboard";

export function routeForAccount(account: Account): string {
  if (account.role === "viewer") {
    return isActiveOccupation(account.occupation)
      ? `/chat/${account.occupation}`
      : "/select";
  }
  if (account.role === "admin") {
    return ADMIN_LANDING;
  }
  return AUDITOR_LANDING;
}

/** 라우트 경로에서 활성 계정 ID 를 파생한다. */
export function activeAccountFromPath(pathname: string): AccountId {
  if (pathname.startsWith("/audit")) return "auditor";
  if (pathname.startsWith("/admin")) return "admin";
  return "viewer";
}
