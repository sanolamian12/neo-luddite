"use client";

import { getSupabase } from "@/lib/supabase/client";
import { useAuditorRegistryStore } from "@/lib/auditor-registry-store";
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

/** 승인 취소 확인 창에 보여 줄 영향 건수(0050 admin_expert_revoke_preview). */
export interface RevokePreview {
  requestsPending: number;
  requestsAccepted: number;
  offersPending: number;
  roomsOpen: number;
  auditsDraft: number;
  auditsSubmitted: number;
  expertCases: number;
  sharedCases: number;
  ledgerEntries: number;
}

export interface RevokeResult {
  requestsDeclined: number;
  requestsCompleted: number;
  offersWithdrawn: number;
  roomsClosed: number;
  auditsCancelled: number;
  pickupsReleased: number;
  expertCasesArchived: number;
}

export async function revokePreview(id: string): Promise<RevokePreview> {
  const { data, error } = await getSupabase().rpc("admin_expert_revoke_preview", { p_domain: id });
  if (error) throw error;
  return data as RevokePreview;
}

/**
 * 세무사 승인 취소(0050 revoke_expert) — 진행 중 상담 정리·검수 draft 취소·카드 삭제·사례 보관·
 * 일반 회원 강등이 DB 한 트랜잭션에서 일어난다. 사유는 신청자가 /expert/apply 에서 본다.
 */
export async function revoke(id: string, reason: string): Promise<RevokeResult> {
  const { data, error } = await getSupabase().rpc("revoke_expert", { p_domain: id, p_reason: reason });
  if (error) throw error;
  useAuditorRegistryStore.getState()._patch(id, { status: "revoked", email: "", phone: undefined });
  return data as RevokeResult;
}

/** DB 예외 메시지 → 화면 문구. */
export function revokeErrorMessage(error: unknown): string {
  const message = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : "";
  const known: [RegExp, string][] = [
    [/reason is required/i, "취소 사유를 입력해 주세요."],
    [/reason too long/i, "사유는 500자 이내로 입력해 주세요."],
    [/already revoked/i, "이미 승인이 취소된 세무사예요."],
    [/only expert accounts/i, "세무사 계정만 승인을 취소할 수 있어요."],
    [/expert not found/i, "세무사 기록을 찾을 수 없어요."],
    [/admin only/i, "관리자만 할 수 있어요."],
  ];
  return known.find(([pattern]) => pattern.test(message))?.[1] ?? "처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
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
