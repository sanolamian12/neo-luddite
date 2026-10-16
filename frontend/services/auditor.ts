"use client";

import { getSupabase } from "@/lib/supabase/client";
import { useAuditorRegistryStore } from "@/lib/auditor-registry-store";
import type { AuditorEntry, AuditorStatus } from "@/lib/poc-schema";

/**
 * 평가자 (auditor registry) service.
 *
 * 세션 계정과 분리된 다중 평가자 데이터를 관리한다.
 * 모든 함수는 `Promise<T>` 반환 — 백엔드 연결 시 동일 시그니처로 fetch 교체.
 */

export interface AuditorFilter {
  status?: AuditorStatus;
  q?: string;
}

export interface AuditorListResult {
  items: AuditorEntry[];
  total: number;
}

export async function list(filter?: AuditorFilter): Promise<AuditorListResult> {
  let items = useAuditorRegistryStore.getState().auditors.slice();
  if (filter?.status) items = items.filter((a) => a.status === filter.status);
  if (filter?.q) {
    const q = filter.q.toLowerCase();
    items = items.filter(
      (a) =>
        a.id.toLowerCase().includes(q) ||
        a.displayName.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q),
    );
  }
  // active 먼저, 등록일 내림차순
  items.sort((a, b) => {
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;
    return b.createdAt - a.createdAt;
  });
  return { items, total: items.length };
}

export async function get(id: string): Promise<AuditorEntry | null> {
  return (
    useAuditorRegistryStore.getState().auditors.find((a) => a.id === id) ?? null
  );
}

export async function suspend(id: string): Promise<AuditorEntry | null> {
  const sb = getSupabase();
  const { error } = await sb
    .from("auditors")
    .update({ status: "suspended" })
    .eq("id", id);
  if (error) throw error;
  useAuditorRegistryStore.getState()._patch(id, { status: "suspended" });
  return get(id);
}

export async function resume(id: string): Promise<AuditorEntry | null> {
  const sb = getSupabase();
  const { error } = await sb
    .from("auditors")
    .update({ status: "active" })
    .eq("id", id);
  if (error) throw error;
  useAuditorRegistryStore.getState()._patch(id, { status: "active" });
  return get(id);
}

/** 승인 취소 확인 창에 보여 줄 영향 건수(0050 admin_expert_revoke_preview, 0058 에서 검수 칸 제거). */
export interface RevokePreview {
  requestsPending: number;
  requestsAccepted: number;
  offersPending: number;
  roomsOpen: number;
  expertCases: number;
  sharedCases: number;
  ledgerEntries: number;
}

export interface RevokeResult {
  requestsDeclined: number;
  requestsCompleted: number;
  offersWithdrawn: number;
  roomsClosed: number;
  expertCasesArchived: number;
}

export async function revokePreview(id: string): Promise<RevokePreview> {
  const { data, error } = await getSupabase().rpc("admin_expert_revoke_preview", { p_domain: id });
  if (error) throw error;
  return data as RevokePreview;
}

/**
 * 세무사 승인 취소(0050 revoke_expert, 0058 판) — 진행 중 상담 정리·카드 삭제·사례 보관·
 * 일반 회원 강등이 DB 한 트랜잭션에서 일어난다. 사유는 신청자가 /expert/apply 에서 본다.
 */
export async function revoke(id: string, reason: string): Promise<RevokeResult> {
  const { data, error } = await getSupabase().rpc("revoke_expert", { p_domain: id, p_reason: reason });
  if (error) throw error;
  useAuditorRegistryStore.getState()._patch(id, { status: "revoked", email: "", phone: undefined });
  return data as RevokeResult;
}

/** DB 예외 메시지 → 화면 문구. */
export function revokeErrorMessage(error: unknown): string {
  const message = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : "";
  const known: [RegExp, string][] = [
    [/reason is required/i, "취소 사유를 입력해 주세요."],
    [/reason too long/i, "사유는 500자 이내로 입력해 주세요."],
    [/already revoked/i, "이미 승인이 취소된 세무사예요."],
    [/only expert accounts/i, "세무사 계정만 승인을 취소할 수 있어요."],
    [/expert not found/i, "세무사 기록을 찾을 수 없어요."],
    [/admin only/i, "관리자만 할 수 있어요."],
  ];
  return known.find(([pattern]) => pattern.test(message))?.[1] ?? "처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
}

export async function updateNote(
  id: string,
  note: string,
): Promise<AuditorEntry | null> {
  const sb = getSupabase();
  const trimmed = note.trim() || undefined;
  const { error } = await sb
    .from("auditors")
    .update({ note: trimmed ?? null })
    .eq("id", id);
  if (error) throw error;
  useAuditorRegistryStore.getState()._patch(id, { note: trimmed });
  return get(id);
}
