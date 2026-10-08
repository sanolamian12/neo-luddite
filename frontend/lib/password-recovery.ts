import { getSupabase, isSupabaseConfigured } from "./supabase/client";
import { isPrototype } from "./data-mode";
import { safeReturnPath } from "./account-route";

type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const markerKey = "password-recovery-v1";
const recoveryLifetime = 60 * 60 * 1000;
const invalidLink = "비밀번호 재설정 링크가 만료되었거나 유효하지 않아요. 이메일을 다시 요청하고, 요청한 브라우저에서 최신 링크를 열어 주세요.";

export class PasswordRecoveryError extends Error {
  constructor(message: string, public readonly kind: "link" | "rate_limit" | "request" | "validation") {
    super(message);
    this.name = "PasswordRecoveryError";
  }
}

function browserStorage(): RecoveryStorage | undefined {
  try { return typeof window === "undefined" ? undefined : window.sessionStorage; }
  catch { return undefined; }
}

function clearMarker(storage?: RecoveryStorage) {
  try { storage?.removeItem(markerKey); } catch { /* Recovery still works when tab storage is unavailable. */ }
}

function requireLiveAuth() {
  if (isPrototype || !isSupabaseConfigured) throw new PasswordRecoveryError("지금은 비밀번호 재설정에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.", "request");
}

export function passwordRecoveryHref(page: "forgot" | "reset", returnTo?: string | null): string {
  const next = safeReturnPath(returnTo);
  return `/${page}-password${next ? `?next=${encodeURIComponent(next)}` : ""}`;
}

export async function requestPasswordReset(email: string, origin: string, returnTo?: string | null): Promise<void> {
  requireLiveAuth();
  const address = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new PasswordRecoveryError("가입한 이메일 주소를 확인해 주세요.", "validation");
  const { error } = await getSupabase().auth.resetPasswordForEmail(address, {
    redirectTo: new URL(passwordRecoveryHref("reset", returnTo), origin).toString(),
  });
  // Use the same acknowledgement for unknown addresses. Never render Auth's raw response.
  if (!error || error.code === "user_not_found") return;
  if (error.status === 429) throw new PasswordRecoveryError("요청이 많아 잠시 기다려야 해요. 잠시 후 다시 시도해 주세요.", "rate_limit");
  throw new PasswordRecoveryError("이메일을 요청하지 못했어요. 연결을 확인하고 다시 시도해 주세요.", "request");
}

async function verifiedRecoveryUser(): Promise<string> {
  const { data, error } = await getSupabase().auth.getUser();
  if (error && (error.status === 0 || (error.status ?? 0) >= 500)) throw new PasswordRecoveryError("계정을 확인하지 못했어요. 연결을 확인하고 다시 시도해 주세요.", "request");
  if (error || !data.user) throw new PasswordRecoveryError(invalidLink, "link");
  return data.user.id;
}

/** The tab marker only restores the form after reload; Supabase authorizes every write. */
export async function beginPasswordRecovery(href: string, storage = browserStorage()): Promise<string> {
  requireLiveAuth();
  const url = new URL(href);
  const code = url.searchParams.get("code");
  if (url.searchParams.has("error") || url.hash) {
    clearMarker(storage);
    throw new PasswordRecoveryError(invalidLink, "link");
  }
  if (code) {
    clearMarker(storage);
    const auth = getSupabase().auth;
    let recoveryUserId: string | undefined;
    const { data: listener } = auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") recoveryUserId = session?.user.id;
    });
    const { data, error } = await auth.exchangeCodeForSession(code).finally(() => listener.subscription.unsubscribe());
    if (error || !data.user || recoveryUserId !== data.user.id) throw new PasswordRecoveryError(invalidLink, "link");
    const userId = await verifiedRecoveryUser();
    if (userId !== data.user.id) throw new PasswordRecoveryError(invalidLink, "link");
    try { storage?.setItem(markerKey, JSON.stringify({ userId, startedAt: Date.now() })); }
    catch { /* Without storage, the current form works; reloading requires a new link. */ }
    return userId;
  }
  let marker: { userId?: string; startedAt?: number } | null = null;
  try { marker = JSON.parse(storage?.getItem(markerKey) ?? "null"); } catch { /* Treat corrupt storage as an invalid link. */ }
  const age = Date.now() - (marker?.startedAt ?? 0);
  if (!marker?.userId || !Number.isFinite(age) || age < 0 || age >= recoveryLifetime) {
    clearMarker(storage);
    throw new PasswordRecoveryError(invalidLink, "link");
  }
  const userId = await verifiedRecoveryUser();
  if (userId !== marker.userId) {
    clearMarker(storage);
    throw new PasswordRecoveryError(invalidLink, "link");
  }
  return userId;
}

export async function changeRecoveredPassword(userId: string, password: string, confirmation: string, storage = browserStorage()): Promise<void> {
  requireLiveAuth();
  if (password.length < 8) throw new PasswordRecoveryError("새 비밀번호를 8자 이상 입력해 주세요.", "validation");
  if (password !== confirmation) throw new PasswordRecoveryError("두 비밀번호가 같지 않아요. 다시 확인해 주세요.", "validation");
  if (await verifiedRecoveryUser() !== userId) throw new PasswordRecoveryError(invalidLink, "link");
  const { error } = await getSupabase().auth.updateUser({ password });
  if (error?.code === "same_password") throw new PasswordRecoveryError("현재 비밀번호와 다른 새 비밀번호를 입력해 주세요.", "validation");
  if (error?.code === "weak_password") throw new PasswordRecoveryError("더 긴 비밀번호에 영문 대·소문자, 숫자, 기호를 함께 사용해 주세요.", "validation");
  if (error?.status === 401 || error?.status === 403) {
    clearMarker(storage);
    throw new PasswordRecoveryError(invalidLink, "link");
  }
  if (error) throw new PasswordRecoveryError("비밀번호를 변경하지 못했어요. 연결을 확인하고 다시 시도해 주세요.", "request");
  clearMarker(storage);
}
