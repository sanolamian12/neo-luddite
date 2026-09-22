"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConversationReadOnly } from "@/components/consultation/consultation-parts";
import { useAccountStore } from "@/lib/account-store";
import { useConversationLookup } from "@/lib/conversation-store";
import { formatDateTime } from "@/lib/poc-format";
import { useRoomsHydrated, useRoomStore } from "@/lib/room-store";
import * as roomService from "@/services/room";
import { LoadingBlock } from "@/components/ui/spinner";

/**
 * 세무사 쪽 "방의 원 대화" (/audit/rooms/<방id>/conversation) — 경로 B(offer) 방의 AI 상담 원문, 읽기 전용.
 *
 * - 원문은 정지 스냅샷 우선(`snapshotPayload ?? payload`) — 검수와 같은 기준(후속1 결정).
 * - 코멘트·평가 쓰기는 없다. 일감 밖에서 검수 기록이 생기지 않게.
 * - 열람 권한은 0040 조건 ③(나와 방이 있는 대화). 방이 생기며 "보이게" 된 대화는 Realtime 이 안 오므로
 *   `useConversationLookup` 으로 직접 당긴다(§3.7). 내 방이 아니면 원문을 비추지 않는다.
 */
export function RoomConversationView({ roomId }: { roomId: string }) {
  const hydrated = useRoomsHydrated();
  const me = useAccountStore((s) => s.auditor.id);
  const room = useRoomStore((s) => s.rooms.find((r) => r.id === roomId));
  const mine = Boolean(room && room.expertId === me);

  // 방 화면과 같이 열 때 한 번 당긴다 — 페이지를 연 직후 생긴 방이 아직 스토어에 없을 수 있다.
  const [refreshed, setRefreshed] = useState<"pending" | "done">("pending");
  useEffect(() => {
    let alive = true;
    roomService
      .refreshRoom(roomId)
      .catch(() => false)
      .finally(() => alive && setRefreshed("done"));
    return () => {
      alive = false;
    };
  }, [roomId]);

  const { record, settled } = useConversationLookup(mine ? room!.conversationId : null);
  const roomHref = `/audit/rooms/${encodeURIComponent(roomId)}`;

  if (!room || !mine) {
    if (!room && (!hydrated || refreshed === "pending")) {
      return <LoadingBlock label="불러오는 중…" />;
    }
    return (
      <div
        className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
        data-testid="room-conversation-denied"
      >
        <MessagesSquare className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground break-keep">
          채팅방을 찾을 수 없습니다. AI 상담 원문은 그 채팅방의 세무사만 볼 수 있습니다.
        </p>
        <Button variant="outline" render={<Link href="/audit/rooms" />}>
          채팅방 목록
        </Button>
      </div>
    );
  }

  const conv = record ? (record.snapshotPayload ?? record.payload) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="room-conversation">
      <header className="flex shrink-0 items-center gap-2 border-b px-3 py-3 md:px-6">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="채팅방으로"
          title="채팅방으로"
          render={<Link href={roomHref} />}
          data-testid="room-conversation-back"
        >
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">
            {record?.title ?? conv?.topic.title ?? "AI 상담 원문"}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {record?.ownerLabel || room.viewerId} · 읽기 전용
            {record?.snapshotAt != null && ` · ${formatDateTime(record.snapshotAt)} 정지 스냅샷`}
          </p>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6">
        <div className="mx-auto max-w-3xl">
          {conv ? (
            <ConversationReadOnly conversation={conv} />
          ) : settled ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              대화 원문을 불러오지 못했습니다(대화가 삭제되었을 수 있습니다).
            </p>
          ) : (
            <LoadingBlock label="불러오는 중…" />
          )}
        </div>
      </div>
    </div>
  );
}
