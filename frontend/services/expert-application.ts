import { getSupabase } from "@/lib/supabase/client";

/**
 * 세무사 가입 신청 (0049) — 소셜 가입한 회원이 신청하고 관리자가 등록번호를 직접 조회한 뒤 승인한다.
 * 쓰기는 전부 RPC(신청·철회·심사). 신청자는 표를 직접 못 읽고 my_expert_application() 으로 본다.
 */

export type ApplicationStatus = "pending" | "approved" | "rejected" | "withdrawn" | "revoked";

export interface ApplicationForm {
  name: string;
  registrationNo: string;
  officeName: string;
  officeRegion: string;
  email: string;
  phone: string;
  yearsExperience: number;
  specialties: string[];
  bio: string;
}

/** 신청자에게 보이는 신청서(관리자 메모 제외). */
export interface MyApplication extends ApplicationForm {
  id: string;
  status: ApplicationStatus;
  rejectReason: string | null;
  createdAt: number;
  decidedAt: number | null;
}

/** 관리자 화면용 전체 행. */
export interface ApplicationRow {
  id: string;
  applicantDomain: string;
  name: string;
  registrationNo: string;
  officeName: string;
  officeRegion: string;
  email: string;
  phone: string;
  yearsExperience: number;
  specialties: string[];
  bio: string;
  status: ApplicationStatus;
  verifiedAt: number | null;
  reviewNote: string | null;
  rejectReason: string | null;
  statusHistory: { status: string; at: number; actor: string; note?: string }[];
  createdAt: number;
  decidedAt: number | null;
}

export const APPLICATION_STATUS_LABEL: Record<ApplicationStatus, string> = {
  pending: "검토 중",
  approved: "승인",
  rejected: "반려",
  withdrawn: "철회",
  revoked: "승인 취소",
};

export const SPECIALTY_PRESETS = ["부가가치세", "종합소득세", "법인세", "원천세", "양도소득세", "상속·증여세", "세무조사", "병의원", "음식점", "간편장부"];

/** DB 예외 메시지 → 화면 문구. */
export function applicationErrorMessage(error: unknown): string {
  const message = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : "";
  const known: [RegExp, string][] = [
    [/already pending/i, "이미 검토 중인 신청이 있어요."],
    [/only member/i, "일반 회원 계정에서만 신청할 수 있어요."],
    [/invalid name/i, "이름을 2~40자로 입력해 주세요."],
    [/registration number must be verified/i, "등록번호 조회를 확인했다고 표시해야 승인할 수 있어요."],
    [/registration/i, "세무사 등록번호를 숫자·영문·하이픈으로 입력해 주세요."],
    [/office name/i, "사무소명을 입력해 주세요."],
    [/office region/i, "사무소 소재지를 입력해 주세요."],
    [/invalid email/i, "연락 이메일 형식을 확인해 주세요."],
    [/invalid phone/i, "휴대폰 번호를 확인해 주세요."],
    [/bio too long/i, "소개는 500자 이내로 입력해 주세요."],
    [/years of experience/i, "경력 연수를 0~70 사이로 입력해 주세요."],
    [/rejection reason/i, "반려 사유를 입력해 주세요."],
    [/no longer a member/i, "신청자 계정이 일반 회원이 아니어서 승인할 수 없어요."],
    [/expert record already exists/i, "이 계정의 세무사 기록이 이미 있어요."],
    [/invalid transition/i, "이미 처리된 신청이에요. 새로고침해 주세요."],
    [/admin only/i, "관리자만 할 수 있어요."],
    [/not signed in/i, "로그인이 필요해요."],
  ];
  return known.find(([pattern]) => pattern.test(message))?.[1] ?? "처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
}

export async function getMyApplication(): Promise<MyApplication | null> {
  const { data, error } = await getSupabase().rpc("my_expert_application");
  if (error) throw error;
  return (data as MyApplication | null) ?? null;
}

export async function submitApplication(form: ApplicationForm): Promise<MyApplication> {
  const { data, error } = await getSupabase().rpc("submit_expert_application", { p: form });
  if (error) throw error;
  return data as MyApplication;
}

export async function withdrawApplication(id: string): Promise<MyApplication> {
  const { data, error } = await getSupabase().rpc("withdraw_expert_application", { p_id: id });
  if (error) throw error;
  return data as MyApplication;
}

interface ApplicationDbRow {
  id: string; applicant_domain: string; name: string; registration_no: string; office_name: string;
  office_region: string; email: string; phone: string; years_experience: number; specialties: string[];
  bio: string; status: ApplicationStatus; verified_at: number | null; review_note: string | null;
  reject_reason: string | null; status_history: ApplicationRow["statusHistory"]; created_at: number; decided_at: number | null;
}

function rowToApplication(r: ApplicationDbRow): ApplicationRow {
  return {
    id: r.id, applicantDomain: r.applicant_domain, name: r.name, registrationNo: r.registration_no,
    officeName: r.office_name, officeRegion: r.office_region, email: r.email, phone: r.phone,
    yearsExperience: r.years_experience, specialties: r.specialties ?? [], bio: r.bio, status: r.status,
    verifiedAt: r.verified_at != null ? Number(r.verified_at) : null, reviewNote: r.review_note,
    rejectReason: r.reject_reason, statusHistory: r.status_history ?? [],
    createdAt: Number(r.created_at), decidedAt: r.decided_at != null ? Number(r.decided_at) : null,
  };
}

/** 관리자: 신청서 목록(RLS 가 관리자에게만 행을 준다). */
export async function listApplications(): Promise<ApplicationRow[]> {
  const { data, error } = await getSupabase()
    .from("expert_applications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data as ApplicationDbRow[]).map(rowToApplication);
}

export async function countPendingApplications(): Promise<number> {
  const { count, error } = await getSupabase()
    .from("expert_applications")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  if (error) throw error;
  return count ?? 0;
}

export async function reviewApplication(input: {
  id: string;
  decision: "approved" | "rejected";
  verified?: boolean;
  reason?: string;
  note?: string;
}): Promise<ApplicationRow> {
  const { data, error } = await getSupabase().rpc("review_expert_application", {
    p_id: input.id,
    p_decision: input.decision,
    p_verified: input.verified ?? false,
    p_reason: input.reason ?? null,
    p_note: input.note ?? null,
  });
  if (error) throw error;
  return rowToApplication(data as ApplicationDbRow);
}
