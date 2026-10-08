"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { isPrototype } from "./data-mode";
import { countPendingApplications } from "@/services/expert-application";

/**
 * 관리자 사이드바 "세무사 가입 신청" 배지 — 검토 대기 수. 신청서 표는 Realtime 에 넣지 않아
 * 사이드바가 떠 있는 동안 1분마다 다시 센다(신청은 드물다). 실패하면 배지를 숨긴다.
 */
const usePendingApplicationsStore = create<{ count?: number }>()(() => ({}));

export async function refreshPendingApplications(): Promise<void> {
  try { usePendingApplicationsStore.setState({ count: await countPendingApplications() }); }
  catch { usePendingApplicationsStore.setState({ count: undefined }); }
}

export function usePendingApplicationsCount(enabled = true): number | undefined {
  useEffect(() => {
    if (!enabled || isPrototype) return;
    void refreshPendingApplications();
    const timer = setInterval(() => void refreshPendingApplications(), 60_000);
    return () => clearInterval(timer);
  }, [enabled]);
  const count = usePendingApplicationsStore((s) => s.count);
  return count && count > 0 ? count : undefined;
}
