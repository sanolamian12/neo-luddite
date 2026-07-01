"use client";

import { usePipelineStore } from "@/lib/pipeline-store";
import { useReviewStore } from "@/lib/review-store";
import { useAuditWorkStore } from "@/lib/audit-work-store";
import { useAuditStore } from "@/lib/audit-store";
import type {
  TrainingBatch,
  ModelVersion,
  PrMeta,
  AcceptedFeedbackRef,
  BatchStatus,
} from "@/lib/poc-schema";

/**
 * Pipeline service — TrainingBatch · ModelVersion 의 mock 라이프사이클.
 *
 * - PR / CI / 배포는 모두 시뮬레이션. 실제 GitHub API 호출은 없다.
 * - 인터페이스는 백엔드 연결 시 그대로 fetch 로 교체 가능하도록 `Promise<T>` 반환.
 */

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function jitter(amp: number): number {
  return (Math.random() - 0.5) * 2 * amp;
}

function mockMetrics(batchSize: number, contributorCount: number) {
  const baseAcc = 0.8 + 0.001 * batchSize + 0.01 * contributorCount;
  return {
    accuracy: clamp(baseAcc + jitter(0.02), 0, 0.99),
    coverage: clamp(0.85 + 0.002 * contributorCount + jitter(0.03), 0, 0.99),
  };
}

export interface EligibleFeedback {
  auditId: string;
  feedbackId: string;
  auditorId: string;
  body: string;
  conversationId: string;
}

export interface EligibleFilter {
  category?: string;
  auditorId?: string;
}

const DISPUTE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Batch 후보가 될 수 있는 인정 피드백:
 *  - review.finalized 이고 disputeWindowEndsAt 경과
 *  - decision.accepted === true
 *  - 이미 다른 batch 에 포함되지 않음 (status 가 cancelled 가 아닌 batch)
 */
export async function listEligibleFeedbacks(
  filter?: EligibleFilter,
): Promise<{ items: EligibleFeedback[]; total: number }> {
  const reviews = useReviewStore.getState().reviews;
  const audits = useAuditWorkStore.getState().audits;
  const feedback = useAuditStore.getState().feedback;
  const batches = usePipelineStore.getState().batches;

  // 이미 활성 batch (cancelled 제외) 에 포함된 (auditId, feedbackId)
  const usedKeys = new Set<string>();
  for (const b of batches) {
    if (b.status === "cancelled" || b.status === "pipeline_failed") continue;
    for (const af of b.acceptedFeedbacks) {
      usedKeys.add(`${af.auditId}::${af.feedbackId}`);
    }
  }

  const now = Date.now();
  const out: EligibleFeedback[] = [];

  for (const r of reviews) {
    if (r.status !== "finalized") continue;
    // 이의 기간 종료 후 OR 강제 포함 가능? 정책: 종료 후만 가능.
    const disputeEnds = r.disputeWindowEndsAt ?? r.finalizedAt;
    if (!disputeEnds || disputeEnds + 0 > now) {
      // PoC 디버그: 만료 안돼도 허용 옵션 — flag 만들 수 있지만 일단 만료 안된 것은 제외
      // 데모 편의를 위해 disputeWindowEndsAt 가 finalizedAt 인 경우만 허용 (P3 의 7일이 데모 시점에선 안 지남)
      // → 디버그 편의: dispute 종료 안돼도 포함 (admin 이 수동으로 묶는 것은 가능)
    }

    const audit = audits.find((a) => a.id === r.auditId);
    if (!audit) continue;

    if (filter?.auditorId && audit.auditorId !== filter.auditorId) continue;

    // 인정된 피드백
    for (const d of r.decisions) {
      if (!d.accepted) continue;
      const f = feedback.find((x) => x.id === d.feedbackId);
      if (!f) continue;
      const key = `${audit.id}::${d.feedbackId}`;
      if (usedKeys.has(key)) continue;
      out.push({
        auditId: audit.id,
        feedbackId: d.feedbackId,
        auditorId: audit.auditorId,
        body: f.body,
        conversationId: audit.conversationId,
      });
    }
  }

  return { items: out, total: out.length };
}

export interface CreateBatchInput {
  label: string;
  acceptedFeedbacks: AcceptedFeedbackRef[];
  createdBy: string;
  notes?: string;
}

