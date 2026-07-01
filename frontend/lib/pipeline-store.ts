"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { TrainingBatch, ModelVersion } from "./poc-schema";

interface PipelineState {
  batches: TrainingBatch[];
  versions: ModelVersion[];
  _upsertBatch: (batch: TrainingBatch) => void;
  _patchBatch: (id: string, patch: Partial<TrainingBatch>) => void;
  _upsertVersion: (version: ModelVersion) => void;
  _patchVersion: (id: string, patch: Partial<ModelVersion>) => void;
}

const noopStorage: Storage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  key: () => null,
  length: 0,
};

export const usePipelineStore = create<PipelineState>()(
  persist(
    (set) => ({
      batches: [],
      versions: [],
      _upsertBatch: (batch) =>
        set((s) => {
          const idx = s.batches.findIndex((b) => b.id === batch.id);
          if (idx === -1) return { batches: [...s.batches, batch] };
          const next = [...s.batches];
          next[idx] = { ...next[idx], ...batch };
          return { batches: next };
        }),
      _patchBatch: (id, patch) =>
        set((s) => ({
          batches: s.batches.map((b) => (b.id === id ? { ...b, ...patch } : b)),
        })),
      _upsertVersion: (version) =>
        set((s) => {
          const idx = s.versions.findIndex((v) => v.id === version.id);
          if (idx === -1) return { versions: [...s.versions, version] };
          const next = [...s.versions];
          next[idx] = { ...next[idx], ...version };
          return { versions: next };
        }),
      _patchVersion: (id, patch) =>
        set((s) => ({
          versions: s.versions.map((v) => (v.id === id ? { ...v, ...patch } : v)),
        })),
    }),
    {
      name: "pipeline-store-v1",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : noopStorage,
      ),
      partialize: (s) => ({ batches: s.batches, versions: s.versions }),
    },
  ),
);

export function usePipelineHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (usePipelineStore.persist.hasHydrated()) setHydrated(true);
    const unsub = usePipelineStore.persist.onFinishHydration(() =>
      setHydrated(true),
    );
    return unsub;
  }, []);
  return hydrated;
}
