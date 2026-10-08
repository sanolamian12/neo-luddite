import type { Page } from "@playwright/test";
import { SEED_ADMIN, SEED_AUDITOR, SEED_VIEWER } from "../lib/account-schema";

/** Test-only transport and identity; no production credentials or network writes. */
export async function liveTransport(page: Page, role?: "viewer" | "auditor" | "admin") {
  await page.route("http://localhost:8799/**", (route) => route.fulfill({ json: [] }));
  if (!role) return;
  const account = { viewer: SEED_VIEWER, auditor: SEED_AUDITOR, admin: SEED_ADMIN }[role];
  const user = { id: "integration-user", aud: "authenticated", role: "authenticated", email: "integration@example.test", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
  await page.route("**/auth/v1/user", (route) => route.fulfill({ json: user }));
  await page.route("**/rest/v1/profiles?**", (route) => route.fulfill({ json: {
    id: user.id, domain_id: account.id, role: role === "viewer" ? "user" : role,
    label: account.label, display_name: role === "auditor" ? SEED_AUDITOR.reviewerName : account.label,
    occupation: role === "viewer" ? SEED_VIEWER.occupation : null,
  } }));
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const payload = Buffer.from(JSON.stringify({ sub: "integration-user", exp: expires })).toString("base64url");
  await page.addInitScript(({ role, expires, payload, viewer, auditor, admin }) => {
    localStorage.setItem("account-store-v1", JSON.stringify({ version: 3, state: { session: role, viewer, auditor, admin } }));
    localStorage.setItem("sb-localhost-auth-token", JSON.stringify({
      access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.fixture`, refresh_token: "fixture", token_type: "bearer", expires_at: expires, expires_in: 3600,
      user: { id: "integration-user", aud: "authenticated", role: "authenticated", email: "integration@example.test", app_metadata: {}, user_metadata: {} },
    }));
  }, { role, expires, payload, viewer: SEED_VIEWER, auditor: SEED_AUDITOR, admin: SEED_ADMIN });
}

export const expertFixture = {
  auditor_id: "integration-expert", display_name: "검증 세무사", qualifications: ["세무사"], bio: "연결 화면 검증용 데이터입니다.",
  specialties: ["병의원"], years_experience: 8, availability: "available", like_count: 0,
};
