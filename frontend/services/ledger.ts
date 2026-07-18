"use client";

import { getSupabase } from "@/lib/supabase/client";
import { useLedgerStore, type LedgerRow } from "@/lib/ledger-store";
import type { LedgerEntry, LedgerKind, LedgerSource } from "@/lib/poc-schema";

/**
 * Ledger service — 기여 통장 원장.
 *
 * 추상 단위 `credit` 만 사용. 실 금액 정산은 PoC 범위 밖.
 *
 * 정책:
 * - contribution_accepted: 인정 1건당 +10 credit
 * - contribution_rejected: 0 credit (로그만 남김 — 인정률 통계용)
 * - settlement_round / bonus / adjustment: 값은 호출자가 결정
 */

const CREDIT_PER_ACCEPTANCE = 10;

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

/**
 * 최신 잔액을 DB 에서 직접 읽는다.
 *
 * ASYNC 인 이유: `recordReviewOutcome` 이 `append` 를 순차로 두 번 호출하고,
 * 각 호출은 직전 append 가 만든 running balance 를 봐야 한다. 스토어 캐시는
 * Realtime echo 로 비동기 갱신돼 stale 하므로, 매번 DB 의 최신 balance_after 를 읽는다.
 */
async function currentBalance(auditorId: string): Promise<number> {
  const { data, error } = await getSupabase()
    .from("ledger_entries")
    .select("balance_after")
    .eq("auditor_id", auditorId)
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? (data as { balance_after: number }).balance_after : 0;
}

export interface AppendInput {
  auditorId: string;
  kind: LedgerKind;
  amount: number;
  sourceRef: LedgerSource;
  note?: string;
  timestamp?: number;
}

export async function append(input: AppendInput): Promise<LedgerEntry> {
  const ts = input.timestamp ?? Date.now();
  const prev = await currentBalance(input.auditorId);
  const entry: LedgerEntry = {
    id: makeId("ledger"),
    auditorId: input.auditorId,
    kind: input.kind,
    amount: input.amount,
    sourceRef: input.sourceRef,
    balanceAfter: prev + input.amount,
    timestamp: ts,
    note: input.note,
  };
  const row: LedgerRow = {
    id: entry.id,
    auditor_id: entry.auditorId,
    kind: entry.kind,
    amount: entry.amount,
    source_ref: entry.sourceRef,
    balance_after: entry.balanceAfter,
    timestamp: entry.timestamp,
    note: entry.note ?? null,
  };
  const { error } = await getSupabase().from("ledger_entries").insert(row);
  if (error) throw error;
  // 낙관적 스토어 갱신 (Realtime echo 는 멱등).
  useLedgerStore.getState()._append(entry);
  return entry;
}

/**
 * Audit 검수 결과를 ledger 에 반영.
 * - accepted 마다 +CREDIT_PER_ACCEPTANCE
 * - rejected 는 정보용 entry (amount 0)
 *
 * 멱등성: 같은 auditId 의 audit-source entry 가 있으면 모두 제거 후 재작성.
 */
export async function recordReviewOutcome(input: {
  auditorId: string;
  auditId: string;
  acceptedCount: number;
  rejectedCount: number;
  timestamp?: number;
}): Promise<LedgerEntry[]> {
  // 기존 audit-source entry 제거 (재검수 / amend 보정용) — DB 먼저, 이어서 낙관적 갱신.
  const { error: delError } = await getSupabase()
    .from("ledger_entries")
    .delete()
    .eq("source_ref->>kind", "audit")
    .eq("source_ref->>auditId", input.auditId);
  if (delError) throw delError;
  useLedgerStore.getState()._removeBySource(input.auditId);

  const ts = input.timestamp ?? Date.now();
  const out: LedgerEntry[] = [];

  if (input.acceptedCount > 0) {
    out.push(
      await append({
        auditorId: input.auditorId,
        kind: "contribution_accepted",
        amount: CREDIT_PER_ACCEPTANCE * input.acceptedCount,
        sourceRef: {
          kind: "audit",
          auditId: input.auditId,
          acceptedCount: input.acceptedCount,
          rejectedCount: input.rejectedCount,
        },
        timestamp: ts,
      }),
    );
  }
  if (input.rejectedCount > 0) {
    out.push(
      await append({
        auditorId: input.auditorId,
        kind: "contribution_rejected",
        amount: 0,
        sourceRef: {
          kind: "audit",
          auditId: input.auditId,
          acceptedCount: input.acceptedCount,
          rejectedCount: input.rejectedCount,
        },
        timestamp: ts + 1, // 같은 timestamp 회피
      }),
    );
  }
  return out;
}

