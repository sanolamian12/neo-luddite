import assert from "node:assert/strict";
import { test } from "node:test";

process.env.NEXT_PUBLIC_DATA_MODE = "live";
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://auth.example.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-public-key";

test("social login preserves a local continuation and creates a PKCE authorization request", async () => {
  const auth = await import("./social-auth").catch(() => null);
  assert.ok(auth, "social authentication module is available");
  for (const provider of ["google", "kakao"] as const) {
    const href: string = await auth.socialAuthorizationUrl(provider, "https://app.example.test", "/chat/clinic?c=guest-1");
    const url: URL = new URL(href);
    assert.equal(url.origin, "https://auth.example.test");
    assert.equal(url.searchParams.get("provider"), provider);
    assert.ok(url.searchParams.get("code_challenge"));
    assert.equal(url.searchParams.get("code_challenge_method"), "s256");
    const callback: URL = new URL(url.searchParams.get("redirect_to")!);
    assert.equal(callback.pathname, "/auth/callback");
    assert.equal(callback.searchParams.get("next"), "/chat/clinic?c=guest-1");
  }
});

test("OAuth callbacks reject external redirect targets and unsafe schemes", async () => {
  const auth = await import("./social-auth").catch(() => null);
  assert.ok(auth, "social authentication module is available");
  for (const next of ["https://evil.test", "//evil.test", "/\\evil.test", "javascript:alert(1)", "/\n/evil.test"]) {
    const callback: URL = new URL(auth.authCallbackUrl("https://app.example.test", next));
    assert.equal(callback.origin, "https://app.example.test");
    assert.equal(callback.searchParams.has("next"), false);
  }
});

test("cancelled and malformed OAuth callbacks return actionable errors without calling Auth", async () => {
  const auth = await import("./social-auth").catch(() => null);
  assert.ok(auth, "social authentication module is available");
  await assert.rejects(auth.exchangeSocialCallback("https://app.test/auth/callback?error=access_denied&error_description=untrusted"), /취소/);
  await assert.rejects(auth.exchangeSocialCallback("https://app.test/auth/callback"), /다시/);
});

test("callback exchanges the stored PKCE verifier and persists the authenticated session", async () => {
  const { createHash } = await import("node:crypto");
  const { socialAuthorizationUrl, exchangeSocialCallback } = await import("./social-auth");
  const { getSupabase } = await import("./supabase/client");
  const authorization: URL = new URL(await socialAuthorizationUrl("google", "https://app.test"));
  const originalFetch = globalThis.fetch;
  let exchanges = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/logout")) return new Response(null, { status: 204 });
    assert.equal(url.searchParams.get("grant_type"), "pkce");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.auth_code, "one-time-code");
    assert.equal(createHash("sha256").update(body.code_verifier).digest("base64url"), authorization.searchParams.get("code_challenge"));
    exchanges++;
    return Response.json({ access_token: "test-token", refresh_token: "test-refresh", token_type: "bearer", expires_in: 3600,
      user: { id: "social-customer", aud: "authenticated", role: "authenticated", app_metadata: { provider: "google" }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" } });
  };
  try {
    await exchangeSocialCallback("https://app.test/auth/callback?code=one-time-code");
    const { data } = await getSupabase().auth.getSession();
    assert.equal(data.session?.user.id, "social-customer");
    assert.equal(exchanges, 1);
    await getSupabase().auth.signOut({ scope: "local" });
  } finally {
    getSupabase().auth.stopAutoRefresh();
    globalThis.fetch = originalFetch;
  }
});
