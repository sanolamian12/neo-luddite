"use client";

import { getSupabase } from "@/lib/supabase/client";
import type { ConsultationRequest, ConsultationStatus } from "@/lib/poc-schema";
import {
  rowToConsultation,
  useConsultationStore,
  type ConsultationRow,
} from "@/lib/consultation-store";

/**
 * 상담 신청 service (0034 consultation_requests · 0035 transition_consultation).
 *
 * - 신청(pending) insert — 세무사 알림 메일은 DB 트리거가 넣는다.
 * - 상태 전이는 transition() 하나로만. 역할·소유·직전 상태 검사와 알림 메일은 DB 함수가 한다.
 */

export const STATUS_LABEL: Record<ConsultationStatus, string> = {
  pending: "대기 중",
  accepted: "수락됨",
  declined: "거절됨",
  completed: "완료",
  cancelled: "취소됨",
};

/**
 * 전이 1회. 허용되지 않는 전이·권한 없는 호출은 DB 가 예외로 거부한다.
 * 반환 행을 스토어에 바로 반영(Realtime echo 는 멱등).
 */
export async function transition(
  id: string,
  next: Exclude<ConsultationStatus, "pending">,
  note?: string,
): Promise<ConsultationRequest> {
  const { data, error } = await getSupabase().rpc("transition_consultation", {
    p_id: id,
    p_next: next,
    p_note: note?.trim() || null,
  });
  if (error) throw error;
  const updated = rowToConsultation(data as ConsultationRow);
  useConsultationStore.getState()._upsert(updated);
  return updated;
}

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
  useConsultationStore.getState()._upsert(created);
  return created;
}
