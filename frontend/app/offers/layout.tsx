import { AppShell } from "@/components/layout/app-shell";

export default function OffersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
