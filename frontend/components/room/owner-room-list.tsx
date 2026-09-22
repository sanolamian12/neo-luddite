"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { ExpertAvatar } from "@/components/expert/expert-card";
import { Spinner } from "@/components/ui/spinner";
import { useAccountStore } from "@/lib/account-store";
import { useEnsureExpertCards, useExpertIdentity } from "@/lib/expert-card-store";
import { formatDate, formatDateTime } from "@/lib/poc-format";
import type { ConsultationRoom, RoomMessage } from "@/lib/poc-schema";
import { sortRooms, unreadInRoom, useRoomsHydrated, useRoomStore } from "@/lib/room-store";
import { cn } from "@/lib/utils";

/** 오늘이면 시:분, 아니면 날짜. */
function shortWhen(ts: number): string {
  const full = formatDateTime(ts);
  const sameDay = new Date(ts).toDateString() === new Date().toDateString();
  return sameDay ? full.split(" ").slice(-1)[0] : formatDate(ts);
}

/** 사장님 본인의 방(열린 방 먼저, 그 안에서 최근 메시지순)과 안 읽음 합계. */
export function useOwnerRooms(): { rooms: ConsultationRoom[]; unread: number; hydrated: boolean } {
  const hydrated = useRoomsHydrated();
  const me = useAccountStore((s) => s.viewer.id);
  const rooms = useRoomStore((s) => s.rooms);
  const messages = useRoomStore((s) => s.messages);
  return useMemo(() => {
    const mine = sortRooms(rooms.filter((r) => r.viewerId === me));
    const unread = mine.reduce((sum, r) => sum + unreadInRoom(r, messages, me), 0);
    return { rooms: mine, unread, hydrated };
  }, [rooms, messages, me, hydrated]);
}

/**
 * 사장님 사이드바 "세무사 채팅" 탭 — 내 채팅방 목록(설계 §4.1, (e)).
 * 열린 방이 위, 닫힌 방은 "닫힌 채팅방" 아래로 묶어 흐리게. 누르면 /rooms/<id>.
 */
export function OwnerRoomList({ onNavigate }: { onNavigate?: () => void }) {
  const { rooms, hydrated } = useOwnerRooms();
  const messages = useRoomStore((s) => s.messages);
  const pathname = usePathname();
  useEnsureExpertCards(useMemo(() => [...new Set(rooms.map((r) => r.expertId))], [rooms]));

  if (!hydrated) {
    return <Spinner size="sm" label="불러오는 중…" className="px-2 py-1.5" />;
  }
  if (rooms.length === 0) {
    return (
      <p className="px-2 py-1.5 text-xs break-keep text-muted-foreground">
        아직 세무사 채팅방이 없습니다. 세무사가 상담 신청을 수락하거나 연결 요청을 승인하면 여기에 열립니다.
      </p>
    );
  }

  const open = rooms.filter((r) => r.status === "open");
  const closed = rooms.filter((r) => r.status !== "open");
  const item = (r: ConsultationRoom) => (
    <OwnerRoomItem
      key={r.id}
      room={r}
      messages={messages}
      active={pathname === `/rooms/${encodeURIComponent(r.id)}` || pathname === `/rooms/${r.id}`}
      onNavigate={onNavigate}
    />
  );

  return (
    <ul className="flex min-w-0 flex-col gap-0.5" data-testid="owner-room-list">
      {open.map(item)}
      {closed.length > 0 && (
        <>
          <li className="px-2 pt-2 pb-0.5 text-[11px] text-muted-foreground" data-testid="owner-room-closed-label">
            닫힌 채팅방
          </li>
          {closed.map(item)}
        </>
      )}
    </ul>
  );
}

function OwnerRoomItem({
  room,
  messages,
  active,
  onNavigate,
}: {
  room: ConsultationRoom;
  messages: RoomMessage[];
  active: boolean;
  onNavigate?: () => void;
}) {
  const me = useAccountStore((s) => s.viewer.id);
  const expert = useExpertIdentity(room.expertId);
  const unread = unreadInRoom(room, messages, me);
  let last: RoomMessage | undefined;
  for (const m of messages) if (m.roomId === room.id && (!last || m.createdAt > last.createdAt)) last = m;
  const closed = room.status !== "open";
  const title = expert.name ? `${expert.name} 세무사` : expert.settled ? "세무사" : "";

  return (
    <li className="min-w-0">
      <Link
        href={`/rooms/${encodeURIComponent(room.id)}`}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        data-testid="owner-room-item"
        data-room-id={room.id}
        data-status={room.status}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-hidden transition-colors",
          "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
          closed && "opacity-60",
        )}
      >
        <ExpertAvatar
          expert={{ displayName: expert.name ?? "", avatarUrl: expert.avatarUrl, avatarColor: expert.avatarColor }}
          className="size-7 shrink-0"
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-sm" data-testid="owner-room-name">
              {title || <span className="inline-block h-3 w-16 animate-pulse rounded bg-muted align-middle" />}
            </span>
            {closed ? (
              <span className="shrink-0 text-[10px] text-muted-foreground" data-testid="owner-room-closed">
                닫힘
              </span>
            ) : (
              <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                {shortWhen(room.lastMessageAt ?? room.createdAt)}
              </span>
            )}
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" data-testid="owner-room-last">
              {last ? (last.deletedAt ? "삭제된 메시지입니다" : last.body) : "아직 메시지가 없습니다"}
            </span>
            {unread > 0 && (
              <span
                className="shrink-0 rounded-full bg-brand-amber px-1.5 text-[10px] font-semibold text-white tabular-nums"
                data-testid="owner-room-unread"
              >
                {unread}
              </span>
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}
