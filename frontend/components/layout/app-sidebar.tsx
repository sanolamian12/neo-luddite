"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { MessagesSquare, Plus, Repeat2, StickyNote } from "lucide-react";
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
import { getConversations } from "@/lib/load-conversation";
import { getOccupation } from "@/lib/occupations";
import { useReplayStore } from "@/lib/replay-store";
import { useChatModeStore } from "@/lib/chat-mode-store";
import {
  useConversationStore,
  useConversationHydrated,
  type ConversationRecord,
} from "@/lib/conversation-store";
import { useRemoteChatStore } from "@/lib/runtime/remote-chat-store";
import { useAccountStore } from "@/lib/account-store";
import { AccountSwitcher } from "./account-switcher";

/** /chat/<occupation> 경로에서 현재 직업군 키 추출 */
function useOccupationKey(): string | null {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean);
  return parts[0] === "chat" && parts[1] ? parts[1] : null;
}

export function AppSidebar() {
  const occupationKey = useOccupationKey();
  const occ = occupationKey ? getOccupation(occupationKey) : undefined;
  const isRemote = useChatModeStore((s) => s.mode) === "remote";

  // ── 재생(데모) 경로: 정적 대화 목록 ─────────────────────────────────────────
  const staticSessions = getConversations(occ?.conversationIds ?? []);
  const revealAll = useReplayStore((s) => s.revealAll);
  const replayReset = useReplayStore((s) => s.reset);
  const replayActiveId = useReplayStore((s) => s.script?.id ?? null);

  // ── 라이브 경로: 사장님 본인의 실제 대화(Supabase Realtime) ──────────────────
  const hydrated = useConversationHydrated();
  const records = useConversationStore((s) => s.records);
  const remoteInit = useRemoteChatStore((s) => s.init);
  const remoteActiveId = useRemoteChatStore((s) => s.conversationId);
  const ownerId = useAccountStore((s) => s.viewer.id);
  const ownerLabel = useAccountStore((s) => s.viewer.label);

  const liveSessions = useMemo(
    () =>
      records
        .filter((r) => r.occupation === occupationKey)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [records, occupationKey],
  );

  // "새 상담": 라이브는 새 conversationId 발급 + 빈 세션(첫 질문 시 제목 자동생성·영속),
  // 재생은 스크립트 리셋(기존 동작).
  const onNewChat = () => {
    if (isRemote) {
      if (!occupationKey) return;
      const createdAt = Date.now();
      remoteInit({
        conversationId: `live-${occupationKey}-${createdAt.toString(36)}`,
        occupation: occupationKey,
        ownerId,
        ownerLabel,
        createdAt,
        messages: [],
      });
    } else {
      replayReset();
    }
  };

  // 기존 라이브 세션 열기: 그 대화를 remote store 로 복원(메시지 포함) → 이어서 질문 가능.
  const openLive = (r: ConversationRecord) => {
    remoteInit({
      conversationId: r.id,
      occupation: r.occupation,
      ownerId,
      ownerLabel: r.ownerLabel ?? ownerLabel,
      createdAt: r.createdAt,
      messages: r.payload?.messages ?? [],
    });
  };

  return (
    <Sidebar>
      <SidebarHeader className="px-3 py-4">
        <Link href="/" className="flex items-center gap-2 font-bold">
          <span className="text-lg">세무상담</span>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton onClick={onNewChat}>
                  <Plus />
                  <span>새 상담</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>상담 세션</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {isRemote ? (
                !hydrated ? (
                  <SidebarMenuItem>
                    <span className="px-2 py-1.5 text-xs text-muted-foreground">
                      불러오는 중…
                    </span>
                  </SidebarMenuItem>
                ) : liveSessions.length === 0 ? (
                  <SidebarMenuItem>
                    <span className="px-2 py-1.5 text-xs text-muted-foreground">
                      아직 상담이 없습니다. 새 상담에서 질문을 시작하세요.
                    </span>
                  </SidebarMenuItem>
                ) : (
                  liveSessions.map((r) => (
                    <SidebarMenuItem key={r.id}>
                      <SidebarMenuButton
                        isActive={remoteActiveId === r.id}
                        onClick={() => openLive(r)}
                      >
                        <MessagesSquare />
                        <span className="truncate">{r.title ?? "새 상담"}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))
                )
              ) : staticSessions.length === 0 ? (
                <SidebarMenuItem>
                  <span className="px-2 py-1.5 text-xs text-muted-foreground">
                    세션이 없습니다
                  </span>
                </SidebarMenuItem>
              ) : (
                staticSessions.map((c) => (
                  <SidebarMenuItem key={c.id}>
                    <SidebarMenuButton
                      isActive={replayActiveId === c.id}
                      onClick={() => revealAll(c)}
                    >
                      <MessagesSquare />
                      <span className="truncate">{c.topic.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>기능 (준비중)</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton disabled aria-disabled className="opacity-50">
                  <StickyNote />
                  <span>대화 주석</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-2 px-2 pb-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="sm" render={<Link href="/select" />}>
              <Repeat2 />
              <span>업종 변경</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <AccountSwitcher />
      </SidebarFooter>
    </Sidebar>
  );
}
