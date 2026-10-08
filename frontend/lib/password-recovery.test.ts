import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

process.env.NEXT_PUBLIC_DATA_MODE = "live";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://auth.example.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-public-key";

const user = { id: "recovering-user", email: "customer@example.test", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
function tabStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

test("recovery sends a PKCE email, verifies the link, survives reload and changes only the verified user's password", async () => {
  const recovery = await import("./password-recovery").catch(() => null);
  assert.ok(recovery, "password recovery is implemented");
  const { getSupabase } = await import("./supabase/client");
  const originalFetch = globalThis.fetch;
  const storage = tabStorage();
  let challenge = "";
  let passwordWrites = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (url.pathname.endsWith("/recover")) {
      assert.equal(body.email, "customer@example.test");
      assert.equal(body.code_challenge_method, "s256");
      const redirect = new URL(url.searchParams.get("redirect_to")!);
      assert.equal(redirect.origin, "https://app.example.test");
      assert.equal(redirect.pathname, "/reset-password");
      assert.equal(redirect.searchParams.get("next"), "/chat/clinic?c=guest-1");
      challenge = body.code_challenge;
      return Response.json({});
    }
    if (url.pathname.endsWith("/token")) {
      assert.equal(body.auth_code, "email-code");
      assert.equal(createHash("sha256").update(body.code_verifier).digest("base64url"), challenge);
      return Response.json({ access_token: "recovery-token", refresh_token: "recovery-refresh", token_type: "bearer", expires_in: 3600, user });
    }
    if (url.pathname.endsWith("/user")) {
      if (init?.method === "PUT") {
        assert.equal(body.password, "New secret 123!");
        passwordWrites++;
      }
      return Response.json(user);
    }
    if (url.pathname.endsWith("/logout")) return new Response(null, { status: 204 });
    throw new Error(`Unexpected endpoint: ${url.pathname}`);
  };
  try {
    await recovery.requestPasswordReset(" customer@example.test ", "https://app.example.test", "/chat/clinic?c=guest-1");
    assert.ok(challenge);
    const id = await recovery.beginPasswordRecovery("https://app.example.test/reset-password?code=email-code", storage);
    assert.equal(id, user.id);
    assert.equal(await recovery.beginPasswordRecovery("https://app.example.test/reset-password", storage), user.id);
    await assert.rejects(recovery.changeRecoveredPassword(id, "short", "short", storage), /8/);
    await assert.rejects(recovery.changeRecoveredPassword(id, "New secret 123!", "different", storage), /같/);
    await assert.rejects(recovery.changeRecoveredPassword("another-user", "New secret 123!", "New secret 123!", storage), /다시/);
    assert.equal(passwordWrites, 0);
    await recovery.changeRecoveredPassword(id, "New secret 123!", "New secret 123!", storage);
    assert.equal(passwordWrites, 1);
    await assert.rejects(recovery.beginPasswordRecovery("https://app.example.test/reset-password", storage), /다시/);
    await getSupabase().auth.signOut({ scope: "local" });
  } finally {
    getSupabase().auth.stopAutoRefresh();
    globalThis.fetch = originalFetch;
  }
});

test("recovery rejects malformed or expired links even when an ordinary session exists", async () => {
  const recovery = await import("./password-recovery").catch(() => null);
  assert.ok(recovery);
  const { getSupabase } = await import("./supabase/client");
  const { socialAuthorizationUrl } = await import("./social-auth");
  const originalFetch = globalThis.fetch;
  const storage = tabStorage();
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/token")) return Response.json({ access_token: "ordinary-token", refresh_token: "ordinary-refresh", token_type: "bearer", expires_in: 3600, user });
    if (url.pathname.endsWith("/logout")) return new Response(null, { status: 204 });
    throw new Error("Malformed links should never fetch a user or write a password");
  };
  try {
    await assert.rejects(recovery.beginPasswordRecovery("https://app.test/reset-password?error=access_denied&error_description=untrusted", storage), /다시/);
    await assert.rejects(recovery.beginPasswordRecovery("https://app.test/reset-password#access_token=untrusted", storage), /다시/);
    await socialAuthorizationUrl("google", "https://app.test");
    await assert.rejects(recovery.beginPasswordRecovery("https://app.test/reset-password?code=oauth-code", storage), /다시/);
    await assert.rejects(recovery.beginPasswordRecovery("https://app.test/reset-password", storage), /다시/);
    await getSupabase().auth.signOut({ scope: "local" });
  } finally {
    getSupabase().auth.stopAutoRefresh();
    globalThis.fetch = originalFetch;
  }
});

test("recovery prevents external redirects and reports rate limits without exposing account existence", async () => {
  const recovery = await import("./password-recovery").catch(() => null);
  assert.ok(recovery);
  const originalFetch = globalThis.fetch;
  let status = 200;
  let code = "";
  let requests = 0;
  globalThis.fetch = async (input) => {
    requests++;
    const url = new URL(String(input));
    assert.equal(new URL(url.searchParams.get("redirect_to")!).searchParams.has("next"), false);
    return Response.json(status === 200 ? {} : { code, msg: "private account details" }, { status, headers: { "x-supabase-api-version": "2024-01-01" } });
  };
  try {
    await assert.rejects(recovery.requestPasswordReset("not-an-email", "https://app.test"), /이메일/);
    assert.equal(requests, 0);
    await recovery.requestPasswordReset("unknown@example.test", "https://app.test", "//evil.test");
    status = 404; code = "user_not_found";
    await recovery.requestPasswordReset("unknown@example.test", "https://app.test", "https://evil.test");
    status = 429; code = "over_email_send_rate_limit";
    await assert.rejects(recovery.requestPasswordReset("customer@example.test", "https://app.test"), { kind: "rate_limit" });
    status = 400; code = "unexpected_failure";
    await assert.rejects(recovery.requestPasswordReset("customer@example.test", "https://app.test"), /다시/);
  } finally { globalThis.fetch = originalFetch; }
});
