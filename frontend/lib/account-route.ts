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

export function safeReturnPath(value?: string | null): string | null {
  if (!value?.startsWith("/") || value.startsWith("//") || /[\\\s]/.test(value)) return null;
  try {
    const url = new URL(value, "https://local.invalid");
    if (url.origin !== "https://local.invalid") return null;
    return `${url.pathname}${url.search}`;
  } catch { return null; }
}

/** Public cancel/return destinations, stripped of unrelated query parameters. */
export function publicReturnPath(value?: string | null): string | null {
  const safe = safeReturnPath(value);
  if (!safe) return null;
  const url = new URL(safe, "https://local.invalid");
  if (url.pathname === "/") return "/";
  const match = /^\/chat\/([^/]+)$/.exec(url.pathname);
  if (!match || !isActiveOccupation(match[1])) return null;
  const id = url.searchParams.get("c");
  return `${url.pathname}${id ? `?c=${encodeURIComponent(id)}` : ""}`;
}

export function loginHref(returnTo: string) {
  return `/login?next=${encodeURIComponent(returnTo)}`;
}

export function destinationAfterLogin(account: Account, returnTo?: string | null): string {
  const publicPath = publicReturnPath(returnTo);
  if (publicPath) return publicPath;
  const safe = safeReturnPath(returnTo);
  if (safe) {
    const pathname = new URL(safe, "https://local.invalid").pathname;
    const allowed = account.role === "viewer" ? /^\/(consultations|offers|rooms|select|expert\/apply)(\/|$)/
      : account.role === "auditor" ? /^\/audit(\/|$)/ : /^\/admin(\/|$)/;
    if (allowed.test(pathname)) return safe;
  }
  return routeForAccount(account);
}
