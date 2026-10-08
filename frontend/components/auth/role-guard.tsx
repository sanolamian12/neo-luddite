"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAccountHydrated, useAccountStore } from "@/lib/account-store";
import { loginHref, routeForAccount } from "@/lib/account-route";
import type { AccountId } from "@/lib/account-schema";

/**
 * 클라이언트 역할 게이트.
 * - 비로그인 → /login 으로 리다이렉트
 * - 다른 역할로 로그인 → 본인 랜딩으로 리다이렉트
 * - 일치할 때만 children 렌더
 *
 * UI navigation only. Live identity is verified with Supabase Auth + profiles;
 * database RLS and the Python API enforce access to data.
 */
export function RoleGuard({
  role,
  children,
}: {
  role: AccountId;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const hydrated = useAccountHydrated();
  const session = useAccountStore((s) => s.session);
  const viewer = useAccountStore((s) => s.viewer);
  const auditor = useAccountStore((s) => s.auditor);
  const admin = useAccountStore((s) => s.admin);

  useEffect(() => {
    if (!hydrated) return;
    if (session === null) {
      router.replace(loginHref(window.location.pathname + window.location.search));
      return;
    }
    if (session !== role) {
      const accounts = { viewer, auditor, admin } as const;
      router.replace(routeForAccount(accounts[session]));
    }
  }, [hydrated, session, role, router, viewer, auditor, admin]);

  if (!hydrated || session !== role) {
    return (
      <div className="flex min-h-svh flex-1 items-center justify-center">
        <div className="h-8 w-32 animate-pulse rounded-md bg-muted/50" />
      </div>
    );
  }

  return <>{children}</>;
}
