"use client";

import { useEffect } from "react";
import { create } from "zustand";
import {
  feedbackDedupeKey,
  type FeedbackTag,
  type LineFeedback,
  type SessionEvaluation,
  type SessionScores,
} from "./audit-schema";
import { getSupabase } from "./supabase/client";
import { makeCollectionSync } from "./supabase/sync";

/**
 * 감사 스토어 — 공용 검수 보드. (구 localStorage persist → Supabase 동기화 컷오버)
 *
 * 사용자 개념: 세무사 N명이 한 대화를 함께 보는 단체 채팅방. 같은 대화의 멤버끼리
 * 서로의 라인 코멘트/세션 평가를 실시간으로 보고, 본인 것만 수정/삭제한다.
 * 가시성은 RLS(0007 feedback_member_read / eval_member_read)가 강제 — 스토어는
 * "볼 수 있는 것"만 fetch/구독한다. reviewer=표시이름, auditorId=신원(도메인 id).
 *
 * 쓰기: Supabase write + 낙관적 스토어 갱신(Realtime echo 는 멱등). services/*.ts
 * 패턴과 동일하되, 기존 소비처가 스토어 액션을 직접 부르므로 액션을 보존하고
 * 그 내부에서 write-through 한다(시그니처 불변, §3-3).
 */

// ── row(snake) 타입 ──────────────────────────────────────────────────────────
interface LineFeedbackRow {
  id: string;
  audit_id: string | null;
  conversation_id: string;
  segment_id: string;
  reviewer: string;
  auditor_id: string | null;
  body: string;
  tags: FeedbackTag[];
  related_kb_ids: string[];
  created_at: number;
}

interface SessionEvalRow {
  id: string;
  conversation_id: string;
  reviewer: string;
  auditor_id: string | null;
  qualitative: string;
  scores: SessionScores;
  created_at: number;
}

function rowToFeedback(r: LineFeedbackRow): LineFeedback {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    segmentId: r.segment_id,
    // 레거시 행(auditor_id null)은 reviewer 로 폴백.
    auditorId: r.auditor_id ?? r.reviewer,
    reviewer: r.reviewer,
    body: r.body,
    tags: Array.isArray(r.tags) ? r.tags : [],
    relatedKbIds: Array.isArray(r.related_kb_ids) ? r.related_kb_ids : [],
    createdAt: Number(r.created_at),
  };
}

function rowToEval(r: SessionEvalRow): SessionEvaluation {
  return {
    id: r.id,
    conversationId: r.conversation_id,
    auditorId: r.auditor_id ?? r.reviewer,
    reviewer: r.reviewer,
    qualitative: r.qualitative ?? "",
    scores: r.scores,
    createdAt: Number(r.created_at),
  };
}

/**
 * DB 백스톱(0012)이 거절한 이유를 사용자 말로 옮긴다.
 * 클라이언트 가드를 우회했거나(다른 탭·경쟁 삽입) 확정 직후에 저장을 눌렀을 때 나온다.
 */
function describeInsertError(error: { code?: string; message?: string }): string {
  if (error.code === "23505") return "같은 문장에 동일한 코멘트가 이미 있습니다.";
  if (error.code === "23514") return "분류를 최소 1개 선택하세요.";
  if (error.code === "42501")
    return "검수가 확정된 대화입니다 — 더 이상 코멘트를 남길 수 없습니다.";
  return `저장에 실패했습니다: ${error.message ?? "알 수 없는 오류"}`;
}

// ── store ────────────────────────────────────────────────────────────────────
interface AuditState {
  feedback: LineFeedback[];
  evaluations: SessionEvaluation[]; // 배열(멤버별) — evaluationFor 로 조회
  selectedSegmentId: string | null; // 세션 한정(동기화·영속 제외)
  feedbackHydrated: boolean;
  evalHydrated: boolean;

  selectSegment: (segmentId: string | null) => void;
  /** 성공 시 null, 거부/실패 시 사용자에게 보여줄 사유 문자열. */
  addFeedback: (input: {
    conversationId: string;
    segmentId: string;
    body: string;
    tags: FeedbackTag[];
    reviewer: string;
    auditorId: string;
    relatedKbIds?: string[];
  }) => Promise<string | null>;
  updateFeedback: (
    id: string,
    patch: { body?: string; tags?: FeedbackTag[]; relatedKbIds?: string[] },
  ) => void;
  deleteFeedback: (id: string) => void;
  setSessionEval: (
    conversationId: string,
    input: {
      qualitative: string;
      scores: SessionScores;
      reviewer: string;
      auditorId: string;
    },
  ) => void;

  // 내부 동기화 어플라이어(Realtime/최초 fetch)
  _setAllFeedback: (items: LineFeedback[]) => void;
  _upsertFeedback: (f: LineFeedback) => void;
  _removeFeedback: (id: string) => void;
  _setAllEval: (items: SessionEvaluation[]) => void;
  _upsertEval: (e: SessionEvaluation) => void;
  _removeEval: (id: string) => void;
}

