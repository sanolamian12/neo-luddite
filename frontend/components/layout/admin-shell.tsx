"use client";

import { AdminSidebar } from "./admin-sidebar";
import { RoleGuard } from "@/components/auth/role-guard";
import { WorkspaceShell } from "./workspace-shell";

export function AdminShell({ children }: { children: React.ReactNode }) {
  return <RoleGuard role="admin"><WorkspaceShell sidebar={<AdminSidebar />} label="운영 콘솔">{children}</WorkspaceShell></RoleGuard>;
}
