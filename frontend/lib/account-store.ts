"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
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
import { getSupabase } from "./supabase/client";

/**
 * 계정 스토어 — viewer/auditor/admin 각 1계정. localStorage 영속.
 * `session` 이 로그인한 역할을 결정한다 (null 이면 비로그인).
 * 각 섹션 라우트는 session 역할로 게이팅되므로 활성 역할 == session.
 */

interface AccountState {
  viewer: ViewerAccount;
  auditor: AuditorAccount;
  admin: AdminAccount;
  session: AccountId | null;

  setViewerOccupation: (occupation: string) => void;
  setReviewerName: (name: string) => void;
  setOperatorName: (name: string) => void;

  /** 아이디/비밀번호 검증 + Supabase Auth 로그인 후 세션 설정. 성공 시 역할, 실패 시 null. */
  login: (username: string, password: string) => Promise<AccountId | null>;
  logout: () => Promise<void>;
}

const noopStorage: Storage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  key: () => null,
  length: 0,
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

export const useAccountStore = create<AccountState>()(
  persist(
    (set) => ({
      viewer: SEED_VIEWER,
      auditor: SEED_AUDITOR,
      admin: SEED_ADMIN,
      session: null,

      setViewerOccupation: (occupation) =>
        set((s) => ({ viewer: { ...s.viewer, occupation } })),

      setReviewerName: (name) =>
        set((s) => ({
          auditor: { ...s.auditor, reviewerName: name || SEED_AUDITOR.reviewerName },
        })),

      setOperatorName: (name) =>
        set((s) => ({
          admin: { ...s.admin, operatorName: name || SEED_ADMIN.operatorName },
        })),

      login: async (username, password) => {
        const cred = DEMO_CREDENTIALS.find(
          (c) => c.username === username.trim() && c.password === password,
        );
        if (!cred) return null;
        // 실제 Supabase Auth 로그인 — 이후 요청이 사용자 JWT 로 나가 RLS 를 통과한다.
        // 데모 계정 이메일 규약: {username}@demo.local (seed.sql).
        const { error } = await getSupabase().auth.signInWithPassword({
          email: `${cred.username}@demo.local`,
          password,
        });
        if (error) {
          console.error("[auth] Supabase 로그인 실패:", error.message);
          return null;
        }
        set({ session: cred.accountId });
        return cred.accountId;
      },

      logout: async () => {
        await getSupabase().auth.signOut();
        set({ session: null });
      },
    }),
    {
      name: "account-store-v1",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : noopStorage,
      ),
      version: 3,
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
        if (!state) return;
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
export function useAccountHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (useAccountStore.persist.hasHydrated()) setHydrated(true);
    const unsub = useAccountStore.persist.onFinishHydration(() =>
      setHydrated(true),
    );
    return unsub;
  }, []);
  return hydrated;
}