/**
 * 정성 평가(세션 총평) 검수 결과를 ledger 에 반영.
 *
 * 기여 환산: 총평 길이 100자당 1단위, 최대 10단위(audit-schema.evalContributionUnits).
 * 문장 단위 코멘트 1건 = 1단위와 같은 축이므로 단위당 같은 CREDIT_PER_ACCEPTANCE 를 곱한다.
 * 거절이면 기여 0 — 문장 단위의 contribution_rejected 와 같이 로그만 남긴다.
 *
 * 멱등성: 같은 evaluationId 의 entry 가 있으면 제거 후 재작성(재확정 보정용).
 */
export async function recordSessionEvalOutcome(input: {
  auditorId: string;
  evaluationId: string;
  conversationId: string;
  units: number;
  accepted: boolean;
  timestamp?: number;
}): Promise<LedgerEntry | null> {
  const { error: delError } = await getSupabase()
    .from("ledger_entries")
    .delete()
    .eq("source_ref->>kind", "session_eval")
    .eq("source_ref->>evaluationId", input.evaluationId);
  if (delError) throw delError;
  useLedgerStore.getState()._removeBySessionEval(input.evaluationId);

  const sourceRef: LedgerSource = {
    kind: "session_eval",
    evaluationId: input.evaluationId,
    conversationId: input.conversationId,
    units: input.units,
    accepted: input.accepted,
  };

  return append({
    auditorId: input.auditorId,
    kind: input.accepted ? "contribution_accepted" : "contribution_rejected",
    amount: input.accepted ? CREDIT_PER_ACCEPTANCE * input.units : 0,
    sourceRef,
    timestamp: input.timestamp ?? Date.now(),
    note: input.accepted
      ? `정성 평가 인정 (${input.units}단위)`
      : "정성 평가 거절",
  });
}

export interface LedgerSummary {
  totalCredit: number;
  acceptedCount: number;
  rejectedCount: number;
  acceptanceRate: number; // 0–1
  monthlyDelta: number;
  lastUpdatedAt: number | null;
}

export async function summary(auditorId: string): Promise<LedgerSummary> {
  const entries = useLedgerStore
    .getState()
    .entries.filter((e) => e.auditorId === auditorId);
  if (entries.length === 0) {
    return {
      totalCredit: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      acceptanceRate: 0,
      monthlyDelta: 0,
      lastUpdatedAt: null,
    };
  }
  const sorted = entries.slice().sort((a, b) => b.timestamp - a.timestamp);
  const totalCredit = sorted[0].balanceAfter;
  let accepted = 0;
  let rejected = 0;
  for (const e of entries) {
    if (e.sourceRef.kind === "audit") {
      accepted += e.sourceRef.acceptedCount;
      rejected += e.sourceRef.rejectedCount;
    }
  }
  // 중복 누적 (한 audit 이 accepted+rejected 두 entry 를 만들 수 있어 *2 됨) → /2 보정 안 함;
  // 대신 distinct auditId 로 집계.
  const auditMap = new Map<
    string,
    { accepted: number; rejected: number }
  >();
  for (const e of entries) {
    if (e.sourceRef.kind === "audit") {
      auditMap.set(e.sourceRef.auditId, {
        accepted: e.sourceRef.acceptedCount,
        rejected: e.sourceRef.rejectedCount,
      });
    }
  }
  accepted = 0;
  rejected = 0;
  for (const v of auditMap.values()) {
    accepted += v.accepted;
    rejected += v.rejected;
  }
  const acceptanceRate = accepted + rejected === 0 ? 0 : accepted / (accepted + rejected);

  // 이번 달 변동
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthlyDelta = entries
    .filter((e) => e.timestamp >= monthStart)
    .reduce((a, e) => a + e.amount, 0);

  return {
    totalCredit,
    acceptedCount: accepted,
    rejectedCount: rejected,
    acceptanceRate,
    monthlyDelta,
    lastUpdatedAt: sorted[0].timestamp,
  };
}

export async function listEntries(
  auditorId: string,
): Promise<{ items: LedgerEntry[]; total: number }> {
  const entries = useLedgerStore
    .getState()
    .entries.filter((e) => e.auditorId === auditorId)
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp);
  return { items: entries, total: entries.length };
}
