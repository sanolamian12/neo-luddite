"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Conversation } from "./conversation-schema";

/**
 * 관리자가 하차장(엑셀)으로 업로드한 대화를 담는 런타임 store.
 *
 * 정적 대화는 `load-conversation.ts` 의 번들 레지스트리에 있지만, 엑셀 intake 로
 * 생성된 대화는 런타임에만 존재하므로 여기(localStorage 영속)에 보관한다.
 * `load-conversation.ts` 의 getter 들이 이 store 를 병합 조회한다.
 */
interface UploadedConvState {
  byId: Record<string, Conversation>;
  addMany: (convs: Conversation[]) => void;
  remove: (id: string) => void;
  clear: () => void;
}

const noopStorage: Storage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  key: () => null,
  length: 0,
};

export const useUploadedConversationStore = create<UploadedConvState>()(
  persist(
    (set) => ({
      byId: {},
      addMany: (convs) =>
        set((s) => {
          const next = { ...s.byId };
          for (const c of convs) next[c.id] = c;
          return { byId: next };
        }),
      remove: (id) =>
        set((s) => {
          const next = { ...s.byId };
          delete next[id];
          return { byId: next };
        }),
      clear: () => set({ byId: {} }),
    }),
    {
      name: "uploaded-conv-v1",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? window.localStorage : noopStorage,
      ),
    },
  ),
);

/** non-hook 접근자 — load-conversation.ts 의 순수 getter 에서 병합 조회용. */
export function getUploadedConversation(id: string): Conversation | undefined {
  return useUploadedConversationStore.getState().byId[id];
}
