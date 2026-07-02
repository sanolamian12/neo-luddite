"use client";

import { useEffect } from "react";
import { create } from "zustand";
import type { Mail, MailRef } from "./poc-schema";
import { makeCollectionSync } from "./supabase/sync";

/**
 * 메일 스토어 — Supabase `public.mail` 의 Realtime 캐시.
 * (구 localStorage persist → DB fetch + Realtime 구독으로 컷오버, §3-3)
 */

interface MailState {
  mails: Mail[];
  /** 최초 DB fetch 완료 여부 (구 persist hydration 대체). */
  hydrated: boolean;
  _append: (mail: Mail) => void;
  _patch: (id: string, patch: Partial<Mail>) => void;
  _upsert: (mail: Mail) => void;
  _remove: (id: string) => void;
}

/** DB row(snake) 형태. */
export interface MailRow {
  id: string;
  recipient_id: string;
  sender_id: string;
  kind: Mail["kind"];
  subject: string;
  body: string;
  ref: MailRef | null;
  sent_at: number;
  read_at: number | null;
}

/** row(snake) → 도메인(camel). */
export function rowToMail(r: MailRow): Mail {
  return {
    id: r.id,
    recipientId: r.recipient_id,
    senderId: r.sender_id,
    kind: r.kind,
    subject: r.subject,
    body: r.body,
    ref: r.ref ?? undefined,
    sentAt: Number(r.sent_at),
    readAt: r.read_at ?? undefined,
  };
}

export const useMailStore = create<MailState>()((set) => ({
  mails: [],
  hydrated: false,

  _append: (mail) => set((s) => ({ mails: [...s.mails, mail] })),

  _patch: (id, patch) =>
    set((s) => ({
      mails: s.mails.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })),

  _upsert: (mail) =>
    set((s) => {
      const idx = s.mails.findIndex((m) => m.id === mail.id);
      if (idx === -1) return { mails: [...s.mails, mail] };
      const next = [...s.mails];
      next[idx] = { ...next[idx], ...mail };
      return { mails: next };
    }),

  _remove: (id) =>
    set((s) => ({ mails: s.mails.filter((m) => m.id !== id) })),
}));

const startSync = makeCollectionSync<MailRow, Mail>({
  table: "mail",
  rowToDomain: rowToMail,
  pkColumn: "id",
  setAll: (items) => useMailStore.setState({ mails: items }),
  applyUpsert: (item) => useMailStore.getState()._upsert(item),
  applyDelete: (pk) => useMailStore.getState()._remove(pk),
  onHydrated: () => useMailStore.setState({ hydrated: true }),
});

// 클라이언트 모듈 로드 시 동기화 시작(구 persist auto-rehydrate 타이밍과 동일).
if (typeof window !== "undefined") startSync();

/** 최초 DB 로드 완료 여부. (시그니처 불변 — 컴포넌트 무손상) */
export function useMailHydrated(): boolean {
  const hydrated = useMailStore((s) => s.hydrated);
  useEffect(() => {
    startSync();
  }, []);
  return hydrated;
}
