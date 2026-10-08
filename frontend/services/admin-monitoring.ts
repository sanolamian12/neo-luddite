import { getSupabase } from "@/lib/supabase/client";

/**
 * 관리자 사용자·사용 현황 (0049 admin_list_users · admin_usage_overview) 과 계정 삭제(0048).
 * auth.users·rag.chat_turns 는 클라이언트 권한이 없어 관리자 전용 RPC 로만 읽는다.
 */

export type UserRole = "user" | "auditor" | "admin";

export interface AdminUserRow {
  domainId: string;
  role: UserRole;
  displayName: string;
  email: string | null;
  providers: string[];
  createdAt: number | null;
  lastSignInAt: number | null;
  conversationCount: number;
  lastConversationAt: number | null;
  applicationStatus: string | null;
}

export interface UsageDay {
  day: string;
  signups: number;
  memberTurns: number;
  guestTurns: number;
  conversations: number;
}

export interface UsageOverview {
  days: number;
  generatedAt: number;
  users: {
    total: number;
    byRole: Partial<Record<UserRole, number>>;
    byProvider: Record<string, number>;
    active7d: number;
    active30d: number;
    newInPeriod: number;
  };
  daily: UsageDay[];
  turns: { member: number; guest: number; byOutcome: Record<string, number> };
  consultations: Record<string, number>;
  pendingApplications: number;
}

export const ROLE_LABEL: Record<UserRole, string> = { user: "회원", auditor: "세무사", admin: "관리자" };
export const PROVIDER_LABEL: Record<string, string> = { google: "Google", kakao: "카카오", email: "이메일" };

interface UserDbRow {
  domain_id: string; role: UserRole; display_name: string; email: string | null; providers: string[];
  created_at: number | null; last_sign_in_at: number | null; conversation_count: number;
  last_conversation_at: number | null; application_status: string | null; total: number;
}

const num = (v: number | string | null) => (v == null ? null : Number(v));

export async function listUsers(input: { role?: UserRole | null; q?: string; limit?: number; offset?: number } = {}): Promise<{ rows: AdminUserRow[]; total: number }> {
  const { data, error } = await getSupabase().rpc("admin_list_users", {
    p_role: input.role ?? null,
    p_q: input.q?.trim() || null,
    p_limit: input.limit ?? 50,
    p_offset: input.offset ?? 0,
  });
  if (error) throw error;
  const rows = (data ?? []) as UserDbRow[];
  return {
    total: rows.length ? Number(rows[0].total) : 0,
    rows: rows.map((r) => ({
      domainId: r.domain_id, role: r.role, displayName: r.display_name, email: r.email,
      providers: r.providers ?? [], createdAt: num(r.created_at), lastSignInAt: num(r.last_sign_in_at),
      conversationCount: Number(r.conversation_count), lastConversationAt: num(r.last_conversation_at),
      applicationStatus: r.application_status,
    })),
  };
}

export async function usageOverview(days = 30): Promise<UsageOverview> {
  const { data, error } = await getSupabase().rpc("admin_usage_overview", { p_days: days });
  if (error) throw error;
  return data as UsageOverview;
}

/** 관리자 계정 삭제 확인 문구. */
export const ADMIN_DELETE_CONFIRM_WORD = "삭제";

export async function deleteAccount(domainId: string): Promise<Record<string, unknown>> {
  const { data, error } = await getSupabase().rpc("admin_delete_account", { p_domain: domainId });
  if (error) {
    if (/cannot be removed/i.test(error.message)) throw new Error("관리자 계정은 여기서 삭제할 수 없어요.");
    throw new Error("계정을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.");
  }
  return (data ?? {}) as Record<string, unknown>;
}
