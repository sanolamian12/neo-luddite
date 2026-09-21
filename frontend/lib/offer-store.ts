"use client";

import { useEffect } from "react";
import { create } from "zustand";
import type { ConsultationOffer, OfferStatus } from "./poc-schema";
import { makeCollectionSync } from "./supabase/sync";

/**
 * 연결 요청(제안) 스토어 — `public.consultation_offers` 의 Realtime 캐시 (0039).
 *
 * 누가 무엇을 보는지는 RLS 가 정한다: 세무사 = 본인이 건 요청, 사장님 = 본인 앞 요청, admin = 전체.
 * 쓰기는 services/offer.ts (make_offer · transition_offer RPC).
 * 만료(7일)는 pg_cron 없이 판정하므로, pending 이어도 expiresAt 이 지났으면 화면에선 만료로 본다
 * (`effectiveOfferStatus`). DB 는 그 행에 전이를 걸 때 expired 로 확정한다.
 */

interface OfferState {
  offers: ConsultationOffer[];
  hydrated: boolean;
  _upsert: (o: ConsultationOffer) => void;
  _remove: (id: string) => void;
}

export interface OfferRow {
  id: string;
  conversation_id: string;
  expert_id: string;
  viewer_id: string;
  message: string | null;
  status: OfferStatus;
  status_history: ConsultationOffer["statusHistory"] | null;
  created_at: number | string;
  updated_at: number | string;
  expires_at: number | string;
}

export function rowToOffer(r: OfferRow): ConsultationOffer {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    expertId: r.expert_id,
    viewerId: r.viewer_id,
    message: r.message ?? undefined,
    status: r.status,
    statusHistory: (r.status_history ?? []).map((h) => ({ ...h, at: Number(h.at) })),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    expiresAt: Number(r.expires_at),
  };
}

/** 화면에 보일 상태 — 기한이 지난 pending 은 만료. */
export function effectiveOfferStatus(o: ConsultationOffer, now: number = Date.now()): OfferStatus {
  return o.status === "pending" && o.expiresAt <= now ? "expired" : o.status;
}

export const useOfferStore = create<OfferState>()((set) => ({
  offers: [],
  hydrated: false,
  _upsert: (o) =>
    set((s) => {
      const idx = s.offers.findIndex((x) => x.id === o.id);
      if (idx === -1) return { offers: [...s.offers, o] };
      const next = [...s.offers];
      next[idx] = { ...next[idx], ...o };
      return { offers: next };
    }),
  _remove: (id) => set((s) => ({ offers: s.offers.filter((x) => x.id !== id) })),
}));

const startSync = makeCollectionSync<OfferRow, ConsultationOffer>({
  table: "consultation_offers",
  rowToDomain: rowToOffer,
  pkColumn: "id",
  setAll: (items) => useOfferStore.setState({ offers: items }),
  applyUpsert: (item) => useOfferStore.getState()._upsert(item),
  applyDelete: (pk) => useOfferStore.getState()._remove(pk),
  onHydrated: () => useOfferStore.setState({ hydrated: true }),
  waitForPostgresReady: true,
});

if (typeof window !== "undefined") startSync();

export function useOfferHydrated(): boolean {
  const hydrated = useOfferStore((s) => s.hydrated);
  useEffect(() => {
    startSync();
  }, []);
  return hydrated;
}

/** 사장님 앞 대기 중(만료 전) 요청 수 — 설정 메뉴 "세무사 연결 요청 N건". 적재 전이면 undefined. */
export function usePendingOffersFor(viewerId: string): number | undefined {
  const hydrated = useOfferHydrated();
  const n = useOfferStore(
    (s) =>
      s.offers.filter((o) => o.viewerId === viewerId && effectiveOfferStatus(o) === "pending").length,
  );
  return hydrated ? n : undefined;
}
