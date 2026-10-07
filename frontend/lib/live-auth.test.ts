import assert from "node:assert/strict";
import { after, test } from "node:test";

process.env.NEXT_PUBLIC_DATA_MODE = "live";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://auth.example.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-public-key";
const originalFetch = globalThis.fetch;
const user = { id: "new-customer", aud: "authenticated", role: "authenticated", email: "customer@example.test", app_metadata: {}, user_metadata: { role: "admin" }, created_at: "2026-01-01T00:00:00Z" };
let profile: Record<string, unknown> | null = { id: user.id, domain_id: "customer-domain", role: "user", label: "새 고객", occupation: null, display_name: "새 고객", avatar_color: null };
let passwordAccepted = true;
let pendingProfile: (() => Promise<Response>) | null = null;
const requests: { path: string; body: Record<string, unknown> }[] = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  requests.push({ path: url.pathname + url.search, body: JSON.parse(String(init?.body ?? "{}")) });
  if (url.pathname.endsWith("/token")) {
    if (!passwordAccepted) return Response.json({ error_code: "invalid_credentials", msg: "Invalid login credentials" }, { status: 400 });
    const payload = Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
    return Response.json({ access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`, refresh_token: "test-refresh", token_type: "bearer", expires_in: 3600, user });
  }
  if (url.pathname.endsWith("/user")) return Response.json(user);
  if (url.pathname.endsWith("/profiles")) {
    if (pendingProfile) return pendingProfile();
    if (init?.method === "PATCH") {
      assert.equal(url.searchParams.get("domain_id"), `eq.${profile?.domain_id}`);
      profile = { ...profile, ...JSON.parse(String(init.body)) };
    }
    return Response.json(profile);
  }
  if (url.pathname.endsWith("/logout")) return new Response(null, { status: 204 });
  throw new Error(`Unexpected request: ${url.pathname}`);
};
after(async () => {
  const { getSupabase } = await import("./supabase/client");
  await getSupabase().auth.signOut({ scope: "local" });
  getSupabase().auth.stopAutoRefresh();
  globalThis.fetch = originalFetch;
});

test("live email login accepts non-demo users and takes identity only from the database", async () => {
  const { useAccountStore } = await import("./account-store");
  assert.equal(await useAccountStore.getState().login("customer@example.test", "real-password"), "viewer");
  assert.equal(useAccountStore.getState().viewer.id, "customer-domain");
  assert.equal(useAccountStore.getState().viewer.label, "새 고객");
  assert.equal(useAccountStore.getState().viewer.occupation, "");
  assert.equal(useAccountStore.getState().session, "viewer", "user metadata cannot grant admin");
  assert.equal(requests.find((r) => r.path.includes("grant_type=password"))?.body.email, "customer@example.test");
  await useAccountStore.getState().logout();
});

test("existing staff usernames authenticate remotely and use database roles", async () => {
  profile = { ...profile, role: "auditor", domain_id: "approved-expert", display_name: "승인 세무사" };
  const { useAccountStore } = await import("./account-store");
  assert.equal(await useAccountStore.getState().login("auditor", "changed-password"), "auditor");
  assert.equal(useAccountStore.getState().auditor.id, "approved-expert");
  assert.equal(useAccountStore.getState().auditor.reviewerName, "승인 세무사");
  await useAccountStore.getState().logout();
});

test("a customer occupation selection survives a fresh server session", async () => {
  profile = { ...profile, role: "user", occupation: null };
  const { useAccountStore } = await import("./account-store");
  await useAccountStore.getState().login("customer@example.test", "real-password");
  await useAccountStore.getState().setViewerOccupation("clinic");
  await useAccountStore.getState().syncSession();
  assert.equal(useAccountStore.getState().viewer.occupation, "clinic");
  await useAccountStore.getState().logout();
});

test("session revalidation preserves the open workspace and cannot undo a later logout", async () => {
  const { useAccountStore } = await import("./account-store");
  await useAccountStore.getState().login("customer@example.test", "real-password");
  let release!: (response: Response) => void;
  let started!: () => void;
  const loading = new Promise<void>((resolve) => { started = resolve; });
  pendingProfile = () => { started(); return new Promise<Response>((resolve) => { release = resolve; }); };
  const refreshing = useAccountStore.getState().syncSession();
  await loading;
  try {
    assert.equal(useAccountStore.getState().session, "viewer", "same-account refresh must not unmount the workspace");
    assert.equal(useAccountStore.getState().authReady, true);
    await useAccountStore.getState().logout();
    release(Response.json(profile));
    await refreshing;
    assert.equal(useAccountStore.getState().session, null, "late profile response must not undo logout");
  } finally {
    pendingProfile = null;
    release(Response.json(profile));
    await refreshing;
  }
});

test("a missing profile fails closed instead of assigning a seeded identity", async () => {
  profile = null;
  const { useAccountStore } = await import("./account-store");
  await assert.rejects(useAccountStore.getState().login("customer@example.test", "real-password"));
  assert.equal(useAccountStore.getState().session, null);
});

test("invalid remote credentials leave no authenticated application session", async () => {
  passwordAccepted = false;
  const { useAccountStore } = await import("./account-store");
  assert.equal(await useAccountStore.getState().login("owner", "demo1234"), null);
  assert.equal(useAccountStore.getState().session, null);
});
