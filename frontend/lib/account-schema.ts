import { z } from "zod";

/**
 * 계정 스키마 — viewer(상담자) · auditor(평가자) · admin(운영자).
 * PoC: 각 1계정만. viewer.occupation 은 가변, auditor/admin 은 occupation 무관.
 */

export const ACCOUNT_ROLES = ["viewer", "auditor", "admin"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];
export type AccountId = "viewer" | "auditor" | "admin";

/** PoC 공용 데모 비밀번호. 다음 단계의 백엔드 인증으로 대체된다. */
export const DEMO_PASSWORD = "demo1234";

/** 아이디/비밀번호 → 역할 매핑. PoC 데모 계정. */
export interface DemoCredential {
  username: string;
  password: string;
  accountId: AccountId;
  /** 화면 표기용 역할 이름 */
  roleLabel: string;
}

export const DEMO_CREDENTIALS: DemoCredential[] = [
  { username: "owner", password: DEMO_PASSWORD, accountId: "viewer", roleLabel: "사장님" },
  { username: "auditor", password: DEMO_PASSWORD, accountId: "auditor", roleLabel: "평가자" },
  { username: "admin", password: DEMO_PASSWORD, accountId: "admin", roleLabel: "운영자" },
];

export const viewerAccountSchema = z.object({
  id: z.literal("viewer"),
  role: z.literal("viewer"),
  label: z.string().min(1),
  avatarColor: z.string().min(1),
  occupation: z.string().min(1),
});

export const auditorAccountSchema = z.object({
  id: z.literal("auditor"),
  role: z.literal("auditor"),
  label: z.string().min(1),
  avatarColor: z.string().min(1),
  reviewerName: z.string().min(1),
});

export const adminAccountSchema = z.object({
  id: z.literal("admin"),
  role: z.literal("admin"),
  label: z.string().min(1),
  avatarColor: z.string().min(1),
  operatorName: z.string().min(1),
});

export const accountSchema = z.discriminatedUnion("role", [
  viewerAccountSchema,
  auditorAccountSchema,
  adminAccountSchema,
]);

export type ViewerAccount = z.infer<typeof viewerAccountSchema>;
export type AuditorAccount = z.infer<typeof auditorAccountSchema>;
export type AdminAccount = z.infer<typeof adminAccountSchema>;
export type Account = ViewerAccount | AuditorAccount | AdminAccount;

export const SEED_VIEWER: ViewerAccount = {
  id: "viewer",
  role: "viewer",
  label: "사장님",
  avatarColor: "var(--brand-blue)",
  occupation: "clinic",
};

export const SEED_AUDITOR: AuditorAccount = {
  id: "auditor",
  role: "auditor",
  label: "평가자",
  avatarColor: "var(--brand-green)",
  reviewerName: "평가자",
};

export const SEED_ADMIN: AdminAccount = {
  id: "admin",
  role: "admin",
  label: "운영자",
  avatarColor: "var(--brand-amber)",
  operatorName: "운영자",
};
