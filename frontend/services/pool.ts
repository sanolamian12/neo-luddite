"use client";

import { getSupabase } from "@/lib/supabase/client";
import { usePoolStore, rowToCandidate, type PoolRow } from "@/lib/pool-store";
import { useAuditTaskStore } from "@/lib/audit-task-store";
import type { PoolCandidate, PoolStatus } from "@/lib/poc-schema";

/**
 * Pool service — 감사 후보 풀.
 *
 * 쓰기: Supabase `pool_candidates` 에 반영 + 낙관적 스토어 갱신(Realtime echo 는 멱등).
 * 읽기: Realtime 동기화된 스토어 캐시에서 필터/정렬 (형태·로직 불변, §3-3).
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
  const sb = getSupabase();
  const existing = usePoolStore
    .getState()
    .candidates.find((c) => c.conversationId === input.conversationId);

  // upsert: conversation_id 충돌 시 metadata 갱신, 기존 status/added_at 보존.
  const row: Record<string, unknown> = {
    conversation_id: input.conversationId,
    occupation: input.occupation,
    topic: input.topic ?? null,
    turn_count: input.turnCount,
    first_user_message: input.firstUserMessage ?? null,
    assistant_token_estimate: input.assistantTokenEstimate ?? null,
    added_at: existing?.addedAt ?? Date.now(),
    status: existing?.status ?? "new",
  };
  const { data, error } = await sb
    .from("pool_candidates")
    .upsert(row, { onConflict: "conversation_id" })
    .select()
    .single();
  if (error) throw error;
  const candidate = rowToCandidate(data as PoolRow);
  usePoolStore.getState()._upsert(candidate);
  return candidate;
}

/** 후보를 제외 처리한다 (회색 처리, 목록에서 사라지지는 않음). */
export async function exclude(
  conversationId: string,
  reason?: string,
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("pool_candidates")
    .update({ status: "excluded", excluded_reason: reason ?? null })
    .eq("conversation_id", conversationId);
  if (error) throw error;
  usePoolStore.getState()._patchByConversationId(conversationId, {
    status: "excluded",
    excludedReason: reason,
  });
}

/** 필터 / 검색으로 후보 목록을 반환한다. 최신순. */
export async function listCandidates(
  filter?: PoolFilter,
): Promise<PoolListResult> {
  let items = [...usePoolStore.getState().candidates];

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
  return (
    usePoolStore
      .getState()
      .candidates.find((c) => c.conversationId === conversationId) ?? null
  );
}

/** Task 등록 시 conversation 상태를 assigned 로 마킹. */
export async function markAssigned(conversationIds: string[]): Promise<void> {
  if (conversationIds.length === 0) return;
  const sb = getSupabase();
  const { error } = await sb
    .from("pool_candidates")
    .update({ status: "assigned" })
    .in("conversation_id", conversationIds);
  if (error) throw error;
  for (const id of conversationIds) {
    usePoolStore.getState()._patchByConversationId(id, { status: "assigned" });
  }
}

/** 대시보드 / 사이드바 배지용 요약. */
export async function summary(): Promise<PoolSummary> {
  const candidates = usePoolStore.getState().candidates;
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

  // Task 에 포함된 conversationId 가 풀에 있다면 assigned 로 표시 (동기화 보강).
  const assignedSet = new Set<string>();
  for (const task of useAuditTaskStore.getState().tasks) {
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
