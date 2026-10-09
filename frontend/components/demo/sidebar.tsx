"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { MessageCircle, GraduationCap, BookOpen, Play, Users, Layers, Wallet } from "lucide-react";
import { Sidebar, SidebarContent, SidebarHeader, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { expert } from "@/lib/demo/domain";
import { DemoLink, useDemo } from "./runtime";
export function DemoSidebar() {
  const demo = useDemo()!; const path = usePathname(); const search = useSearchParams(); const { setOpenMobile } = useSidebar(); const run = demo.run;
  function active(href: string) { return path === href.split("?")[0] && (!path.startsWith("/chat/") || href.includes("common=1") === (search.get("common") === "1")); }
  const links = path.startsWith("/admin") ? [{ title: "기여 검토", path: "/admin/knowledge-contributions", icon: Users }, { title: "지식 업데이트", path: "/admin/knowledge-contributions/batches", icon: Layers }] : path.startsWith("/audit") ? [{ title: "진행 중인 상담", path: "/audit/consultations?kind=participation", icon: MessageCircle }, { title: "가르치기", path: "/audit/agents/teach?method=session", icon: GraduationCap }, { title: "지식 모음", path: "/audit/agents/knowledge", icon: BookOpen }, { title: "가르치기 전후 비교", path: "/audit/agents/preview", icon: Play }, { title: "공통 지식 기여", path: "/audit/contributions", icon: Users }, { title: "기여 크레딧", path: "/audit/ledger", icon: Wallet }] : [{ title: "장비 사용 상담", path: `/chat/clinic?c=${run.conversationId}`, icon: MessageCircle }, { title: "업데이트된 공통 AI", path: "/chat/clinic?common=1", icon: BookOpen }];
  return <Sidebar><SidebarHeader className="p-5 font-semibold">{path.startsWith("/admin") ? "공통 지식 운영" : path.startsWith("/audit") ? expert(run).displayName : "세무상담"}</SidebarHeader><SidebarContent><SidebarGroup><SidebarGroupContent><SidebarMenu>{links.map(({ title, path: href, icon: Icon }) => <SidebarMenuItem key={title}><SidebarMenuButton isActive={active(href)} render={<DemoLink href={href} />} onClick={() => setOpenMobile(false)}><Icon /><span>{title}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarGroupContent></SidebarGroup></SidebarContent><SidebarFooter className="p-5 text-xs text-muted-foreground">가상 인물 · 로컬 시연<br />상담과 지식은 이 데모에만 저장됩니다.</SidebarFooter></Sidebar>;
}
