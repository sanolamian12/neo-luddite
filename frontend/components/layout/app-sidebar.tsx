"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo } from "react";
import { Handshake, MessagesSquare, Plus, Repeat2, StickyNote } from "lucide-react";
import { create } from "zustand";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { useOwnerSidebarBadges } from "@/lib/sidebar-badges";
import { AccountSwitcher } from "./account-switcher";
import { SidebarBadge } from "./sidebar-badge";
import { Spinner } from "@/components/ui/spinner";
import { OwnerRoomList, useOwnerRooms } from "@/components/room/owner-room-list";

type SessionTab = "ai" | "rooms";

/**
 * "상담 세션" 탭 선택 — 새로 연 페이지는 늘 AI 상담부터((e) 결정). 채팅·세무사 상담·채팅방은 레이아웃이
 * 달라 사이드바가 다시 마운트되므로, 고른 탭은 모듈 상태로 들고 있어 화면을 옮겨도 유지한다(새로고침이면 AI 상담).
 */
const useSessionTabStore = create<{ tab: SessionTab; setTab: (t: SessionTab) => void }>()((set) => ({
  tab: "ai",
  setTab: (tab) => set({ tab }),
}));

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
  const pathname = usePathname();
  const router = useRouter();
  const onConsultations = pathname.startsWith("/consultations");
  const badges = useOwnerSidebarBadges();
  const tab = useSessionTabStore((s) => s.tab);
  const setTab = useSessionTabStore((s) => s.setTab);
  const { unread: roomsUnread } = useOwnerRooms();
  const { isMobile, setOpenMobile } = useSidebar();
  // 모바일 시트: 방으로 옮겨 가면 시트를 닫는다(같은 /rooms 레이아웃 안 이동은 사이드바가 그대로 남는다).
  const closeMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

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

  // 채팅 밖(/consultations·/offers·/rooms)에서는 직업군이 없으므로 전체 세션을 보여 주고, 누르면 그 대화로 이동.
  const liveSessions = useMemo(
    () =>
      records
        .filter((r) => (occupationKey ? r.occupation === occupationKey : true))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [records, occupationKey],
  );

  // "새 상담": 라이브는 새 conversationId 발급 + 빈 세션(첫 질문 시 제목 자동생성·영속),
  // 재생은 스크립트 리셋(기존 동작).
  const onNewChat = () => {
    if (!occupationKey) {
      router.push("/select");
      return;
    }
    if (isRemote) {
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
    if (!occupationKey) {
      router.push(`/chat/${r.occupation}?c=${encodeURIComponent(r.id)}`);
      return;
    }
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
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={onConsultations}
                  render={<Link href="/consultations" />}
                >
                  <Handshake />
                  <span>세무사 상담</span>
                  <SidebarBadge count={badges.consultationsUnread} variant="warn" dot />
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>상담 세션</SidebarGroupLabel>
          <SidebarGroupContent>
            <Tabs
              value={tab}
              onValueChange={(v) => setTab(v as SessionTab)}
              className="min-w-0 gap-1.5"
              data-testid="session-tabs"
            >
              <TabsList className="w-full">
                <TabsTrigger value="ai" className="px-2 text-xs" data-testid="session-tab-ai">
                  AI 상담
                </TabsTrigger>
                <TabsTrigger value="rooms" className="px-2 text-xs" data-testid="session-tab-rooms">
                  세무사 채팅
                  {roomsUnread > 0 && (
                    <span
                      className="rounded-full bg-brand-amber px-1.5 text-[10px] font-semibold text-white tabular-nums"
                      aria-label={`안 읽은 메시지 ${roomsUnread}개`}
                      data-testid="session-tab-rooms-unread"
                    >
                      {roomsUnread}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="ai" className="min-w-0">
                <SidebarMenu>
                  {isRemote ? (
                    !hydrated ? (
                      <SidebarMenuItem>
                        <Spinner size="sm" label="불러오는 중…" className="px-2 py-1.5" />
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
                            isActive={occupationKey !== null && remoteActiveId === r.id}
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
              </TabsContent>
              <TabsContent value="rooms" className="min-w-0">
                <OwnerRoomList onNavigate={closeMobile} />
              </TabsContent>
            </Tabs>
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
