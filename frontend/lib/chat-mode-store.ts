"use client";

import { create } from "zustand";

/**
 * 챗 모드(재생/라이브) 공유 store.
 *
 * 본문(ChatExperience 토글)과 좌측 사이드바(세션 목록·"새 상담")가 같은 모드를 봐야
 * 목록·동작이 어긋나지 않는다. 그래서 로컬 useState 대신 이 store 하나를 공유한다.
 * 기본값은 NEXT_PUBLIC_CHAT_MODE(프로덕션은 remote).
 */

export type ChatMode = "replay" | "remote";

function defaultMode(): ChatMode {
  return process.env.NEXT_PUBLIC_CHAT_MODE === "remote" ? "remote" : "replay";
}

interface ChatModeState {
  mode: ChatMode;
  setMode: (m: ChatMode) => void;
}

export const useChatModeStore = create<ChatModeState>((set) => ({
  mode: defaultMode(),
  setMode: (mode) => set({ mode }),
}));
