"use client";

import { getSupabase } from "@/lib/supabase/client";
import {
  conversationSchema,
  type Conversation,
  type Framework,
  type Message,
  FRAMEWORKS,
} from "@/lib/conversation-schema";
import {
  useConversationStore,
  type ConversationRecord,
} from "@/lib/conversation-store";

/**
 * Conversation service — 라이브(Seam A) 대화를 Supabase `public.conversations` 에 영속화.
 *
 * 프로세스 linchpin(0005 주석 참조): 관리자 하차장 목록·세무사 코멘트 원문·RAG write-path
 * 가 모두 이 테이블을 읽는다. 라이브 챗은 매 assistant 턴 후 여기에 upsert 된다.
 *
 * 쓰기: 브라우저 Supabase 클라이언트(anon+RLS). 소유자(사장님) JWT 로 나가 owner_id =
 * current_domain_id() RLS 를 통과한다(§3-2·0005).
 */

const FRAMEWORK_SET = new Set<string>(FRAMEWORKS);

export interface LiveConversationSnapshot {
  conversationId: string;
  occupation: string;
  ownerId: string;
  ownerLabel?: string | null;
  /** 세션 시작 시각(ms) — 하차장 정렬 키. 매 턴 동일값이라 upsert 시 보존된다. */
  createdAt: number;
  /** 현재까지 누적된 라이브 메시지(user/assistant 교대). */
  messages: Message[];
}

