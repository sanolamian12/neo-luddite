"use client";

import { useEffect } from "react";
import { create } from "zustand";
import type { Inquiry, InquiryMessage } from "./poc-schema";
import { makeCollectionSync } from "./supabase/sync";

/**
 * 이의제기(Inquiry) 스토어 — Supabase `public.inquiries` 의 Realtime 캐시.
 * (구 localStorage persist → DB fetch + Realtime 구독으로 컷오버, §3-3)
 */

interface InquiryState {
  inquiries: Inquiry[];
  /** 최초 DB fetch 완료 여부 (구 persist hydration 대체). */
  hydrated: boolean;
  _upsert: (inquiry: Inquiry) => void;
  _patch: (id: string, patch: Partial<Inquiry>) => void;
  _appendMessage: (id: string, message: InquiryMessage) => void;
  _remove: (id: string) => void;
}

/** DB row(snake) 형태. */
export interface InquiryRow {
  id: string;
  audit_id: string;
  feedback_id: string | null;
  raised_by: string;
  raised_at: number;
  messages: InquiryMessage[];
  status: Inquiry["status"];
  amended_feedback_ids: string[];
}

/** row(snake) → 도메인(camel). */
export function rowToInquiry(r: InquiryRow): Inquiry {
  return {
    id: r.id,
    auditId: r.audit_id,
    feedbackId: r.feedback_id ?? undefined,
    raisedBy: r.raised_by,
    raisedAt: Number(r.raised_at),
    messages: r.messages,
    status: r.status,
    amendedFeedbackIds: r.amended_feedback_ids,
  };
}

export const useInquiryStore = create<InquiryState>()((set) => ({
  inquiries: [],
  hydrated: false,

  _upsert: (inquiry) =>
    set((s) => {
      const idx = s.inquiries.findIndex((q) => q.id === inquiry.id);
      if (idx === -1) return { inquiries: [...s.inquiries, inquiry] };
      const next = [...s.inquiries];
      next[idx] = { ...next[idx], ...inquiry };
      return { inquiries: next };
    }),

  _patch: (id, patch) =>
    set((s) => ({
      inquiries: s.inquiries.map((q) =>
        q.id === id ? { ...q, ...patch } : q,
      ),
    })),

  _appendMessage: (id, message) =>
    set((s) => ({
      inquiries: s.inquiries.map((q) =>
        q.id === id ? { ...q, messages: [...q.messages, message] } : q,
      ),
    })),

  _remove: (id) =>
    set((s) => ({
      inquiries: s.inquiries.filter((q) => q.id !== id),
    })),
}));

const startSync = makeCollectionSync<InquiryRow, Inquiry>({
  table: "inquiries",
  rowToDomain: rowToInquiry,
  pkColumn: "id",
  setAll: (items) => useInquiryStore.setState({ inquiries: items }),
  applyUpsert: (i) => useInquiryStore.getState()._upsert(i),
  applyDelete: (pk) => useInquiryStore.getState()._remove(pk),
  onHydrated: () => useInquiryStore.setState({ hydrated: true }),
});

// 클라이언트 모듈 로드 시 동기화 시작(구 persist auto-rehydrate 타이밍과 동일).
if (typeof window !== "undefined") startSync();

/** 최초 DB 로드 완료 여부. (시그니처 불변 — 컴포넌트 무손상) */
export function useInquiryHydrated(): boolean {
  const hydrated = useInquiryStore((s) => s.hydrated);
  useEffect(() => {
    startSync();
  }, []);
  return hydrated;
}
