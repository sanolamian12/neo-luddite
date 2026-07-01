"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAccountHydrated, useAccountStore } from "@/lib/account-store";
import { routeForAccount } from "@/lib/account-route";
import type { AccountId } from "@/lib/account-schema";

/**
 * 클라이언트 역할 게이트.
 * - 비로그인 → /login 으로 리다이렉트
 * - 다른 역할로 로그인 → 본인 랜딩으로 리다이렉트
 * - 일치할 때만 children 렌더
 *
 * PoC: 클라이언트 전용 목 인증. localStorage 는 누구나 수정 가능 → 실 보안 아님.
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
      router.replace("/login");
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
