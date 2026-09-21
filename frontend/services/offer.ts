"use client";

import { getSupabase } from "@/lib/supabase/client";
import type { ConsultationOffer } from "@/lib/poc-schema";
import { rowToOffer, useOfferStore, type OfferRow } from "@/lib/offer-store";

/**
 * 연결 요청(제안) service (0039) — 경로 B.
 *
 * - 세무사: makeOffer(풀 사례에 요청 + 메시지 1건) / withdraw
 * - 사장님: approve(→ DB 가 채팅방을 연다) / decline(사유 선택)
 * 상태 변경은 전부 transition_offer() 하나. 반환 행을 스토어에 바로 반영한다(Realtime echo 는 멱등).
 */

/** DB 오류 문구 → 사용자 문구. 모르는 오류는 원문 그대로. */
const OFFER_ERRORS: Array<[RegExp, string]> = [
  [/already offered/, "이 사례에는 이미 연결을 요청했습니다(사례당 1회)."],
  [/offer limit reached/, "이 사례에는 대기 중인 요청이 이미 5건이라 지금은 요청할 수 없습니다."],
  [/pool case not available/, "사례가 풀에서 내려갔습니다(사장님이 철회했거나 공개 기간이 끝났습니다)."],
  [/not listed/, "상담 프로필을 공개해야 연결을 요청할 수 있습니다. [상담 프로필]에서 공개로 바꿔 주세요."],
  [/room already open/, "이 사례의 사장님과 이미 채팅방이 열려 있습니다."],
  [/already requested you/, "이 사장님이 이미 나에게 상담을 신청했습니다. [상담 신청]에서 수락해 주세요."],
  [/room limit reached/, "이 대화에는 열린 채팅방이 이미 3개라 승인할 수 없습니다. 다른 채팅방을 닫은 뒤 다시 시도해 주세요."],
  [/too long/, "메시지는 300자까지 쓸 수 있습니다."],
  [/invalid transition/, "이미 처리된 요청입니다."],
];

export function offerErrorMessage(e: unknown, fallback: string): string {
  const raw =
    e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "";
  for (const [re, msg] of OFFER_ERRORS) if (re.test(raw)) return msg;
  return raw || fallback;
}

function apply(row: OfferRow): ConsultationOffer {
  const offer = rowToOffer(row);
  useOfferStore.getState()._upsert(offer);
  return offer;
}

export async function makeOffer(conversationId: string, message: string): Promise<ConsultationOffer> {
  const { data, error } = await getSupabase().rpc("make_offer", {
    p_conversation_id: conversationId,
    p_message: message.trim() || null,
  });
  if (error) throw error;
  return apply(data as OfferRow);
}

/**
 * 전이. 기한이 지난 요청은 DB 가 요청한 전이 대신 expired 로 확정해 돌려준다 — 그 경우 오류로 알린다.
 */
async function transition(
  id: string,
  next: "approved" | "declined" | "withdrawn",
  note?: string,
): Promise<ConsultationOffer> {
  const { data, error } = await getSupabase().rpc("transition_offer", {
    p_id: id,
    p_next: next,
    p_note: note?.trim() || null,
  });
  if (error) throw error;
  const offer = apply(data as OfferRow);
  if (offer.status !== next) {
    throw new Error("요청 기한(7일)이 지나 만료되었습니다.");
  }
  return offer;
}

export const approve = (id: string) => transition(id, "approved");
export const decline = (id: string, reason?: string) => transition(id, "declined", reason);
export const withdraw = (id: string) => transition(id, "withdrawn");
