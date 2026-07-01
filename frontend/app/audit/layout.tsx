import { AuditShell } from "@/components/layout/audit-shell";

export default function AuditLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AuditShell>{children}</AuditShell>;
}
