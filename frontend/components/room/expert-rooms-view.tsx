"use client";

import Link from "next/link";
import { useMemo } from "react";
import { MessagesSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAccountStore } from "@/lib/account-store";
import { useConversationStore } from "@/lib/conversation-store";
import { formatDateTime } from "@/lib/poc-format";
import type { ConsultationRoom } from "@/lib/poc-schema";
import { unreadInRoom, useRoomsHydrated, useRoomStore } from "@/lib/room-store";
import { cn } from "@/lib/utils";
import { RoomView } from "./room-view";

/** 방 정렬: 열린 방 먼저, 그 안에서 최근 메시지(없으면 개설) 순. */
export function sortRooms(rooms: ConsultationRoom[]): ConsultationRoom[] {
  return [...rooms].sort((a, b) => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    return (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt);
  });
}

/**
 * 세무사 "채팅방" (/audit/rooms) — 내 방 목록 + 방. 방 화면은 사장님 쪽과 같은 RoomView.
 * 좁은 화면에서는 목록(/audit/rooms)과 방(/audit/rooms/<id>)이 한 번에 하나만 보인다.
 */
export function ExpertRoomsView({ roomId }: { roomId?: string }) {
  const hydrated = useRoomsHydrated();
  const me = useAccountStore((s) => s.auditor.id);
  const rooms = useRoomStore((s) => s.rooms);
  const messages = useRoomStore((s) => s.messages);
  const records = useConversationStore((s) => s.records);

  const mine = useMemo(() => sortRooms(rooms.filter((r) => r.expertId === me)), [rooms, me]);
  const activeId = roomId ?? null;

  const lastMessage = (id: string) => {
    let last: (typeof messages)[number] | undefined;
    for (const m of messages) if (m.roomId === id && (!last || m.createdAt > last.createdAt)) last = m;
    return last;
  };

  if (!hydrated && !roomId) {
    return <div className="px-6 py-10 text-sm text-muted-foreground">불러오는 중…</div>;
  }

  if (hydrated && mine.length === 0 && !roomId) {
    return (
      <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <MessagesSquare className="size-8 text-muted-foreground" />
        <h1 className="text-lg font-semibold">아직 열린 채팅방이 없습니다</h1>
        <p className="text-sm break-keep text-muted-foreground">
          상담 신청을 수락하면 그 사장님과의 채팅방이 여기에 열립니다.
        </p>
        <Button variant="outline" render={<Link href="/audit/consultations" />}>
          상담 신청 보기
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <aside
        className={cn(
          "w-full shrink-0 flex-col border-r md:flex md:w-[320px]",
          activeId ? "hidden md:flex" : "flex",
        )}
      >
        <div className="border-b px-4 py-3">
          <h1 className="text-sm font-semibold">채팅방</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {mine.filter((r) => r.status === "open").length}개 진행 중
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {mine.map((r) => {
            const conv = records.find((c) => c.id === r.conversationId);
            const unread = unreadInRoom(r, messages, me);
            const last = lastMessage(r.id);
            return (
              <Link
                key={r.id}
                href={`/audit/rooms/${encodeURIComponent(r.id)}`}
                aria-current={r.id === activeId ? "true" : undefined}
                data-testid="room-list-item"
                className={cn(
                  "flex w-full flex-col gap-1 border-b px-4 py-3 text-left transition-colors",
                  r.id === activeId ? "bg-primary/5" : "hover:bg-muted/50",
                )}
              >
                <div className="flex w-full items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {conv?.ownerLabel || r.viewerId}
                  </span>
                  {r.status === "closed" && (
                    <Badge variant="outline" className="text-[10px]">
                      닫힘
                    </Badge>
                  )}
                  {unread > 0 && (
                    <span
                      className="rounded-full bg-brand-amber px-1.5 text-[10px] font-semibold text-white tabular-nums"
                      data-testid="room-unread"
                    >
                      {unread}
                    </span>
                  )}
                </div>
                <span className="line-clamp-1 text-xs text-muted-foreground">
                  {last ? (last.deletedAt ? "삭제된 메시지입니다" : last.body) : (conv?.title ?? "AI 상담")}
                </span>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {formatDateTime(r.lastMessageAt ?? r.createdAt)}
                </span>
              </Link>
            );
          })}
        </div>
      </aside>

      <div className={cn("min-w-0 flex-1 flex-col", activeId ? "flex" : "hidden md:flex")}>
        {activeId ? (
          <RoomView
            key={activeId}
            roomId={activeId}
            side="expert"
            backHref="/audit/rooms"
            backLabel="채팅방 목록"
            backMobileOnly
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            왼쪽에서 채팅방을 선택하세요.
          </div>
        )}
      </div>
    </div>
  );
}
