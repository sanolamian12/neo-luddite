"use client";

import { getSupabase } from "@/lib/supabase/client";
import {
  CONTACT_CHANNELS,
  type ContactChannel,
  type ContactVisibility,
  type ExpertCard,
  type ExpertContact,
  type ExpertProfile,
} from "@/lib/poc-schema";

/**
 * 세무사 상담 프로필 · 채팅 카드 목록 · 하트 service (0034).
 *
 * - 세무사 본인: getMyProfile / saveMyProfile (expert_profiles, RLS 본인만)
 * - 채팅 카드:   listExperts → list_experts() RPC. 연락처는 DB 가 공개 범위대로 걸러 준다.
 * - 하트:        toggleLike → toggle_expert_like() RPC. (세무사, 대화, 사용자)당 1회.
 */

/** 프로필 편집 화면에서 고르는 프리셋 일러스트. */
export const AVATAR_PRESETS = Array.from(
  { length: 7 },
  (_, i) => `/experts/preset-${i + 1}.webp`,
);

export const CONTACT_LABEL: Record<ContactChannel, string> = {
  phone: "전화",
  email: "이메일",
  kakao: "카카오톡 오픈채팅",
};

export const VISIBILITY_LABEL: Record<ContactVisibility, string> = {
  public: "공개",
  after_accept: "상담 수락 후 공개",
  hidden: "비공개",
};

const COLUMN: Record<ContactChannel, { value: string; visibility: string }> = {
  phone: { value: "contact_phone", visibility: "phone_visibility" },
  email: { value: "contact_email", visibility: "email_visibility" },
  kakao: { value: "contact_kakao", visibility: "kakao_visibility" },
};

type Row = Record<string, unknown>;

function contactsFromRow(r: Row): Record<ContactChannel, ExpertContact> {
  const out = {} as Record<ContactChannel, ExpertContact>;
  for (const ch of CONTACT_CHANNELS) {
    const value = r[COLUMN[ch].value];
    out[ch] = {
      value: typeof value === "string" && value.trim() ? value : undefined,
      visibility: (r[COLUMN[ch].visibility] as ContactVisibility) ?? "hidden",
    };
  }
  return out;
}

/** 아직 저장한 적 없는 세무사의 빈 프로필. */
export function emptyProfile(auditorId: string): ExpertProfile {
  return {
    auditorId,
    listed: false,
    bio: "",
    specialties: [],
    yearsExperience: 0,
    availability: "available",
    avatarUrl: undefined,
    contacts: {
      phone: { visibility: "hidden" },
      email: { visibility: "hidden" },
      kakao: { visibility: "hidden" },
    },
    updatedAt: 0,
  };
}

export async function getMyProfile(auditorId: string): Promise<ExpertProfile | null> {
  const { data, error } = await getSupabase()
    .from("expert_profiles")
    .select("*")
    .eq("auditor_id", auditorId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r = data as Row;
  return {
    auditorId: r.auditor_id as string,
    listed: Boolean(r.listed),
    bio: (r.bio as string) ?? "",
    specialties: (r.specialties as string[]) ?? [],
    yearsExperience: Number(r.years_experience ?? 0),
    availability: r.availability as ExpertProfile["availability"],
    avatarUrl: (r.avatar_url as string | null) ?? undefined,
    contacts: contactsFromRow(r),
    updatedAt: Number(r.updated_at ?? 0),
  };
}

export async function saveMyProfile(profile: ExpertProfile): Promise<ExpertProfile> {
  const row: Row = {
    auditor_id: profile.auditorId,
    listed: profile.listed,
    bio: profile.bio.trim(),
    specialties: profile.specialties.map((s) => s.trim()).filter(Boolean),
    years_experience: profile.yearsExperience,
    availability: profile.availability,
    avatar_url: profile.avatarUrl ?? null,
    updated_at: Date.now(),
  };
  for (const ch of CONTACT_CHANNELS) {
    row[COLUMN[ch].value] = profile.contacts[ch].value?.trim() || null;
    row[COLUMN[ch].visibility] = profile.contacts[ch].visibility;
  }
  const { error } = await getSupabase()
    .from("expert_profiles")
    .upsert(row, { onConflict: "auditor_id" });
  if (error) throw error;
  return (await getMyProfile(profile.auditorId)) ?? profile;
}

/**
 * 채팅 카드용 목록. 정렬: 이 대화를 검수한 세무사 → 하트 많은 순 → 이름.
 * (DB 는 공개(listed)·활성 세무사만 돌려준다.)
 */
export async function listExperts(conversationId: string | null): Promise<ExpertCard[]> {
  const { data, error } = await getSupabase().rpc("list_experts", {
    p_conversation_id: conversationId,
  });
  if (error) throw error;
  const items: ExpertCard[] = ((data as Row[] | null) ?? []).map((r) => ({
    auditorId: r.auditor_id as string,
    displayName: r.display_name as string,
    qualifications: (r.qualifications as string[]) ?? [],
    bio: (r.bio as string) ?? "",
    specialties: (r.specialties as string[]) ?? [],
    yearsExperience: Number(r.years_experience ?? 0),
    availability: r.availability as ExpertCard["availability"],
    avatarUrl: (r.avatar_url as string | null) ?? undefined,
    avatarColor: (r.avatar_color as string | null) ?? undefined,
    contacts: contactsFromRow(r),
    likeCount: Number(r.like_count ?? 0),
    likedByMe: Boolean(r.liked_by_me),
    reviewedCount: Number(r.reviewed_count ?? 0),
    reviewedThisCase: Boolean(r.reviewed_this_case),
  }));
  items.sort((a, b) => {
    if (a.reviewedThisCase !== b.reviewedThisCase) return a.reviewedThisCase ? -1 : 1;
    if (b.likeCount !== a.likeCount) return b.likeCount - a.likeCount;
    return a.displayName.localeCompare(b.displayName, "ko");
  });
  return items;
}

/** 하트 토글. 반환: 토글 후 내 상태와 그 세무사의 전체 하트 수. */
export async function toggleLike(
  expertId: string,
  conversationId: string,
): Promise<{ liked: boolean; likeCount: number }> {
  const { data, error } = await getSupabase().rpc("toggle_expert_like", {
    p_expert_id: expertId,
    p_conversation_id: conversationId,
  });
  if (error) throw error;
  const r = ((data as Row[] | null) ?? [])[0] ?? {};
  return { liked: Boolean(r.liked), likeCount: Number(r.like_count ?? 0) };
}
