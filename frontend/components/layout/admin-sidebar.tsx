"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes,
  ClipboardList,
  GitMerge,
  GitPullRequest,
  Inbox,
  LayoutDashboard,
  MailPlus,
  MessagesSquare,
  Receipt,
  ShieldCheck,
  Users,
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
import { useAdminRouteContext, type AdminSection } from "@/lib/admin-route";
import { useAdminSidebarBadges } from "@/lib/sidebar-badges";
import { AccountSwitcher } from "./account-switcher";
import { SidebarBadge } from "./sidebar-badge";

interface ItemDef {
  id: AdminSection;
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badgeKey?: "poolNew" | "inspectionCount" | "inquiriesOpen";
  /** path 정확 매칭이 필요할 때 사용. 미지정 시 section 매칭. */
  exactPath?: string;
}

interface GroupDef {
  /** 미지정 시 그룹 라벨을 표시하지 않는다. */
  label?: string;
  items: ItemDef[];
}

const GROUPS: GroupDef[] = [
  {
    items: [
      { id: "dashboard", href: "/admin/dashboard", label: "대시보드", icon: LayoutDashboard },
    ],
  },
  {
    label: "모델개선",
    items: [
      { id: "pool", href: "/admin/pool", label: "AI상담세션 후보", icon: Inbox, badgeKey: "poolNew" },
      { id: "tasks", href: "/admin/tasks", label: "평가중", icon: ClipboardList },
      { id: "inspection", href: "/admin/inspection", label: "검수 완료", icon: ShieldCheck, badgeKey: "inspectionCount" },
    ],
  },
  {
    label: "전문가",
    items: [
      { id: "auditors", href: "/admin/auditors", label: "전문가 관리", icon: Users },
      { id: "settlement", href: "/admin/settlement", label: "정산", icon: Receipt },
    ],
  },
  {
    label: "운영",
    items: [
      { id: "inquiries", href: "/admin/inquiries", label: "메시지", icon: MessagesSquare, badgeKey: "inquiriesOpen" },
      { id: "mail", href: "/admin/mail", label: "공지사항", icon: MailPlus },
    ],
  },
  {
    label: "모델",
    items: [
      { id: "pipeline", href: "/admin/pipeline", label: "파이프라인", icon: GitPullRequest },
      { id: "pipeline", href: "/admin/pipeline/batches", label: "Training Batch", icon: Boxes, exactPath: "/admin/pipeline/batches" },
      { id: "pipeline", href: "/admin/pipeline/versions", label: "ModelVersion", icon: GitMerge, exactPath: "/admin/pipeline/versions" },
    ],
  },
];

export function AdminSidebar() {
  const { section } = useAdminRouteContext();
  const pathname = usePathname();
  const badges = useAdminSidebarBadges();

  const isActive = (item: ItemDef): boolean => {
    if (item.exactPath) {
      return pathname === item.exactPath || pathname.startsWith(item.exactPath + "/");
    }
    if (item.id === "pipeline") {
      // 파이프라인 메인은 /admin/pipeline (정확) 일 때만 강조 — 하위 페이지는 sub item 이 강조
      return pathname === "/admin/pipeline";
    }
    return section === item.id;
  };

  return (
    <Sidebar>
      <SidebarHeader className="px-3 py-4">
        <Link href="/admin/dashboard" className="flex items-center gap-2 font-bold">
          <ShieldCheck className="size-5 text-brand-amber" />
          <span className="text-lg">운영</span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {GROUPS.map((group) => (
          <SidebarGroup key={group.label ?? group.items[0].href}>
            {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={`${item.id}::${item.href}`}>
                    <SidebarMenuButton
                      isActive={isActive(item)}
                      render={<Link href={item.href} />}
                    >
                      <item.icon className="size-4" />
                      <span>{item.label}</span>
                      {item.badgeKey && (
                        <SidebarBadge
                          count={badges[item.badgeKey]}
                          variant={item.badgeKey === "inspectionCount" || item.badgeKey === "inquiriesOpen" ? "warn" : "neutral"}
                          dot={item.badgeKey === "inspectionCount" || item.badgeKey === "inquiriesOpen"}
                        />
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="px-2 pb-3">
        <AccountSwitcher />
      </SidebarFooter>
    </Sidebar>
  );
}
