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
export async function fetchAll<TRow>(table: string): Promise<TRow[]> {
  const { data, error } = await getSupabase().from(table).select("*");
  if (error) throw error;
  return (data ?? []) as TRow[];
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

/**
 * 컬렉션 스토어용 동기화 부트스트랩. 반환된 start() 는 멱등(최초 1회만 실행):
 * 전체 fetch → setAll → onHydrated, 이어서 Realtime 구독 연결.
 * 로그인/로그아웃 시 자동으로 재-fetch 된다(RLS 반영).
 *
 * 스토어 파일에서 client 진입 시 한 번, useXHydrated() 훅에서 한 번 호출해도
 * started 가드로 단일 실행된다.
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

  async function hydrate(): Promise<void> {
    try {
      const rows = await fetchAll<TRow>(opts.table);
      opts.setAll(rows.map(opts.rowToDomain));
    } catch (e) {
      console.error(`[sync] ${opts.table} 로드 실패`, e);
    } finally {
      opts.onHydrated();
    }
  }

  rehydrators.push(hydrate);
  bindAuthRehydrate();

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
