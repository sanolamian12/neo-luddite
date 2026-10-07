"use client";

import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import {
  DEMO_CREDENTIALS,
  SEED_ADMIN,
  SEED_AUDITOR,
  SEED_VIEWER,
  type AccountId,
  type AdminAccount,
  type AuditorAccount,
  type ViewerAccount,
} from "./account-schema";
import { isActiveOccupation } from "./occupations";
import { verifiedAccount } from "./live-auth";
import { getSupabase, isSupabaseConfigured } from "./supabase/client";
import { isPrototype } from "./data-mode";

/**
 * Account UI state. Prototype identities persist locally; live identities are
 * verified through Supabase Auth and database profiles before use.
 * `session` 이 로그인한 역할을 결정한다 (null 이면 비로그인).
 * 각 섹션 라우트는 session 역할로 게이팅되므로 활성 역할 == session.
 */

interface AccountState {
  viewer: ViewerAccount;
  auditor: AuditorAccount;
  admin: AdminAccount;
  session: AccountId | null;
  authReady: boolean;
  authError: string | null;
  syncSession: () => Promise<AccountId | null>;

  setViewerOccupation: (occupation: string) => Promise<void>;
  setReviewerName: (name: string) => void;
  setOperatorName: (name: string) => void;

  /** 아이디/비밀번호 검증 + Supabase Auth 로그인 후 세션 설정. 성공 시 역할, 실패 시 null. */
  login: (username: string, password: string) => Promise<AccountId | null>;
  logout: () => Promise<void>;
}

// Guest entry must still hydrate when browser storage is blocked or corrupted.
const accountStorage: StateStorage = {
  getItem(key) {
    try {
      const raw = typeof window === "undefined" ? null : window.localStorage.getItem(key);
      if (raw) { JSON.parse(raw); return raw; }
    } catch { /* Use the in-memory guest session. */ }
    return null;
  },
  setItem(key, value) {
    try { if (typeof window !== "undefined") window.localStorage.setItem(key, value); } catch { /* In-memory login remains usable. */ }
  },
  removeItem(key) {
    try { if (typeof window !== "undefined") window.localStorage.removeItem(key); } catch { /* In-memory logout remains usable. */ }
  },
};

/** 구 audit-store(`audit-store-v1`)의 reviewerName 을 1회 흡수. */
function legacyReviewerName(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("audit-store-v1");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const name = parsed?.state?.reviewerName;
    return typeof name === "string" && name.trim().length > 0 ? name : null;
  } catch {
    return null;
  }
}

let sessionRevision = 0;

