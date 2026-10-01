import { AuditShell } from "@/components/layout/audit-shell";
import { Suspense } from "react";

export default function AuditLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Suspense fallback={<p className="p-6" role="status">전문가 워크스페이스를 불러오는 중…</p>}><AuditShell>{children}</AuditShell></Suspense>;
}
