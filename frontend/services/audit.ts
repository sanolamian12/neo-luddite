"use client";

import { useAuditWorkStore } from "@/lib/audit-work-store";
import type { Audit, AuditStatus } from "@/lib/poc-schema";

/**
 * Audit (metadata wrapper) service.
 *
 * 라인 피드백 / 세션 평가 자체는 prototype 2 의 `lib/audit-store.ts` 가 conversationId 키로 보유.
 * 본 service 는 Audit 의 lifecycle(draft → submitted → reviewed → finalized) 만 다룬다.
 * P2 에서 두 store 를 auditId 기반으로 통합 마이그레이션 예정.
 */

export interface AuditFilter {
  auditorId?: string;
  taskId?: string;
  status?: AuditStatus;
  conversationId?: string;
}

export interface AuditListResult {
  items: Audit[];
  total: number;
}

export async function listMine(filter: AuditFilter): Promise<AuditListResult> {
  const store = useAuditWorkStore.getState();
  let items = [...store.audits];
  if (filter.auditorId) {
    items = items.filter((a) => a.auditorId === filter.auditorId);
  }
  if (filter.taskId) items = items.filter((a) => a.taskId === filter.taskId);
  if (filter.status) items = items.filter((a) => a.status === filter.status);
  if (filter.conversationId) {
    items = items.filter((a) => a.conversationId === filter.conversationId);
  }
  items.sort((a, b) => b.pickedAt - a.pickedAt);
  return { items, total: items.length };
}

export async function get(id: string): Promise<Audit | null> {
  const store = useAuditWorkStore.getState();
  return store.audits.find((a) => a.id === id) ?? null;
}

/** 진행도 캐시 갱신 (라인 피드백 / 세션 평가 변경 시 호출). */
export async function patchProgress(
  id: string,
  progress: Partial<Audit["progress"]>,
): Promise<Audit | null> {
  const store = useAuditWorkStore.getState();
  const current = store.audits.find((a) => a.id === id);
  if (!current) return null;
  store._patch(id, {
    progress: { ...current.progress, ...progress },
  });
  return useAuditWorkStore.getState().audits.find((a) => a.id === id) ?? null;
}

/** 제출 (P2 에서 본격 wiring; 여기서는 시그니처만 노출). */
export async function submit(id: string): Promise<Audit | null> {
  useAuditWorkStore.getState()._patch(id, {
    status: "submitted",
    submittedAt: Date.now(),
  });
  return get(id);
}

export interface AuditSummary {
  draft: number;
  submitted: number;
  reviewed: number;
  finalized: number;
}

export async function summaryByAuditor(auditorId: string): Promise<AuditSummary> {
  const { items } = await listMine({ auditorId });
  const summary: AuditSummary = {
    draft: 0,
    submitted: 0,
    reviewed: 0,
    finalized: 0,
  };
  for (const a of items) {
    if (a.status === "draft") summary.draft += 1;
    else if (a.status === "submitted") summary.submitted += 1;
    else if (a.status === "reviewed") summary.reviewed += 1;
    else if (a.status === "finalized") summary.finalized += 1;
  }
  return summary;
}