// get() 을 쓴다 — 초기화 함수 안에서 useAuditStore 를 직접 참조하면 반환 타입이
// 자기 자신을 순환 참조해 스토어 타입이 any 로 무너진다(TS7022/7023).
export const useAuditStore = create<AuditState>()((set, get) => ({
  feedback: [],
  evaluations: [],
  selectedSegmentId: null,
  feedbackHydrated: false,
  evalHydrated: false,

  selectSegment: (segmentId) => set({ selectedSegmentId: segmentId }),

  addFeedback: async ({
    conversationId,
    segmentId,
    body,
    tags,
    reviewer,
    auditorId,
    relatedKbIds,
  }) => {
    const trimmed = body.trim();
    if (!trimmed) return "내용을 입력하세요.";
    // 분류 필수 — 태그 없는 코멘트는 RAG 적재 갈래를 정할 수 없다.
    if (tags.length === 0) return "분류를 최소 1개 선택하세요.";
    // 중복 방어 — 같은 문장에 이미 달린 코멘트(작성자 불문)와 스트링 비교.
    // 최종 방어선은 DB 유니크 인덱스(0012)이고, 여기선 왕복 없이 즉시 되돌려준다.
    const key = feedbackDedupeKey(trimmed);
    const dup = get().feedback.find(
      (f) =>
        f.conversationId === conversationId &&
        f.segmentId === segmentId &&
        feedbackDedupeKey(f.body) === key,
    );
    if (dup) {
      return dup.auditorId === auditorId
        ? "이미 같은 코멘트를 이 문장에 남겼습니다."
        : `${dup.reviewer} 님이 같은 코멘트를 이미 남겼습니다.`;
    }

    const item: LineFeedback = {
      id: crypto.randomUUID(),
      conversationId,
      segmentId,
      auditorId,
      reviewer,
      body: trimmed,
      tags,
      relatedKbIds: relatedKbIds ?? [],
      createdAt: Date.now(),
    };
    // 낙관적 갱신
    set((s) => ({ feedback: [...s.feedback, item] }));

    const { error } = await getSupabase().from("line_feedback").insert({
      id: item.id,
      audit_id: null,
      conversation_id: item.conversationId,
      segment_id: item.segmentId,
      reviewer: item.reviewer,
      auditor_id: item.auditorId,
      body: item.body,
      tags: item.tags,
      related_kb_ids: item.relatedKbIds,
      created_at: item.createdAt,
    });
    if (error) {
      // 낙관적 항목 롤백 — 안 그러면 저장 실패한 코멘트가 화면에만 남는다.
      set((s) => ({ feedback: s.feedback.filter((f) => f.id !== item.id) }));
      console.error("[audit] addFeedback 실패", error);
      return describeInsertError(error);
    }
    return null;
  },

  updateFeedback: (id, patch) => {
    set((s) => ({
      feedback: s.feedback.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }));
    void (async () => {
      const row: Record<string, unknown> = {};
      if (patch.body !== undefined) row.body = patch.body;
      if (patch.tags !== undefined) row.tags = patch.tags;
      if (patch.relatedKbIds !== undefined) row.related_kb_ids = patch.relatedKbIds;
      if (Object.keys(row).length === 0) return;
      const { error } = await getSupabase()
        .from("line_feedback")
        .update(row)
        .eq("id", id);
      if (error) console.error("[audit] updateFeedback 실패", error);
    })();
  },

  deleteFeedback: (id) => {
    const prev = get().feedback.find((f) => f.id === id);
    set((s) => ({ feedback: s.feedback.filter((f) => f.id !== id) }));
    void (async () => {
      // RLS 가 막은 DELETE 는 에러가 아니라 "0행 삭제"로 조용히 통과한다.
      // → .select() 로 실제 지워진 행을 확인해야 확정 대화 잠금을 감지할 수 있다.
      const { data, error } = await getSupabase()
        .from("line_feedback")
        .delete()
        .eq("id", id)
        .select("id");
      const deleted = !error && (data?.length ?? 0) > 0;
      if (!deleted && prev) {
        // 화면에서만 사라지지 않도록 되돌린다(확정 대화 = 삭제 불가).
        set((s) =>
          s.feedback.some((f) => f.id === prev.id)
            ? s
            : { feedback: [...s.feedback, prev] },
        );
        console.error("[audit] deleteFeedback 실패(잠김 또는 오류)", error);
      }
    })();
  },

  setSessionEval: (conversationId, { qualitative, scores, reviewer, auditorId }) => {
    const prev = get().evaluations.find(
      (e) => e.conversationId === conversationId && e.auditorId === auditorId,
    );
    const item: SessionEvaluation = {
      id: prev?.id ?? crypto.randomUUID(),
      conversationId,
      auditorId,
      reviewer,
      qualitative,
      scores,
      createdAt: prev?.createdAt ?? Date.now(),
    };
    set((s) => ({
      evaluations: prev
        ? s.evaluations.map((e) => (e.id === item.id ? item : e))
        : [...s.evaluations, item],
    }));
    void (async () => {
      const { error } = await getSupabase()
        .from("session_evaluations")
        .upsert(
          {
            id: item.id,
            conversation_id: item.conversationId,
            reviewer: item.reviewer,
            auditor_id: item.auditorId,
            qualitative: item.qualitative,
            scores: item.scores,
            created_at: item.createdAt,
          },
          { onConflict: "conversation_id,auditor_id" },
        );
      if (error) console.error("[audit] setSessionEval 실패", error);
    })();
  },

  _setAllFeedback: (items) => set({ feedback: items }),
  _upsertFeedback: (f) =>
    set((s) => {
      const idx = s.feedback.findIndex((x) => x.id === f.id);
      if (idx === -1) return { feedback: [...s.feedback, f] };
      const next = [...s.feedback];
      next[idx] = f;
      return { feedback: next };
    }),
  _removeFeedback: (id) =>
    set((s) => ({ feedback: s.feedback.filter((f) => f.id !== id) })),

  _setAllEval: (items) => set({ evaluations: items }),
  _upsertEval: (e) =>
    set((s) => {
      const idx = s.evaluations.findIndex((x) => x.id === e.id);
      if (idx === -1) return { evaluations: [...s.evaluations, e] };
      const next = [...s.evaluations];
      next[idx] = e;
      return { evaluations: next };
    }),
  _removeEval: (id) =>
    set((s) => ({ evaluations: s.evaluations.filter((e) => e.id !== id) })),
}));

