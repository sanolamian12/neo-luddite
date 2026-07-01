"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  FeedbackTag,
  LineFeedback,
  SessionEvaluation,
  SessionScores,
} from "./audit-schema";

/**
 * 감사 스토어 — 사람 평가자가 단 라인 피드백 + 세션 평가. localStorage 영속.
 * 대화 데이터는 불변이므로 여기서는 conversationId/segmentId 외래키만 보관한다.
 *
 * reviewer 이름은 account-store(auditor.reviewerName)가 소유한다. 호출 측에서
 * 인자로 전달하여 단일 소스를 유지한다.
 */

interface AuditState {
  feedback: LineFeedback[];
  evaluations: Record<string, SessionEvaluation>; // key: conversationId
  selectedSegmentId: string | null; // 영속 제외(세션 한정)

  selectSegment: (segmentId: string | null) => void;
  addFeedback: (input: {
    conversationId: string;
    segmentId: string;
    body: string;
    tags: FeedbackTag[];
    reviewer: string;
    relatedKbIds?: string[];
  }) => void;
  updateFeedback: (
    id: string,
    patch: {
      body?: string;
      tags?: FeedbackTag[];
      relatedKbIds?: string[];
    },
  ) => void;
  deleteFeedback: (id: string) => void;
  setSessionEval: (
    conversationId: string,
    input: { qualitative: string; scores: SessionScores; reviewer: string },
  ) => void;
}

const noopStorage: Storage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  key: () => null,
  length: 0,
};

export const useAuditStore = create<AuditState>()(
  persist(
    (set) => ({
      feedback: [],
      evaluations: {},
      selectedSegmentId: null,

      selectSegment: (segmentId) => set({ selectedSegmentId: segmentId }),

      addFeedback: ({
        conversationId,
        segmentId,
        body,
        tags,
        reviewer,
        relatedKbIds,
      }) =>
        set((s) => ({
          feedback: [
            ...s.feedback,
            {
              id: crypto.randomUUID(),
              conversationId,
              segmentId,
              reviewer,
              body,
              tags,
              relatedKbIds: relatedKbIds ?? [],
              createdAt: Date.now(),
            },
          ],
        })),

      updateFeedback: (id, patch) =>
        set((s) => ({
          feedback: s.feedback.map((f) =>
            f.id === id ? { ...f, ...patch } : f,
          ),
        })),

      deleteFeedback: (id) =>
        set((s) => ({ feedback: s.feedback.filter((f) => f.id !== id) })),

      setSessionEval: (conversationId, { qualitative, scores, reviewer }) =>
        set((s) => ({
          evaluations: {
            ...s.evaluations,
            [conversationId]: {
              id: s.evaluations[conversationId]?.id ?? crypto.randomUUID(),
              conversationId,
              reviewer,
              qualitative,
              scores,
              createdAt: Date.now(),
            },
          },
        })),
    }),
    {
      name: "audit-store-v1",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : noopStorage,
      ),
      version: 2, // v2: LineFeedback 에 relatedKbIds 추가
      migrate: (persisted, fromVersion) => {
        if (!persisted || typeof persisted !== "object") return persisted;
        const state = persisted as Record<string, unknown>;
        if (fromVersion < 2 && Array.isArray(state.feedback)) {
          state.feedback = (state.feedback as Array<Record<string, unknown>>).map(
            (f) => ({
              ...f,
              relatedKbIds: Array.isArray(f.relatedKbIds) ? f.relatedKbIds : [],
            }),
          );
        }
        return state;
      },
      // selectedSegmentId 는 영속하지 않음. reviewerName 은 account-store 로 이관.
      partialize: (s) => ({
        feedback: s.feedback,
        evaluations: s.evaluations,
      }),
    },
  ),
);

// ── 파생 헬퍼 (컴포넌트에서 useMemo로 사용) ─────────────────────────────────────
export type ConversationStatus = "untouched" | "in_progress" | "completed";

export function conversationStatus(
  state: Pick<AuditState, "feedback" | "evaluations">,
  conversationId: string,
): ConversationStatus {
  if (state.evaluations[conversationId]) return "completed";
  const hasFeedback = state.feedback.some(
    (f) => f.conversationId === conversationId,
  );
  return hasFeedback ? "in_progress" : "untouched";
}

export function feedbackForSegment(
  feedback: LineFeedback[],
  conversationId: string,
  segmentId: string,
): LineFeedback[] {
  return feedback.filter(
    (f) => f.conversationId === conversationId && f.segmentId === segmentId,
  );
}

export function feedbackCounts(
  feedback: LineFeedback[],
  conversationId: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of feedback) {
    if (f.conversationId === conversationId)
      out[f.segmentId] = (out[f.segmentId] ?? 0) + 1;
  }
  return out;
}

// ── SSR 하이드레이션 가드 ────────────────────────────────────────────────────────
export function useAuditHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (useAuditStore.persist.hasHydrated()) setHydrated(true);
    const unsub = useAuditStore.persist.onFinishHydration(() =>
      setHydrated(true),
    );
    return unsub;
  }, []);
  return hydrated;
}
