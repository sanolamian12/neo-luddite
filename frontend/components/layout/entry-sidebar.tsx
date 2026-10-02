"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Handshake, LogIn, MessagesSquare, Plus, Repeat2, ShieldCheck, BriefcaseBusiness } from "lucide-react";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { useAccountHydrated, useAccountStore } from "@/lib/account-store";
import { loginHref, routeForAccount } from "@/lib/account-route";
import { chatHref, conversationTitle } from "@/lib/entry-chat";
import { entryChatStore, useChatScope, useEntryChat, useEntryHydrated } from "@/lib/entry-chat-store";
import { AccountSwitcher } from "./account-switcher";
import { OwnerRoomList } from "@/components/room/owner-room-list";
import styles from "@/components/chat/entry-chat.module.css";

export function EntrySidebar() {
  const router = useRouter();
  const path = usePathname();
  const search = useSearchParams();
  const scope = useChatScope();
  const hydrated = useEntryHydrated();
  const accountHydrated = useAccountHydrated();
  const session = useAccountStore((state) => state.session);
  const conversations = useEntryChat((state) => state.conversations);
  const { setOpenMobile } = useSidebar();
  const activeId = search.get("c");
  const returnTo = path.startsWith("/chat/") ? chatHref(activeId ?? undefined) : "/";
  const own = conversations.filter((conversation) => conversation.scope === scope).toSorted((a, b) => b.updatedAt - a.updatedAt);
  const close = () => setOpenMobile(false);
  function newChat() {
    const id = entryChatStore.getState().create(scope);
    router.push(chatHref(id));
    close();
  }
  return <Sidebar>
    <SidebarHeader><Link href="/" className="flex items-center gap-2 font-semibold" onClick={close}><MessagesSquare size={20} />세무상담</Link></SidebarHeader>
    <SidebarContent>
      <SidebarGroup><SidebarGroupContent><SidebarMenu>
        <SidebarMenuItem><SidebarMenuButton onClick={newChat} disabled={!hydrated || !accountHydrated}><Plus /><span>새 상담</span></SidebarMenuButton></SidebarMenuItem>
        {session === "viewer" && <SidebarMenuItem><SidebarMenuButton isActive={path.startsWith("/consultations")} render={<Link href="/consultations" />} onClick={close}><Handshake /><span>세무사 상담</span></SidebarMenuButton></SidebarMenuItem>}
      </SidebarMenu></SidebarGroupContent></SidebarGroup>
      <SidebarGroup><SidebarGroupLabel>{session === "viewer" ? "내 상담 기록" : "체험 대화"}</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>
        {hydrated && accountHydrated ? own.length ? own.map((conversation) => <SidebarMenuItem key={conversation.id}><SidebarMenuButton isActive={activeId === conversation.id && path.startsWith("/chat/")} render={<Link href={chatHref(conversation.id)} />} onClick={close}><MessagesSquare /><span className="truncate">{conversationTitle(conversation)}</span></SidebarMenuButton></SidebarMenuItem>)
          : <li className={styles.sidebarNote}>첫 질문을 보내면<br />이곳에서 이어갈 수 있어요.</li> : <li className={styles.sidebarNote} role="status">상담 기록을 불러오는 중…</li>}
      </SidebarMenu></SidebarGroupContent></SidebarGroup>
      {session === "viewer" && <SidebarGroup><SidebarGroupLabel>병의원 상담 예시</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>
        {[["clinic-vehicle", "리스 차량 비용처리"], ["clinic-golf", "골프 접대비"], ["clinic-gym", "직원 복지비"]].map(([id, label]) => <SidebarMenuItem key={id}><SidebarMenuButton render={<Link href={`/chat/clinic?c=${id}`} />} onClick={close}><MessagesSquare /><span>{label}</span></SidebarMenuButton></SidebarMenuItem>)}
      </SidebarMenu></SidebarGroupContent></SidebarGroup>}
      {session === "viewer" && <SidebarGroup><SidebarGroupLabel>세무사 채팅</SidebarGroupLabel><SidebarGroupContent><OwnerRoomList onNavigate={close} /></SidebarGroupContent></SidebarGroup>}
    </SidebarContent>
    <SidebarFooter>
      {!accountHydrated ? <p className={styles.sidebarNote}>계정을 확인하는 중…</p> : session ? <>
        {session === "viewer" ? <SidebarMenu><SidebarMenuItem><SidebarMenuButton render={<Link href="/select" />} onClick={close}><Repeat2 /><span>업종 변경</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu> : <WorkspaceLink onNavigate={close} />}
        <AccountSwitcher />
      </> : <>
        <p className={styles.sidebarNote}>대화는 이 브라우저에 보관돼요.<br />로그인하면 내 상담으로 이어집니다.</p>
        <SidebarMenu><SidebarMenuItem><SidebarMenuButton render={<Link href={loginHref(returnTo)} />} onClick={close}><LogIn /><span>로그인하고 이어가기</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu>
      </>}
    </SidebarFooter>
  </Sidebar>;
}

export function WorkspaceLink({ onNavigate }: { onNavigate?: () => void }) {
  const session = useAccountStore((state) => state.session);
  const auditor = useAccountStore((state) => state.auditor);
  const admin = useAccountStore((state) => state.admin);
  if (!session || session === "viewer") return null;
  const account = session === "auditor" ? auditor : admin;
  const Icon = session === "auditor" ? BriefcaseBusiness : ShieldCheck;
  return <Link href={routeForAccount(account)} className={styles.workspaceLink} onClick={onNavigate}><Icon size={16} /><span>{session === "auditor" ? "전문가 워크스페이스" : "운영 콘솔"}</span></Link>;
}
