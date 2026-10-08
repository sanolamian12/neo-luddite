import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Account } from "./account-schema";

const profileSchema = z.object({
  id: z.string().min(1),
  domain_id: z.string().min(1),
  role: z.enum(["user", "auditor", "admin"]),
  label: z.string().min(1),
  display_name: z.string().nullable(),
  occupation: z.string().nullable(),
});

/** The Auth server verifies the identity; profiles (under RLS) supplies its role. */
export async function verifiedAccount(client: SupabaseClient): Promise<Account | null> {
  const { data: { user }, error } = await client.auth.getUser();
  if (error?.name === "AuthSessionMissingError") return null;
  if (error) throw new Error("로그인 상태를 확인하지 못했어요. 다시 로그인해 주세요.");
  if (!user) return null;
  const { data, error: profileError } = await client.from("profiles")
    .select("id, domain_id, role, label, display_name, occupation")
    .eq("id", user.id).maybeSingle();
  const parsed = profileSchema.safeParse(data);
  if (profileError || !parsed.success || parsed.data.id !== user.id) {
    throw new Error("계정 정보를 불러오지 못했어요. 다시 시도해 주세요.");
  }
  const profile = parsed.data;
  const common = { id: profile.domain_id, label: profile.label };
  if (profile.role === "user") return { ...common, role: "viewer", avatarColor: "var(--brand-blue)", occupation: profile.occupation ?? "" };
  if (profile.role === "auditor") return { ...common, role: "auditor", avatarColor: "var(--brand-green)", reviewerName: profile.display_name || profile.label };
  return { ...common, role: "admin", avatarColor: "var(--brand-amber)", operatorName: profile.display_name || profile.label };
}
