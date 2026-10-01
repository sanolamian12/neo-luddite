"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { BookOpen, Bot, GraduationCap, Inbox, LayoutDashboard, MessageCircle, Play, Settings2, ShieldCheck, Sparkles, UserRound, Users } from "lucide-react";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { useAgentLibrary } from "@/components/audit/agents/agent-library";
import { agentHref, taskFromPath, type AgentTask } from "@/lib/agent-navigation";
import { useLuminousTheme } from "@/components/design-system/theme";
import { useAuditorSidebarBadges } from "@/lib/sidebar-badges";
import { AccountSwitcher } from "./account-switcher";
import { SidebarBadge } from "./sidebar-badge";
import styles from "./audit-shell.module.css";

const tasks: { task: AgentTask; label: string; icon: typeof Bot }[] = [
  { task: "overview", label: "한눈에 보기", icon: Sparkles }, { task: "teach", label: "가르치기", icon: GraduationCap },
  { task: "knowledge", label: "지식 모음", icon: BookOpen }, { task: "principles", label: "운영 원칙", icon: ShieldCheck },
  { task: "preview", label: "미리보기", icon: Play }, { task: "advanced", label: "고급 설정", icon: Settings2 },
];
export function ExpertSidebar() {
  const { agent, agents, expertName } = useAgentLibrary();
  const path = usePathname(), search = useSearchParams(), theme = useLuminousTheme();
  const { setOpenMobile } = useSidebar();
  const badges = useAuditorSidebarBadges();
  const pending = agents.reduce((count, item) => count + item.practice.reviews.filter((review) => review.status !== "resolved").length, 0);
  const context = search.get("agent") ?? agent?.id;
  const withAgent = (href: string) => `${href}${context ? `?agent=${encodeURIComponent(context)}` : ""}`;
  const groups = [
    { label: `${expertName} 세무사`, items: [
      { label: "대시보드", href: withAgent("/audit/dashboard"), active: path === "/audit/dashboard", icon: LayoutDashboard, count: 0 },
      { label: "상담 프로필", href: withAgent("/audit/profile"), active: path.startsWith("/audit/profile"), icon: UserRound, count: 0 },
      { label: "우편함", href: withAgent("/audit/mailbox"), active: path.startsWith("/audit/mailbox"), icon: Inbox, count: badges.mailboxUnread },
    ] },
    { label: "내 에이전트", items: tasks.map(({ task, label, icon }) => ({ label, icon, href: agentHref(task, context), active: taskFromPath(path) === task, count: 0 })) },
    { label: "상담", items: [
      { label: "상담 요청", href: withAgent("/audit/consultations"), active: path.startsWith("/audit/consultations"), icon: Inbox, count: (badges.consultationsPending ?? 0) + pending },
      { label: "공개 상담 사례", href: withAgent("/audit/pool"), active: path.startsWith("/audit/pool"), icon: Users, count: 0 },
      { label: "채팅방", href: withAgent("/audit/rooms"), active: path.startsWith("/audit/rooms"), icon: MessageCircle, count: badges.roomsUnread },
    ] },
  ];
  return <Sidebar mobileContentProps={theme ? { className: `luminous ${styles.mobileNav}`, "data-theme": theme, backdropClassName: styles.mobileBackdrop } : undefined}>
    <SidebarHeader className="px-3 py-4"><Link href={withAgent("/audit/dashboard")} className="flex items-center gap-2 font-semibold" onClick={() => setOpenMobile(false)}><Bot size={21} /><span>전문가 워크스페이스</span></Link></SidebarHeader>
    <SidebarContent>{groups.map((group) => <SidebarGroup key={group.label}><SidebarGroupLabel>{group.label}</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>{group.items.map(({ label, href, active, icon: Icon, count }) => <SidebarMenuItem key={label}><SidebarMenuButton isActive={active} onClick={() => setOpenMobile(false)} render={<Link href={href} />}><Icon className="size-4" /><span>{label}</span>{(count ?? 0) > 0 && <SidebarBadge count={count} variant="warn" />}</SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroupContent></SidebarGroup>)}</SidebarContent>
    <SidebarFooter className="px-2 pb-3"><AccountSwitcher /></SidebarFooter>
  </Sidebar>;
}
