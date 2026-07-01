"use client";

import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { AdminSidebar } from "./admin-sidebar";
import { RoleGuard } from "@/components/auth/role-guard";

/**
 * 운영자 셸 — 좌측 admin 사이드바 + 우측 본문. admin 역할로 게이팅.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard role="admin">
    <SidebarProvider className="theme-admin">
      <AdminSidebar />
      <SidebarInset className="flex h-svh flex-col overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger />
          <span className="text-sm font-medium">운영 콘솔</span>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
    </RoleGuard>
  );
}
