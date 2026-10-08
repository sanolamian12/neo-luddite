import { getSupabase, isSupabaseConfigured } from "./supabase/client";
import { isPrototype } from "./data-mode";
import { safeReturnPath } from "./account-route";

export type SocialProvider = "google" | "kakao";
const configuredProviders = (process.env.NEXT_PUBLIC_AUTH_PROVIDERS ?? "google,kakao").split(",").map((value) => value.trim());
export const socialProviders: SocialProvider[] = ["google", "kakao"].filter((value): value is SocialProvider => configuredProviders.includes(value));

export function authCallbackUrl(origin: string, returnTo?: string | null): string {
  const url = new URL("/auth/callback", origin);
  const next = safeReturnPath(returnTo);
  if (next) url.searchParams.set("next", next);
  return url.toString();
}

export async function socialAuthorizationUrl(provider: SocialProvider, origin: string, returnTo?: string | null): Promise<string> {
  if (isPrototype || !isSupabaseConfigured) throw new Error("지금은 소셜 로그인에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.");
  if (!socialProviders.includes(provider)) throw new Error("지원하지 않는 로그인 방식입니다.");
  const { data, error } = await getSupabase().auth.signInWithOAuth({
    provider,
    options: { redirectTo: authCallbackUrl(origin, returnTo), skipBrowserRedirect: true },
  });
  if (error || !data.url) throw new Error("로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.");
  return data.url;
}

/** PKCE exchanges happen in the same browser that holds the verifier. */
export async function exchangeSocialCallback(href: string): Promise<void> {
  const url = new URL(href);
  const params = url.searchParams;
  const providerError = params.get("error") || new URLSearchParams(url.hash.slice(1)).get("error");
  if (providerError) throw new Error(providerError === "access_denied"
    ? "로그인을 취소했어요. 원하는 계정으로 다시 시작해 주세요."
    : "소셜 로그인에 실패했어요. 잠시 후 다시 시도해 주세요.");
  const code = params.get("code");
  if (!code || isPrototype || !isSupabaseConfigured) throw new Error("로그인 연결이 만료되었어요. 같은 브라우저에서 다시 시작해 주세요.");
  const { error } = await getSupabase().auth.exchangeCodeForSession(code);
  if (error) throw new Error("로그인 연결이 만료되었어요. 같은 브라우저에서 다시 시작해 주세요.");
}
