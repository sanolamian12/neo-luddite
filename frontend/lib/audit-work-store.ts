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

/**
 * 이 평가자가 이 대화의 일감을 이미 제출했는가 — 제출 뒤엔 자기 코멘트를 못 고친다.
 * ("제출 후에는 수정할 수 없습니다" — 제출 화면이 이미 약속하던 규칙을 실제로 강제)
 *
 * 잠금은 **평가자별**이다. 공용 보드라 한 대화를 여럿이 보는데, 내가 제출했다고 아직
 * 작성 중(draft)인 다른 평가자까지 막으면 안 된다. cancelled 는 제출로 치지 않는다.
 */
export function isMyAuditSubmitted(
  audits: Audit[],
  conversationId: string,
  auditorId: string,
): boolean {
  return audits.some(
    (a) =>
      a.conversationId === conversationId &&
      a.auditorId === auditorId &&
      a.status !== "draft" &&
      a.status !== "cancelled",
  );
}
