"use client";

import { usePoolStore } from "@/lib/pool-store";
import { useAuditTaskStore } from "@/lib/audit-task-store";
import type { PoolCandidate, PoolStatus } from "@/lib/poc-schema";

/**
 * Pool service — 감사 후보 풀.
 *
 * 모든 함수는 `Promise<T>` 반환. 현재 구현은 Zustand store 를 읽고 쓰지만,
 * 백엔드 연결 시 동일 시그니처로 `fetch('/api/pool/...')` 로 교체된다.
 */

export interface PoolAddInput {
  conversationId: string;
  occupation: string;
  topic?: string;
  turnCount: number;
  firstUserMessage?: string;
  assistantTokenEstimate?: number;
}

export interface PoolFilter {
  occupation?: string;
  status?: PoolStatus;
  q?: string;
}

export interface PoolListResult {
  items: PoolCandidate[];
  total: number;
}

export interface PoolSummary {
  totalActive: number;
  newCount: number;
  assignedCount: number;
  excludedCount: number;
  byOccupation: Record<string, number>;
}

/** Conversation 을 풀에 추가하거나, 이미 있으면 metadata 만 갱신한다 (idempotent). */
export async function add(input: PoolAddInput): Promise<PoolCandidate> {
  const store = usePoolStore.getState();
  const existing = store.candidates.find(
    (c) => c.conversationId === input.conversationId,
  );

  if (existing) {
    const patched: PoolCandidate = {
      ...existing,
      occupation: input.occupation,
      topic: input.topic ?? existing.topic,
      turnCount: input.turnCount,
      firstUserMessage: input.firstUserMessage ?? existing.firstUserMessage,
      assistantTokenEstimate:
        input.assistantTokenEstimate ?? existing.assistantTokenEstimate,
    };
    store._upsert(patched);
    return patched;
  }

  const next: PoolCandidate = {
    conversationId: input.conversationId,
    occupation: input.occupation,
    topic: input.topic,
    turnCount: input.turnCount,
    firstUserMessage: input.firstUserMessage,
    assistantTokenEstimate: input.assistantTokenEstimate,
    addedAt: Date.now(),
    status: "new",
  };
  store._upsert(next);
  return next;
}

/** 후보를 제외 처리한다 (회색 처리, 목록에서 사라지지는 않음). */
export async function exclude(
  conversationId: string,
  reason?: string,
): Promise<void> {
  const store = usePoolStore.getState();
  store._patchByConversationId(conversationId, {
    status: "excluded",
    excludedReason: reason,
  });
}

/** 필터 / 검색으로 후보 목록을 반환한다. 최신순. */
export async function listCandidates(
  filter?: PoolFilter,
): Promise<PoolListResult> {
  const store = usePoolStore.getState();
  let items = [...store.candidates];

  if (filter?.occupation) {
    items = items.filter((c) => c.occupation === filter.occupation);
  }
  if (filter?.status) {
    items = items.filter((c) => c.status === filter.status);
  }
  if (filter?.q) {
    const q = filter.q.toLowerCase();
    items = items.filter(
      (c) =>
        c.conversationId.toLowerCase().includes(q) ||
        c.topic?.toLowerCase().includes(q) ||
        c.firstUserMessage?.toLowerCase().includes(q),
    );
  }

  items.sort((a, b) => b.addedAt - a.addedAt);
  return { items, total: items.length };
}

/** 단건 조회. */
export async function get(
  conversationId: string,
): Promise<PoolCandidate | null> {
  const store = usePoolStore.getState();
  return (
    store.candidates.find((c) => c.conversationId === conversationId) ?? null
  );
}

/** Task 등록 시 conversation 상태를 assigned 로 마킹. */
export async function markAssigned(conversationIds: string[]): Promise<void> {
  const store = usePoolStore.getState();
  for (const id of conversationIds) {
    store._patchByConversationId(id, { status: "assigned" });
  }
}

/** 대시보드 / 사이드바 배지용 요약. */
export async function summary(): Promise<PoolSummary> {
  const store = usePoolStore.getState();
  const candidates = store.candidates;
  const byOccupation: Record<string, number> = {};
  let newCount = 0;
  let assignedCount = 0;
  let excludedCount = 0;
  for (const c of candidates) {
    if (c.status === "excluded") {
      excludedCount += 1;
      continue;
    }
    byOccupation[c.occupation] = (byOccupation[c.occupation] ?? 0) + 1;
    if (c.status === "new") newCount += 1;
    if (c.status === "assigned") assignedCount += 1;
  }

  // Task 가 신규 생성될 때마다 assigned 가 늘어남 — 정확도 보강:
  // Task 에 포함된 conversationId 가 풀에 있다면 assigned 로 표시.
  // (admin pool 화면에서 수동 제외하지 않는 한 동기화)
  const taskStore = useAuditTaskStore.getState();
  const assignedSet = new Set<string>();
  for (const task of taskStore.tasks) {
    for (const cid of task.conversationIds) assignedSet.add(cid);
  }

  return {
    totalActive: candidates.length - excludedCount,
    newCount,
    assignedCount: Math.max(assignedCount, assignedSet.size),
    excludedCount,
    byOccupation,
  };
}
