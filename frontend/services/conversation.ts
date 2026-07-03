"use client";

import { getSupabase } from "@/lib/supabase/client";
import {
  conversationSchema,
  type Conversation,
  type Framework,
  type Message,
  FRAMEWORKS,
} from "@/lib/conversation-schema";

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
