"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import { useAccountStore } from "./account-store";
import { createEntryChatStore, type EntryChatState } from "./entry-chat";
import { getScenario } from "./prototype/backend";

const browserStorage = {
  getItem: (key: string) => typeof window === "undefined" ? null : window.localStorage.getItem(key),
  setItem: (key: string, value: string) => { if (typeof window !== "undefined") window.localStorage.setItem(key, value); },
  removeItem: (key: string) => { if (typeof window !== "undefined") window.localStorage.removeItem(key); },
};
export const entryChatStore = createEntryChatStore(browserStorage, getScenario());

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
