"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { auditSchema, type Audit } from "./poc-schema";
import { makeCollectionSync } from "./supabase/sync";

/**
 * Audit metadata (pickup → submit → ...) 스토어 — Supabase `public.audits` 의
 * Realtime 캐시 (§3-3 컷오버).
 * 라인 피드백 / 세션 평가는 기존 audit-store(v1) 가 conversationId 키로 보유(A 범위 밖).
 */

interface AuditWorkState {
  audits: Audit[];
  hydrated: boolean;
  _upsert: (audit: Audit) => void;
  _patch: (id: string, patch: Partial<Audit>) => void;
  _remove: (id: string) => void;
}

export interface AuditRow {
  id: string;
  task_id: string;
  conversation_id: string;
  auditor_id: string;
  picked_at: number;
  submitted_at: number | null;
  status: Audit["status"];
  progress: Audit["progress"] | null;
}

export function rowToAudit(r: AuditRow): Audit {
  return {
    id: r.id,
    taskId: r.task_id,
    conversationId: r.conversation_id,
    auditorId: r.auditor_id,
    pickedAt: Number(r.picked_at),
    submittedAt: r.submitted_at != null ? Number(r.submitted_at) : undefined,
    status: r.status,
    progress: r.progress ?? {
      feedbackCount: 0,
      hasSessionEval: false,
      totalSegments: 0,
    },
  };
}

export const useAuditWorkStore = create<AuditWorkState>()((set) => ({
  audits: [],
  hydrated: false,

  _upsert: (audit) =>
    set((s) => {
      const valid = auditSchema.parse(audit);
      const idx = s.audits.findIndex((a) => a.id === valid.id);
      if (idx === -1) return { audits: [...s.audits, valid] };
      const next = [...s.audits];
      next[idx] = { ...next[idx], ...valid };
      return { audits: next };
    }),

  _patch: (id, patch) =>
    set((s) => ({
      audits: s.audits.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    })),

  _remove: (id) => set((s) => ({ audits: s.audits.filter((a) => a.id !== id) })),
}));

const startSync = makeCollectionSync<AuditRow, Audit>({
  table: "audits",
  rowToDomain: rowToAudit,
  pkColumn: "id",
  setAll: (items) => useAuditWorkStore.setState({ audits: items }),
  applyUpsert: (item) => useAuditWorkStore.getState()._upsert(item),
  applyDelete: (pk) => useAuditWorkStore.getState()._remove(pk),
  onHydrated: () => useAuditWorkStore.setState({ hydrated: true }),
});

if (typeof window !== "undefined") startSync();

export function useAuditWorkHydrated(): boolean {
  const hydrated = useAuditWorkStore((s) => s.hydrated);
  useEffect(() => {
    startSync();
  }, []);
  return hydrated;
}
