"use client";

import { getSupabase } from "@/lib/supabase/client";
import type { Conversation } from "@/lib/conversation-schema";
import type {
  MaskReport,
  PoolCaseSummary,
  PoolConsent,
  PoolConsentState,
} from "@/lib/poc-schema";

/**
 * 비식별 상담사 풀 service (0037). 하차장 pool 과 다른 것.
 *
 * - 사장님: previewMask(마스킹 미리보기, 저장 안 함) → grant(동의·마스킹·등재 한 번에) / revoke
 *           getConsent 는 본인 행만(RLS).
 * - 세무사: listCases(본문 없음) → openCase(마스킹 사본 + 열람 기록 1건).
 * 원문은 어느 함수도 돌려주지 않는다 — 풀에 보이는 것은 동의 시점에 얼린 마스킹 사본뿐이다.
 */

export const POOL_CONSENT_DAYS = 7;

type Row = Record<string, unknown>;

function num(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function rowToConsent(r: Row): PoolConsent {
  return {
    conversationId: String(r.conversation_id),
    viewerId: String(r.viewer_id),
    grantedAt: num(r.granted_at),
    expiresAt: num(r.expires_at),
    revokedAt: r.revoked_at == null ? undefined : num(r.revoked_at),
    maskReport: (r.mask_report as MaskReport) ?? {},
  };
}

export function consentState(c: PoolConsent, now: number = Date.now()): PoolConsentState {
  if (c.revokedAt) return "revoked";
  return c.expiresAt > now ? "active" : "expired";
}

export async function previewMask(
  conversationId: string,
): Promise<{ payload: Conversation; report: MaskReport }> {
  const { data, error } = await getSupabase().rpc("preview_pool_mask", {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
  const d = data as { payload: Conversation; report: MaskReport };
  return { payload: d.payload, report: d.report ?? {} };
}

export async function grant(conversationId: string): Promise<PoolConsent> {
  const { data, error } = await getSupabase().rpc("grant_pool_consent", {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
  return rowToConsent(data as Row);
}

export async function revoke(conversationId: string): Promise<PoolConsent> {
  const { data, error } = await getSupabase().rpc("revoke_pool_consent", {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
  return rowToConsent(data as Row);
}

/** 이 대화의 내 동의(없으면 null). masked_payload 는 싣지 않는다. */
export async function getConsent(conversationId: string): Promise<PoolConsent | null> {
  const { data, error } = await getSupabase()
    .from("conversation_pool_consents")
    .select("conversation_id, viewer_id, granted_at, expires_at, revoked_at, mask_report")
    .eq("conversation_id", conversationId)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToConsent(data as Row) : null;
}

export async function listCases(): Promise<PoolCaseSummary[]> {
  const { data, error } = await getSupabase().rpc("list_pool_cases");
  if (error) throw error;
  return ((data as Row[]) ?? []).map((r) => ({
    conversationId: String(r.conversation_id),
    occupation: str(r.occupation),
    taxCategory: str(r.tax_category),
    title: str(r.title),
    firstQuestion: str(r.first_question),
    turnCount: num(r.turn_count),
    grantedAt: num(r.granted_at),
    expiresAt: num(r.expires_at),
    maskReport: (r.mask_report as MaskReport) ?? {},
    viewedByMe: Boolean(r.viewed_by_me),
  }));
}

export async function openCase(
  conversationId: string,
): Promise<{ summary: Pick<PoolCaseSummary, "conversationId" | "occupation" | "taxCategory" | "title" | "grantedAt" | "expiresAt" | "maskReport">; payload: Conversation }> {
  const { data, error } = await getSupabase().rpc("open_pool_case", {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
  const r = ((data as Row[]) ?? [])[0];
  if (!r) throw new Error("사례를 찾을 수 없습니다(철회되었거나 만료되었을 수 있습니다).");
  return {
    summary: {
      conversationId: String(r.conversation_id),
      occupation: str(r.occupation),
      taxCategory: str(r.tax_category),
      title: str(r.title),
      grantedAt: num(r.granted_at),
      expiresAt: num(r.expires_at),
      maskReport: (r.mask_report as MaskReport) ?? {},
    },
    payload: r.masked_payload as Conversation,
  };
}
