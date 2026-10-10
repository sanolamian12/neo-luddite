import Link from "next/link";
import { ImprintMark } from "@/components/design-system/imprint";
import { ThemeToggle } from "@/components/design-system/theme-toggle";
import { PublicAccountNav } from "./public-account-nav";

export function PublicHeader({ showAccount = true }: { showAccount?: boolean }) {
  return <header className="ds-public-header">
    <Link href="/" className="inline-flex items-center gap-3 text-base font-semibold"><ImprintMark />세무상담</Link>
    <nav aria-label="계정과 테마" className="flex items-center gap-2">{showAccount && <PublicAccountNav />}<ThemeToggle /></nav>
  </header>;
}
