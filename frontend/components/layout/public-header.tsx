import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { ThemeToggle } from "@/components/design-system/theme-toggle";

export function PublicHeader() {
  return <header className="ds-public-header">
    <Link href="/" className="inline-flex items-center gap-3 text-base font-semibold"><MessagesSquare className="size-5 text-primary" />세무상담</Link>
    <ThemeToggle />
  </header>;
}
