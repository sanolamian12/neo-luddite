"use client";

import { AuditSidebar } from "./audit-sidebar";
import { WorkspaceShell } from "./workspace-shell";
import { RoleGuard } from "@/components/auth/role-guard";
import { NormsPendingWatcher } from "@/components/audit/kb/norms-pending-watcher";
import { useAuditRouteContext, type AuditSection } from "@/lib/audit-route";
import { AgentLibraryProvider } from "@/components/audit/agents/agent-library";
import { agentStudioEnabled, isPrototype } from "@/lib/data-mode";

const titles: Record<AuditSection, string> = {
  dashboard: "대시보드", agents: "내 에이전트", queue: "참여하기", work: "진행 중", results: "완료",
  mailbox: "우편함", ledger: "모델 기여 로그", "chat-logs": "상담 기록", knowledge: "지식 베이스",
  "kb-map": "RAG 지식망", kb2: "지식베이스2", norms: "AI 상담 규범", profile: "상담 프로필",
  consultations: "상담 요청", pool: "상담 사례", rooms: "채팅방", root: "",
};

export function AuditShell({ children }: { children: React.ReactNode }) {
  return <RoleGuard role="auditor">{agentStudioEnabled ? <AgentLibraryProvider><Shell>{children}</Shell></AgentLibraryProvider> : <Shell>{children}</Shell>}</RoleGuard>;
}
function Shell({ children }: { children: React.ReactNode }) {
  const { section } = useAuditRouteContext();
  return <WorkspaceShell sidebar={<AuditSidebar />} label="전문가 워크스페이스" title={titles[section]}>
    {children}
    {!isPrototype && <NormsPendingWatcher />}
  </WorkspaceShell>;
}
