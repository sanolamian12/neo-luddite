"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { poolCandidateSchema, type PoolCandidate } from "./poc-schema";
import poolSeed from "@/data/poc-seeds/pool.json";

interface PoolState {
  candidates: PoolCandidate[];
  /** 클라이언트 측 hydration 기준 — 첫 마운트 시 seed 1회 merge */
  seedApplied: boolean;
  _upsert: (cand: PoolCandidate) => void;
  _patchByConversationId: (id: string, patch: Partial<PoolCandidate>) => void;
  _hydrateSeeds: () => void;
}

const noopStorage: Storage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  key: () => null,
  length: 0,
};

function loadSeeds(): PoolCandidate[] {
  const raw = (poolSeed as { candidates?: unknown }).candidates ?? [];
  if (!Array.isArray(raw)) return [];
  const out: PoolCandidate[] = [];
  const now = Date.now();
  for (const item of raw) {
    const parsed = poolCandidateSchema.safeParse(item);
    if (!parsed.success) continue;
    const c = parsed.data;
    // 시드의 addedAt 이 과거(>30일)면 데모 가독성을 위해 최근 N분~수시간 전으로 보정.
    if (now - c.addedAt > 30 * 86_400_000) {
      c.addedAt = now - (out.length + 1) * 60_000;
    }
    out.push(c);
  }
  return out;
}

export const usePoolStore = create<PoolState>()(
  persist(
    (set, get) => ({
      candidates: [],
      seedApplied: false,

      _upsert: (cand) =>
        set((s) => {
          const idx = s.candidates.findIndex(
            (c) => c.conversationId === cand.conversationId,
          );
          if (idx === -1) return { candidates: [...s.candidates, cand] };
          const next = [...s.candidates];
          next[idx] = { ...next[idx], ...cand };
          return { candidates: next };
        }),

      _patchByConversationId: (id, patch) =>
        set((s) => ({
          candidates: s.candidates.map((c) =>
            c.conversationId === id ? { ...c, ...patch } : c,
          ),
        })),

      _hydrateSeeds: () => {
        if (get().seedApplied) return;
        const seeds = loadSeeds();
        set((s) => {
          const existing = new Set(s.candidates.map((c) => c.conversationId));
          const additions = seeds.filter((c) => !existing.has(c.conversationId));
          return {
            candidates: [...s.candidates, ...additions],
            seedApplied: true,
          };
        });
      },
    }),
    {
      name: "pool-store-v1",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : noopStorage,
      ),
      partialize: (s) => ({
        candidates: s.candidates,
        seedApplied: s.seedApplied,
      }),
    },
  ),
);

export function usePoolHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  const hydrate = usePoolStore((s) => s._hydrateSeeds);
  useEffect(() => {
    const apply = () => {
      hydrate();
      setHydrated(true);
    };
    if (usePoolStore.persist.hasHydrated()) apply();
    const unsub = usePoolStore.persist.onFinishHydration(apply);
    return unsub;
  }, [hydrate]);
  return hydrated;
}
