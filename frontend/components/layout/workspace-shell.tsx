"use client";

import type { CSSProperties, ReactNode } from "react";
import { usePathname } from "next/navigation";
import { BriefcaseBusiness, MessageCircle } from "lucide-react";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/design-system/theme-toggle";
import styles from "./audit-shell.module.css";
import { useDemo } from "@/components/demo/runtime";
import { DemoSidebar } from "@/components/demo/sidebar";
import { DemoPresenter } from "@/components/demo/presenter";

/** Shared chrome for customer, expert and operations workspaces. */
export function WorkspaceShell({ sidebar, label, title, actions, children }: {
  sidebar: ReactNode;
  label: string;
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const demo = useDemo();
  const path = usePathname();
  const role = demo ? path.startsWith("/audit/") ? "expert" : path.startsWith("/chat/") ? "customer" : "admin" : undefined;
  return <SidebarProvider className={styles.shell} data-demo-role={role} style={{ "--sidebar-width": "15rem" } as CSSProperties}>
    {demo ? <DemoSidebar /> : sidebar}
    <SidebarInset className={`flex h-dvh min-w-0 flex-col overflow-hidden ${styles.inset}`}>
      <header className={`flex shrink-0 items-center border-b ${styles.header}`}>
        <SidebarTrigger aria-label="탐색 메뉴 열기/닫기" />
        {role === "expert" || role === "customer" ? <span className={styles.roleLabel}>{role === "expert" ? <BriefcaseBusiness size={16} /> : <MessageCircle size={16} />}{role === "expert" ? "세무사 화면" : "고객 화면"}</span> : <span className={styles.workspaceLabel}>{label}</span>}
        {title && <><span className={styles.separator} aria-hidden="true">/</span><span className={styles.currentPage}>{title}</span></>}
        <div className="ml-auto flex shrink-0 items-center gap-2">{!demo && actions}<ThemeToggle /></div>
      </header>
      <DemoPresenter />
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </SidebarInset>
  </SidebarProvider>;
}
