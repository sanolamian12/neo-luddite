"use client";

import { create } from "zustand";
import type { Conversation, Message } from "./conversation-schema";

/**
 * 결정적(deterministic) 대화 재생 스토어.
 * - script: 로드된 전체 대화
 * - visible: 현재까지 노출된 메시지 (assistant-ui external store가 읽음)
 * - byId: 메시지 ID → 원본 Message (커스텀 렌더에서 세그먼트/uiBlock 조회용)
 * - pointer: script.messages 중 다음에 노출할 인덱스
 *
 * sendNext()가 핵심: 사용자가 starter/composer로 보내면
 * 다음 user 메시지를 즉시 노출 → 잠시 후 다음 assistant 메시지를 노출(결정적).
 */
const ASSISTANT_DELAY_MS = 700;

function buildById(messages: Message[]): Record<string, Message> {
  const m: Record<string, Message> = {};
  for (const msg of messages) m[msg.id] = msg;
  return m;
}

interface ReplayState {
  script: Conversation | null;
  visible: Message[];
  byId: Record<string, Message>;
  pointer: number;
  isRunning: boolean;
  /** true면 세그먼트를 순차 애니메이션 없이 즉시 표시(전체 공개 모드) */
  instant: boolean;
  init: (conv: Conversation) => void;
  start: (conv: Conversation) => void;
  revealAll: (conv: Conversation) => void;
  sendNext: () => void;
  reset: () => void;
}

export const useReplayStore = create<ReplayState>((set, get) => ({
  script: null,
  visible: [],
  byId: {},
  pointer: 0,
  isRunning: false,
  instant: false,

  init: (conv) =>
    set({
      script: conv,
      visible: [],
      byId: {},
      pointer: 0,
      isRunning: false,
      instant: false,
    }),

  // 대화를 로드하고 즉시 첫 턴(user→assistant) 재생
  start: (conv) => {
    set({
      script: conv,
      visible: [],
      byId: {},
      pointer: 0,
      isRunning: false,
      instant: false,
    });
    get().sendNext();
  },

  // 대화 전체를 한 번에 공개(완성된 세션 트랜스크립트)
  revealAll: (conv) =>
    set({
      script: conv,
      visible: [...conv.messages],
      byId: buildById(conv.messages),
      pointer: conv.messages.length,
      isRunning: false,
      instant: true,
    }),

  sendNext: () => {
    const { script, pointer, isRunning } = get();
    if (!script || isRunning) return;
    const msgs = script.messages;
    if (pointer >= msgs.length) return;

    const userMsg = msgs[pointer];
    // 다음 user 메시지 즉시 노출
    set((s) => ({
      visible: [...s.visible, userMsg],
      byId: { ...s.byId, [userMsg.id]: userMsg },
      pointer: s.pointer + 1,
      isRunning: userMsg.role === "user",
    }));

    // 이어지는 assistant 메시지를 지연 후 노출
    if (userMsg.role === "user") {
      const next = get().pointer;
      const asst = msgs[next];
      if (asst && asst.role === "assistant") {
        setTimeout(() => {
          set((s) => ({
            visible: [...s.visible, asst],
            byId: { ...s.byId, [asst.id]: asst },
            pointer: s.pointer + 1,
            isRunning: false,
          }));
        }, ASSISTANT_DELAY_MS);
      } else {
        set({ isRunning: false });
      }
    }
  },

  reset: () =>
    set({
      script: null,
      visible: [],
      byId: {},
      pointer: 0,
      isRunning: false,
      instant: false,
    }),
}));