/** 첫 사용자 질문에서 대화 제목을 만든다(자동 생성). */
export function deriveTitle(messages: Message[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  const text = firstUser?.segments.map((s) => s.text).join(" ").trim();
  if (!text) return "새 상담";
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

/** 라이브 메시지 배열을 conversation-schema 에 맞는 Conversation payload 로 빌드. */
export function buildLivePayload(snap: LiveConversationSnapshot): Conversation {
  // order 를 0..n 오름차순으로 재부여(스키마 superRefine: 오름차순·중복불가).
  const messages: Message[] = snap.messages.map((m, i) => ({ ...m, order: i }));

  // assistant 세그먼트에서 등장한 해석 프레임워크 수집(중복 제거).
  const frameworks: Framework[] = [];
  for (const m of messages) {
    for (const s of m.segments) {
      if (s.framework && FRAMEWORK_SET.has(s.framework) && !frameworks.includes(s.framework)) {
        frameworks.push(s.framework);
      }
    }
  }

  const title = deriveTitle(messages);
  const firstUserText =
    messages.find((m) => m.role === "user")?.segments.map((s) => s.text).join(" ") ?? title;

  return {
    id: snap.conversationId,
    schemaVersion: "live-1",
    persona: {
      occupation: snap.occupation,
      label: snap.ownerLabel ?? "사장님",
      businessType: snap.ownerLabel ?? "미상",
    },
    topic: {
      title,
      taxCategory: "미분류",
      caseRefs: [],
      frameworks,
    },
    starterQuestions: [{ id: `${snap.conversationId}_q0`, text: firstUserText.slice(0, 200) }],
    messages,
  };
}

/**
 * 스냅샷을 Supabase 에 upsert. 매 assistant 턴 후 호출.
 * payload 는 유효 Conversation 으로 검증하되, 검증 실패해도 영속화는 진행(챗을 막지 않음).
 */
export async function persistLive(snap: LiveConversationSnapshot): Promise<void> {
  if (snap.messages.length === 0) return;

  const payload = buildLivePayload(snap);
  const check = conversationSchema.safeParse(payload);
  if (!check.success) {
    console.warn("[conversation] payload 검증 경고(영속화는 진행):", check.error.message.slice(0, 200));
  }

  const now = Date.now();
  const row = {
    id: snap.conversationId,
    occupation: snap.occupation,
    tax_category: payload.topic.taxCategory,
    title: payload.topic.title,
    owner_id: snap.ownerId,
    owner_label: snap.ownerLabel ?? null,
    source: "live",
    status: "live",
    turn_count: snap.messages.length,
    created_at: snap.createdAt,
    updated_at: now,
    payload,
  };

  const { error } = await getSupabase()
    .from("conversations")
    .upsert(row, { onConflict: "id" });
  if (error) throw error;
}

// ════════════════════════════════════════════════════════════════════════════
// 하차장(감사 후보) — 정지 스냅샷 목록/제외
// ════════════════════════════════════════════════════════════════════════════
// 정책(0006): 5분 후 사진 찍힌(snapshot_at != null) 대화만 하차장에 노출한다.
// 라이브 진행 중(사진 전) 대화는 정지 데이터가 아니므로 목록에서 제외.
// 읽기는 Realtime 동기화된 conversation-store 캐시에서(형태·로직 불변, §3-3).

export type PoolSortKey = "created_desc" | "created_asc" | "occupation" | "owner";

export interface PoolListFilter {
  q?: string;
  occupation?: string;
  sort?: PoolSortKey;
  /** 1-based 페이지 번호. */
  page?: number;
  pageSize?: number;
  /** 제외된 대화도 포함할지(관리자 열람용). 기본 false. */
  includeExcluded?: boolean;
}

export interface PoolListResult {
  items: ConversationRecord[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_PAGE_SIZE = 100;

/** 하차장 목록 노출 대상: 사진 찍힘 & (기본) 미제외. */
export function isPoolEligible(c: ConversationRecord, includeExcluded = false): boolean {
  if (c.snapshotAt == null) return false;
  if (!includeExcluded && c.excludedAt != null) return false;
  return true;
}

function ownerName(c: ConversationRecord): string {
  return c.ownerLabel ?? c.ownerId;
}

/**
 * 하차장 후보를 필터/검색/정렬하여 전체 배열로 반환(페이징 없음).
 * 상태(신규/배정됨) 필터는 task 데이터가 필요해 호출측(컴포넌트)에서 적용한다.
 */
export function queryPool(filter?: PoolListFilter): ConversationRecord[] {
  const includeExcluded = filter?.includeExcluded ?? false;
  let items = useConversationStore
    .getState()
    .records.filter((c) => isPoolEligible(c, includeExcluded));

  if (filter?.occupation) {
    items = items.filter((c) => c.occupation === filter.occupation);
  }
  if (filter?.q) {
    const q = filter.q.toLowerCase();
    items = items.filter(
      (c) =>
        (c.title ?? "").toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        ownerName(c).toLowerCase().includes(q),
    );
  }

  const sort = filter?.sort ?? "created_desc";
  items.sort((a, b) => {
    switch (sort) {
      case "created_asc":
        return a.createdAt - b.createdAt;
      case "occupation":
        return (
          a.occupation.localeCompare(b.occupation, "ko") ||
          b.createdAt - a.createdAt
        );
      case "owner":
        return (
          ownerName(a).localeCompare(ownerName(b), "ko") ||
          b.createdAt - a.createdAt
        );
      case "created_desc":
      default:
        return b.createdAt - a.createdAt;
    }
  });
  return items;
}

/** 하차장 목록 — queryPool 결과에 페이징을 씌워 반환. */
export function listPool(filter?: PoolListFilter): PoolListResult {
  const items = queryPool(filter);
  const total = items.length;
  const pageSize = filter?.pageSize ?? DEFAULT_PAGE_SIZE;
  const page = Math.max(1, filter?.page ?? 1);
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total, page, pageSize };
}

/** 단건 조회(스토어 캐시). */
export function getPoolRecord(id: string): ConversationRecord | null {
  return useConversationStore.getState().records.find((c) => c.id === id) ?? null;
}

/** 대화를 하차장에서 제외/복원(관리자). excluded_at 토글. */
export async function setExcluded(id: string, excluded: boolean): Promise<void> {
  const excludedAt = excluded ? Date.now() : null;
  const { error } = await getSupabase()
    .from("conversations")
    .update({ excluded_at: excludedAt })
    .eq("id", id);
  if (error) throw error;
  useConversationStore.getState()._patchById(id, { excludedAt });
}
