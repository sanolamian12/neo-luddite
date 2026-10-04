"use client";

import Link from "next/link";
import { MessagesSquare } from "lucide-react";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { useAccountStore } from "@/lib/account-store";
import { chatHref } from "@/lib/entry-chat";
import { useConversationHydrated, useConversationStore } from "@/lib/conversation-store";

/**
 * 로그인 사장님의 서버(Supabase) 대화 중 이 브라우저에 없는 것 — 다른 기기에서 시작한 상담.
 * conversation-store 는 import 만으로 Realtime 동기화를 켜므로, 사이드바가 viewer 일 때만 지연 로드한다.
 */
export function OwnerServerConversations({ localIds, activeId, onNavigate }: { localIds: string[]; activeId: string | null; onNavigate: () => void }) {
  const ownerId = useAccountStore((state) => state.viewer.id);
  const hydrated = useConversationHydrated();
  const records = useConversationStore((state) => state.records);
  if (!hydrated) return null;
  const remote = records
    .filter((record) => record.ownerId === ownerId && record.occupation === "clinic" && !localIds.includes(record.id) && (record.payload?.messages.length ?? 0) > 0)
    .toSorted((a, b) => b.updatedAt - a.updatedAt);
  return remote.map((record) => <SidebarMenuItem key={record.id}>
    <SidebarMenuButton isActive={activeId === record.id} render={<Link href={chatHref(record.id)} />} onClick={onNavigate}>
      <MessagesSquare /><span className="truncate">{record.title ?? "상담"}</span>
    </SidebarMenuButton>
  </SidebarMenuItem>);
}
