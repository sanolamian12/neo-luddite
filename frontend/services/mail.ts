"use client";

import { getSupabase } from "@/lib/supabase/client";
import { useMailStore } from "@/lib/mail-store";
import type { Mail, MailKind, MailRef } from "@/lib/poc-schema";

/**
 * Mail service — 공지 / 이의 답변 / 정산 안내 메일.
 *
 * 쓰기: Supabase `mail` 에 반영 + 낙관적 스토어 갱신(Realtime echo 는 멱등).
 * 읽기: Realtime 동기화된 스토어 캐시에서 필터/정렬 (형태·로직 불변, §3-3).
 */

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

export interface SendMailInput {
  recipientId: string;
  senderId: string;
  kind: MailKind;
  subject: string;
  body?: string;
  ref?: MailRef;
}

export async function send(input: SendMailInput): Promise<Mail> {
  const sb = getSupabase();
  const mail: Mail = {
    id: makeId("mail"),
    recipientId: input.recipientId,
    senderId: input.senderId,
    kind: input.kind,
    subject: input.subject,
    body: input.body ?? "",
    ref: input.ref,
    sentAt: Date.now(),
  };
  const row: Record<string, unknown> = {
    id: mail.id,
    recipient_id: mail.recipientId,
    sender_id: mail.senderId,
    kind: mail.kind,
    subject: mail.subject,
    body: mail.body,
    ref: mail.ref ?? null,
    sent_at: mail.sentAt,
    read_at: null,
  };
  const { error } = await sb.from("mail").insert(row);
  if (error) throw error;
  useMailStore.getState()._append(mail);
  return mail;
}

export interface MailFilter {
  recipientId?: string;
  kind?: MailKind;
  unreadOnly?: boolean;
}

export async function listInbox(
  filter: MailFilter,
): Promise<{ items: Mail[]; total: number }> {
  let items = useMailStore.getState().mails.slice();
  if (filter.recipientId)
    items = items.filter((m) => m.recipientId === filter.recipientId);
  if (filter.kind) items = items.filter((m) => m.kind === filter.kind);
  if (filter.unreadOnly) items = items.filter((m) => !m.readAt);
  items.sort((a, b) => b.sentAt - a.sentAt);
  return { items, total: items.length };
}

export async function get(id: string): Promise<Mail | null> {
  return useMailStore.getState().mails.find((m) => m.id === id) ?? null;
}

export async function markRead(id: string): Promise<Mail | null> {
  const sb = getSupabase();
  const readAt = Date.now();
  const { error } = await sb
    .from("mail")
    .update({ read_at: readAt })
    .eq("id", id);
  if (error) throw error;
  useMailStore.getState()._patch(id, { readAt });
  return get(id);
}
