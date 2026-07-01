"use client";

import { create } from "zustand";
import type { OccupationKey } from "./occupations";

/**
 * 앱 세션 상태.
 * Phase 2: 선택된 직업군 보관.
 * Phase 4: 대화 재생 슬라이스(스크립트 포인터·표시 메시지)를 확장 추가 예정.
 */
interface AppState {
  selectedOccupation: OccupationKey | null;
  setOccupation: (key: OccupationKey) => void;
  reset: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedOccupation: null,
  setOccupation: (key) => set({ selectedOccupation: key }),
  reset: () => set({ selectedOccupation: null }),
}));
