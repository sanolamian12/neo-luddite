"use client";

import { useEffect } from "react";
import { create } from "zustand";
import type { Conversation } from "./conversation-schema";
import { makeCollectionSync } from "./supabase/sync";

/**
 * 대화 스토어 — Supabase `public.conversations` 의 Realtime 캐시.
 *
 * 이 테이블은 두 얼굴을 가진다(0005 + 0006):
 *  · payload           = 라이브 대화 원형(매 턴 갱신, 사장님은 계속 대화 가능)
 *  · snapshot_payload  = 5분 시점 "사진"(정지 사본). pg_cron 이 채운다.
 *
 * 하차장/일감/RAG 는 정지 사본만 소비한다. 따라서:
 *  · 하차장 노출 = snapshot_at != null && excluded_at == null (사진 찍힘 & 미제외)
 *  · getSnapshotConversation(id) = 정지 사본 우선(감사/일감이 읽는 대화 원문)
 *
 * (pool-store 와 동일한 makeCollectionSync 패턴. 구 pool_candidates 대체.)
 */

export interface ConversationRecord {
  id: string;
  occupation: string;
  taxCategory: string | null;
  title: string | null;
  ownerId: string;
  ownerLabel: string | null;
  source: string;
  status: string;
  turnCount: number;
  createdAt: number;
  updatedAt: number;
  /** 사진 찍은 시각(ms). null = 아직 라이브(하차장 미노출). */
  snapshotAt: number | null;
  /** 관리자 제외 시각(ms). null = 활성. */
  excludedAt: number | null;
  /** 라이브 대화 원형. */
  payload: Conversation;
  /** 5분 시점 정지 사본(하차장/감사/일감/RAG 가 읽는 원문). */
  snapshotPayload: Conversation | null;
}

/** DB row(snake). bigint 컬럼은 PostgREST 가 string 으로 줄 수 있어 Number() 정규화. */
export interface ConversationRow {
  id: string;
  occupation: string;
  tax_category: string | null;
  title: string | null;
  owner_id: string;
  owner_label: string | null;
  source: string;
  status: string;
  turn_count: number;
  created_at: number | string;
  updated_at: number | string;
  snapshot_at: number | string | null;
  excluded_at: number | string | null;
  payload: Conversation;
  snapshot_payload: Conversation | null;
}

export function rowToConversation(r: ConversationRow): ConversationRecord {
  return {
    id: r.id,
    occupation: r.occupation,
    taxCategory: r.tax_category ?? null,
    title: r.title ?? null,
    ownerId: r.owner_id,
    ownerLabel: r.owner_label ?? null,
    source: r.source,
    status: r.status,
    turnCount: r.turn_count,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    snapshotAt: r.snapshot_at == null ? null : Number(r.snapshot_at),
    excludedAt: r.excluded_at == null ? null : Number(r.excluded_at),
    payload: r.payload,
    snapshotPayload: r.snapshot_payload ?? null,
  };
}

interface ConversationState {
  records: ConversationRecord[];
  hydrated: boolean;
  _upsert: (rec: ConversationRecord) => void;
  _patchById: (id: string, patch: Partial<ConversationRecord>) => void;
  _remove: (id: string) => void;
}

export const useConversationStore = create<ConversationState>()((set) => ({
  records: [],
  hydrated: false,

  _upsert: (rec) =>
    set((s) => {
      const idx = s.records.findIndex((c) => c.id === rec.id);
      if (idx === -1) return { records: [...s.records, rec] };
      const next = [...s.records];
      next[idx] = { ...next[idx], ...rec };
      return { records: next };
    }),

  _patchById: (id, patch) =>
    set((s) => ({
      records: s.records.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    })),

  _remove: (id) =>
    set((s) => ({ records: s.records.filter((c) => c.id !== id) })),
}));

const startSync = makeCollectionSync<ConversationRow, ConversationRecord>({
  table: "conversations",
  rowToDomain: rowToConversation,
  pkColumn: "id",
  setAll: (items) => useConversationStore.setState({ records: items }),
  applyUpsert: (item) => useConversationStore.getState()._upsert(item),
  applyDelete: (pk) => useConversationStore.getState()._remove(pk),
  onHydrated: () => useConversationStore.setState({ hydrated: true }),
});

if (typeof window !== "undefined") startSync();

/** 최초 DB 로드 완료 여부. */
export function useConversationHydrated(): boolean {
  const hydrated = useConversationStore((s) => s.hydrated);
  useEffect(() => {
    startSync();
  }, []);
  return hydrated;
}

/**
 * 비-hook 접근자 — load-conversation.ts 의 동기 getter 가 정지 사본을 병합 조회.
 * 정지 사본(snapshot)이 있으면 그것을, 없으면 라이브 payload 를 반환한다.
 * (일감/감사는 언제나 snapshot 이 있는 대화만 참조하므로 실질적으로 정지본.)
 */
export function getStoredConversation(id: string): Conversation | undefined {
  const rec = useConversationStore.getState().records.find((c) => c.id === id);
  if (!rec) return undefined;
  return rec.snapshotPayload ?? rec.payload;
}
