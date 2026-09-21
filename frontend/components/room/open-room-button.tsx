"use client";

import Link from "next/link";
import { useEffect } from "react";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAccountStore } from "@/lib/account-store";
import { unreadInRoom, useRoomsHydrated, useRoomStore } from "@/lib/room-store";
import * as roomService from "@/services/room";
import type { RoomSide } from "./room-view";

/**
 * 신청 상세의 [채팅방 열기] — 이 (대화, 세무사) 쌍의 방이 있으면 그 방으로, 안 읽음 수를 붙여서.
 * 방은 수락 때 DB(open_room)가 만든다. 수락 직후 Realtime 이 늦으면 잠깐 "여는 중"으로 보인다.
 */
export function OpenRoomButton({
  conversationId,
  expertId,
  side,
}: {
  conversationId: string;
  expertId: string;
  side: RoomSide;
}) {
  const hydrated = useRoomsHydrated();
  const me = useAccountStore((s) => (side === "owner" ? s.viewer.id : s.auditor.id));
  const room = useRoomStore((s) =>
    s.rooms.find((r) => r.conversationId === conversationId && r.expertId === expertId),
  );
  const unread = useRoomStore((s) => (room ? unreadInRoom(room, s.messages, me) : 0));

  // 적재가 끝났는데도 방이 없으면(수락 INSERT 가 Realtime 에서 빠진 경우) 직접 당긴다 — 0·1.5·4초.
  const missing = hydrated && !room;
  useEffect(() => {
    if (!missing) return;
    const timers = [0, 1500, 4000].map((ms) =>
      setTimeout(() => void roomService.fetchRoomFor(conversationId, expertId).catch(() => {}), ms),
    );
    return () => timers.forEach(clearTimeout);
  }, [missing, conversationId, expertId]);

  if (!room) {
    return (
      <Button size="sm" variant="outline" disabled className="w-fit">
        {/* 적재 대기만 돈다 — 적재 뒤 방이 없으면(재조회 0·1.5·4초) 도는 표시 없이 문구만 남긴다. */}
        {hydrated ? <MessageCircle /> : <Spinner size="sm" className="text-inherit" />}
        {hydrated ? "채팅방 여는 중…" : "채팅방 불러오는 중…"}
      </Button>
    );
  }

  const href =
    side === "owner"
      ? `/rooms/${encodeURIComponent(room.id)}`
      : `/audit/rooms/${encodeURIComponent(room.id)}`;

  return (
    <Button size="sm" className="w-fit" render={<Link href={href} />} data-testid="open-room">
      <MessageCircle />
      {room.status === "closed" ? "채팅방 보기(닫힘)" : "채팅방 열기"}
      {unread > 0 && (
        <span
          className="ml-1 rounded-full bg-brand-amber px-1.5 text-[10px] font-semibold text-white tabular-nums"
          data-testid="open-room-unread"
        >
          {unread}
        </span>
      )}
    </Button>
  );
}
