"use client";

import { getSupabase } from "@/lib/supabase/client";
import type { ConsultationRoom, RoomMessage } from "@/lib/poc-schema";
import {
  rowToRoom,
  rowToRoomMessage,
  useRoomStore,
  type RoomMessageRow,
  type RoomRow,
} from "@/lib/room-store";

/**
 * 상담 채팅방 service (0038).
 *
 * - 방 개설은 여기 없다 — DB 의 open_room() 만 연다(경로 A = 세무사가 신청을 수락할 때).
 * - 메시지 insert 는 RLS(참여자 · 열린 방)가 막고, 보낸 사람·역할·시각은 DB 트리거가 채운다.
 * - 읽음 · 종료는 RPC. 반환 행을 스토어에 바로 반영한다(Realtime echo 는 멱등).
 */

function makeId(): string {
  return `rmsg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function sendMessage(roomId: string, body: string): Promise<RoomMessage> {
  const text = body.trim();
  const { data, error } = await getSupabase()
    .from("consultation_messages")
    // sender_id·sender_role·created_at 은 트리거가 덮어쓴다 — not null 을 채우려 넣을 뿐.
    .insert({ id: makeId(), room_id: roomId, sender_id: "-", sender_role: "user", body: text, created_at: 0 })
    .select("*")
    .single();
  if (error) throw error;
  const msg = rowToRoomMessage(data as RoomMessageRow);
  useRoomStore.getState()._upsertMessage(msg);
  return msg;
}

/** 본인 메시지 지우기(soft delete). 지운 시각은 DB 가 정한다. */
export async function deleteMessage(id: string): Promise<void> {
  const { data, error } = await getSupabase()
    .from("consultation_messages")
    .update({ deleted_at: Date.now() })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (data) useRoomStore.getState()._upsertMessage(rowToRoomMessage(data as RoomMessageRow));
}

export async function markRead(roomId: string): Promise<ConsultationRoom> {
  const { data, error } = await getSupabase().rpc("mark_room_read", { p_room_id: roomId });
  if (error) throw error;
  const room = rowToRoom(data as RoomRow);
  useRoomStore.getState()._upsertRoom(room);
  return room;
}

export async function closeRoom(roomId: string): Promise<ConsultationRoom> {
  const { data, error } = await getSupabase().rpc("close_room", { p_room_id: roomId });
  if (error) throw error;
  const room = rowToRoom(data as RoomRow);
  useRoomStore.getState()._upsertRoom(room);
  return room;
}

/**
 * (대화, 세무사) 쌍의 방을 직접 당긴다 — 수락 직후 방 INSERT 가 Realtime 으로 안 왔을 때의 대비.
 * 반환: 찾았으면 true.
 */
export async function fetchRoomFor(conversationId: string, expertId: string): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from("consultation_rooms")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("expert_id", expertId)
    .maybeSingle();
  if (error) throw error;
  if (data) useRoomStore.getState()._upsertRoom(rowToRoom(data as RoomRow));
  return Boolean(data);
}

/**
 * 방을 열 때 한 번 더 당긴다(설계 §7) — 구독이 늦게 붙었거나 끊겼던 사이의 메시지를 메운다.
 * 반환: 방이 보이면 true(참여자·admin), 아니면 false.
 */
export async function refreshRoom(roomId: string): Promise<boolean> {
  const sb = getSupabase();
  const [roomRes, msgRes] = await Promise.all([
    sb.from("consultation_rooms").select("*").eq("id", roomId).maybeSingle(),
    sb.from("consultation_messages").select("*").eq("room_id", roomId).order("created_at"),
  ]);
  if (roomRes.error) throw roomRes.error;
  if (msgRes.error) throw msgRes.error;
  const store = useRoomStore.getState();
  if (roomRes.data) store._upsertRoom(rowToRoom(roomRes.data as RoomRow));
  for (const row of (msgRes.data ?? []) as RoomMessageRow[]) store._upsertMessage(rowToRoomMessage(row));
  return Boolean(roomRes.data);
}
