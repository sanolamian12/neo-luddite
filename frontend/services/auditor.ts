"use client";

import { getSupabase } from "@/lib/supabase/client";
import {
  useAuditorRegistryStore,
  rowToAuditor,
  type AuditorRow,
} from "@/lib/auditor-registry-store";
import { useAuditWorkStore } from "@/lib/audit-work-store";
import { useLedgerStore } from "@/lib/ledger-store";
import type {
  AuditorEntry,
  AuditorStatus,
  LedgerEntry,
  Audit,
} from "@/lib/poc-schema";

/**
 * 평가자 (auditor registry) service.
 *
 * 세션 계정과 분리된 다중 평가자 데이터를 관리한다.
 * 모든 함수는 `Promise<T>` 반환 — 백엔드 연결 시 동일 시그니처로 fetch 교체.
 */

function makeAuditorId(): string {
  return `auditor-${Date.now().toString(36).slice(-4)}-${Math.random()
    .toString(36)
    .slice(2, 4)}`;
}

export interface AuditorFilter {
  status?: AuditorStatus;
  q?: string;
}

export interface AuditorListResult {
  items: AuditorEntry[];
  total: number;
}

export async function list(filter?: AuditorFilter): Promise<AuditorListResult> {
  let items = useAuditorRegistryStore.getState().auditors.slice();
  if (filter?.status) items = items.filter((a) => a.status === filter.status);
  if (filter?.q) {
    const q = filter.q.toLowerCase();
    items = items.filter(
      (a) =>
        a.id.toLowerCase().includes(q) ||
        a.displayName.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q),
    );
  }
  // active 먼저, 등록일 내림차순
  items.sort((a, b) => {
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;
    return b.createdAt - a.createdAt;
  });
  return { items, total: items.length };
}

export async function get(id: string): Promise<AuditorEntry | null> {
  return (
    useAuditorRegistryStore.getState().auditors.find((a) => a.id === id) ?? null
  );
}

export interface CreateAuditorInput {
  displayName: string;
  email: string;
  phone?: string;
  qualifications?: string[];
  note?: string;
  /** id 를 명시할 수 있다 (테스트/시드 시드). 비어 있으면 auto-id. */
  id?: string;
}

