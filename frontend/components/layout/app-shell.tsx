"use client";

import { AppSidebar } from "./app-sidebar";
import { NewChatButton } from "@/components/chat/new-chat-button";
import { RoleGuard } from "@/components/auth/role-guard";
import { WorkspaceShell } from "./workspace-shell";

export function AppShell({ children }: { children: React.ReactNode }) {
  return <RoleGuard role="viewer"><WorkspaceShell sidebar={<AppSidebar />} label="세무 상담" actions={<NewChatButton />}>{children}</WorkspaceShell></RoleGuard>;
}
