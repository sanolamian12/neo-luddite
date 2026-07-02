"use client";

import { useEffect } from "react";
import { create } from "zustand";
import type { TrainingBatch, ModelVersion } from "./poc-schema";
import { makeCollectionSync } from "./supabase/sync";

/**
 * 파이프라인 스토어 — Supabase `public.training_batches` + `public.model_versions`
 * 두 테이블의 Realtime 캐시. (구 localStorage persist → DB fetch + Realtime 구독으로 컷오버, §3-3)
 *
 * 이 도메인은 스토어 하나가 두 컬렉션(batches / versions)을 함께 담는다.
 */

interface PipelineState {
  batches: TrainingBatch[];
  versions: ModelVersion[];
  /** 두 테이블 모두 최초 DB fetch 완료 여부 (구 persist hydration 대체). */
  hydrated: boolean;
  _upsertBatch: (batch: TrainingBatch) => void;
  _patchBatch: (id: string, patch: Partial<TrainingBatch>) => void;
  _removeBatch: (id: string) => void;
  _upsertVersion: (version: ModelVersion) => void;
  _patchVersion: (id: string, patch: Partial<ModelVersion>) => void;
  _removeVersion: (id: string) => void;
}

/** DB row(snake) — training_batches. */
export interface TrainingBatchRow {
  id: string;
  label: string;
  accepted_feedbacks: TrainingBatch["acceptedFeedbacks"];
  contributor_ids: string[];
  created_at: number;
  created_by: string;
  status: TrainingBatch["status"];
  pr_meta: TrainingBatch["prMeta"] | null;
  target_model_version: string | null;
  notes: string | null;
  failure_reason: string | null;
}

/** DB row(snake) — model_versions. */
export interface ModelVersionRow {
  id: string;
  semver: ModelVersion["semver"];
  status: ModelVersion["status"];
  created_at: number;
  promoted_at: number | null;
  retired_at: number | null;
  merged_from_batch_ids: string[];
  source_pr: ModelVersion["sourcePr"] | null;
  metrics: ModelVersion["metrics"] | null;
  notes: string | null;
}

/** row(snake) → 도메인(camel) — training_batches. */
export function rowToBatch(r: TrainingBatchRow): TrainingBatch {
  return {
    id: r.id,
    label: r.label,
    acceptedFeedbacks: r.accepted_feedbacks ?? [],
    contributorIds: r.contributor_ids ?? [],
    createdAt: Number(r.created_at),
    createdBy: r.created_by,
    status: r.status,
    prMeta: r.pr_meta ?? undefined,
    targetModelVersion: r.target_model_version ?? undefined,
    notes: r.notes ?? undefined,
    failureReason: r.failure_reason ?? undefined,
  };
}

/** row(snake) → 도메인(camel) — model_versions. */
export function rowToVersion(r: ModelVersionRow): ModelVersion {
  return {
    id: r.id,
    semver: r.semver,
    status: r.status,
    createdAt: Number(r.created_at),
    promotedAt: r.promoted_at != null ? Number(r.promoted_at) : undefined,
    retiredAt: r.retired_at != null ? Number(r.retired_at) : undefined,
    mergedFromBatchIds: r.merged_from_batch_ids ?? [],
    sourcePr: r.source_pr ?? undefined,
    metrics: r.metrics ?? undefined,
    notes: r.notes ?? undefined,
  };
}

export const usePipelineStore = create<PipelineState>()((set) => ({
  batches: [],
  versions: [],
  hydrated: false,

  _upsertBatch: (batch) =>
    set((s) => {
      const idx = s.batches.findIndex((b) => b.id === batch.id);
      if (idx === -1) return { batches: [...s.batches, batch] };
      const next = [...s.batches];
      next[idx] = { ...next[idx], ...batch };
      return { batches: next };
    }),
  _patchBatch: (id, patch) =>
    set((s) => ({
      batches: s.batches.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    })),
  _removeBatch: (id) =>
    set((s) => ({ batches: s.batches.filter((b) => b.id !== id) })),
  _upsertVersion: (version) =>
    set((s) => {
      const idx = s.versions.findIndex((v) => v.id === version.id);
      if (idx === -1) return { versions: [...s.versions, version] };
      const next = [...s.versions];
      next[idx] = { ...next[idx], ...version };
      return { versions: next };
    }),
  _patchVersion: (id, patch) =>
    set((s) => ({
      versions: s.versions.map((v) => (v.id === id ? { ...v, ...patch } : v)),
    })),
  _removeVersion: (id) =>
    set((s) => ({ versions: s.versions.filter((v) => v.id !== id) })),
}));

// 두 테이블이 각자 hydrate 되면 자기 플래그를 세우고, 둘 다 되면 hydrated=true.
let batchesHydrated = false;
let versionsHydrated = false;
function markHydrated() {
  if (batchesHydrated && versionsHydrated) {
    usePipelineStore.setState({ hydrated: true });
  }
}

const startBatchesSync = makeCollectionSync<TrainingBatchRow, TrainingBatch>({
  table: "training_batches",
  rowToDomain: rowToBatch,
  pkColumn: "id",
  setAll: (items) => usePipelineStore.setState({ batches: items }),
  applyUpsert: (item) => usePipelineStore.getState()._upsertBatch(item),
  applyDelete: (pk) => usePipelineStore.getState()._removeBatch(pk),
  onHydrated: () => {
    batchesHydrated = true;
    markHydrated();
  },
});

const startVersionsSync = makeCollectionSync<ModelVersionRow, ModelVersion>({
  table: "model_versions",
  rowToDomain: rowToVersion,
  pkColumn: "id",
  setAll: (items) => usePipelineStore.setState({ versions: items }),
  applyUpsert: (item) => usePipelineStore.getState()._upsertVersion(item),
  applyDelete: (pk) => usePipelineStore.getState()._removeVersion(pk),
  onHydrated: () => {
    versionsHydrated = true;
    markHydrated();
  },
});

/** 두 컬렉션 동기화를 함께 시작 (각 start 는 멱등). */
function startAll() {
  startBatchesSync();
  startVersionsSync();
}

// 클라이언트 모듈 로드 시 동기화 시작(구 persist auto-rehydrate 타이밍과 동일).
if (typeof window !== "undefined") startAll();

/** 최초 DB 로드 완료 여부. (시그니처 불변 — 컴포넌트 무손상) */
export function usePipelineHydrated(): boolean {
  const hydrated = usePipelineStore((s) => s.hydrated);
  useEffect(() => {
    startAll();
  }, []);
  return hydrated;
}
