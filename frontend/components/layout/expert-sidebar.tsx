"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { BookOpen, Bot, ChevronRight, GraduationCap, Inbox, LayoutDashboard, MessageCircle, Play, Settings2, ShieldCheck, Sparkles, UserRound, Users, Wallet } from "lucide-react";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { useAgentLibrary } from "@/components/audit/agents/agent-library";
import { agentHref, taskFromPath, type AgentTask } from "@/lib/agent-navigation";
import { agentStudioEnabled } from "@/lib/data-mode";
import { useAccountStore } from "@/lib/account-store";
import { useLuminousTheme } from "@/components/design-system/theme";
import { useAuditorSidebarBadges } from "@/lib/sidebar-badges";
import { AccountSwitcher } from "./account-switcher";
import { SidebarBadge } from "./sidebar-badge";
import styles from "./audit-shell.module.css";

interface NavItem { label: string; href: string; active: boolean; icon: typeof Bot; count?: number; tone?: "warn" | "neutral"; dot?: boolean }
/** collapsible: 접힌 채 시작하는 그룹(현재 화면이 그 안에 있으면 펼친 채). */
interface NavGroup { label: string; items: NavItem[]; collapsible?: boolean }

const tasks: { task: AgentTask; label: string; icon: typeof Bot }[] = [
  { task: "overview", label: "한눈에 보기", icon: Sparkles }, { task: "teach", label: "가르치기", icon: GraduationCap },
  { task: "knowledge", label: "지식 모음", icon: BookOpen }, { task: "principles", label: "운영 원칙", icon: ShieldCheck },
  { task: "preview", label: "미리보기", icon: Play }, { task: "advanced", label: "고급 설정", icon: Settings2 },
];

/** 에이전트 스튜디오는 서버 저장·AI 반영 전까지 프로토타입 전용 — live 는 지식 참여·KB·규범 메뉴를 쓴다. */
export function ExpertSidebar() {
  return agentStudioEnabled ? <AgentExpertSidebar /> : <LiveExpertSidebar />;
}

function AgentExpertSidebar() {
  const { agent, agents, expertName } = useAgentLibrary();
  const path = usePathname(), search = useSearchParams();
  const badges = useAuditorSidebarBadges();
  const pending = agents.reduce((count, item) => count + item.practice.reviews.filter((review) => review.status !== "resolved").length, 0);
  const context = search.get("agent") ?? agent?.id;
  const withAgent = (href: string) => `${href}${context ? `?agent=${encodeURIComponent(context)}` : ""}`;
  const groups: NavGroup[] = [
    { label: `${expertName} 세무사`, items: [
      { label: "대시보드", href: withAgent("/audit/dashboard"), active: path === "/audit/dashboard", icon: LayoutDashboard },
      { label: "상담 프로필", href: withAgent("/audit/profile"), active: path.startsWith("/audit/profile"), icon: UserRound },
      { label: "우편함", href: withAgent("/audit/mailbox"), active: path.startsWith("/audit/mailbox"), icon: Inbox, count: badges.mailboxUnread },
    ] },
    { label: "내 에이전트", items: tasks.map(({ task, label, icon }) => ({ label, icon, href: agentHref(task, context), active: taskFromPath(path) === task })) },
    { label: "함께 만드는 지식", items: [{ label: "공통 지식 기여", href: agentHref("contributions", context), active: path === "/audit/contributions", icon: Users }] },
    { label: "상담", items: [
      { label: "상담 요청", href: withAgent("/audit/consultations"), active: path.startsWith("/audit/consultations"), icon: Inbox, count: (badges.consultationsPending ?? 0) + pending },
      { label: "공개 상담 사례", href: withAgent("/audit/pool"), active: path.startsWith("/audit/pool"), icon: Users },
      { label: "채팅방", href: withAgent("/audit/rooms"), active: path.startsWith("/audit/rooms"), icon: MessageCircle, count: badges.roomsUnread },
    ] },
  ];
  return <ExpertNav groups={groups} homeHref={withAgent("/audit/dashboard")} />;
}

