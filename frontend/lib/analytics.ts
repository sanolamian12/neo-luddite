"use client";

import { isPrototype } from "./data-mode";
import { getSupabase, isSupabaseConfigured } from "./supabase/client";

/**
 * 방문·유입 기록(0061 analytics.events) — 관리자 사용 현황용 1st-party 기록.
 * 설계: design/관리자_사용현황_모니터링_대시보드_설계_1021.md §2.3.
 *
 * - 식별자는 브라우저가 만든 무작위 id 뿐(visitor = localStorage, session = 30분 무활동이면 새로). IP·UA 원문은 보내지 않는다.
 * - 첫 유입(first-touch) = 처음 들어온 방문의 utm·/r/코드·referrer 호스트. 처음이 직접 방문이었다면
 *   나중에 처음으로 경로 정보가 있는 방문이 그 자리를 채운다(그 뒤로는 바뀌지 않는다).
 * - 실패는 전부 삼킨다 — 화면·챗에 영향 0 이 원칙.
 * - 집계 제외: 이 브라우저에서 세무사·관리자·데모 계정이 로그인했거나, `?nl_optout=1` 로 들어온 적이 있으면 보내지 않는다.
 */

export type AnalyticsEvent = "visit" | "chat_started" | "handoff_shown" | "handoff_open" | "handoff_click" | "auth";

export interface FirstTouch {
  source?: string;
  medium?: string;
  campaign?: string;
  ref?: string;
  referrer_host?: string;
  landing?: string;
  at?: number;
}

const VID = "nl_vid";
const SID = "nl_sid";
const FT = "nl_ft";
const OPTOUT = "nl_optout";
export const SESSION_IDLE_MS = 30 * 60 * 1000;
const FLUSH_MS = 1500;
const MAX_BATCH = 20;

/** 이 URL·referrer 로 들어온 방문의 유입 정보. 같은 사이트 안 이동은 referrer 로 치지 않는다. */
export function touchFrom(href: string, referrer: string): FirstTouch {
  const url = new URL(href);
  const q = url.searchParams;
  const clip = (v: string | null, n: number) => (v ? v.trim().slice(0, n) || undefined : undefined);
  const touch: FirstTouch = {
    source: clip(q.get("utm_source"), 80)?.toLowerCase(),
    medium: clip(q.get("utm_medium"), 80)?.toLowerCase(),
    campaign: clip(q.get("utm_campaign"), 80),
  };
  const ref = q.get("ref")?.toLowerCase();
  if (ref && /^[a-z0-9_-]{1,40}$/.test(ref)) touch.ref = ref;
  try {
    const host = referrer ? new URL(referrer).host : "";
    if (host && host !== url.host) touch.referrer_host = host.slice(0, 120);
  } catch { /* 잘못된 referrer 는 없는 것으로 */ }
  return Object.fromEntries(Object.entries(touch).filter(([, v]) => v !== undefined)) as FirstTouch;
}

export const hasSource = (t: FirstTouch | null | undefined) => Boolean(t && (t.source || t.ref || t.referrer_host));

/** 저장된 첫 유입과 이번 방문으로 새 첫 유입을 정한다. 직접 방문만 있던 자리는 처음 경로가 있는 방문으로 채운다. */
export function mergeFirstTouch(saved: FirstTouch | null, current: FirstTouch, landing: string, now: number): FirstTouch {
  if (saved && (hasSource(saved) || !hasSource(current))) return saved;
  return { ...current, landing: landing.slice(0, 200), at: now };
}

/** 세션 이어가기: 마지막 활동이 30분 안이면 같은 세션, 아니면 새 세션(= visit 를 보낸다). */
export function nextSession(saved: { id: string; last: number } | null, now: number, newId: () => string) {
  if (saved && now - saved.last < SESSION_IDLE_MS) return { id: saved.id, last: now, isNew: false };
  return { id: newId(), last: now, isNew: true };
}

// ── 브라우저 ───────────────────────────────────────────────────────────────────

function read<T>(key: string): T | null {
  try { const raw = window.localStorage.getItem(key); return raw ? JSON.parse(raw) as T : null; } catch { return null; }
}
function write(key: string, value: unknown) {
  try { window.localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value)); } catch { /* 저장 불가 브라우저 — 메모리로만 */ }
}

