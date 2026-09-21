"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, MessagesSquare, Send, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ExpertAvatar } from "@/components/expert/expert-card";
import { errorMessage } from "@/components/consultation/consultation-parts";
import { useAccountStore } from "@/lib/account-store";
import { useAuditorRegistryStore } from "@/lib/auditor-registry-store";
import { useConversationRecord } from "@/lib/conversation-store";
import { formatDateTime } from "@/lib/poc-format";
import {
  ROOM_MESSAGE_MAX,
  type ConsultationRoom,
  type ExpertCard,
  type RoomMessage,
} from "@/lib/poc-schema";
import { unreadInRoom, useRoomsHydrated, useRoomStore } from "@/lib/room-store";
import { cn } from "@/lib/utils";
import * as expertService from "@/services/expert";
import * as roomService from "@/services/room";

export type RoomSide = "owner" | "expert";

/**
 * 상담 채팅방 한 개 — 사장님(/rooms/<id>)과 세무사(/audit/rooms/<id>)가 같이 쓴다. 역할만 다르다.
 *
 * - 열 때 그 방을 한 번 더 당긴다(Realtime 유실 대비, 설계 §7).
 * - 화면에 떠 있는 동안 상대 메시지가 오면 곧바로 읽음 처리한다(mark_room_read → 뱃지 감소).
 * - 닫힌 방은 읽기만 된다. 닫기는 양쪽 누구나(§10-2).
 */
