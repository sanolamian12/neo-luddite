"use client";

import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { NewChatButton } from "@/components/chat/new-chat-button";
import { RoleGuard } from "@/components/auth/role-guard";

/**
 * 좌측 사이드바 + 우측 메인(챗) 셸.
 * /chat/* 라우트에 적용된다. viewer 역할로 게이팅.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <RoleGuard role="viewer">
    <SidebarProvider className="theme-viewer">
      <AppSidebar />
      <SidebarInset className="flex h-svh flex-col overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <SidebarTrigger />
          <span className="text-sm text-muted-foreground">세무 상담</span>
          <div className="ml-auto flex items-center gap-2">
            <NewChatButton />
          </div>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
    </RoleGuard>
  );
}