export async function create(input: CreateAuditorInput): Promise<AuditorEntry> {
  const sb = getSupabase();
  const store = useAuditorRegistryStore.getState();
  const id = input.id ?? makeAuditorId();
  if (store.auditors.some((a) => a.id === id)) {
    throw new Error(`이미 존재하는 평가자 ID: ${id}`);
  }
  const auditor: AuditorEntry = {
    id,
    displayName: input.displayName.trim(),
    email: input.email.trim(),
    phone: input.phone?.trim() || undefined,
    qualifications: input.qualifications ?? [],
    status: "active",
    createdAt: Date.now(),
    note: input.note?.trim() || undefined,
  };
  const { data, error } = await sb
    .from("auditors")
    .insert({
      id: auditor.id,
      display_name: auditor.displayName,
      email: auditor.email,
      phone: auditor.phone ?? null,
      qualifications: auditor.qualifications,
      status: auditor.status,
      created_at: auditor.createdAt,
      last_active_at: auditor.lastActiveAt ?? null,
      note: auditor.note ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  const created = rowToAuditor(data as AuditorRow);
  store._upsert(created);
  return created;
}

export async function suspend(id: string): Promise<AuditorEntry | null> {
  const sb = getSupabase();
  const { error } = await sb
    .from("auditors")
    .update({ status: "suspended" })
    .eq("id", id);
  if (error) throw error;
  useAuditorRegistryStore.getState()._patch(id, { status: "suspended" });
  return get(id);
}

export async function resume(id: string): Promise<AuditorEntry | null> {
  const sb = getSupabase();
  const { error } = await sb
    .from("auditors")
    .update({ status: "active" })
    .eq("id", id);
  if (error) throw error;
  useAuditorRegistryStore.getState()._patch(id, { status: "active" });
  return get(id);
}

export async function updateNote(
  id: string,
  note: string,
): Promise<AuditorEntry | null> {
  const sb = getSupabase();
  const trimmed = note.trim() || undefined;
  const { error } = await sb
    .from("auditors")
    .update({ note: trimmed ?? null })
    .eq("id", id);
  if (error) throw error;
  useAuditorRegistryStore.getState()._patch(id, { note: trimmed });
  return get(id);
}

// ── stats / 활동 집계 ──────────────────────────────────────────────────────────
export interface AuditorStats {
  totalAudits: number;
  draftCount: number;
  submittedCount: number;
  reviewedCount: number;
  finalizedCount: number;
  acceptedFeedbacks: number;
  rejectedFeedbacks: number;
  acceptanceRate: number; // 0–1
  totalCredit: number;
  lastActivityAt: number | null;
}

export async function stats(auditorId: string): Promise<AuditorStats> {
  const audits = useAuditWorkStore
    .getState()
    .audits.filter((a) => a.auditorId === auditorId);
  const ledger = useLedgerStore
    .getState()
    .entries.filter((e) => e.auditorId === auditorId);

  let accepted = 0;
  let rejected = 0;
  const auditMap = new Map<string, { accepted: number; rejected: number }>();
  for (const e of ledger) {
    if (e.sourceRef.kind === "audit") {
      auditMap.set(e.sourceRef.auditId, {
        accepted: e.sourceRef.acceptedCount,
        rejected: e.sourceRef.rejectedCount,
      });
    }
  }
  for (const v of auditMap.values()) {
    accepted += v.accepted;
    rejected += v.rejected;
  }

  const totalCredit = ledger
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp)[0]?.balanceAfter ?? 0;
  const acceptanceRate = accepted + rejected === 0 ? 0 : accepted / (accepted + rejected);

  const lastTs = Math.max(
    0,
    ...audits.map((a) => a.submittedAt ?? a.pickedAt),
    ...ledger.map((e) => e.timestamp),
  );

  return {
    totalAudits: audits.length,
    draftCount: audits.filter((a) => a.status === "draft").length,
    submittedCount: audits.filter((a) => a.status === "submitted").length,
    reviewedCount: audits.filter((a) => a.status === "reviewed").length,
    finalizedCount: audits.filter((a) => a.status === "finalized").length,
    acceptedFeedbacks: accepted,
    rejectedFeedbacks: rejected,
    acceptanceRate,
    totalCredit,
    lastActivityAt: lastTs > 0 ? lastTs : null,
  };
}

export interface AuditorListItemWithStats {
  auditor: AuditorEntry;
  stats: AuditorStats;
}

/** 목록 + 각 평가자의 stats 를 합쳐 반환 (UI 편의). */
export async function listWithStats(
  filter?: AuditorFilter,
): Promise<{ items: AuditorListItemWithStats[]; total: number }> {
  const { items } = await list(filter);
  const enriched = await Promise.all(
    items.map(async (a) => ({ auditor: a, stats: await stats(a.id) })),
  );
  return { items: enriched, total: enriched.length };
}

/** 디버그/Re-render 안전을 위한 동기 셀렉터 (컴포넌트는 service 함수 호출 후 결과를 store 처럼 다루지 말 것). */
export function auditsForAuditor(
  auditorId: string,
  audits: Audit[],
): Audit[] {
  return audits
    .filter((a) => a.auditorId === auditorId)
    .slice()
    .sort((a, b) => (b.submittedAt ?? b.pickedAt) - (a.submittedAt ?? a.pickedAt));
}

export function ledgerForAuditor(
  auditorId: string,
  entries: LedgerEntry[],
): LedgerEntry[] {
  return entries
    .filter((e) => e.auditorId === auditorId)
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp);
}
