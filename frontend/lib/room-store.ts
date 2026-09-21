"use client";

import { useEffect } from "react";
import { create } from "zustand";
import type { ConsultationRoom, RoomMessage } from "./poc-schema";
import { makeCollectionSync } from "./supabase/sync";

/**
 * 상담 채팅방 스토어 — `public.consultation_rooms` · `consultation_messages` 의 Realtime 캐시 (0038).
 *
 * 누가 무엇을 보는지는 RLS 가 정한다: 방 참여자(사장님·세무사) + admin(읽기만).
 * 메시지는 내 방 전체를 한 컬렉션으로 들고 있다 — 안 읽음 수를 사이드바에서 세려면 방 밖에서도
 * 메시지가 보여야 한다. 방 화면은 열 때 그 방을 한 번 더 당긴다(설계 §7, services/room.ts).
 * 쓰기는 services/room.ts (메시지 insert · mark_room_read · close_room RPC).
 */

interface RoomState {
  rooms: ConsultationRoom[];
  messages: RoomMessage[];
  roomsHydrated: boolean;
  messagesHydrated: boolean;
  _upsertRoom: (r: ConsultationRoom) => void;
  _removeRoom: (id: string) => void;
  _upsertMessage: (m: RoomMessage) => void;
  _removeMessage: (id: string) => void;
}

export interface RoomRow {
  id: string;
  conversation_id: string;
  viewer_id: string;
  expert_id: string;
  origin: ConsultationRoom["origin"];
  origin_id: string;
  status: ConsultationRoom["status"];
  created_at: number | string;
  closed_at: number | string | null;
  last_message_at: number | string | null;
  viewer_last_read_at: number | string | null;
  expert_last_read_at: number | string | null;
}

export interface RoomMessageRow {
  id: string;
  room_id: string;
  sender_id: string;
  sender_role: RoomMessage["senderRole"];
  body: string;
  created_at: number | string;
  deleted_at: number | string | null;
}

const num = (v: number | string | null | undefined) => (v == null ? undefined : Number(v));

export function rowToRoom(r: RoomRow): ConsultationRoom {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    viewerId: r.viewer_id,
    expertId: r.expert_id,
    origin: r.origin,
    originId: r.origin_id,
    status: r.status,
    createdAt: Number(r.created_at),
    closedAt: num(r.closed_at),
    lastMessageAt: num(r.last_message_at),
    viewerLastReadAt: num(r.viewer_last_read_at),
    expertLastReadAt: num(r.expert_last_read_at),
  };
}

export function rowToRoomMessage(r: RoomMessageRow): RoomMessage {
  return {
    id: r.id,
    roomId: r.room_id,
    senderId: r.sender_id,
    senderRole: r.sender_role,
    body: r.body,
    createdAt: Number(r.created_at),
    deletedAt: num(r.deleted_at),
  };
}

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx === -1) return [...list, item];
  const next = [...list];
  next[idx] = { ...next[idx], ...item };
  return next;
}

export const useRoomStore = create<RoomState>()((set) => ({
  rooms: [],
  messages: [],
  roomsHydrated: false,
  messagesHydrated: false,
  _upsertRoom: (r) => set((s) => ({ rooms: upsertById(s.rooms, r) })),
  _removeRoom: (id) => set((s) => ({ rooms: s.rooms.filter((x) => x.id !== id) })),
  _upsertMessage: (m) => set((s) => ({ messages: upsertById(s.messages, m) })),
  _removeMessage: (id) => set((s) => ({ messages: s.messages.filter((x) => x.id !== id) })),
}));

const startRoomSync = makeCollectionSync<RoomRow, ConsultationRoom>({
  table: "consultation_rooms",
  rowToDomain: rowToRoom,
  pkColumn: "id",
  setAll: (items) => useRoomStore.setState({ rooms: items }),
  applyUpsert: (item) => useRoomStore.getState()._upsertRoom(item),
  applyDelete: (pk) => useRoomStore.getState()._removeRoom(pk),
  onHydrated: () => useRoomStore.setState({ roomsHydrated: true }),
  // 수락 직후 생긴 방·막 도착한 메시지를 적재 틈에서 잃지 않게(sync.ts 설명).
  waitForPostgresReady: true,
});

const startMessageSync = makeCollectionSync<RoomMessageRow, RoomMessage>({
  table: "consultation_messages",
  rowToDomain: rowToRoomMessage,
  pkColumn: "id",
  setAll: (items) => useRoomStore.setState({ messages: items }),
  applyUpsert: (item) => useRoomStore.getState()._upsertMessage(item),
  applyDelete: (pk) => useRoomStore.getState()._removeMessage(pk),
  onHydrated: () => useRoomStore.setState({ messagesHydrated: true }),
  waitForPostgresReady: true,
});

if (typeof window !== "undefined") {
  startRoomSync();
  startMessageSync();
}

/** 방·메시지 둘 다 적재됐는가. */
export function useRoomsHydrated(): boolean {
  const rooms = useRoomStore((s) => s.roomsHydrated);
  const messages = useRoomStore((s) => s.messagesHydrated);
  useEffect(() => {
    startRoomSync();
    startMessageSync();
  }, []);
  return rooms && messages;
}

/** 내가 이 방에서 마지막으로 읽은 시각(참여자가 아니면 undefined). */
export function myLastReadAt(room: ConsultationRoom, me: string): number | undefined {
  if (room.viewerId === me) return room.viewerLastReadAt;
  if (room.expertId === me) return room.expertLastReadAt;
  return undefined;
}

/** 이 방에서 내가 안 읽은 상대 메시지 수. */
export function unreadInRoom(room: ConsultationRoom, messages: RoomMessage[], me: string): number {
  if (room.viewerId !== me && room.expertId !== me) return 0;
  const readAt = myLastReadAt(room, me) ?? 0;
  let n = 0;
  for (const m of messages) {
    if (m.roomId === room.id && m.senderId !== me && !m.deletedAt && m.createdAt > readAt) n++;
  }
  return n;
}

/** 내 방 전체의 안 읽음 수 — 사이드바 뱃지. */
export function useMyRoomUnread(me: string): number | undefined {
  const hydrated = useRoomsHydrated();
  const count = useRoomStore((s) =>
    s.rooms.reduce((sum, r) => sum + unreadInRoom(r, s.messages, me), 0),
  );
  return hydrated ? count : undefined;
}
