"use client";

import { useEffect } from "react";
import { create } from "zustand";
import type { AuditTask, TaskConditions, TaskPickup } from "./poc-schema";
import { makeCollectionSync } from "./supabase/sync";

/**
 * 감사 과제 스토어 — Supabase `public.audit_tasks` 의 Realtime 캐시 (§3-3 컷오버).
 */

interface AuditTaskState {
  tasks: AuditTask[];
  hydrated: boolean;
  _upsert: (task: AuditTask) => void;
  _patch: (id: string, patch: Partial<AuditTask>) => void;
  _remove: (id: string) => void;
}

export interface AuditTaskRow {
  id: string;
  label: string | null;
  conversation_ids: string[];
  capacity: number;
  conditions: TaskConditions | null;
  deadline: number;
  created_at: number;
  created_by: string;
  pickups: TaskPickup[] | null;
  status: AuditTask["status"];
  note: string | null;
}

export function rowToTask(r: AuditTaskRow): AuditTask {
  return {
    id: r.id,
    label: r.label ?? undefined,
    conversationIds: r.conversation_ids,
    capacity: r.capacity,
    conditions: r.conditions ?? undefined,
    deadline: Number(r.deadline),
    createdAt: Number(r.created_at),
    createdBy: r.created_by,
    pickups: r.pickups ?? [],
    status: r.status,
    note: r.note ?? undefined,
  };
}

export const useAuditTaskStore = create<AuditTaskState>()((set) => ({
  tasks: [],
  hydrated: false,

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

  _remove: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
}));

const startSync = makeCollectionSync<AuditTaskRow, AuditTask>({
  table: "audit_tasks",
  rowToDomain: rowToTask,
  pkColumn: "id",
  setAll: (items) => useAuditTaskStore.setState({ tasks: items }),
  applyUpsert: (item) => useAuditTaskStore.getState()._upsert(item),
  applyDelete: (pk) => useAuditTaskStore.getState()._remove(pk),
  onHydrated: () => useAuditTaskStore.setState({ hydrated: true }),
});

if (typeof window !== "undefined") startSync();

export function useAuditTaskHydrated(): boolean {
  const hydrated = useAuditTaskStore((s) => s.hydrated);
  useEffect(() => {
    startSync();
  }, []);
  return hydrated;
}
