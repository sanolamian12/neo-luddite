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

// ════════════════════════════════════════════════════════════════════════════
// 프로필 사진 업로드 (0036, Storage 버킷 `expert-avatars`)
// ════════════════════════════════════════════════════════════════════════════
// 프리셋 일러스트 대신 자기 사진을 쓰고 싶은 세무사를 위한 경로.
// 원본을 그대로 올리지 않고 **브라우저에서 256px 정사각 webp 로 줄여** 올린다:
//  · 카드에 뜨는 크기가 48px 남짓이라 그 이상은 낭비다(프리셋도 256px, 장당 ~5KB)
//  · 휴대폰 사진 그대로면 수 MB — 비로그인 방문자의 채팅 카드까지 느려진다
//  · EXIF(촬영 위치 등)가 캔버스 재인코딩에서 떨어져 나간다
// 경로는 `<auditor_id>/<epoch>.webp` — 첫 폴더로 소유자를 판정하는 RLS 와 짝이다.

export const AVATAR_BUCKET = "expert-avatars";
/** 고르기 전 원본 상한. 이보다 크면 브라우저에서 디코딩하다 멈출 수 있어 미리 막는다. */
export const AVATAR_SOURCE_MAX_BYTES = 12 * 1024 * 1024;
const AVATAR_EDGE = 256;
const AVATAR_QUALITY = 0.85;
const PUBLIC_PREFIX = `/storage/v1/object/public/${AVATAR_BUCKET}/`;

/** 이 URL 이 업로드된 객체인가(프리셋 `/experts/...` 와 구분). */
export function isUploadedAvatar(url: string | undefined): boolean {
  return Boolean(url && url.includes(PUBLIC_PREFIX));
}

/** 공개 URL → 버킷 안 경로. 우리 버킷이 아니면 null. */
function avatarObjectPath(url: string): string | null {
  const at = url.indexOf(PUBLIC_PREFIX);
  if (at === -1) return null;
  return decodeURIComponent(url.slice(at + PUBLIC_PREFIX.length).split("?")[0]);
}

/** 가운데를 정사각으로 잘라 256px webp 로 다시 굽는다. */
async function toSquareWebp(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const edge = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_EDGE;
    canvas.height = AVATAR_EDGE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("이 브라우저에서는 이미지를 줄일 수 없습니다.");
    ctx.drawImage(
      bitmap,
      (bitmap.width - edge) / 2,
      (bitmap.height - edge) / 2,
      edge,
      edge,
      0,
      0,
      AVATAR_EDGE,
      AVATAR_EDGE,
    );
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", AVATAR_QUALITY),
    );
    if (!blob) throw new Error("이미지를 변환하지 못했습니다.");
    return blob;
  } finally {
    bitmap.close();
  }
}

/**
 * 사진을 올리고 공개 URL 을 돌려준다(프로필 저장은 호출자가 한다 —
 * 업로드만으로 카드가 바뀌면 "저장 안 누르고 나갔는데 반영된" 상태가 된다).
 */
export async function uploadAvatar(auditorId: string, file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("이미지 파일만 올릴 수 있습니다.");
  }
  if (file.size > AVATAR_SOURCE_MAX_BYTES) {
    throw new Error("사진이 너무 큽니다(12MB 이하).");
  }
  const blob = await toSquareWebp(file);
  const path = `${auditorId}/${Date.now()}.webp`;
  const sb = getSupabase();
  const { error } = await sb.storage
    .from(AVATAR_BUCKET)
    .upload(path, blob, { contentType: "image/webp", upsert: false });
  if (error) throw error;
  return sb.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * 안 쓰게 된 업로드 객체를 지운다. 실패해도 조용히 넘어간다 —
 * 남은 파일은 버킷 쓰레기일 뿐이고, 여기서 화면을 막을 이유가 없다.
 */
export async function removeUploadedAvatar(url: string | undefined): Promise<void> {
  if (!url) return;
  const path = avatarObjectPath(url);
  if (!path) return;
  const { error } = await getSupabase().storage.from(AVATAR_BUCKET).remove([path]);
  if (error) console.warn("[expert] 옛 프로필 사진 삭제 실패(무시):", error.message);
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
