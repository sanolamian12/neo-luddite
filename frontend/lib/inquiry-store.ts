"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Inquiry, InquiryMessage } from "./poc-schema";

interface InquiryState {
  inquiries: Inquiry[];
  _upsert: (inquiry: Inquiry) => void;
  _patch: (id: string, patch: Partial<Inquiry>) => void;
  _appendMessage: (id: string, message: InquiryMessage) => void;
}

const noopStorage: Storage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  key: () => null,
  length: 0,
};

export const useInquiryStore = create<InquiryState>()(
  persist(
    (set) => ({
      inquiries: [],
      _upsert: (inquiry) =>
        set((s) => {
          const idx = s.inquiries.findIndex((q) => q.id === inquiry.id);
          if (idx === -1) return { inquiries: [...s.inquiries, inquiry] };
          const next = [...s.inquiries];
          next[idx] = { ...next[idx], ...inquiry };
          return { inquiries: next };
        }),
      _patch: (id, patch) =>
        set((s) => ({
          inquiries: s.inquiries.map((q) =>
            q.id === id ? { ...q, ...patch } : q,
          ),
        })),
      _appendMessage: (id, message) =>
        set((s) => ({
          inquiries: s.inquiries.map((q) =>
            q.id === id ? { ...q, messages: [...q.messages, message] } : q,
          ),
        })),
    }),
    {
      name: "inquiry-store-v1",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : noopStorage,
      ),
      partialize: (s) => ({ inquiries: s.inquiries }),
    },
  ),
);

export function useInquiryHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (useInquiryStore.persist.hasHydrated()) setHydrated(true);
    const unsub = useInquiryStore.persist.onFinishHydration(() =>
      setHydrated(true),
    );
    return unsub;
  }, []);
  return hydrated;
}
