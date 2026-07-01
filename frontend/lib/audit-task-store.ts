"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { auditTaskSchema, type AuditTask } from "./poc-schema";
import tasksSeed from "@/data/poc-seeds/audit-tasks.json";

interface AuditTaskState {
  tasks: AuditTask[];
  seedApplied: boolean;
  _upsert: (task: AuditTask) => void;
  _patch: (id: string, patch: Partial<AuditTask>) => void;
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

function loadSeeds(): AuditTask[] {
  const raw = (tasksSeed as { tasks?: unknown }).tasks ?? [];
  if (!Array.isArray(raw)) return [];
  const out: AuditTask[] = [];
  // 데모를 위해 시드의 deadline 이 과거이면 오늘+N일로 보정.
  const now = Date.now();
  for (const item of raw) {
    const parsed = auditTaskSchema.safeParse(item);
    if (!parsed.success) continue;
    const t = parsed.data;
    if (t.deadline < now) {
      // 시드의 createdAt → deadline 간격을 유지한 채 today 로 anchor 이동
      const span = Math.max(86_400_000, t.deadline - t.createdAt);
      t.createdAt = now;
      t.deadline = now + span;
    }
    out.push(t);
  }
  return out;
}

export const useAuditTaskStore = create<AuditTaskState>()(
  persist(
    (set, get) => ({
      tasks: [],
      seedApplied: false,

      _upsert: (task) =>
        set((s) => {
          const idx = s.tasks.findIndex((t) => t.id === task.id);
          if (idx === -1) return { tasks: [...s.tasks, task] };
          const next = [...s.tasks];
          next[idx] = { ...next[idx], ...task };
          return { tasks: next };
        }),

      _patch: (id, patch) =>
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        })),

      _hydrateSeeds: () => {
        if (get().seedApplied) return;
        const seeds = loadSeeds();
        set((s) => {
          const existing = new Set(s.tasks.map((t) => t.id));
          const additions = seeds.filter((t) => !existing.has(t.id));
          return {
            tasks: [...s.tasks, ...additions],
            seedApplied: true,
          };
        });
      },
    }),
    {
      name: "audit-task-store-v1",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : noopStorage,
      ),
      partialize: (s) => ({
        tasks: s.tasks,
        seedApplied: s.seedApplied,
      }),
    },
  ),
);

export function useAuditTaskHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  const hydrate = useAuditTaskStore((s) => s._hydrateSeeds);
  useEffect(() => {
    const apply = () => {
      hydrate();
      setHydrated(true);
    };
    if (useAuditTaskStore.persist.hasHydrated()) apply();
    const unsub = useAuditTaskStore.persist.onFinishHydration(apply);
    return unsub;
  }, [hydrate]);
  return hydrated;
}