let memoryVid: string | null = null;
let queue: Record<string, unknown>[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let listening = false;

export function isTrackingEnabled(): boolean {
  if (typeof window === "undefined" || isPrototype || !isSupabaseConfigured) return false;
  if (navigator.webdriver) return false;          // 평가·E2E 러너
  try { return window.localStorage.getItem(OPTOUT) !== "1"; } catch { return true; }
}

/** 이 브라우저를 집계에서 빼거나 다시 넣는다(관리자 화면 토글·`?nl_optout=1|0`·직원 로그인). */
export function setOptOut(value: boolean) {
  try {
    if (value) window.localStorage.setItem(OPTOUT, "1"); else window.localStorage.removeItem(OPTOUT);
  } catch { /* noop */ }
  if (value) queue = [];
}
export function isOptedOut(): boolean {
  try { return window.localStorage.getItem(OPTOUT) === "1"; } catch { return false; }
}

function visitorId(): string {
  let saved: string | null = null;
  try { saved = window.localStorage.getItem(VID); } catch { /* 메모리로 */ }
  if (saved && saved.length >= 8 && saved.length <= 64) return saved;
  memoryVid ??= crypto.randomUUID();
  write(VID, memoryVid);
  return memoryVid;
}

function device(): "mobile" | "desktop" {
  return window.matchMedia?.("(pointer: coarse)").matches && window.innerWidth < 1024 ? "mobile" : "desktop";
}

/** 세션을 이어가거나 새로 연다. 새 세션이면 visit 를 남긴다. 페이지 이동·탭 복귀마다 부른다. */
export function touchSession() {
  if (!isTrackingEnabled()) return;
  const now = Date.now();
  const current = touchFrom(window.location.href, document.referrer);
  const ft = mergeFirstTouch(read<FirstTouch>(FT), current, window.location.pathname, now);
  write(FT, ft);
  const session = nextSession(read<{ id: string; last: number }>(SID), now, () => crypto.randomUUID());
  write(SID, { id: session.id, last: session.last });
  if (session.isNew) {
    enqueue("visit", { props: { landing: window.location.pathname, ...current } });
  }
}

/** 이벤트 하나를 남긴다. 곧바로 보내지 않고 모아서 보낸다(페이지를 떠날 땐 바로). */
export function track(event: AnalyticsEvent, data: { conversationId?: string | null; props?: Record<string, unknown> } = {}) {
  if (!isTrackingEnabled()) return;
  const saved = read<{ id: string; last: number }>(SID);
  if (!saved || Date.now() - saved.last >= SESSION_IDLE_MS) touchSession();
  else write(SID, { id: saved.id, last: Date.now() });
  enqueue(event, data);
}

function enqueue(event: AnalyticsEvent, data: { conversationId?: string | null; props?: Record<string, unknown> }) {
  const ft = read<FirstTouch>(FT) ?? {};
  queue.push({
    visitor_id: visitorId(),
    session_id: read<{ id: string }>(SID)?.id ?? visitorId(),
    event,
    path: window.location.pathname,
    conversation_id: data.conversationId ?? undefined,
    ft: { source: ft.source, medium: ft.medium, campaign: ft.campaign, ref: ft.ref, referrer_host: ft.referrer_host },
    device: device(),
    props: data.props ?? {},
  });
  listen();
  clearTimeout(timer);
  timer = setTimeout(() => void flush(), queue.length >= MAX_BATCH ? 0 : FLUSH_MS);
}

/** 모은 이벤트를 보낸다. `auth` 처럼 로그인 토큰이 필요한 이벤트도 있어 평소엔 supabase-js 로 보낸다. */
export async function flush() {
  clearTimeout(timer);
  while (queue.length) {
    const batch = queue.splice(0, MAX_BATCH);
    try { await getSupabase().rpc("analytics_track", { p_events: batch }); } catch { /* 버린다 */ }
  }
}

/** 페이지를 떠날 때(로그인 화면으로의 전체 이동 포함) 남은 것을 keepalive 로 보낸다 — 이때는 비로그인 자격으로 간다. */
function flushOnLeave() {
  if (!queue.length) return;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return;
  const batch = queue.splice(0, MAX_BATCH).filter((item) => item.event !== "auth");
  queue = [];
  clearTimeout(timer);
  if (!batch.length) return;
  try {
    void fetch(`${url}/rest/v1/rpc/analytics_track`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ p_events: batch }),
    }).catch(() => {});
  } catch { /* noop */ }
}

function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener("pagehide", flushOnLeave);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushOnLeave(); });
}
