"use client";

import { create } from "zustand";
import type { Message } from "../conversation-schema";

/**
 * 원격(라이브) 챗 스토어 — Seam A `/api/chat` 로 실제 진행되는 대화 상태.
 * replay-store 의 결정적 재생과 대비되는, 사용자 입력이 실제 반영되는 경로.
 *
 * - conversationId: 이 라이브 세션의 고유 id (영속화·풀 등록·RAG write-path 키).
 * - messages: 현재까지 누적된 대화 (assistant-ui external store 가 읽음).
 * - isRunning: assistant 응답 대기 중(타이핑 인디케이터).
 * - error: 마지막 전송 실패 메시지(사용자 노출).
 *
 * 순수 store — 서비스 호출/영속화는 remote-chat-send.ts 가 담당(순환 의존 방지).
 */

export interface RemoteChatState {
  conversationId: string | null;
  occupation: string | null;
  /** 대화방 소유자(사장님) domain_id — 영속화 owner_id(RLS 키). */
  ownerId: string | null;
  /** 대화방 소유자(사장님) 표시 라벨. */
  ownerLabel: string | null;
  /** 세션 시작 시각(ms) — 하차장 정렬 키. init 시 1회 확정. */
  createdAt: number | null;
  messages: Message[];
  isRunning: boolean;
  error: string | null;

  init: (args: {
    conversationId: string;
    occupation: string;
    ownerId: string;
    ownerLabel?: string | null;
    createdAt: number;
    /** 기존 세션을 다시 열 때 복원할 메시지(사이드바에서 세션 클릭). 미지정=새 세션(빈 배열). */
    messages?: Message[];
  }) => void;
  append: (m: Message) => void;
  setRunning: (b: boolean) => void;
  setError: (e: string | null) => void;
  reset: () => void;
}

export const useRemoteChatStore = create<RemoteChatState>((set) => ({
  conversationId: null,
  occupation: null,
  ownerId: null,
  ownerLabel: null,
  createdAt: null,
  messages: [],
  isRunning: false,
  error: null,

  init: ({ conversationId, occupation, ownerId, ownerLabel, createdAt, messages }) =>
    set({
      conversationId,
      occupation,
      ownerId,
      ownerLabel: ownerLabel ?? null,
      createdAt,
      messages: messages ?? [],
      isRunning: false,
      error: null,
    }),

  append: (m) => set((s) => ({ messages: [...s.messages, m] })),
  setRunning: (b) => set({ isRunning: b }),
  setError: (e) => set({ error: e }),

  reset: () =>
    set({
      conversationId: null,
      occupation: null,
      ownerId: null,
      ownerLabel: null,
      createdAt: null,
      messages: [],
      isRunning: false,
      error: null,
    }),
}));
