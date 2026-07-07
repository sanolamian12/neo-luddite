"use client";

import { getSupabase } from "@/lib/supabase/client";
import {
  useSettlementStore,
  rowToRound,
  type SettlementRoundRow,
} from "@/lib/settlement-store";
import { useAuditWorkStore } from "@/lib/audit-work-store";
import type {
  SettlementRound,
  SettlementAllocation,
  SettlementDistributionModel,
} from "@/lib/poc-schema";
import * as ledgerService from "./ledger";
import * as mailService from "./mail";
import * as ragService from "./rag";

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
 * 정산 회차 미리보기 — **살아있는 RAG 기여도**(존속연동)를 평가자별로 집계하고
 * pool 을 분배 모델에 따라 나눈다.
 *
 * 분배 기준(2026-07-07 존속연동, 메모리 project_operational_flow):
 * 종전 ledger 인정건수 → `rag.passages status='active'` 의 auditor_id 별 count 로 교체.
 * 포장실에서 연결끊기(retract)하면 그 passage 가 집계에서 빠져 해당 세무사 기여도가
 * 자동 감소한다 → "버려지면 기여도 소멸"이 별도 저장이 아니라 **이 조회의 파생**으로
 * 성립. periodFrom/To 는 created_at 스코프(그 기간에 생성됐고 지금도 살아있는 기여만) →
 * 회차 기간이 안 겹치면 중복지급도 자연 방지(구 settle-once dedup 대체).
 *
 * 분배 모델:
 *  - even: 참여자(활성 기여 보유) 1/N
 *  - weighted_by_count: 활성 기여(passage) 수 비례
 *
 * 백엔드(Seam A) 미기동/미설정이면 기여 없음으로 처리(폼이 '대상 없음' 표시).
 * `SettlementAllocation.acceptedCount` 는 이제 **활성 기여 passage 수**를 담는다.
 * includedAuditIds 는 RAG 스냅샷 기준이라 비운다(집계는 auditor_id 파생, audit 단위 아님).
 */
export async function preview(
  input: SettlementPreviewInput,
): Promise<SettlementPreview> {
  let contributions: ragService.ContributionCount[] = [];
  try {
    const res = await ragService.listContributions(
      input.periodFrom,
      input.periodTo,
    );
    contributions = res.dbConfigured ? res.contributions : [];
  } catch {
    // 백엔드 미기동/미설정 → 기여 없음(폼이 빈 미리보기로 처리). 정산 발행은 막지 않되
    // participants=0 이면 폼에서 발행 버튼이 거른다.
    contributions = [];
  }

  const active = contributions.filter((c) => c.activeCount > 0);
  const participants = active.length;
  const totalAccepted = active.reduce((a, c) => a + c.activeCount, 0);

  const allocations: SettlementAllocation[] = [];
  if (input.distributionModel === "even") {
    const each = participants > 0 ? Math.floor(input.pool / participants) : 0;
    for (const c of active) {
      allocations.push({
        auditorId: c.auditorId,
        acceptedCount: c.activeCount,
        amount: each,
        includedAuditIds: [],
      });
    }
  } else {
    for (const c of active) {
      const share = totalAccepted > 0 ? c.activeCount / totalAccepted : 0;
      allocations.push({
        auditorId: c.auditorId,
        acceptedCount: c.activeCount,
        amount: Math.floor(input.pool * share),
        includedAuditIds: [],
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

/**
 * 입금 처리 — 회차 allocations jsonb 안의 해당 평가자 항목에 `paidAt` 을 세팅한다.
 *
 * 관리자가 실제 계좌이체(플랫폼 밖) 후 세부화면에서 체크박스로 일괄 호출.
 * read-modify-write: 스토어의 최신 회차를 읽어 대상 auditor 항목만 paidAt 을 채운 뒤
 * `settlement_rounds.allocations` 를 통째로 update → Realtime 이 세무사 화면에 전파.
 * 이미 입금된 항목은 건너뛴다(멱등). 새로 입금 처리된 평가자에게는 입금 완료 안내 메일 발송.
 */
export async function markPaid(
  roundId: string,
  auditorIds: string[],
  paidBy: string,
): Promise<SettlementRound | null> {
  const round = useSettlementStore.getState().rounds.find((r) => r.id === roundId);
  if (!round) return null;

  const target = new Set(auditorIds);
  const paidAt = Date.now();
  const newlyPaid: SettlementAllocation[] = [];
  const nextAllocations = round.allocations.map((a) => {
    if (target.has(a.auditorId) && a.paidAt == null) {
      const updated = { ...a, paidAt };
      newlyPaid.push(updated);
      return updated;
    }
    return a;
  });

  if (newlyPaid.length === 0) return round; // 대상 없음 — 네트워크 미접촉

  const sb = getSupabase();
  const { data, error } = await sb
    .from("settlement_rounds")
    .update({ allocations: nextAllocations })
    .eq("id", roundId)
    .select()
    .single();
  if (error) throw error;
  const saved = rowToRound(data as SettlementRoundRow);
  useSettlementStore.getState()._upsert(saved);

  // 새로 입금 처리된 평가자에게 입금 완료 안내 (메일함이 확인처, 대시보드는 알림만).
  for (const a of newlyPaid) {
    try {
      await mailService.send({
        recipientId: a.auditorId,
        senderId: paidBy,
        kind: "settlement",
        subject: `${round.label} 회차 입금 완료`,
        body: `회차 ${round.label}\n분배 credit: +${a.amount}\n입금이 완료되었습니다.`,
        ref: { kind: "settlement", roundId: round.id },
      });
    } catch {
      // 메일 실패가 입금 처리를 되돌리지 않는다(비차단).
    }
  }

  return saved;
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