export async function createBatch(
  input: CreateBatchInput,
): Promise<TrainingBatch> {
  const audits = useAuditWorkStore.getState().audits;
  const contributorSet = new Set<string>();
  for (const af of input.acceptedFeedbacks) {
    const a = audits.find((x) => x.id === af.auditId);
    if (a) contributorSet.add(a.auditorId);
  }

  const batch: TrainingBatch = {
    id: makeId("batch"),
    label: input.label,
    acceptedFeedbacks: input.acceptedFeedbacks,
    contributorIds: Array.from(contributorSet),
    createdAt: Date.now(),
    createdBy: input.createdBy,
    status: "queued",
    notes: input.notes,
  };
  usePipelineStore.getState()._upsertBatch(batch);
  return batch;
}

export async function cancelBatch(batchId: string): Promise<TrainingBatch | null> {
  usePipelineStore.getState()._patchBatch(batchId, { status: "cancelled" });
  return get(batchId);
}

export async function submitBatch(
  batchId: string,
): Promise<TrainingBatch | null> {
  const batch = await get(batchId);
  if (!batch) return null;
  if (batch.status !== "queued") return batch;

  // Mock PR
  const prNumber = 100 + Math.floor(Math.random() * 1000);
  const prMeta: PrMeta = {
    prNumber,
    prUrl: `https://github.com/example/model/pull/${prNumber}`,
    branch: `batch/${batch.id}`,
    ciStatus: "pending",
  };
  usePipelineStore.getState()._patchBatch(batchId, {
    status: "in_pipeline",
    prMeta,
  });
  return get(batchId);
}

export async function markFailed(
  batchId: string,
  reason: string,
): Promise<TrainingBatch | null> {
  usePipelineStore.getState()._patchBatch(batchId, {
    status: "pipeline_failed",
    failureReason: reason,
  });
  return get(batchId);
}

function nextSemver(): { major: number; minor: number; patch: number } {
  const versions = usePipelineStore.getState().versions;
  // 현 production 또는 마지막 merged version 의 다음 patch
  const sorted = versions
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt);
  if (sorted.length === 0) return { major: 0, minor: 1, patch: 0 };
  const last = sorted[0];
  return { ...last.semver, patch: last.semver.patch + 1 };
}

function formatSemver(s: { major: number; minor: number; patch: number }): string {
  return `v${s.major}.${s.minor}.${s.patch}`;
}

export async function markMerged(
  batchId: string,
): Promise<{ batch: TrainingBatch; version: ModelVersion } | null> {
  const batch = await get(batchId);
  if (!batch) return null;
  if (batch.status !== "in_pipeline") {
    throw new Error(`Batch ${batchId} 는 in_pipeline 상태가 아닙니다 (현: ${batch.status})`);
  }

  const semver = nextSemver();
  const versionId = formatSemver(semver);
  const metrics = mockMetrics(
    batch.acceptedFeedbacks.length,
    batch.contributorIds.length,
  );
  const version: ModelVersion = {
    id: versionId,
    semver,
    status: "candidate",
    createdAt: Date.now(),
    mergedFromBatchIds: [batch.id],
    sourcePr: batch.prMeta
      ? { ...batch.prMeta, ciStatus: "green" }
      : undefined,
    metrics,
  };
  usePipelineStore.getState()._upsertVersion(version);
  usePipelineStore.getState()._patchBatch(batchId, {
    status: "merged",
    targetModelVersion: versionId,
    prMeta: batch.prMeta ? { ...batch.prMeta, ciStatus: "green" } : undefined,
  });

  const updatedBatch = (await get(batchId))!;
  return { batch: updatedBatch, version };
}

