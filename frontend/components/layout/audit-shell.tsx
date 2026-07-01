"use client";

import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { AuditSidebar } from "./audit-sidebar";
import { RoleGuard } from "@/components/auth/role-guard";

/**
 * 감사 모드 셸 — 좌측 평가 사이드바 + 우측 본문. auditor 역할로 게이팅.
 */
export function AuditShell({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard role="auditor">
    <SidebarProvider className="theme-auditor">
      <AuditSidebar />
      <SidebarInset className="flex h-svh flex-col overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger />
          <span className="text-sm font-medium">감사 모드 · 세무 상담 평가</span>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
    </RoleGuard>
  );
}
