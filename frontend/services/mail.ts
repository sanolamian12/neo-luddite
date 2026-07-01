"use client";

import { useMailStore } from "@/lib/mail-store";
import type { Mail, MailKind, MailRef } from "@/lib/poc-schema";

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
  useMailStore.getState()._patch(id, { readAt: Date.now() });
  return get(id);
}
