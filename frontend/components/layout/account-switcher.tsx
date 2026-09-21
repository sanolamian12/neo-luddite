"use client";

import { useRouter } from "next/navigation";
import { ChevronsUpDown, Handshake, LogOut } from "lucide-react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
import { useAccountHydrated, useAccountStore } from "@/lib/account-store";
import { activeAccountFromPath } from "@/lib/account-route";
import { usePendingOffersFor } from "@/lib/offer-store";
import { getOccupation } from "@/lib/occupations";
import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";
import type { AccountId } from "@/lib/account-schema";

/**
 * 사이드바 푸터의 계정 메뉴 — 로그인한 계정 표시 + 로그아웃.
 * - 활성 계정은 session 에서 파생 (없으면 라우트 기준으로 폴백).
 * - auditor 는 평가자 이름, admin 은 운영자 이름 인라인 편집.
 * - 사장님(viewer)은 "세무사 연결 요청 N건" → /offers (0039, 경로 B). 대기 요청이 있으면 버튼에도 수를 띄운다
 *   — 메뉴가 닫혀 있어도 요청이 온 걸 알 수 있게.
 * - 로그아웃 시 세션 초기화 후 /login 으로 이동.
 */
export function AccountSwitcher() {
  const hydrated = useAccountHydrated();
  const viewer = useAccountStore((s) => s.viewer);
  const auditor = useAccountStore((s) => s.auditor);
  const admin = useAccountStore((s) => s.admin);
  const session = useAccountStore((s) => s.session);
  const setReviewerName = useAccountStore((s) => s.setReviewerName);
  const setOperatorName = useAccountStore((s) => s.setOperatorName);
  const logout = useAccountStore((s) => s.logout);
  const router = useRouter();
  const pathname = usePathname();
  const activeId: AccountId = session ?? activeAccountFromPath(pathname);
  const pendingOffers = usePendingOffersFor(viewer.id);
  const offerCount = activeId === "viewer" ? (pendingOffers ?? 0) : 0;

  if (!hydrated) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <div className="h-12 animate-pulse rounded-md bg-muted/50" />
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  const accounts = { viewer, auditor, admin } as const;
  const active = accounts[activeId];
  const viewerOcc = getOccupation(viewer.occupation);
  const secondaryFor: Record<AccountId, string> = {
    viewer: viewerOcc?.label ?? viewer.occupation,
    auditor: auditor.reviewerName,
    admin: admin.operatorName,
  };

  const handleLogout = async () => {
    await logout();
    router.replace("/login");
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <MenuPrimitive.Root>
          <MenuPrimitive.Trigger
            render={
              <SidebarMenuButton size="lg" className="data-popup-open:bg-sidebar-accent" />
            }
          >
            <AccountAvatar color={active.avatarColor} label={active.label} />
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{active.label}</span>
              <span className="truncate text-xs text-muted-foreground">
                {secondaryFor[activeId]}
              </span>
            </div>
            {offerCount > 0 && (
              <span
                className="ml-auto rounded-full bg-sidebar-primary px-1.5 py-0.5 text-[10px] font-medium text-sidebar-primary-foreground tabular-nums"
                aria-label={`세무사 연결 요청 ${offerCount}건`}
                data-testid="account-offer-badge"
              >
                {offerCount}
              </span>
            )}
            <ChevronsUpDown className={cn("size-4 text-muted-foreground", offerCount === 0 && "ml-auto")} />
          </MenuPrimitive.Trigger>
          <MenuPrimitive.Portal>
            <MenuPrimitive.Positioner side="top" align="start" sideOffset={8} className="isolate z-50">
              <MenuPrimitive.Popup
                className={cn(
                  "z-50 min-w-(--anchor-width) origin-(--transform-origin) rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none",
                  "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
                  "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
                )}
              >
                {activeId === "auditor" && (
                  <div className="px-2 py-1.5">
                    <label className="block text-xs text-muted-foreground">
                      평가자 이름
                    </label>
                    <Input
                      value={auditor.reviewerName}
                      onChange={(e) => setReviewerName(e.target.value)}
                      className="mt-1 h-8 text-sm"
                      placeholder="평가자"
                    />
                  </div>
                )}
                {activeId === "admin" && (
                  <div className="px-2 py-1.5">
                    <label className="block text-xs text-muted-foreground">
                      운영자 이름
                    </label>
                    <Input
                      value={admin.operatorName}
                      onChange={(e) => setOperatorName(e.target.value)}
                      className="mt-1 h-8 text-sm"
                      placeholder="운영자"
                    />
                  </div>
                )}
                {activeId === "viewer" && (
                  <MenuPrimitive.Item
                    onClick={() => router.push("/offers")}
                    className={cn(
                      "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none",
                      "data-highlighted:bg-accent data-highlighted:text-accent-foreground",
                    )}
                    data-testid="menu-offers"
                  >
                    <Handshake className="size-4 text-muted-foreground" />
                    <span className="flex-1">세무사 연결 요청</span>
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                        offerCount > 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {offerCount}건
                    </span>
                  </MenuPrimitive.Item>
                )}
                <MenuPrimitive.Separator className="my-1 h-px bg-border" />
                <MenuPrimitive.Item
                  onClick={handleLogout}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-none",
                    "data-highlighted:bg-accent data-highlighted:text-accent-foreground",
                  )}
                >
                  <LogOut className="size-4 text-muted-foreground" />
                  <span>로그아웃</span>
                </MenuPrimitive.Item>
              </MenuPrimitive.Popup>
            </MenuPrimitive.Positioner>
          </MenuPrimitive.Portal>
        </MenuPrimitive.Root>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function AccountAvatar({ color, label }: { color: string; label: string }) {
  const initial = label.trim().charAt(0) || "?";
  return (
    <span
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-medium text-white"
      style={{ backgroundColor: color }}
      aria-hidden
    >
      {initial}
    </span>
  );
}
