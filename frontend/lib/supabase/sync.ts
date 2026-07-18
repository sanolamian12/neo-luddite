"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "./client";

/**
 * Supabase ↔ Zustand 컬렉션 동기화 유틸 (워크스트림 A 컷오버).
 *
 * 설계 (마스터설계 §3-3 "UI 무손상"):
 *  - 컴포넌트는 여전히 `useXStore((s) => s.items)` 로 반응형 구독한다.
 *  - 스토어는 이제 localStorage 가 아니라 Supabase 를 원천으로 삼는다:
 *      ① 최초 1회 전체 fetch → setAll
 *      ② postgres_changes Realtime 구독 → 다른 브라우저의 변경이 흘러들어옴
 *  - services/*.ts 의 쓰기 함수는 Supabase 에 write 하고, 낙관적(optimistic)으로
 *    자기 스토어도 갱신한다. Realtime echo 는 멱등이라 이중 적용돼도 안전.
 */

/** table 의 전체 행을 읽어 반환. RLS 가 역할별 가시성을 강제한다. */
export async function fetchAll<TRow>(
  table: string,
  signal?: AbortSignal,
): Promise<TRow[]> {
  const query = getSupabase().from(table).select("*");
  const { data, error } = await (signal ? query.abortSignal(signal) : query);
  if (error) throw error;
  return (data ?? []) as TRow[];
}

// ── 최초 적재 재시도 정책 ────────────────────────────────────────────────────
// 이 값들이 지키는 것은 "느린 네트워크"가 아니라 **끊긴 요청**이다. 로그인 직후
// 곧바로 다른 화면으로 이동하면 진행 중이던 fetch 가 취소되고(ERR_ABORTED),
// 재시도가 없으면 그 컬렉션은 그 세션 내내 비어 있거나 로딩 상태로 굳는다.
const FETCH_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 4; // 최초 1회 + 재시도 3회
const BACKOFF_BASE_MS = 400; // 400 → 800 → 1600

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * table 의 INSERT/UPDATE/DELETE 를 구독.
 *  - INSERT/UPDATE → onUpsert(payload.new)
 *  - DELETE        → onDelete(payload.old)  (RLS full replica identity 없으면 pk 만 옴)
 */