function LiveExpertSidebar() {
  const expertName = useAccountStore((state) => state.auditor.reviewerName);
  const path = usePathname(), search = useSearchParams();
  const { agent } = useAgentLibrary();
  const context = search.get("agent") ?? agent?.id;
  const badges = useAuditorSidebarBadges();
  const at = (href: string) => path.startsWith(href);
  // 10/1 피드백 구성(세무사 / 내 에이전트 / 상담)이 기본. 내 에이전트는 10/6 부터 live 에서도 연다 —
  // 답변 사례만 서버(KB3)에 올라가고, 고급 설정(그래프 캔버스)은 프로토타입 전용이라 뺀다.
  // 옛 검수 흐름(챗 로그·참여하기·진행 중·완료·지식 베이스·RAG 지식망·지식베이스2·AI 상담 규범)은 10/5 결정으로 쓰지 않고
  // 10/16 메뉴에서 뺐다(design/옛검수흐름_절단_로드맵_1016.md S0). 기여 내역(공용 승격 크레딧, 0056)만 세무사 묶음으로.
  const groups: NavGroup[] = [
    { label: `${expertName} 세무사`, items: [
      { label: "대시보드", href: "/audit/dashboard", active: path === "/audit/dashboard", icon: LayoutDashboard },
      { label: "상담 프로필", href: "/audit/profile", active: at("/audit/profile"), icon: UserRound },
      { label: "우편함", href: "/audit/mailbox", active: at("/audit/mailbox"), icon: Inbox, count: badges.mailboxUnread, dot: true },
      { label: "기여 내역", href: "/audit/ledger", active: at("/audit/ledger"), icon: Wallet },
    ] },
    { label: "내 에이전트", items: tasks.filter(({ task }) => task !== "advanced").map(({ task, label, icon }) => ({ label, icon, href: agentHref(task, context), active: taskFromPath(path) === task })) },
    { label: "상담", items: [
      { label: "상담 신청", href: "/audit/consultations", active: at("/audit/consultations"), icon: Inbox, count: badges.consultationsPending, dot: true },
      { label: "상담사 풀", href: "/audit/pool", active: at("/audit/pool"), icon: Users },
      { label: "채팅방", href: "/audit/rooms", active: at("/audit/rooms"), icon: MessageCircle, count: badges.roomsUnread },
    ] },
  ];
  return <ExpertNav groups={groups} homeHref="/audit/dashboard" />;
}

function ExpertNav({ groups, homeHref }: { groups: NavGroup[]; homeHref: string }) {
  const theme = useLuminousTheme();
  const { setOpenMobile } = useSidebar();
  return <Sidebar mobileContentProps={theme ? { className: styles.mobileNav, "data-theme": theme, backdropClassName: styles.mobileBackdrop } : undefined}>
    <SidebarHeader className="px-3 py-4"><Link href={homeHref} className="flex items-center gap-2 font-semibold" onClick={() => setOpenMobile(false)}><Bot size={21} /><span>전문가 워크스페이스</span></Link></SidebarHeader>
    <SidebarContent>
      {groups.map((group) => <NavGroupSection key={group.label} group={group} onNavigate={() => setOpenMobile(false)} />)}
    </SidebarContent>
    <SidebarFooter className="px-2 pb-3"><AccountSwitcher /></SidebarFooter>
  </Sidebar>;
}

function NavGroupSection({ group, onNavigate }: { group: NavGroup; onNavigate: () => void }) {
  const containsActive = group.items.some((item) => item.active);
  const [toggled, setToggled] = useState<boolean | null>(null);
  const open = !group.collapsible || (toggled ?? containsActive);
  const hidden = group.collapsible && !open ? group.items.reduce((sum, item) => sum + (item.tone === "neutral" ? 0 : item.count ?? 0), 0) : 0;
  const menu = <SidebarMenu>{group.items.map(({ label, href, active, icon: Icon, count, tone = "warn", dot }) => <SidebarMenuItem key={label}><SidebarMenuButton isActive={active} aria-current={active ? "page" : undefined} onClick={onNavigate} render={<Link href={href} />}><Icon className="size-4" /><span>{label}</span>{(count ?? 0) > 0 && <SidebarBadge count={count} variant={tone} dot={dot} />}</SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu>;
  if (!group.collapsible) return <SidebarGroup><SidebarGroupLabel>{group.label}</SidebarGroupLabel><SidebarGroupContent>{menu}</SidebarGroupContent></SidebarGroup>;
  return <SidebarGroup className="mt-auto">
    <SidebarGroupLabel render={<button type="button" aria-expanded={open} onClick={() => setToggled(!open)} />} className="w-full cursor-pointer gap-1 hover:text-sidebar-foreground">
      <ChevronRight className={open ? "rotate-90 transition-transform" : "transition-transform"} /><span>{group.label}</span>{hidden > 0 && <span className="ml-auto"><SidebarBadge count={hidden} variant="warn" dot /></span>}
    </SidebarGroupLabel>
    {open && <SidebarGroupContent>{menu}</SidebarGroupContent>}
  </SidebarGroup>;
}
