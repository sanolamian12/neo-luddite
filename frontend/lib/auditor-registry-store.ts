"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { auditorEntrySchema, type AuditorEntry } from "./poc-schema";
import auditorsSeed from "@/data/poc-seeds/auditors.json";

interface AuditorRegistryState {
  auditors: AuditorEntry[];
  seedApplied: boolean;
  _upsert: (a: AuditorEntry) => void;
  _patch: (id: string, patch: Partial<AuditorEntry>) => void;
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

function loadSeeds(): AuditorEntry[] {
  const raw = (auditorsSeed as { auditors?: unknown }).auditors ?? [];
  if (!Array.isArray(raw)) return [];
  const out: AuditorEntry[] = [];
  const now = Date.now();
  for (const item of raw) {
    const parsed = auditorEntrySchema.safeParse(item);
    if (!parsed.success) continue;
    const e = parsed.data;
    // 시드의 timestamp 가 너무 과거(60일+)면 데모 가독성을 위해 최근 N일 전으로 보정
    if (now - e.createdAt > 60 * 86_400_000) {
      e.createdAt = now - (15 + out.length * 3) * 86_400_000;
    }
    if (e.lastActiveAt && now - e.lastActiveAt > 30 * 86_400_000) {
      e.lastActiveAt = now - (1 + out.length) * 86_400_000;
    }
    out.push(e);
  }
  return out;
}

export const useAuditorRegistryStore = create<AuditorRegistryState>()(
  persist(
    (set, get) => ({
      auditors: [],
      seedApplied: false,
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
      _hydrateSeeds: () => {
        if (get().seedApplied) return;
        const seeds = loadSeeds();
        set((s) => {
          const existing = new Set(s.auditors.map((a) => a.id));
          const additions = seeds.filter((a) => !existing.has(a.id));
          return {
            auditors: [...s.auditors, ...additions],
            seedApplied: true,
          };
        });
      },
    }),
    {
      name: "auditor-registry-store-v1",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : noopStorage,
      ),
      partialize: (s) => ({ auditors: s.auditors, seedApplied: s.seedApplied }),
    },
  ),
);

export function useAuditorRegistryHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  const hydrate = useAuditorRegistryStore((s) => s._hydrateSeeds);
  useEffect(() => {
    const apply = () => {
      hydrate();
      setHydrated(true);
    };
    if (useAuditorRegistryStore.persist.hasHydrated()) apply();
    const unsub = useAuditorRegistryStore.persist.onFinishHydration(apply);
    return unsub;
  }, [hydrate]);
  return hydrated;
}
