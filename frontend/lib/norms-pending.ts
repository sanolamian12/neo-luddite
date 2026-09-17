"use client";

import { create } from "zustand";
import * as normsService from "@/services/norms";
import type { NormDocument } from "@/services/norms";

/**
 * "내가 아직 승인·이의 안 한 공개 중 규범 제안" — 세무사 로그인 팝업·사이드바 배지 공용(P6 ②, 2026-09-17).
 *
 * 워처(NormsPendingWatcher)가 감사 셸에서 60초마다 refresh 하고, 규범 화면은 변경 후 같은 store 에
 * 결과를 밀어 넣는다 — 화면에서 승인하면 배지가 곧바로 줄어든다. 백엔드 미설정·장애면 조용히 빈 목록.
 */
interface NormsPendingState {
  items: NormDocument[];
  loaded: boolean;
  refresh: (me: string) => Promise<void>;
  setFromOverview: (overview: normsService.NormsOverview, me: string) => void;
}

export const useNormsPendingStore = create<NormsPendingState>()((set) => ({
  items: [],
  loaded: false,
  refresh: async (me) => {
    if (!process.env.NEXT_PUBLIC_API_BASE || !me) return;
    try {
      const overview = await normsService.getNorms();
      set({ items: normsService.awaitingMyDecision(overview, me), loaded: true });
    } catch {
      // 조회 실패는 배지·팝업을 띄우지 않을 뿐 — 규범 화면이 오류를 직접 보여준다.
    }
  },
  setFromOverview: (overview, me) => set({ items: normsService.awaitingMyDecision(overview, me), loaded: true }),
}));
