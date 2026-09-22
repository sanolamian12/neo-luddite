"use client";

import { useEffect } from "react";
import { create } from "zustand";
import type { ExpertCard } from "./poc-schema";
import { useAuditorRegistryStore } from "./auditor-registry-store";
import * as expertService from "@/services/expert";

/**
 * 사장님 쪽 세무사 공개 카드 캐시 — `list_experts(null)` 한 번을 사이드바 방 목록·방 헤더가 같이 쓴다.
 * 컬렉션(채널)이 아니라 RPC 라 구독 준비 대기(설계 §7)에 줄 서지 않는다.
 * 모르는 세무사 id 가 나오면(방이 새로 생김) 그 id 당 한 번 다시 당긴다.
 */

interface ExpertCardState {
  cards: Map<string, ExpertCard> | null;
}

const useExpertCardStore = create<ExpertCardState>()(() => ({ cards: null }));

let inflight: Promise<void> | null = null;
const retried = new Set<string>();

function load(): Promise<void> {
  if (!inflight) {
    inflight = expertService
      .listExperts(null)
      .then((items) => useExpertCardStore.setState({ cards: new Map(items.map((e) => [e.auditorId, e])) }))
      .catch(() => {
        if (!useExpertCardStore.getState().cards) useExpertCardStore.setState({ cards: new Map() });
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** 이 세무사들의 공개 카드를 적재한다(처음 한 번 + 모르는 id 가 나오면 id 당 한 번). */
export function useEnsureExpertCards(expertIds: string[]): void {
  const cards = useExpertCardStore((s) => s.cards);
  const key = expertIds.join("\u0001");
  useEffect(() => {
    if (expertIds.length === 0) return;
    if (!cards) {
      void load();
      return;
    }
    const unknown = expertIds.filter((id) => !cards.has(id) && !retried.has(id));
    if (unknown.length === 0) return;
    unknown.forEach((id) => retried.add(id));
    void load();
    // key 가 expertIds 를 대신한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, cards]);
}

export interface ExpertIdentity {
  /** 표시 이름. 공개 카드 → 명부 순. 둘 다 없으면 undefined(id 는 비추지 않는다 — (c) 규칙). */
  name?: string;
  avatarUrl?: string;
  avatarColor?: string;
  /** 카드·명부 적재가 끝났는가 — 끝났는데 name 이 없으면 "세무사"로만 쓴다. */
  settled: boolean;
}

/** enabled=false 면 카드를 당기지 않는다(세무사 쪽 방 헤더 — 상대가 사장님이라 필요 없다). */
export function useExpertIdentity(expertId: string, enabled = true): ExpertIdentity {
  useEnsureExpertCards(enabled ? [expertId] : []);
  const card = useExpertCardStore((s) => s.cards?.get(expertId));
  const cardsLoaded = useExpertCardStore((s) => s.cards !== null);
  const registryName = useAuditorRegistryStore(
    (s) => s.auditors.find((a) => a.id === expertId)?.displayName,
  );
  const registryHydrated = useAuditorRegistryStore((s) => s.hydrated);
  return {
    name: card?.displayName ?? registryName,
    avatarUrl: card?.avatarUrl,
    avatarColor: card?.avatarColor,
    settled: cardsLoaded && registryHydrated,
  };
}
