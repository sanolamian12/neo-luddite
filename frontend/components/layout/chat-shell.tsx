"use client";

import { Suspense } from "react";
import { isPrototype } from "@/lib/data-mode";
import { AppShell } from "./app-shell";
import { WorkspaceShell } from "./workspace-shell";
import { EntrySidebar, WorkspaceLink } from "./entry-sidebar";

export function ChatShell({ children }: { children: React.ReactNode }) {
  if (!isPrototype) return <AppShell>{children}</AppShell>;
  return <Suspense fallback={<p className="p-6" role="status">상담을 준비하는 중…</p>}>
    <WorkspaceShell sidebar={<EntrySidebar />} label="세무 상담" actions={<WorkspaceLink />}>{children}</WorkspaceShell>
  </Suspense>;
}
