"use client";

import { useEffect } from "react";
import { create } from "zustand";
import type { AuditorEntry } from "./poc-schema";
import { makeCollectionSync } from "./supabase/sync";

/**
 * 평가자 레지스트리 스토어 — Supabase `public.auditors` 의 Realtime 캐시.
 * (구 localStorage persist + JSON seed → DB fetch + Realtime 구독으로 컷오버, §3-3)
 */

interface AuditorRegistryState {
  auditors: AuditorEntry[];
  /** 최초 DB fetch 완료 여부 (구 persist hydration 대체). */
  hydrated: boolean;
  _upsert: (a: AuditorEntry) => void;
  _patch: (id: string, patch: Partial<AuditorEntry>) => void;
  _remove: (id: string) => void;
}

/** DB row(snake) 형태. */
export interface AuditorRow {
  id: string;
  display_name: string;
  email: string;
  phone: string | null;
  qualifications: string[];
  status: AuditorEntry["status"];
  created_at: number;
  last_active_at: number | null;
  note: string | null;
}

/** row(snake) → 도메인(camel). */
export function rowToAuditor(r: AuditorRow): AuditorEntry {
  return {
    id: r.id,
    displayName: r.display_name,
    email: r.email,
    phone: r.phone ?? undefined,
    qualifications: r.qualifications,
    status: r.status,
    createdAt: Number(r.created_at),
    lastActiveAt: r.last_active_at != null ? Number(r.last_active_at) : undefined,
    note: r.note ?? undefined,
  };
}

export const useAuditorRegistryStore = create<AuditorRegistryState>()((set) => ({
  auditors: [],
  hydrated: false,

  _upsert: (a) =>
    set((s) => {
      const idx = s.auditors.findIndex((x) => x.id === a.id);
      if (idx === -1) return { auditors: [...s.auditors, a] };
      const next = [...s.auditors];
      next[idx] = { ...next[idx], ...a };
      return { auditors: next };
    }),

  _patch: (id, patch) =>
    set((s) => ({
      auditors: s.auditors.map((x) =>
        x.id === id ? { ...x, ...patch } : x,
      ),
    })),

  _remove: (id) =>
    set((s) => ({
      auditors: s.auditors.filter((x) => x.id !== id),
    })),
}));

const startSync = makeCollectionSync<AuditorRow, AuditorEntry>({
  table: "auditors",
  rowToDomain: rowToAuditor,
  pkColumn: "id",
  setAll: (items) => useAuditorRegistryStore.setState({ auditors: items }),
  applyUpsert: (item) => useAuditorRegistryStore.getState()._upsert(item),
  applyDelete: (pk) => useAuditorRegistryStore.getState()._remove(pk),
  onHydrated: () => useAuditorRegistryStore.setState({ hydrated: true }),
});

// 클라이언트 모듈 로드 시 동기화 시작(구 persist auto-rehydrate 타이밍과 동일).
if (typeof window !== "undefined") startSync();

/** 최초 DB 로드 완료 여부. (시그니처 불변 — 컴포넌트 무손상) */
export function useAuditorRegistryHydrated(): boolean {
  const hydrated = useAuditorRegistryStore((s) => s.hydrated);
  useEffect(() => {
    startSync();
  }, []);
  return hydrated;
}
