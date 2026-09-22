"use client";

import { useEffect } from "react";
import { create } from "zustand";
import type { Conversation } from "./conversation-schema";
import { getSupabase } from "./supabase/client";
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
  waitForPostgresReady: true,
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
 * 대화 한 건을 DB 에서 직접 읽어 스토어에 넣는다(RLS 대로 보이는 것만).
 * Realtime 구독이 붙기 전에 생긴 대화는 INSERT 이벤트를 놓쳐 스토어에 없을 수 있다 —
 * 특정 대화가 꼭 필요한 화면(상담 신청 상세, ?c= 로 대화 열기)이 이걸로 메운다.
 */
export async function fetchConversationRecord(
  id: string,
): Promise<ConversationRecord | null> {
  const { data, error } = await getSupabase()
    .from("conversations")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const rec = rowToConversation(data as ConversationRow);
  useConversationStore.getState()._upsert(rec);
  return rec;
}

/** 스토어에서 대화를 찾고, 적재가 끝났는데도 없으면 DB 에서 한 번 읽어 온다. */
export function useConversationRecord(id: string | null | undefined): ConversationRecord | undefined {
  const hydrated = useConversationHydrated();
  const rec = useConversationStore((s) => (id ? s.records.find((c) => c.id === id) : undefined));
  const missing = hydrated && Boolean(id) && !rec;
  useEffect(() => {
    if (missing && id) void fetchConversationRecord(id);
  }, [missing, id]);
  return rec;
}

/**
 * 목록 화면용 — 스토어에 없는 대화 여러 건을 한 번에 DB 에서 읽어 넣는다(RLS 대로 보이는 것만).
 * 세무사는 0040 부터 **조건에 걸린 대화만** 읽는다(설계 §3.7). 새 일감·신청·채팅방이 생겨 대화가
 * "보이게" 돼도 conversations 행은 그대로라 Realtime 이벤트가 오지 않는다 — 그 틈을 여기서 메운다.
 * 같은 id 는 10초에 한 번만 시도한다(권한 밖이면 계속 null 이라 무한 재시도를 막는다).
 */
const ensureTriedAt = new Map<string, number>();
const ENSURE_RETRY_MS = 10_000;

export async function ensureConversationRecords(ids: readonly string[]): Promise<void> {
  const now = Date.now();
  const have = new Set(useConversationStore.getState().records.map((c) => c.id));
  const missing = [...new Set(ids)].filter(
    (id) => id && !have.has(id) && now - (ensureTriedAt.get(id) ?? 0) > ENSURE_RETRY_MS,
  );
  if (missing.length === 0) return;
  for (const id of missing) ensureTriedAt.set(id, now);
  for (let i = 0; i < missing.length; i += 100) {
    const { data, error } = await getSupabase()
      .from("conversations")
      .select("*")
      .in("id", missing.slice(i, i + 100));
    if (error || !data) continue;
    for (const row of data) {
      useConversationStore.getState()._upsert(rowToConversation(row as ConversationRow));
    }
  }
}

/** `ensureConversationRecords` 의 hook 판 — 적재가 끝난 뒤 목록의 빠진 대화를 메운다. */
export function useEnsureConversations(ids: readonly string[]): void {
  const hydrated = useConversationHydrated();
  const key = JSON.stringify(ids);
  useEffect(() => {
    if (hydrated && key !== "[]") void ensureConversationRecords(JSON.parse(key) as string[]);
  }, [hydrated, key]);
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
