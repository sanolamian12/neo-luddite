"use client";

import { useState, type CSSProperties } from "react";
import { Moon, Sun } from "lucide-react";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { LuminousButton } from "@/components/design-system/controls";
import { LuminousThemeContext, type LuminousTheme } from "@/components/design-system/theme";
import { AuditSidebar } from "./audit-sidebar";
import { RoleGuard } from "@/components/auth/role-guard";
import { NormsPendingWatcher } from "@/components/audit/kb/norms-pending-watcher";
import { useAuditRouteContext } from "@/lib/audit-route";
import { cn } from "@/lib/utils";
import styles from "./audit-shell.module.css";
import "@/components/design-system/luminous.css";
import { AgentLibraryProvider } from "@/components/audit/agents/agent-library";
import { isPrototype } from "@/lib/data-mode";

export function AuditShell({ children }: { children: React.ReactNode }) {
  return <RoleGuard role="auditor">{isPrototype ? <AgentLibraryProvider><Shell>{children}</Shell></AgentLibraryProvider> : <Shell>{children}</Shell>}</RoleGuard>;
}
function Shell({ children }: { children: React.ReactNode }) {
  const { section } = useAuditRouteContext();
  const [theme, setTheme] = useState<LuminousTheme>("light");
  const luminous = section === "dashboard" || section === "agents" || (isPrototype && section === "consultations");

  return (
    <>
      <LuminousThemeContext.Provider value={luminous ? theme : null}>
        <SidebarProvider
          className={cn("theme-auditor", luminous && `luminous ${styles.shell}`)}
          data-theme={luminous ? theme : undefined}
          style={luminous ? { "--sidebar-width": "15rem" } as CSSProperties : undefined}
        >
          <AuditSidebar />
          <SidebarInset className={cn("flex h-svh min-w-0 flex-col overflow-hidden", luminous && styles.inset)}>
            <header className={cn("flex h-12 shrink-0 items-center gap-2 border-b px-3", luminous && styles.header)}>
              <SidebarTrigger aria-label="탐색 메뉴 열기/닫기" />
              {luminous ? <>
                <span className={styles.workspaceLabel}>전문가 워크스페이스</span>
                <span className={styles.separator} aria-hidden="true">/</span>
                <span className={styles.currentPage}>{section === "agents" ? "내 에이전트" : section === "consultations" ? "상담 요청" : "대시보드"}</span>
                <LuminousButton
                  variant="ghost"
                  className={styles.themeButton}
                  aria-label={theme === "light" ? "어두운 테마로 전환" : "밝은 테마로 전환"}
                  onClick={() => setTheme(theme === "light" ? "dark" : "light")}
                >
                  {theme === "light" ? <Moon /> : <Sun />}
                </LuminousButton>
              </> : <span className="text-sm font-medium">{isPrototype ? "전문가 워크스페이스" : "감사 모드 · 세무 상담 평가"}</span>}
            </header>
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          </SidebarInset>
          {!isPrototype && <NormsPendingWatcher />}
        </SidebarProvider>
      </LuminousThemeContext.Provider>
    </>
  );
}
