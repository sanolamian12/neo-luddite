"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import { useAccountStore } from "./account-store";
import { createEntryChatStore, messageText, type EntryChatState, type EntryResponder } from "./entry-chat";
import { getScenario } from "./prototype/backend";
import { isPrototype } from "./data-mode";
import { send as sendChat } from "@/services/chat";
import { track } from "./analytics";

const browserStorage = {
  getItem: (key: string) => typeof window === "undefined" ? null : window.localStorage.getItem(key),
  setItem: (key: string, value: string) => { if (typeof window !== "undefined") window.localStorage.setItem(key, value); },
  removeItem: (key: string) => { if (typeof window !== "undefined") window.localStorage.removeItem(key); },
};

/** 라이브: Seam A `/api/chat`(Upstage) 한 턴. 비로그인 방문자도 탄다 — 챗 API 는 인증 없음. */
const liveRespond: EntryResponder = async (conversation) => {
  const last = conversation.messages.at(-1)!;
  // 첫 질문이면 방문 기록과 이 대화를 잇는다(관리자 사용 현황 — rag.chat_turns 와 conversation_id 로 조인).
  if (conversation.messages.filter((m) => m.role === "user").length === 1) track("chat_started", { conversationId: conversation.id });
  const { message } = await sendChat({
    conversationId: conversation.id,
    occupation: conversation.occupation,
    history: conversation.messages.slice(0, -1),
    text: messageText(last),
  });
  return message;
};

export const entryChatStore = createEntryChatStore(browserStorage, getScenario(), isPrototype ? undefined : liveRespond);

export function useEntryChat<T>(selector: (state: EntryChatState) => T) {
  return useStore(entryChatStore, selector);
}

const subscribeHydration = (listener: () => void) => entryChatStore.persist.onFinishHydration(listener);
const isHydrated = () => entryChatStore.persist.hasHydrated();
const serverHydrated = () => false;
export function useEntryHydrated() {
  const hydrated = useSyncExternalStore(subscribeHydration, isHydrated, serverHydrated);
  useEffect(() => {
    if (!entryChatStore.persist.hasHydrated()) void entryChatStore.persist.rehydrate();
  }, [hydrated]);
  return hydrated;
}

export function currentChatScope() {
  const account = useAccountStore.getState();
  return account.session ? `${account.session}:${account[account.session].id}` : "guest";
}

export function useChatScope() {
  return useAccountStore((account) => account.session ? `${account.session}:${account[account.session].id}` : "guest");
}
