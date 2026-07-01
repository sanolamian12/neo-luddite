"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Mail } from "./poc-schema";

interface MailState {
  mails: Mail[];
  _append: (mail: Mail) => void;
  _patch: (id: string, patch: Partial<Mail>) => void;
}

const noopStorage: Storage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  key: () => null,
  length: 0,
};

export const useMailStore = create<MailState>()(
  persist(
    (set) => ({
      mails: [],
      _append: (mail) => set((s) => ({ mails: [...s.mails, mail] })),
      _patch: (id, patch) =>
        set((s) => ({
          mails: s.mails.map((m) => (m.id === id ? { ...m, ...patch } : m)),
        })),
    }),
    {
      name: "mail-store-v1",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : noopStorage,
      ),
      partialize: (s) => ({ mails: s.mails }),
    },
  ),
);

export function useMailHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (useMailStore.persist.hasHydrated()) setHydrated(true);
    const unsub = useMailStore.persist.onFinishHydration(() => setHydrated(true));
    return unsub;
  }, []);
  return hydrated;
}
