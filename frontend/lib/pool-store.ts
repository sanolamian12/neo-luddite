"use client";

import { useEffect } from "react";
import { create } from "zustand";
import type { PoolCandidate } from "./poc-schema";
import { makeCollectionSync } from "./supabase/sync";

/**
 * 감사 후보 풀 스토어 — Supabase `public.pool_candidates` 의 Realtime 캐시.
 * (구 localStorage persist + JSON seed → DB fetch + Realtime 구독으로 컷오버, §3-3)
 */

interface PoolState {
  candidates: PoolCandidate[];
  /** 최초 DB fetch 완료 여부 (구 persist hydration 대체). */
  hydrated: boolean;
  _upsert: (cand: PoolCandidate) => void;
  _patchByConversationId: (id: string, patch: Partial<PoolCandidate>) => void;
  _remove: (conversationId: string) => void;
}

/** DB row(snake) 형태. */
export interface PoolRow {
  conversation_id: string;
  occupation: string;
  topic: string | null;
  turn_count: number;
  first_user_message: string | null;
  assistant_token_estimate: number | null;
  added_at: number;
  status: PoolCandidate["status"];
  excluded_reason: string | null;
}

/** row(snake) → 도메인(camel). */
export function rowToCandidate(r: PoolRow): PoolCandidate {
  return {
    conversationId: r.conversation_id,
    occupation: r.occupation,
    topic: r.topic ?? undefined,
    turnCount: r.turn_count,
    firstUserMessage: r.first_user_message ?? undefined,
    assistantTokenEstimate: r.assistant_token_estimate ?? undefined,
    addedAt: Number(r.added_at),
    status: r.status,
    excludedReason: r.excluded_reason ?? undefined,
  };
}

export const usePoolStore = create<PoolState>()((set) => ({
  candidates: [],
  hydrated: false,

  _upsert: (cand) =>
    set((s) => {
      const idx = s.candidates.findIndex(
        (c) => c.conversationId === cand.conversationId,
      );
      if (idx === -1) return { candidates: [...s.candidates, cand] };
      const next = [...s.candidates];
      next[idx] = { ...next[idx], ...cand };
      return { candidates: next };
    }),

  _patchByConversationId: (id, patch) =>
    set((s) => ({
      candidates: s.candidates.map((c) =>
        c.conversationId === id ? { ...c, ...patch } : c,
      ),
    })),

  _remove: (conversationId) =>
    set((s) => ({
      candidates: s.candidates.filter(
        (c) => c.conversationId !== conversationId,
      ),
    })),
}));

const startSync = makeCollectionSync<PoolRow, PoolCandidate>({
  table: "pool_candidates",
  rowToDomain: rowToCandidate,
  pkColumn: "conversation_id",
  setAll: (items) => usePoolStore.setState({ candidates: items }),
  applyUpsert: (item) => usePoolStore.getState()._upsert(item),
  applyDelete: (pk) => usePoolStore.getState()._remove(pk),
  onHydrated: () => usePoolStore.setState({ hydrated: true }),
});

// 클라이언트 모듈 로드 시 동기화 시작(구 persist auto-rehydrate 타이밍과 동일).
if (typeof window !== "undefined") startSync();

/** 최초 DB 로드 완료 여부. (시그니처 불변 — 컴포넌트 무손상) */
export function usePoolHydrated(): boolean {
  const hydrated = usePoolStore((s) => s.hydrated);
  useEffect(() => {
    startSync();
  }, []);
  return hydrated;
}
