"use client";

import { useEffect } from "react";
import { create } from "zustand";
import type { ConsultationRoom, RoomAgentRun, RoomMessage } from "./poc-schema";
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
  /** 세무사 AI 호출(0044) — 내 방 것만(RLS). */
  runs: RoomAgentRun[];
  roomsHydrated: boolean;
  messagesHydrated: boolean;
  _upsertRun: (r: RoomAgentRun) => void;
  _removeRun: (triggerMessageId: string) => void;
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
  agent_reply_customer?: boolean;
  agent_reply_expert?: boolean;
}

export interface RoomAgentRunRow {
  trigger_message_id: string;
  room_id: string;
  status: RoomAgentRun["status"];
  attempts: number;
  started_at: number | string;
  finished_at: number | string | null;
  reply_message_id: string | null;
  error: string | null;
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
    // 0044 기본값과 같게 — 칸이 없으면(적용 전) 고객 ON · 세무사 OFF 로 읽는다.
    agentReplyCustomer: r.agent_reply_customer ?? true,
    agentReplyExpert: r.agent_reply_expert ?? false,
  };
}

export function rowToRoomAgentRun(r: RoomAgentRunRow): RoomAgentRun {
  return {
    triggerMessageId: r.trigger_message_id,
    roomId: r.room_id,
    status: r.status,
    attempts: Number(r.attempts),
    startedAt: Number(r.started_at),
    finishedAt: num(r.finished_at),
    replyMessageId: r.reply_message_id ?? undefined,
    error: r.error ?? undefined,
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
  runs: [],
  roomsHydrated: false,
  messagesHydrated: false,
  _upsertRoom: (r) => set((s) => ({ rooms: upsertById(s.rooms, r) })),
  _removeRoom: (id) => set((s) => ({ rooms: s.rooms.filter((x) => x.id !== id) })),
  _upsertMessage: (m) => set((s) => ({ messages: upsertById(s.messages, m) })),
  _removeMessage: (id) => set((s) => ({ messages: s.messages.filter((x) => x.id !== id) })),
  _upsertRun: (r) =>
    set((s) => {
      const i = s.runs.findIndex((x) => x.triggerMessageId === r.triggerMessageId);
      if (i === -1) return { runs: [...s.runs, r] };
      const next = [...s.runs];
      next[i] = { ...next[i], ...r };
      return { runs: next };
    }),
  _removeRun: (id) => set((s) => ({ runs: s.runs.filter((x) => x.triggerMessageId !== id) })),
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

// 대기 표시용(0044). 적재 완료 플래그는 따로 두지 않는다 — 없으면 '대기 중 아님'으로 그릴 뿐이다.
const startRunSync = makeCollectionSync<RoomAgentRunRow, RoomAgentRun>({
  table: "room_agent_runs",
  rowToDomain: rowToRoomAgentRun,
  pkColumn: "trigger_message_id",
  setAll: (items) => useRoomStore.setState({ runs: items }),
  applyUpsert: (item) => useRoomStore.getState()._upsertRun(item),
  applyDelete: (pk) => useRoomStore.getState()._removeRun(pk),
  onHydrated: () => {},
  waitForPostgresReady: true,
});

if (typeof window !== "undefined") {
  startRoomSync();
  startMessageSync();
  startRunSync();
}

/** 방·메시지 둘 다 적재됐는가. */
export function useRoomsHydrated(): boolean {
  const rooms = useRoomStore((s) => s.roomsHydrated);
  const messages = useRoomStore((s) => s.messagesHydrated);
  useEffect(() => {
    startRoomSync();
    startMessageSync();
    startRunSync();
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

/** 방 정렬: 열린 방 먼저, 그 안에서 최근 메시지(없으면 개설) 순. 세무사 방 목록·사장님 사이드바가 같이 쓴다. */
export function sortRooms(rooms: ConsultationRoom[]): ConsultationRoom[] {
  return [...rooms].sort((a, b) => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    return (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt);
  });
}

/** 내 방 전체의 안 읽음 수 — 사이드바 뱃지. */
export function useMyRoomUnread(me: string): number | undefined {
  const hydrated = useRoomsHydrated();
  const count = useRoomStore((s) =>
    s.rooms.reduce((sum, r) => sum + unreadInRoom(r, s.messages, me), 0),
  );
  return hydrated ? count : undefined;
}
