"use client";

import { useEffect } from "react";
import { create } from "zustand";
import type { Review, FeedbackDecision } from "./poc-schema";
import { makeCollectionSync } from "./supabase/sync";

/**
 * 검수(Review) 스토어 — Supabase `public.reviews` 의 Realtime 캐시.
 * (구 localStorage persist → DB fetch + Realtime 구독으로 컷오버, §3-3)
 */

interface ReviewState {
  reviews: Review[];
  /** 최초 DB fetch 완료 여부 (구 persist hydration 대체). */
  hydrated: boolean;
  _upsert: (review: Review) => void;
  _patch: (id: string, patch: Partial<Review>) => void;
  _remove: (id: string) => void;
}

/** DB row(snake) 형태. */
export interface ReviewRow {
  id: string;
  audit_id: string;
  reviewer_id: string;
  decisions: FeedbackDecision[];
  overall_note: string | null;
  finalized_at: number | null;
  dispute_window_ends_at: number | null;
  status: Review["status"];
  created_at: number;
  seen_by_auditor_at: number | null;
}

/** row(snake) → 도메인(camel). */
export function rowToReview(r: ReviewRow): Review {
  return {
    id: r.id,
    auditId: r.audit_id,
    reviewerId: r.reviewer_id,
    decisions: r.decisions ?? [],
    overallNote: r.overall_note ?? undefined,
    finalizedAt: r.finalized_at == null ? undefined : Number(r.finalized_at),
    disputeWindowEndsAt:
      r.dispute_window_ends_at == null
        ? undefined
        : Number(r.dispute_window_ends_at),
    status: r.status,
    createdAt: Number(r.created_at),
    seenByAuditorAt:
      r.seen_by_auditor_at == null ? undefined : Number(r.seen_by_auditor_at),
  };
}

export const useReviewStore = create<ReviewState>()((set) => ({
  reviews: [],
  hydrated: false,

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

  _remove: (id) =>
    set((s) => ({
      reviews: s.reviews.filter((r) => r.id !== id),
    })),
}));

const startSync = makeCollectionSync<ReviewRow, Review>({
  table: "reviews",
  rowToDomain: rowToReview,
  pkColumn: "id",
  setAll: (items) => useReviewStore.setState({ reviews: items }),
  applyUpsert: (item) => useReviewStore.getState()._upsert(item),
  applyDelete: (pk) => useReviewStore.getState()._remove(pk),
  onHydrated: () => useReviewStore.setState({ hydrated: true }),
});

// 클라이언트 모듈 로드 시 동기화 시작(구 persist auto-rehydrate 타이밍과 동일).
if (typeof window !== "undefined") startSync();

/** 최초 DB 로드 완료 여부. (시그니처 불변 — 컴포넌트 무손상) */
export function useReviewHydrated(): boolean {
  const hydrated = useReviewStore((s) => s.hydrated);
  useEffect(() => {
    startSync();
  }, []);
  return hydrated;
}
