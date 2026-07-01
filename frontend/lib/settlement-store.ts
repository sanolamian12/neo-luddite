"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { SettlementRound } from "./poc-schema";

interface SettlementState {
  rounds: SettlementRound[];
  _upsert: (round: SettlementRound) => void;
  _patch: (id: string, patch: Partial<SettlementRound>) => void;
}

const noopStorage: Storage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  key: () => null,
  length: 0,
};

export const useSettlementStore = create<SettlementState>()(
  persist(
    (set) => ({
      rounds: [],
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
    }),
    {
      name: "settlement-store-v1",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : noopStorage,
      ),
      partialize: (s) => ({ rounds: s.rounds }),
    },
  ),
);

export function useSettlementHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (useSettlementStore.persist.hasHydrated()) setHydrated(true);
    const unsub = useSettlementStore.persist.onFinishHydration(() =>
      setHydrated(true),
    );
    return unsub;
  }, []);
  return hydrated;
}
