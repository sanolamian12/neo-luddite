"use client";

import { useEffect } from "react";
import { create } from "zustand";
import type { ConsultationRequest, ConsultationStatus } from "./poc-schema";
import { makeCollectionSync } from "./supabase/sync";

/**
 * 상담 신청 스토어 — Supabase `public.consultation_requests` 의 Realtime 캐시 (0034/0035).
 *
 * 누가 무엇을 보는지는 RLS 가 정한다: 사장님 = 본인 신청, 세무사 = 본인 앞 신청, admin = 전체.
 * 쓰기는 services/consultation.ts (신청 insert · transition_consultation RPC).
 */

interface ConsultationState {
  requests: ConsultationRequest[];
  hydrated: boolean;
  _upsert: (r: ConsultationRequest) => void;
  _remove: (id: string) => void;
}

export interface ConsultationRow {
  id: string;
  conversation_id: string;
  viewer_id: string;
  expert_id: string;
  message: string | null;
  status: ConsultationStatus;
  status_history: ConsultationRequest["statusHistory"] | null;
  created_at: number | string;
  updated_at: number | string;
}

export function rowToConsultation(r: ConsultationRow): ConsultationRequest {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    viewerId: r.viewer_id,
    expertId: r.expert_id,
    message: r.message ?? undefined,
    status: r.status,
    statusHistory: (r.status_history ?? []).map((h) => ({
      ...h,
      at: Number(h.at),
    })),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export const useConsultationStore = create<ConsultationState>()((set) => ({
  requests: [],
  hydrated: false,

  _upsert: (r) =>
    set((s) => {
      const idx = s.requests.findIndex((x) => x.id === r.id);
      if (idx === -1) return { requests: [...s.requests, r] };
      const next = [...s.requests];
      next[idx] = { ...next[idx], ...r };
      return { requests: next };
    }),

  _remove: (id) =>
    set((s) => ({ requests: s.requests.filter((x) => x.id !== id) })),
}));

const startSync = makeCollectionSync<ConsultationRow, ConsultationRequest>({
  table: "consultation_requests",
  rowToDomain: rowToConsultation,
  pkColumn: "id",
  setAll: (items) => useConsultationStore.setState({ requests: items }),
  applyUpsert: (item) => useConsultationStore.getState()._upsert(item),
  applyDelete: (pk) => useConsultationStore.getState()._remove(pk),
  onHydrated: () => useConsultationStore.setState({ hydrated: true }),
});

if (typeof window !== "undefined") startSync();

export function useConsultationHydrated(): boolean {
  const hydrated = useConsultationStore((s) => s.hydrated);
  useEffect(() => {
    startSync();
  }, []);
  return hydrated;
}
