"use client";

import Link from "next/link";
import { useAccountHydrated, useAccountStore } from "@/lib/account-store";
import { routeForAccount } from "@/lib/account-route";
import { buttonVariants } from "@/components/ui/button";

export function PublicAccountNav() {
  const hydrated = useAccountHydrated();
  const session = useAccountStore((state) => state.session);
  const viewer = useAccountStore((state) => state.viewer);
  const auditor = useAccountStore((state) => state.auditor);
  const admin = useAccountStore((state) => state.admin);
  const active = hydrated ? session : null;
  return <Link href={active ? routeForAccount({ viewer, auditor, admin }[active]) : "/login"} className={buttonVariants({ variant: "ghost", size: "sm" })}>
    {active === "auditor" ? "전문가 워크스페이스" : active === "admin" ? "운영 콘솔" : active === "viewer" ? "내 상담" : "로그인"}
  </Link>;
}
