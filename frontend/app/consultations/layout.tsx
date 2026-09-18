import { AppShell } from "@/components/layout/app-shell";

export default function ConsultationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