// ── Supabase 동기화 부트스트랩 (두 컬렉션) ─────────────────────────────────────
const startFeedbackSync = makeCollectionSync<LineFeedbackRow, LineFeedback>({
  table: "line_feedback",
  rowToDomain: rowToFeedback,
  pkColumn: "id",
  setAll: (items) => useAuditStore.getState()._setAllFeedback(items),
  applyUpsert: (item) => useAuditStore.getState()._upsertFeedback(item),
  applyDelete: (pk) => useAuditStore.getState()._removeFeedback(pk),
  onHydrated: () => useAuditStore.setState({ feedbackHydrated: true }),
});

const startEvalSync = makeCollectionSync<SessionEvalRow, SessionEvaluation>({
  table: "session_evaluations",
  rowToDomain: rowToEval,
  pkColumn: "id",
  setAll: (items) => useAuditStore.getState()._setAllEval(items),
  applyUpsert: (item) => useAuditStore.getState()._upsertEval(item),
  applyDelete: (pk) => useAuditStore.getState()._removeEval(pk),
  onHydrated: () => useAuditStore.setState({ evalHydrated: true }),
});

function startAuditSync(): void {
  startFeedbackSync();
  startEvalSync();
}

if (typeof window !== "undefined") startAuditSync();

// ── 파생 헬퍼 (컴포넌트에서 useMemo로 사용) ─────────────────────────────────────
export type ConversationStatus = "untouched" | "in_progress" | "completed";

/**
 * 특정 세무사 시점의 대화 진행 상태.
 *  - completed: 그 세무사가 세션 평가까지 남김
 *  - in_progress: 라인 코멘트는 있으나 세션 평가 없음
 *  - untouched: 둘 다 없음
 */
export function conversationStatus(
  state: Pick<AuditState, "feedback" | "evaluations">,
  conversationId: string,
  auditorId: string,
): ConversationStatus {
  const hasEval = state.evaluations.some(
    (e) => e.conversationId === conversationId && e.auditorId === auditorId,
  );
  if (hasEval) return "completed";
  const hasFeedback = state.feedback.some(
    (f) => f.conversationId === conversationId && f.auditorId === auditorId,
  );
  return hasFeedback ? "in_progress" : "untouched";
}

/** 한 문장에 달린 모든 코멘트(작성자 불문 = 공용 보드). */
export function feedbackForSegment(
  feedback: LineFeedback[],
  conversationId: string,
  segmentId: string,
): LineFeedback[] {
  return feedback.filter(
    (f) => f.conversationId === conversationId && f.segmentId === segmentId,
  );
}

/** 대화의 문장별 코멘트 수(작성자 불문). */
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

/** 특정 세무사가 남긴 그 대화의 세션 평가(없으면 null). */
export function evaluationFor(
  evaluations: SessionEvaluation[],
  conversationId: string,
  auditorId: string,
): SessionEvaluation | null {
  return (
    evaluations.find(
      (e) => e.conversationId === conversationId && e.auditorId === auditorId,
    ) ?? null
  );
}

// ── 하이드레이션 가드 (두 컬렉션 모두 최초 fetch 완료) ──────────────────────────
export function useAuditHydrated(): boolean {
  const feedbackHydrated = useAuditStore((s) => s.feedbackHydrated);
  const evalHydrated = useAuditStore((s) => s.evalHydrated);
  useEffect(() => {
    startAuditSync();
  }, []);
  return feedbackHydrated && evalHydrated;
}