export function subscribe<TRow>(
  table: string,
  onUpsert: (row: TRow) => void,
  onDelete: (oldRow: Record<string, unknown>) => void,
): RealtimeChannel {
  return getSupabase()
    .channel(`rt:public:${table}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table },
      (payload) => {
        if (payload.eventType === "DELETE") onDelete(payload.old ?? {});
        else onUpsert(payload.new as TRow);
      },
    )
    .subscribe();
}

// ── 인증 연동 재하이드레이션 ────────────────────────────────────────────────
// 최초 fetch 는 비로그인(anon) 상태라 RLS 로 빈 결과다. 로그인(SIGNED_IN) 시
// 모든 컬렉션을 사용자 JWT 로 재-fetch 해야 데이터가 채워진다. 로그아웃 시엔
// 다시 anon 으로 재-fetch → 빈 결과로 스토어가 비워진다.
const rehydrators: Array<() => Promise<void>> = [];
let authBound = false;

function bindAuthRehydrate(): void {
  if (authBound || typeof window === "undefined") return;
  authBound = true;
  getSupabase().auth.onAuthStateChange((event) => {
    if (
      event === "SIGNED_IN" ||
      event === "SIGNED_OUT" ||
      event === "TOKEN_REFRESHED"
    ) {
      for (const rehydrate of rehydrators) void rehydrate();
    }
  });
}

// ── 복귀 시 자가 회복 ────────────────────────────────────────────────────────
// 재시도를 다 써도 실패한 컬렉션은 빈 채로 남는다. 사용자가 아무 조작도 안 했는데
// 목록이 비어 보이는 상태가 지속되면 안 되므로, 네트워크가 돌아오거나 탭이 다시
// 보일 때 한 번 더 당긴다. 리스너는 컬렉션마다 하나씩 붙되 콜백은 degraded 인
// 것만 실제로 재조회한다.
const recoveryListeners: Array<() => void> = [];
let recoveryBound = false;

function bindRecoveryRetry(onRecover: () => void): void {
  recoveryListeners.push(onRecover);
  if (recoveryBound || typeof window === "undefined") return;
  recoveryBound = true;

  const fire = () => {
    for (const listener of recoveryListeners) listener();
  };
  window.addEventListener("online", fire);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") fire();
  });
}

/**
 * 컬렉션 스토어용 동기화 부트스트랩. 반환된 start() 는 멱등(최초 1회만 실행):
 * 전체 fetch → setAll → onHydrated, 이어서 Realtime 구독 연결.
 * 로그인/로그아웃 시 자동으로 재-fetch 된다(RLS 반영).
 *
 * 스토어 파일에서 client 진입 시 한 번, useXHydrated() 훅에서 한 번 호출해도
 * started 가드로 단일 실행된다.
 *
 * 적재 실패 대응(3중):
 *  ① 타임아웃 — 매달린 요청이 onHydrated 를 영영 막지 못하게(= "로딩 중…" 고착 방지)
 *  ② 백오프 재시도 — 끊긴 요청/일시적 장애를 스스로 넘긴다
 *  ③ 복귀 재시도 — 그래도 실패했으면 online·탭 복귀 시 다시 당긴다
 */
export function makeCollectionSync<TRow, TDomain>(opts: {
  table: string;
  rowToDomain: (row: TRow) => TDomain;
  /** DELETE payload.old 에서 삭제 대상을 식별할 컬럼명 (예: "id", "conversation_id"). */
  pkColumn: string;
  setAll: (items: TDomain[]) => void;
  applyUpsert: (item: TDomain) => void;
  applyDelete: (pk: string) => void;
  onHydrated: () => void;
}): () => void {
  let started = false;
  let subscribed = false;
  /** 진행 중인 hydrate — 중복 호출(auth 이벤트 연발 등)이 재시도를 겹쳐 쌓지 않게. */
  let inflight: Promise<void> | null = null;
  /** 마지막 적재가 실패한 채로 남아 있는가 — 복귀 이벤트로 자가 회복할 대상. */
  let degraded = false;

  /** 한 번의 시도. 매달린 요청이 영원히 안 끝나는 걸 막으려 타임아웃을 건다. */
  async function fetchOnce(): Promise<TRow[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      return await fetchAll<TRow>(opts.table, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 최초 적재(및 재적재). 실패하면 백오프로 재시도한다.
   *
   * 재시도를 다 쓰고도 실패하면 **그래도 onHydrated 를 호출한다.** 화면이 "로딩 중…"에
   * 영원히 갇히는 것보다 "데이터 없음"이 낫고, 아래 복귀 이벤트(online/visible)가
   * 다시 시도해 자가 회복하기 때문이다. 대신 degraded 로 표시해 둔다.
   */
  function hydrate(): Promise<void> {
    if (inflight) return inflight;
    inflight = (async () => {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const rows = await fetchOnce();
          opts.setAll(rows.map(opts.rowToDomain));
          degraded = false;
          opts.onHydrated();
          return;
        } catch (e) {
          if (attempt === MAX_ATTEMPTS) {
            degraded = true;
            console.error(
              `[sync] ${opts.table} 로드 실패 (${MAX_ATTEMPTS}회 시도) — ` +
                "빈 상태로 진행하고 네트워크 복귀 시 재시도한다.",
              e,
            );
            opts.onHydrated();
            return;
          }
          await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1));
        }
      }
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  rehydrators.push(hydrate);
  bindAuthRehydrate();
  // 실패한 채 남은 컬렉션만 복귀 시점에 다시 당긴다(성공한 것까지 재조회하지 않는다).
  bindRecoveryRetry(() => {
    if (degraded) void hydrate();
  });

  return function start() {
    if (started) return;
    started = true;
    void (async () => {
      await hydrate();
      if (!subscribed) {
        subscribed = true;
        subscribe<TRow>(
          opts.table,
          (row) => opts.applyUpsert(opts.rowToDomain(row)),
          (old) => opts.applyDelete(String(old[opts.pkColumn])),
        );
      }
    })();
  };
}
