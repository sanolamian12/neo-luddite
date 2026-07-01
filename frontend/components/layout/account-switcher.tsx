"use client";

import { useRouter } from "next/navigation";
import { ChevronsUpDown, LogOut } from "lucide-react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Input } from "@/components/ui/input";
import { useAccountHydrated, useAccountStore } from "@/lib/account-store";
import { activeAccountFromPath } from "@/lib/account-route";
import { getOccupation } from "@/lib/occupations";
import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";
import type { AccountId } from "@/lib/account-schema";

/**
 * 사이드바 푸터의 계정 메뉴 — 로그인한 계정 표시 + 로그아웃.
 * - 활성 계정은 session 에서 파생 (없으면 라우트 기준으로 폴백).
 * - auditor 는 평가자 이름, admin 은 운영자 이름 인라인 편집.
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

  const handleLogout = () => {
    logout();
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
            <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
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
                {(activeId === "auditor" || activeId === "admin") && (
                  <MenuPrimitive.Separator className="my-1 h-px bg-border" />
                )}
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
