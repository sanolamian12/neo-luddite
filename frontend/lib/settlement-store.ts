"use client";

import { useEffect } from "react";
import { create } from "zustand";
import type { SettlementRound, SettlementAllocation } from "./poc-schema";
import { makeCollectionSync } from "./supabase/sync";

/**
 * 정산 회차 스토어 — Supabase `public.settlement_rounds` 의 Realtime 캐시.
 * (구 localStorage persist + JSON seed → DB fetch + Realtime 구독으로 컷오버, §3-3)
 */

interface SettlementState {
  rounds: SettlementRound[];
  /** 최초 DB fetch 완료 여부 (구 persist hydration 대체). */
  hydrated: boolean;
  _upsert: (round: SettlementRound) => void;
  _patch: (id: string, patch: Partial<SettlementRound>) => void;
  _remove: (id: string) => void;
}

/** DB row(snake) 형태. */
export interface SettlementRoundRow {
  id: string;
  label: string;
  period_from: number;
  period_to: number;
  pool: number;
  distribution_model: SettlementRound["distributionModel"];
  allocations: SettlementAllocation[];
  status: SettlementRound["status"];
  created_at: number;
  created_by: string;
  published_at: number | null;
  note: string | null;
}

/** row(snake) → 도메인(camel). */
export function rowToRound(r: SettlementRoundRow): SettlementRound {
  return {
    id: r.id,
    label: r.label,
    periodFrom: Number(r.period_from),
    periodTo: Number(r.period_to),
    pool: r.pool,
    distributionModel: r.distribution_model,
    allocations: r.allocations,
    status: r.status,
    createdAt: Number(r.created_at),
    createdBy: r.created_by,
    publishedAt: r.published_at == null ? undefined : Number(r.published_at),
    note: r.note ?? undefined,
  };
}

export const useSettlementStore = create<SettlementState>()((set) => ({
  rounds: [],
  hydrated: false,

  _upsert: (round) =>
    set((s) => {
      const idx = s.rounds.findIndex((r) => r.id === round.id);
      if (idx === -1) return { rounds: [...s.rounds, round] };
      const next = [...s.rounds];
      next[idx] = { ...next[idx], ...round };
      return { rounds: next };
    }),

  _patch: (id, patch) =>
    set((s) => ({
      rounds: s.rounds.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    })),

  _remove: (id) =>
    set((s) => ({
      rounds: s.rounds.filter((r) => r.id !== id),
    })),
}));

const startSync = makeCollectionSync<SettlementRoundRow, SettlementRound>({
  table: "settlement_rounds",
  rowToDomain: rowToRound,
  pkColumn: "id",
  setAll: (items) => useSettlementStore.setState({ rounds: items }),
  applyUpsert: (item) => useSettlementStore.getState()._upsert(item),
  applyDelete: (pk) => useSettlementStore.getState()._remove(pk),
  onHydrated: () => useSettlementStore.setState({ hydrated: true }),
});

// 클라이언트 모듈 로드 시 동기화 시작(구 persist auto-rehydrate 타이밍과 동일).
if (typeof window !== "undefined") startSync();

/** 최초 DB 로드 완료 여부. (시그니처 불변 — 컴포넌트 무손상) */
export function useSettlementHydrated(): boolean {
  const hydrated = useSettlementStore((s) => s.hydrated);
  useEffect(() => {
    startSync();
  }, []);
  return hydrated;
}