export const useAccountStore = create<AccountState>()(
  persist(
    (set, get): AccountState => ({
      viewer: SEED_VIEWER,
      auditor: SEED_AUDITOR,
      admin: SEED_ADMIN,
      session: null,
      authReady: isPrototype,
      authError: null,

      syncSession: async () => {
        const revision = ++sessionRevision;
        // Revalidating the same identity must not discard an open form/workspace.
        set({ authReady: get().session !== null, authError: null });
        try {
          const account = await verifiedAccount(getSupabase());
          if (revision === sessionRevision) {
            set({ viewer: SEED_VIEWER, auditor: SEED_AUDITOR, admin: SEED_ADMIN,
              ...(account ? { [account.role]: account } : {}), session: account?.role ?? null, authReady: true });
          }
          return account?.role ?? null;
        } catch (error) {
          if (revision === sessionRevision) set({ session: null, authReady: true, authError: error instanceof Error ? error.message : "로그인 상태를 확인하지 못했어요." });
          throw error;
        }
      },

      setViewerOccupation: async (occupation) => {
        if (!isPrototype) {
          if (get().session !== "viewer" || !isActiveOccupation(occupation)) throw new Error("업종을 다시 선택해 주세요.");
          const id = get().viewer.id;
          const { data, error } = await getSupabase().from("profiles").update({ occupation })
            .eq("domain_id", id).select("occupation").single();
          if (error || data?.occupation !== occupation) throw new Error("업종을 저장하지 못했어요. 다시 시도해 주세요.");
          if (get().session !== "viewer" || get().viewer.id !== id) return;
        }
        set((s) => ({ viewer: { ...s.viewer, occupation } }));
      },

      setReviewerName: (name) =>
        set((s) => ({
          auditor: { ...s.auditor, reviewerName: name || SEED_AUDITOR.reviewerName },
        })),

      setOperatorName: (name) =>
        set((s) => ({
          admin: { ...s.admin, operatorName: name || SEED_ADMIN.operatorName },
        })),

      login: async (username, password) => {
        if (!isPrototype) {
          ++sessionRevision;
          set({ session: null, authError: null });
          const email = username.trim();
          const { error } = await getSupabase().auth.signInWithPassword({
            email: email.includes("@") ? email : `${email}@demo.local`, password,
          });
          if (error) { set({ authReady: true }); return null; }
          return get().syncSession();
        }
        const cred = DEMO_CREDENTIALS.find(
          (c) => c.username === username.trim() && c.password === password,
        );
        if (!cred) return null;
        // 세무사는 어느 신원(auditor/auditor2…)으로 들어왔는지에 따라 계정 id/이름을
        // 세팅한다 → 공용 보드에서 코멘트 작성자가 갈리고 RLS(auditor_id=도메인 id)를 통과.
        if (cred.accountId === "auditor") {
          set((s) => ({
            session: cred.accountId,
            auditor: {
              ...s.auditor,
              id: cred.domainId ?? SEED_AUDITOR.id,
              reviewerName: cred.displayName ?? SEED_AUDITOR.reviewerName,
            },
          }));
        } else if (cred.accountId === "viewer") {
          // 손님도 신원(domain_id)이 갈린다 → conversations.owner_id = 이 값 → RLS 통과.
          set((s) => ({
            session: cred.accountId,
            viewer: { ...s.viewer, id: cred.domainId ?? SEED_VIEWER.id, label: cred.roleLabel },
          }));
        } else {
          set({ session: cred.accountId });
        }
        return cred.accountId;
      },

      logout: async () => {
        if (!isPrototype) {
          const { error } = await getSupabase().auth.signOut({ scope: "local" });
          if (error) throw new Error("로그아웃하지 못했어요. 다시 시도해 주세요.");
        }
        ++sessionRevision;
        set({ session: null, authReady: true, authError: null });
      },
    }),
    {
      name: isPrototype ? "prototype-account-v1" : "account-store-v1",
      storage: createJSONStorage(() => accountStorage),
      version: 3,
      // A persisted UI role is never authentication in live mode.
      partialize: (state) => isPrototype ? state : {},
      merge: (persisted, current) => isPrototype ? { ...current, ...(persisted as Partial<AccountState>) } : current,
      migrate: (persisted, version) => {
        // v1 → v2: admin 계정이 없으므로 시드로 채움
        // v2 → v3: session 필드 추가 (기본 비로그인)
        const state = (persisted ?? {}) as Partial<AccountState>;
        const next: Partial<AccountState> = { ...state };
        if (version < 2 || !next.admin) {
          next.admin = SEED_ADMIN;
        }
        if (next.session === undefined) {
          next.session = null;
        }
        return next as AccountState;
      },
      onRehydrateStorage: () => (state) => {
        if (!state || !isPrototype) return;
        // 구 audit-store 의 reviewerName 흡수 (기본값일 때만)
        if (state.auditor.reviewerName === SEED_AUDITOR.reviewerName) {
          const legacy = legacyReviewerName();
          if (legacy) {
            state.auditor = { ...state.auditor, reviewerName: legacy };
          }
        }
        // admin 누락 보정 (migrate 가 실패한 경우 안전망)
        if (!state.admin) {
          state.admin = SEED_ADMIN;
        }
      },
    },
  ),
);

// ── SSR 하이드레이션 가드 ───────────────────────────────────────────────────────
const subscribeHydration = (listener: () => void) => {
  const unsubscribeStart = useAccountStore.persist.onHydrate(listener);
  const unsubscribeFinish = useAccountStore.persist.onFinishHydration(listener);
  const unsubscribeState = useAccountStore.subscribe(listener);
  return () => { unsubscribeStart(); unsubscribeFinish(); unsubscribeState(); };
};
const accountHydrated = () => useAccountStore.persist.hasHydrated() && useAccountStore.getState().authReady;
const serverHydrated = () => false;

export function useAccountHydrated(): boolean {
  return useSyncExternalStore(subscribeHydration, accountHydrated, serverHydrated);
}


/** Subscribe once at the root, including cross-tab sign-out and token refresh. */
export function startAccountSession(): () => void {
  if (isPrototype) return () => {};
  if (!isSupabaseConfigured) {
    useAccountStore.setState({ session: null, authReady: true });
    return () => {};
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let observedUserId: string | null = null;
  const { data: { subscription } } = getSupabase().auth.onAuthStateChange((event, session) => {
    clearTimeout(timer);
    const userId = session?.user.id ?? null;
    if (userId !== observedUserId) {
      ++sessionRevision;
      observedUserId = userId;
      useAccountStore.setState({ session: null, authReady: false, authError: null });
    }
    if (event === "SIGNED_OUT") {
      ++sessionRevision;
      useAccountStore.setState({ session: null, authReady: true, authError: null });
      return;
    }
    // Supabase holds its auth lock in this callback. Defer calls back into Auth.
    timer = setTimeout(() => { void useAccountStore.getState().syncSession().catch(() => {}); }, 0);
  });
  return () => { clearTimeout(timer); subscription.unsubscribe(); ++sessionRevision; };
}
