"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { ledgerEntrySchema, type LedgerEntry } from "./poc-schema";
import auditorHistorySeed from "@/data/poc-seeds/auditor-history.json";

interface LedgerState {
  entries: LedgerEntry[];
  seedApplied: boolean;
  _append: (entry: LedgerEntry) => void;
  _removeBySource: (auditId: string) => void;
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

function loadLedgerSeeds(): LedgerEntry[] {
  const raw = (auditorHistorySeed as { ledger?: unknown }).ledger ?? [];
  if (!Array.isArray(raw)) return [];
  const out: LedgerEntry[] = [];
  const now = Date.now();
  for (const item of raw) {
    const parsed = ledgerEntrySchema.safeParse(item);
    if (!parsed.success) continue;
    const e = parsed.data;
    if (now - e.timestamp > 60 * 86_400_000) {
      e.timestamp = now - (5 + out.length * 2) * 86_400_000;
    }
    out.push(e);
  }
  return out;
}

export const useLedgerStore = create<LedgerState>()(
  persist(
    (set, get) => ({
      entries: [],
      seedApplied: false,
      _append: (entry) =>
        set((s) => ({ entries: [...s.entries, entry] })),
      _removeBySource: (auditId) =>
        set((s) => ({
          entries: s.entries.filter(
            (e) =>
              !(e.sourceRef.kind === "audit" && e.sourceRef.auditId === auditId),
          ),
        })),
      _hydrateSeeds: () => {
        if (get().seedApplied) return;
        const seeds = loadLedgerSeeds();
        set((s) => {
          const existing = new Set(s.entries.map((e) => e.id));
          const additions = seeds.filter((e) => !existing.has(e.id));
          return {
            entries: [...s.entries, ...additions],
            seedApplied: true,
          };
        });
      },
    }),
    {
      name: "ledger-store-v1",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : noopStorage,
      ),
      partialize: (s) => ({ entries: s.entries, seedApplied: s.seedApplied }),
    },
  ),
);

export function useLedgerHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  const hydrate = useLedgerStore((s) => s._hydrateSeeds);
  useEffect(() => {
    const apply = () => {
      hydrate();
      setHydrated(true);
    };
    if (useLedgerStore.persist.hasHydrated()) apply();
    const unsub = useLedgerStore.persist.onFinishHydration(apply);
    return unsub;
  }, [hydrate]);
  return hydrated;
}
