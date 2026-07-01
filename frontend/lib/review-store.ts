"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Review } from "./poc-schema";

interface ReviewState {
  reviews: Review[];
  _upsert: (review: Review) => void;
  _patch: (id: string, patch: Partial<Review>) => void;
}

const noopStorage: Storage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  key: () => null,
  length: 0,
};

export const useReviewStore = create<ReviewState>()(
  persist(
    (set) => ({
      reviews: [],
      _upsert: (review) =>
        set((s) => {
          const idx = s.reviews.findIndex((r) => r.id === review.id);
          if (idx === -1) return { reviews: [...s.reviews, review] };
          const next = [...s.reviews];
          next[idx] = { ...next[idx], ...review };
          return { reviews: next };
        }),
      _patch: (id, patch) =>
        set((s) => ({
          reviews: s.reviews.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        })),
    }),
    {
      name: "review-store-v1",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : noopStorage,
      ),
      partialize: (s) => ({ reviews: s.reviews }),
    },
  ),
);

export function useReviewHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (useReviewStore.persist.hasHydrated()) setHydrated(true);
    const unsub = useReviewStore.persist.onFinishHydration(() => setHydrated(true));
    return unsub;
  }, []);
  return hydrated;
}