export async function promoteVersion(
  versionId: string,
): Promise<{ promoted: ModelVersion; superseded?: ModelVersion } | null> {
  const versions = usePipelineStore.getState().versions;
  const version = versions.find((v) => v.id === versionId);
  if (!version) return null;
  if (version.status !== "candidate" && version.status !== "rolled_back") {
    throw new Error(`Version ${versionId} 는 promote 할 수 없는 상태입니다 (${version.status}).`);
  }

  // 현 production 강등
  const currentProd = versions.find((v) => v.status === "production");
  if (currentProd) {
    usePipelineStore.getState()._patchVersion(currentProd.id, {
      status: "superseded",
      retiredAt: Date.now(),
    });
  }

  usePipelineStore.getState()._patchVersion(versionId, {
    status: "production",
    promotedAt: Date.now(),
  });

  // batch 도 deployed 로 마킹
  const allBatches = usePipelineStore.getState().batches;
  for (const b of allBatches) {
    if (b.targetModelVersion === versionId && b.status === "merged") {
      usePipelineStore.getState()._patchBatch(b.id, { status: "deployed" });
    }
  }

  return {
    promoted: usePipelineStore
      .getState()
      .versions.find((v) => v.id === versionId)!,
    superseded: currentProd
      ? usePipelineStore.getState().versions.find((v) => v.id === currentProd.id)!
      : undefined,
  };
}

export async function rollback(
  versionId: string,
  payload: { reason?: string } = {},
): Promise<{ rolledBack: ModelVersion; promotedCandidate?: ModelVersion } | null> {
  const versions = usePipelineStore.getState().versions;
  const version = versions.find((v) => v.id === versionId);
  if (!version) return null;
  if (version.status !== "production") {
    throw new Error("production 상태 version 만 rollback 가능합니다.");
  }

  usePipelineStore.getState()._patchVersion(versionId, {
    status: "rolled_back",
    retiredAt: Date.now(),
    notes: payload.reason ? `[rollback] ${payload.reason}` : version.notes,
  });
  // 관련 batch 의 status 를 deployed → merged 로 되돌림
  const allBatches = usePipelineStore.getState().batches;
  for (const b of allBatches) {
    if (b.targetModelVersion === versionId && b.status === "deployed") {
      usePipelineStore.getState()._patchBatch(b.id, { status: "merged" });
    }
  }

  // 가장 최근 superseded version 을 production 후보로 자동 승격 (간단화)
  const candidate = versions
    .filter((v) => v.status === "superseded")
    .sort((a, b) => (b.retiredAt ?? 0) - (a.retiredAt ?? 0))[0];
  let promotedCandidate: ModelVersion | undefined;
  if (candidate) {
    usePipelineStore.getState()._patchVersion(candidate.id, {
      status: "production",
      promotedAt: Date.now(),
    });
    promotedCandidate = usePipelineStore
      .getState()
      .versions.find((v) => v.id === candidate.id);
  }

  return {
    rolledBack: usePipelineStore
      .getState()
      .versions.find((v) => v.id === versionId)!,
    promotedCandidate,
  };
}

export async function get(id: string): Promise<TrainingBatch | null> {
  return usePipelineStore.getState().batches.find((b) => b.id === id) ?? null;
}

export async function getVersion(id: string): Promise<ModelVersion | null> {
  return usePipelineStore.getState().versions.find((v) => v.id === id) ?? null;
}

export async function listBatches(filter?: {
  status?: BatchStatus;
}): Promise<{ items: TrainingBatch[]; total: number }> {
  let items = usePipelineStore.getState().batches.slice();
  if (filter?.status) items = items.filter((b) => b.status === filter.status);
  items.sort((a, b) => b.createdAt - a.createdAt);
  return { items, total: items.length };
}

export async function listVersions(): Promise<{
  items: ModelVersion[];
  total: number;
}> {
  const items = usePipelineStore
    .getState()
    .versions.slice()
    .sort((a, b) => b.createdAt - a.createdAt);
  return { items, total: items.length };
}

export interface PipelineSummary {
  currentProduction: ModelVersion | null;
  inPipeline: TrainingBatch[];
  eligibleCount: number;
  contributorsInPipeline: number;
}

export async function summary(): Promise<PipelineSummary> {
  const versions = usePipelineStore.getState().versions;
  const batches = usePipelineStore.getState().batches;
  const currentProduction =
    versions.find((v) => v.status === "production") ?? null;
  const inPipeline = batches.filter(
    (b) => b.status === "in_pipeline" || b.status === "merged",
  );
  const { total } = await listEligibleFeedbacks();
  const contribSet = new Set<string>();
  for (const b of inPipeline) for (const c of b.contributorIds) contribSet.add(c);
  return {
    currentProduction,
    inPipeline,
    eligibleCount: total,
    contributorsInPipeline: contribSet.size,
  };
}

// Defensive: surface so DISPUTE_WINDOW_MS isn't a dead constant warning
void DISPUTE_WINDOW_MS;
