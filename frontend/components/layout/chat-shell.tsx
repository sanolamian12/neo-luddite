"use client";

import { Suspense } from "react";
import { WorkspaceShell } from "./workspace-shell";
import { EntrySidebar, WorkspaceLink } from "./entry-sidebar";

/** 챗은 비로그인 방문자도 쓴다(전시회) — 셸에 로그인 가드를 두지 않는다. 기존 대화(?c=)만 화면 단에서 viewer 가드. */
export function ChatShell({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<p className="p-6" role="status">상담을 준비하는 중…</p>}>
    <WorkspaceShell sidebar={<EntrySidebar />} label="세무 상담" actions={<WorkspaceLink />}>{children}</WorkspaceShell>
  </Suspense>;
}
