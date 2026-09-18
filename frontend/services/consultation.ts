"use client";

import { getSupabase } from "@/lib/supabase/client";
import type { ConsultationRequest } from "@/lib/poc-schema";

/**
 * 상담 신청 service (0034 consultation_requests).
 *
 * 이번 단계는 신청(pending) 까지. 수락/거절/완료/취소 전이와 메일 알림, 받는 쪽 화면은
 * 다음 단계(b) — docs/doing/세무사연결_핸드오프_이식설계.md §2.
 */

function makeId(): string {
  return `consult-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 이 대화에서 내가 이미 넣은 신청(취소·거절 제외) 중 가장 최근 것.
 * 연결 카드가 다시 렌더될 때(대화 재진입) 중복 신청을 막는 데 쓴다. RLS 로 본인 행만 보인다.
 */
export async function findActiveForConversation(
  conversationId: string,
): Promise<{ id: string; expertId: string; status: string } | null> {
  const { data, error } = await getSupabase()
    .from("consultation_requests")
    .select("id, expert_id, status")
    .eq("conversation_id", conversationId)
    .in("status", ["pending", "accepted", "completed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { id: data.id, expertId: data.expert_id, status: data.status };
}

export async function request(input: {
  conversationId: string;
  viewerId: string;
  expertId: string;
  message?: string;
}): Promise<ConsultationRequest> {
  const now = Date.now();
  const created: ConsultationRequest = {
    id: makeId(),
    conversationId: input.conversationId,
    viewerId: input.viewerId,
    expertId: input.expertId,
    message: input.message?.trim() || undefined,
    status: "pending",
    statusHistory: [{ status: "pending", at: now, actor: input.viewerId }],
    createdAt: now,
    updatedAt: now,
  };
  const { error } = await getSupabase().from("consultation_requests").insert({
    id: created.id,
    conversation_id: created.conversationId,
    viewer_id: created.viewerId,
    expert_id: created.expertId,
    message: created.message ?? null,
    status: created.status,
    status_history: created.statusHistory,
    created_at: created.createdAt,
    updated_at: created.updatedAt,
  });
  if (error) throw error;
  return created;
}
