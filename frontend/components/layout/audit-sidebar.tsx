"use client";

import Link from "next/link";
import {
  BookOpen,
  ClipboardCheck,
  ClipboardList,
  FolderCheck,
  Inbox,
  LayoutDashboard,
  ListChecks,
  MessagesSquare,
  Wallet,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useAuditRouteContext, type AuditSection } from "@/lib/audit-route";
import { useAuditorSidebarBadges } from "@/lib/sidebar-badges";
import { AccountSwitcher } from "./account-switcher";
import { FolderTree } from "@/components/audit/kb/folder-tree";
import { SidebarBadge } from "./sidebar-badge";

interface ItemDef {
  id: AuditSection;
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badgeKey?: "queueOpen" | "workInProgress" | "resultsUnseen" | "mailboxUnread";
}

interface GroupDef {
  /** 미지정 시 그룹 라벨을 표시하지 않는다. */
  label?: string;
  items: ItemDef[];
}

const GROUPS: GroupDef[] = [
  {
    items: [
      { id: "dashboard", href: "/audit/dashboard", label: "대시보드", icon: LayoutDashboard },
    ],
  },
  {
    label: "Knowledge lab",
    items: [
      { id: "queue", href: "/audit/queue", label: "참여하기", icon: ClipboardList, badgeKey: "queueOpen" },
      { id: "work", href: "/audit/work", label: "진행중", icon: ListChecks, badgeKey: "workInProgress" },
      { id: "results", href: "/audit/results", label: "완료", icon: FolderCheck, badgeKey: "resultsUnseen" },
    ],
  },
  {
    items: [
      { id: "ledger", href: "/audit/ledger", label: "모델 기여 로그", icon: Wallet },
      { id: "mailbox", href: "/audit/mailbox", label: "우편함", icon: Inbox, badgeKey: "mailboxUnread" },
    ],
  },
  {
    label: "참고",
    items: [
      { id: "chat-logs", href: "/audit/chat-logs", label: "챗 로그 (legacy)", icon: MessagesSquare },
      { id: "knowledge", href: "/audit/knowledge", label: "지식 베이스", icon: BookOpen },
    ],
  },
];

export function AuditSidebar() {
  const { section } = useAuditRouteContext();
  const badges = useAuditorSidebarBadges();

  return (
    <Sidebar>
      <SidebarHeader className="px-3 py-4">
        <Link href="/audit/dashboard" className="flex items-center gap-2 font-bold">
          <ClipboardCheck className="size-5 text-brand-green" />
          <span className="text-lg">상담 평가</span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {GROUPS.map((group) => (
          <SidebarGroup key={group.items[0].id}>
            {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map(({ id, href, label, icon: Icon, badgeKey }) => (
                  <SidebarMenuItem key={id}>
                    <SidebarMenuButton
                      isActive={section === id}
                      render={<Link href={href} />}
                    >
                      <Icon className="size-4" />
                      <span>{label}</span>
                      {badgeKey && (
                        <SidebarBadge
                          count={badges[badgeKey]}
                          variant={badgeKey === "workInProgress" || badgeKey === "resultsUnseen" || badgeKey === "mailboxUnread" ? "warn" : "neutral"}
                          dot={badgeKey === "resultsUnseen" || badgeKey === "mailboxUnread"}
                        />
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}

        {section === "knowledge" && (
          <SidebarGroup>
            <SidebarGroupLabel>문서 트리</SidebarGroupLabel>
            <SidebarGroupContent>
              <FolderTree />
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="px-2 pb-3">
        <AccountSwitcher />
      </SidebarFooter>
    </Sidebar>
  );
}
