"use client";

import { useEffect } from "react";
import { create } from "zustand";
import type { LedgerEntry, LedgerSource } from "./poc-schema";
import { makeCollectionSync } from "./supabase/sync";

/**
 * 기여 통장 원장 스토어 — Supabase `public.ledger_entries` 의 Realtime 캐시.
 * (구 localStorage persist + JSON seed → DB fetch + Realtime 구독으로 컷오버, §3-3)
 */

interface LedgerState {
  entries: LedgerEntry[];
  /** 최초 DB fetch 완료 여부 (구 persist hydration 대체). */
  hydrated: boolean;
  _append: (entry: LedgerEntry) => void;
  _upsert: (entry: LedgerEntry) => void;
  _remove: (id: string) => void;
  _removeBySource: (auditId: string) => void;
}

/** DB row(snake) 형태. */
export interface LedgerRow {
  id: string;
  auditor_id: string;
  kind: LedgerEntry["kind"];
  amount: number;
  source_ref: LedgerSource;
  balance_after: number;
  timestamp: number;
  note: string | null;
}

/** row(snake) → 도메인(camel). */
export function rowToEntry(r: LedgerRow): LedgerEntry {
  return {
    id: r.id,
    auditorId: r.auditor_id,
    kind: r.kind,
    amount: r.amount,
    sourceRef: r.source_ref,
    balanceAfter: r.balance_after,
    timestamp: Number(r.timestamp),
    note: r.note ?? undefined,
  };
}

export const useLedgerStore = create<LedgerState>()((set) => ({
  entries: [],
  hydrated: false,

  _append: (entry) => set((s) => ({ entries: [...s.entries, entry] })),

  _upsert: (entry) =>
    set((s) => {
      const idx = s.entries.findIndex((e) => e.id === entry.id);
      if (idx === -1) return { entries: [...s.entries, entry] };
      const next = [...s.entries];
      next[idx] = { ...next[idx], ...entry };
      return { entries: next };
    }),

  _remove: (id) =>
    set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),

  _removeBySource: (auditId) =>
    set((s) => ({
      entries: s.entries.filter(
        (e) =>
          !(e.sourceRef.kind === "audit" && e.sourceRef.auditId === auditId),
      ),
    })),
}));

const startSync = makeCollectionSync<LedgerRow, LedgerEntry>({
  table: "ledger_entries",
  rowToDomain: rowToEntry,
  pkColumn: "id",
  setAll: (items) => useLedgerStore.setState({ entries: items }),
  applyUpsert: (item) => useLedgerStore.getState()._upsert(item),
  applyDelete: (pk) => useLedgerStore.getState()._remove(pk),
  onHydrated: () => useLedgerStore.setState({ hydrated: true }),
});

// 클라이언트 모듈 로드 시 동기화 시작(구 persist auto-rehydrate 타이밍과 동일).
if (typeof window !== "undefined") startSync();

/** 최초 DB 로드 완료 여부. (시그니처 불변 — 컴포넌트 무손상) */
export function useLedgerHydrated(): boolean {
  const hydrated = useLedgerStore((s) => s.hydrated);
  useEffect(() => {
    startSync();
  }, []);
  return hydrated;
}
