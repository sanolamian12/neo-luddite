"use client";

import Link from "next/link";
import { Fragment, createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ComponentProps, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { isPrototype } from "@/lib/data-mode";
import { demoHref, demoRunSchema, reconcileRetractions, type DemoRun } from "@/lib/demo/domain";
import { loadRun, runKey, saveRun } from "@/lib/demo/storage";

const changed = "neo-demo-changed";
const lockKey = (id: string) => `neo-demo-lock-v1:${id}`;
const emptySnapshot = () => "";
function subscribe(callback: () => void) { window.addEventListener("storage", callback); window.addEventListener(changed, callback); return () => { window.removeEventListener("storage", callback); window.removeEventListener(changed, callback); }; }
export function notifyDemo() { window.dispatchEvent(new Event(changed)); }
export function supportedDemoPath(path: string) { return /^\/(demo|chat\/clinic|audit\/(agents(?:\/(teach|knowledge|principles|preview))?|consultations|contributions|ledger)|admin\/knowledge-contributions(?:\/batches(?:\/[\w-]+)?)?)\/?$/.test(path); }
interface Runtime { run: DemoRun; href: (path: string) => string; transact: (change: (run: DemoRun) => DemoRun) => DemoRun; act: (change: (run: DemoRun) => DemoRun) => boolean; }
const Context = createContext<Runtime | null>(null);
export function useDemo() { return useContext(Context); }
export function DemoLink({ href, ...props }: ComponentProps<typeof Link>) { const demo = useDemo(); return <Link {...props} href={demo && typeof href === "string" && supportedDemoPath(href.split("?")[0]) ? demo.href(href) : href} />; }
export function useDemoRouter() { const router = useRouter(); const demo = useDemo(); return { ...router, push: (href: string, options?: Parameters<typeof router.push>[1]) => router.push(demo && supportedDemoPath(href.split("?")[0]) ? demo.href(href) : href, options), replace: (href: string, options?: Parameters<typeof router.replace>[1]) => router.replace(demo && supportedDemoPath(href.split("?")[0]) ? demo.href(href) : href, options) }; }

export function DemoRuntimeProvider({ children }: { children: ReactNode }) {
  const search = useSearchParams(), path = usePathname();
  const id = isPrototype ? search.get("demo") : null;
  if (!id) return children;
  if (!supportedDemoPath(path)) return <div className="ds-page"><h1>이 화면은 데모에 포함되지 않습니다</h1><Link href="/demo">데모 시작 화면으로</Link></div>;
  return <RunRuntime key={id} id={id}>{children}</RunRuntime>;
}
function RunRuntime({ id, children }: { id: string; children: ReactNode }) {
  const path = usePathname(); const search = useSearchParams().toString();
  const [tab] = useState(() => crypto.randomUUID());
  const [error, setError] = useState("");
  const raw = useSyncExternalStore(subscribe, () => { try { return window.localStorage.getItem(runKey(id)) ?? "missing"; } catch { return "unavailable"; } }, emptySnapshot);
  const lock = useSyncExternalStore(subscribe, () => { try { return window.localStorage.getItem(lockKey(id)) ?? ""; } catch { return ""; } }, emptySnapshot);
  const state = useMemo(() => { if (!raw) return { run: null, error: "" }; try { const run = demoRunSchema.parse(JSON.parse(raw)); if (run.id !== id) throw new Error(); return { run, error: "" }; } catch { return { run: null, error: "저장된 데모를 열 수 없습니다. 원본은 보존되어 있습니다. 시작 화면에서 새 데모를 만들어 주세요." }; } }, [raw, id]);
  const ownsLock = lock.startsWith(`${tab}|`);
  function claim() { try { window.localStorage.setItem(lockKey(id), `${tab}|${Date.now()}`); notifyDemo(); } catch { setError("브라우저 저장소에 접근할 수 없습니다."); } }
  useEffect(() => {
    const release = () => { if (window.localStorage.getItem(lockKey(id))?.startsWith(`${tab}|`)) window.localStorage.removeItem(lockKey(id)); };
    const beat = () => {
      try { const value = window.localStorage.getItem(lockKey(id)); const [owner, at] = value?.split("|") ?? [];
        if (!owner || owner === tab || Date.now() - Number(at) > 15000) { window.localStorage.setItem(lockKey(id), `${tab}|${Date.now()}`); notifyDemo(); }
      } catch { /* A write reports the actionable storage error. */ }
    };
    beat(); const timer = window.setInterval(beat, 5000); window.addEventListener("pagehide", release);
    return () => { window.clearInterval(timer); window.removeEventListener("pagehide", release); release(); };
  }, [id, tab]);
  useEffect(() => {
    if (!ownsLock) return;
    try { const current = loadRun(localStorage, id); const lastPath = `${path}${search ? `?${search}` : ""}`;
      if (current && current.lastPath !== lastPath) { saveRun(localStorage, { ...current, lastPath }, current.revision); notifyDemo(); }
    } catch { /* Domain actions report storage errors; navigation can still proceed. */ }
  }, [id, ownsLock, path, search]);
  if (!state.run) return <div className="ds-page" role={state.error ? "alert" : "status"}>{state.error || "데모를 불러오는 중…"}{state.error && <p><Link href="/demo">새 데모 시작하기</Link></p>}</div>;
  if (!ownsLock) return <div className="ds-page"><h1>데모 편집 권한 확인</h1><p>다른 탭이 이 데모를 열고 있으면 한 탭에서만 진행해 주세요.</p><button onClick={claim}>이 탭에서 이어하기</button>{error && <p role="alert">{error}</p>}</div>;
  function transact(change: (run: DemoRun) => DemoRun) {
    try {
      if (!window.localStorage.getItem(lockKey(id))?.startsWith(`${tab}|`)) throw new Error("다른 탭에서 데모를 이어가고 있습니다. 이 탭의 편집 권한을 다시 확인해 주세요.");
      const current = loadRun(window.localStorage, id);
      if (!current) throw new Error("데모를 찾을 수 없습니다.");
      const next = saveRun(window.localStorage, reconcileRetractions(change(current)), current.revision);
      setError(""); notifyDemo(); return next;
    } catch (cause) { const message = cause instanceof Error ? cause.message : "저장하지 못했습니다. 다시 시도해 주세요."; setError(message); throw cause; }
  }
  return <Context.Provider value={{ run: state.run, href: (path) => demoHref(path, id), transact, act: (change) => { try { transact(change); return true; } catch { return false; } } }}>
    {error && <div role="alert" className="border-b bg-card px-4 py-2 text-sm text-destructive">{error}<button className="ml-4 underline" onClick={() => setError("")}>닫기</button></div>}
    <Fragment key={state.run.generation}>{children}</Fragment>
  </Context.Provider>;
}