export function RoomView({
  roomId,
  side,
  backHref,
  backLabel,
  backMobileOnly = false,
}: {
  roomId: string;
  side: RoomSide;
  /** 헤더 "← 목록" 링크. */
  backHref?: string;
  backLabel?: string;
  /** 목록이 옆에 붙는 넓은 화면에서는 뒤로 버튼을 숨긴다. */
  backMobileOnly?: boolean;
}) {
  const hydrated = useRoomsHydrated();
  const me = useAccountStore((s) => (side === "owner" ? s.viewer.id : s.auditor.id));
  const room = useRoomStore((s) => s.rooms.find((r) => r.id === roomId));
  const allMessages = useRoomStore((s) => s.messages);
  const messages = useMemo(
    () =>
      allMessages
        .filter((m) => m.roomId === roomId)
        .sort((a, b) => a.createdAt - b.createdAt),
    [allMessages, roomId],
  );

  // 열 때 한 번 더 fetch — 결과가 올 때까지는 스토어 내용으로 그린다.
  const [refreshed, setRefreshed] = useState<"pending" | "ok" | "missing">("pending");
  useEffect(() => {
    let alive = true;
    roomService
      .refreshRoom(roomId)
      .then((found) => alive && setRefreshed(found ? "ok" : "missing"))
      .catch(() => alive && setRefreshed("ok"));
    // 탭으로 돌아오면 한 번 더 — 자리를 비운 사이(절전·네트워크 끊김) 빠진 메시지·닫힘을 메운다.
    const onVisible = () => {
      if (document.visibilityState === "visible") void roomService.refreshRoom(roomId).catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [roomId]);

  // 떠 있는 동안 안 읽은 상대 메시지가 있으면 읽음 처리(탭이 보일 때만).
  const unread = room ? unreadInRoom(room, messages, me) : 0;
  const isMember = Boolean(room && (room.viewerId === me || room.expertId === me));
  useEffect(() => {
    if (!room || !isMember || unread === 0) return;
    const mark = () => {
      if (document.visibilityState === "visible") void roomService.markRead(room.id).catch(() => {});
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [room, isMember, unread]);

  // 새 메시지가 오면 맨 아래로.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  if (!room) {
    if (!hydrated || refreshed === "pending") {
      return <div className="px-6 py-10 text-sm text-muted-foreground">불러오는 중…</div>;
    }
    return (
      <div className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <MessagesSquare className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">채팅방을 찾을 수 없습니다.</p>
        {backHref && (
          <Button variant="outline" render={<Link href={backHref} />}>
            {backLabel ?? "돌아가기"}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="room-view">
      <RoomHeader
        room={room}
        side={side}
        backHref={backHref}
        backLabel={backLabel}
        backMobileOnly={backMobileOnly}
        isMember={isMember}
      />
      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6"
        data-testid="room-messages"
      >
        {messages.length === 0 ? (
          <p className="mx-auto max-w-sm py-10 text-center text-sm break-keep text-muted-foreground">
            {side === "owner"
              ? "세무사가 상담을 수락해 채팅방이 열렸습니다. 궁금한 점을 남겨 보세요."
              : "채팅방이 열렸습니다. 사장님께 먼저 인사를 건네 보세요."}
          </p>
        ) : (
          <ul className="mx-auto flex max-w-3xl flex-col gap-2">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} mine={m.senderId === me} />
            ))}
          </ul>
        )}
      </div>
      {room.status === "open" && isMember ? (
        <Composer roomId={room.id} />
      ) : (
        <p className="border-t px-4 py-3 text-center text-xs text-muted-foreground">
          {room.status === "closed"
            ? `채팅방이 닫혔습니다${room.closedAt ? ` (${formatDateTime(room.closedAt)})` : ""}. 이전 대화는 계속 볼 수 있습니다.`
            : "참여자만 메시지를 보낼 수 있습니다."}
        </p>
      )}
    </div>
  );
}

function RoomHeader({
  room,
  side,
  backHref,
  backLabel,
  backMobileOnly,
  isMember,
}: {
  room: ConsultationRoom;
  side: RoomSide;
  backHref?: string;
  backLabel?: string;
  backMobileOnly: boolean;
  isMember: boolean;
}) {
  const conversation = useConversationRecord(room.conversationId);
  const expertName = useAuditorRegistryStore(
    (s) => s.auditors.find((a) => a.id === room.expertId)?.displayName ?? room.expertId,
  );

  // 사장님 쪽: 상대 세무사 카드(아바타). 공개 프로필이 없으면 이름만.
  const [expert, setExpert] = useState<ExpertCard | null>(null);
  useEffect(() => {
    if (side !== "owner") return;
    let alive = true;
    expertService
      .listExperts(room.conversationId)
      .then((items) => alive && setExpert(items.find((e) => e.auditorId === room.expertId) ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [side, room.conversationId, room.expertId]);

  const [confirmClose, setConfirmClose] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onClose = async () => {
    setBusy(true);
    setError(null);
    try {
      await roomService.closeRoom(room.id);
      setConfirmClose(false);
    } catch (e) {
      setError(errorMessage(e, "채팅방을 닫지 못했습니다."));
    } finally {
      setBusy(false);
    }
  };

  const title =
    side === "owner"
      ? `${expertName} 세무사`
      : conversation?.ownerLabel || room.viewerId;
  const originHref =
    side === "owner"
      ? conversation
        ? `/chat/${conversation.occupation}?c=${encodeURIComponent(conversation.id)}`
        : null
      : room.origin === "request"
        ? `/audit/consultations/${encodeURIComponent(room.originId)}`
        : null;

  return (
    <header className="flex shrink-0 flex-col gap-2 border-b px-3 py-3 md:px-6">
      <div className="flex items-center gap-2">
        {backHref && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={backLabel ?? "목록으로"}
            className={backMobileOnly ? "md:hidden" : undefined}
            render={<Link href={backHref} />}
          >
            <ArrowLeft />
          </Button>
        )}
        {side === "owner" && (
          <ExpertAvatar
            expert={{
              displayName: expertName,
              avatarUrl: expert?.avatarUrl,
              avatarColor: expert?.avatarColor,
            }}
            className="size-8"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-sm font-semibold" data-testid="room-title">
              {title}
            </h1>
            <Badge variant={room.status === "open" ? "secondary" : "outline"} className="text-[10px]">
              {room.status === "open" ? "진행 중" : "닫힘"}
            </Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {conversation?.title ?? "AI 상담"}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {originHref && (
          <Button size="xs" variant="outline" render={<Link href={originHref} />}>
            {side === "owner" ? "원래 AI 상담 보기" : "신청·AI 상담 원문 보기"}
          </Button>
        )}
        {room.status === "open" && isMember &&
          (confirmClose ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-xs">채팅방을 닫을까요? 닫으면 양쪽 모두 메시지를 보낼 수 없습니다.</span>
              <Button size="xs" variant="destructive" disabled={busy} onClick={() => void onClose()}>
                닫기
              </Button>
              <Button size="xs" variant="ghost" disabled={busy} onClick={() => setConfirmClose(false)}>
                취소
              </Button>
            </span>
          ) : (
            <Button size="xs" variant="ghost" onClick={() => setConfirmClose(true)}>
              채팅방 닫기
            </Button>
          ))}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </header>
  );
}

function MessageBubble({ message, mine }: { message: RoomMessage; mine: boolean }) {
  const [busy, setBusy] = useState(false);
  const deleted = Boolean(message.deletedAt);
  return (
    <li
      className={cn("group flex flex-col gap-0.5", mine ? "items-end" : "items-start")}
      data-testid="room-message"
      data-mine={mine ? "true" : "false"}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-wrap md:max-w-[70%]",
          deleted
            ? "border border-dashed text-muted-foreground italic"
            : mine
              ? "bg-primary text-primary-foreground"
              : "bg-muted",
        )}
      >
        {deleted ? "삭제된 메시지입니다" : message.body}
      </div>
      <div className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground tabular-nums">
        {formatDateTime(message.createdAt)}
        {mine && !deleted && (
          <button
            type="button"
            aria-label="메시지 삭제"
            disabled={busy}
            className="rounded p-0.5 opacity-60 hover:opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100"
            onClick={async () => {
              if (!window.confirm("이 메시지를 지울까요? 상대에게도 삭제됨으로 보입니다.")) return;
              setBusy(true);
              try {
                await roomService.deleteMessage(message.id);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Trash2 className="size-3" />
          </button>
        )}
      </div>
    </li>
  );
}

function Composer({ roomId }: { roomId: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = text.trim();
  const tooLong = text.length > ROOM_MESSAGE_MAX;

  const send = async () => {
    if (!trimmed || tooLong || busy) return;
    setBusy(true);
    setError(null);
    try {
      await roomService.sendMessage(roomId, trimmed);
      setText("");
    } catch (e) {
      setError(errorMessage(e, "보내지 못했습니다."));
      // 상대가 방을 닫았는데 그 소식을 못 받았을 수 있다 — 방 상태를 다시 당겨 화면을 맞춘다.
      void roomService.refreshRoom(roomId).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="shrink-0 border-t px-3 py-2 md:px-6"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <Textarea
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // 한글 조합 중 Enter 는 조합 확정이다 — 보내지 않는다.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="메시지 입력 (Enter 보내기 · Shift+Enter 줄바꿈)"
          aria-label="메시지 입력"
          className="max-h-40 min-h-9 flex-1 resize-none"
          data-testid="room-input"
        />
        <Button type="submit" size="icon" disabled={!trimmed || tooLong || busy} aria-label="보내기">
          <Send />
        </Button>
      </div>
      {(error || tooLong) && (
        <p className="mx-auto mt-1 max-w-3xl text-xs text-destructive">
          {tooLong ? `메시지는 ${ROOM_MESSAGE_MAX.toLocaleString()}자까지 보낼 수 있습니다.` : error}
        </p>
      )}
    </form>
  );
}
