"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BrainCircuit,
  ChartNoAxesCombined,
  BadgeCheck,
  ChartColumn,
  Handshake,
  LayoutDashboard,
  MailPlus,
  Server,
  Share2,
  ShieldCheck,
  UserCog,
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
  useSidebar,
} from "@/components/ui/sidebar";
import { useAdminRouteContext, type AdminSection } from "@/lib/admin-route";
import { isPrototype } from "@/lib/data-mode";
import { useAdminSidebarBadges } from "@/lib/sidebar-badges";
import { AccountSwitcher } from "./account-switcher";
import { SidebarBadge } from "./sidebar-badge";

interface ItemDef {
  id: AdminSection;
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badgeKey?: "consultationsPending" | "applicationsPending";
  /** path 정확 매칭이 필요할 때 사용. 미지정 시 section 매칭. */
  exactPath?: string;
}

interface GroupDef {
  /** 미지정 시 그룹 라벨을 표시하지 않는다. */
  label?: string;
  items: ItemDef[];
}

// 옛 검수 흐름(AI상담세션 후보·평가중·검수실·배선실·문장 대조 집계)·정산·메시지(검수 이의제기)·RAG·지식망 추이·
// 소급 중복 정리·수정 제안 승인·지식베이스2·AI 상담 규범은 10/5 결정으로 쓰지 않고 10/16 메뉴에서 뺐다
// (design/옛검수흐름_절단_로드맵_1016.md S0 · D2·D3·D7). 화면 코드는 S2 에서 지운다.
const GROUPS: GroupDef[] = [
  {
    items: [
      { id: "dashboard", href: "/admin/dashboard", label: "대시보드", icon: LayoutDashboard },
    ],
  },
  {
    label: "모델개선",
    items: [
      // 기여 원장과 크레딧은 프로토타입 시연(live 는 서버 모델 전까지 숨김).
      ...(isPrototype ? [
        { id: "knowledge-contributions" as const, href: "/admin/knowledge-contributions", label: "공통 지식 기여", icon: Users },
        { id: "knowledge-contributions" as const, href: "/admin/knowledge-contributions/insights", label: "크레딧 · 기여자 현황", icon: ChartNoAxesCombined, exactPath: "/admin/knowledge-contributions/insights" },
      ] : []),
    ],
  },
  {
    label: "전문가",
    items: [
      { id: "applications", href: "/admin/applications", label: "세무사 가입 신청", icon: BadgeCheck, badgeKey: "applicationsPending" },
      { id: "auditors", href: "/admin/auditors", label: "전문가 관리", icon: Users },
      { id: "consultations", href: "/admin/consultations", label: "상담 신청", icon: Handshake, badgeKey: "consultationsPending" },
    ],
  },
  {
    label: "운영",
    items: [
      { id: "mail", href: "/admin/mail", label: "공지사항", icon: MailPlus },
      { id: "users", href: "/admin/users", label: "사용자", icon: UserCog },
      { id: "usage", href: "/admin/usage", label: "사용 현황", icon: ChartColumn },
    ],
  },
  {
    label: "AI 코어",
    items: [
      { id: "pipeline", href: "/admin/pipeline", label: "LLM", icon: BrainCircuit },
      { id: "pipeline", href: "/admin/pipeline/versions", label: "인프라", icon: Server, exactPath: "/admin/pipeline/versions" },
      { id: "pipeline", href: "/admin/pipeline/kb3-share", label: "공용 KB 공유 승인", icon: Share2, exactPath: "/admin/pipeline/kb3-share" },
    ],
  },
];

export function AdminSidebar() {
  const { setOpenMobile } = useSidebar();
  const { section } = useAdminRouteContext();
  const pathname = usePathname();
  const badges = useAdminSidebarBadges();

  const isActive = (item: ItemDef): boolean => {
    if (item.exactPath) {
      return pathname === item.exactPath || pathname.startsWith(item.exactPath + "/");
    }
    if (item.id === "knowledge-contributions") return pathname === "/admin/knowledge-contributions";
    if (item.id === "pipeline") {
      // 파이프라인 메인은 /admin/pipeline (정확) 일 때만 강조 — 하위 페이지는 sub item 이 강조
      return pathname === "/admin/pipeline";
    }
    return section === item.id;
  };

  return (
    <Sidebar>
      <SidebarHeader className="px-3 py-4">
        <Link href="/admin/dashboard" className="flex items-center gap-2 font-bold" onClick={() => setOpenMobile(false)}>
          <ShieldCheck className="size-5 text-brand-amber" />
          <span className="text-lg">운영</span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {GROUPS.filter((group) => group.items.length > 0).map((group) => (
          <SidebarGroup key={group.label ?? group.items[0].href}>
            {group.label && <SidebarGroupLabel>{group.label}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.filter((item) => isPrototype || item.id !== "knowledge-contributions").map((item) => (
                  <SidebarMenuItem key={`${item.id}::${item.href}`}>
                    <SidebarMenuButton
                      isActive={isActive(item)}
                      onClick={() => setOpenMobile(false)}
                      render={<Link href={item.href} />}
                    >
                      <item.icon className="size-4" />
                      <span>{item.label}</span>
                      {item.badgeKey && (
                        <SidebarBadge
                          count={badges[item.badgeKey]}
                          variant="warn"
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
