"use client";

import { getSupabase } from "@/lib/supabase/client";
import {
  useSettlementStore,
  rowToRound,
  type SettlementRoundRow,
} from "@/lib/settlement-store";
import { useLedgerStore } from "@/lib/ledger-store";
import { useAuditWorkStore } from "@/lib/audit-work-store";
import type {
  SettlementRound,
  SettlementAllocation,
  SettlementDistributionModel,
} from "@/lib/poc-schema";
import * as ledgerService from "./ledger";
import * as mailService from "./mail";

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

export interface SettlementPreviewInput {
  periodFrom: number;
  periodTo: number;
  pool: number;
  distributionModel: SettlementDistributionModel;
}

export interface SettlementPreview {
  allocations: SettlementAllocation[];
  totalAccepted: number;
  participants: number;
}

/**
 * 정산 회차 미리보기 — 지정 기간 내 인정 ledger entry 들을 평가자별로 집계하고
 * pool 을 분배 모델에 따라 나눈다.
 *
 * 분배 모델:
 *  - even: 참여자 1/N
 *  - weighted_by_count: 인정 건수 비례
 *
 * "포함된 기간 내 entry" = ledger entry timestamp 가 [from, to] 안에 있고
 * kind === contribution_accepted 이며, settlement_round 에 포함되지 않은 것.
 */
export async function preview(
  input: SettlementPreviewInput,
): Promise<SettlementPreview> {
  const entries = useLedgerStore.getState().entries;
  const previouslyIncluded = new Set<string>();
  for (const e of entries) {
    if (e.sourceRef.kind === "settlement") {
      for (const a of e.sourceRef.includedAuditIds) previouslyIncluded.add(a);
    }
  }

  const groupedByAuditor = new Map<
    string,
    { acceptedCount: number; auditIds: Set<string> }
  >();

  for (const e of entries) {
    if (e.kind !== "contribution_accepted") continue;
    if (e.timestamp < input.periodFrom || e.timestamp > input.periodTo) continue;
    if (e.sourceRef.kind !== "audit") continue;
    if (previouslyIncluded.has(e.sourceRef.auditId)) continue;
    const g = groupedByAuditor.get(e.auditorId) ?? {
      acceptedCount: 0,
      auditIds: new Set<string>(),
    };
    g.acceptedCount += e.sourceRef.acceptedCount;
    g.auditIds.add(e.sourceRef.auditId);
    groupedByAuditor.set(e.auditorId, g);
  }

  const participants = groupedByAuditor.size;
  const totalAccepted = [...groupedByAuditor.values()].reduce(
    (a, g) => a + g.acceptedCount,
    0,
  );

  const allocations: SettlementAllocation[] = [];
  if (input.distributionModel === "even") {
    const each = participants > 0 ? Math.floor(input.pool / participants) : 0;
    for (const [auditorId, g] of groupedByAuditor) {
      allocations.push({
        auditorId,
        acceptedCount: g.acceptedCount,
        amount: each,
        includedAuditIds: Array.from(g.auditIds),
      });
    }
  } else {
    for (const [auditorId, g] of groupedByAuditor) {
      const share = totalAccepted > 0 ? g.acceptedCount / totalAccepted : 0;
      allocations.push({
        auditorId,
        acceptedCount: g.acceptedCount,
        amount: Math.floor(input.pool * share),
        includedAuditIds: Array.from(g.auditIds),
      });
    }
  }

  // 정렬: amount 큰 순
  allocations.sort((a, b) => b.amount - a.amount);

  return { allocations, totalAccepted, participants };
}

export interface PublishInput extends SettlementPreviewInput {
  label: string;
  createdBy: string;
  note?: string;
}

export async function publish(input: PublishInput): Promise<SettlementRound> {
  const previewResult = await preview(input);
  const round: SettlementRound = {
    id: makeId("round"),
    label: input.label,
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    pool: input.pool,
    distributionModel: input.distributionModel,
    allocations: previewResult.allocations,
    status: "published",
    createdAt: Date.now(),
    publishedAt: Date.now(),
    createdBy: input.createdBy,
    note: input.note,
  };
  const sb = getSupabase();
  const { data, error } = await sb
    .from("settlement_rounds")
    .insert({
      id: round.id,
      label: round.label,
      period_from: round.periodFrom,
      period_to: round.periodTo,
      pool: round.pool,
      distribution_model: round.distributionModel,
      allocations: round.allocations,
      status: round.status,
      created_at: round.createdAt,
      created_by: round.createdBy,
      published_at: round.publishedAt ?? null,
      note: round.note ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  const saved = rowToRound(data as SettlementRoundRow);
  useSettlementStore.getState()._upsert(saved);

  // ledger entry + mail 발송 per 평가자
  for (const a of round.allocations) {
    await ledgerService.append({
      auditorId: a.auditorId,
      kind: "settlement_round",
      amount: a.amount,
      sourceRef: {
        kind: "settlement",
        roundId: round.id,
        includedAuditIds: a.includedAuditIds,
      },
      timestamp: round.publishedAt,
    });
    await mailService.send({
      recipientId: a.auditorId,
      senderId: input.createdBy,
      kind: "settlement",
      subject: `${input.label} 회차 정산 안내`,
      body: `회차 ${input.label}\n포함 audit: ${a.includedAuditIds.length}건\n인정 피드백: ${a.acceptedCount}건\n분배 credit: +${a.amount}\n분배 모델: ${input.distributionModel}`,
      ref: { kind: "settlement", roundId: round.id },
    });
  }

  return round;
}

export async function list(): Promise<{
  items: SettlementRound[];
  total: number;
}> {
  const items = useSettlementStore
    .getState()
    .rounds.slice()
    .sort((a, b) => b.createdAt - a.createdAt);
  return { items, total: items.length };
}

export async function get(id: string): Promise<SettlementRound | null> {
  return (
    useSettlementStore.getState().rounds.find((r) => r.id === id) ?? null
  );
}

/** 평가자별로 회차에서 받은 분배만 따로 조회 (auditor ledger 상세에서 사용). */
export async function getRoundsForAuditor(
  auditorId: string,
): Promise<SettlementRound[]> {
  void useAuditWorkStore.getState().audits; // 의존성 placeholder
  return useSettlementStore
    .getState()
    .rounds.filter((r) =>
      r.allocations.some((a) => a.auditorId === auditorId),
    )
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
}
