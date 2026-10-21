"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useAccountStore } from "@/lib/account-store";
import { flush, isTrackingEnabled, setOptOut, touchSession, track } from "@/lib/analytics";

/** 시드 데모 사장님 계정(domain_id) — 팀 시연이 지표에 섞이지 않게 뺀다. */
const DEMO_OWNER_IDS = new Set(["viewer", "owner2", "owner3", "owner4"]);
const AUTH_SENT = "nl_auth_sent";

/**
 * 방문 세션·로그인을 기록한다(lib/analytics.ts). 화면에는 아무것도 그리지 않는다.
 * 세무사·관리자·데모 계정으로 로그인하면 그 로그인을 한 번 남긴 뒤 이 브라우저를 집계에서 뺀다
 * (서버 집계도 같은 방문자를 user_id 로 걸러낼 수 있다).
 */
export function AnalyticsTracker() {
  const pathname = usePathname();

  useEffect(() => {
    try {
      const flag = new URLSearchParams(window.location.search).get("nl_optout");
      if (flag === "1") setOptOut(true);
      if (flag === "0") setOptOut(false);
    } catch { /* noop */ }
    const onVisible = () => { if (document.visibilityState === "visible") touchSession(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => { touchSession(); }, [pathname]);

  useEffect(() => {
    const report = (state: ReturnType<typeof useAccountStore.getState>) => {
      if (!state.authReady || !state.session || !isTrackingEnabled()) return;
      const id = state[state.session].id;
      const key = `${state.session}:${id}`;
      try { if (window.sessionStorage.getItem(AUTH_SENT) === key) return; window.sessionStorage.setItem(AUTH_SENT, key); } catch { /* noop */ }
      track("auth");
      if (state.session !== "viewer" || DEMO_OWNER_IDS.has(id)) {
        void flush().then(() => setOptOut(true));
      } else {
        void flush();
      }
    };
    report(useAccountStore.getState());
    return useAccountStore.subscribe(report);
  }, []);

  return null;
}
