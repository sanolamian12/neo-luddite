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
  /** 채널 이름 꼬리표 — 재구독 때 같은 이름이 겹치지 않게 한다(로그인 전/후 채널 교체). */
  epoch = 0,
  /** 채널 상태 콜백 — 호출자가 SUBSCRIBED 까지 기다릴 수 있게. */
  onStatus?: (status: string) => void,
  /**
   * 서버가 "Subscribed to PostgreSQL" 을 보낸 뒤 — 이때부터 변경이 실제로 흘러온다.
   * SUBSCRIBED(join 응답)보다 1~3초 늦다(2026-09-21 실측, 아래 waitForPostgresReady).
   */
  onPostgresReady?: () => void,
): RealtimeChannel {
  return getSupabase()
    .channel(epoch === 0 ? `rt:public:${table}` : `rt:public:${table}#${epoch}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table },
      (payload) => {
        if (payload.eventType === "DELETE") onDelete(payload.old ?? {});
        else onUpsert(payload.new as TRow);
      },
    )
    .on("system", {}, (payload: { extension?: string; status?: string }) => {
      if (payload?.extension === "postgres_changes" && payload.status === "ok") onPostgresReady?.();
    })
    .subscribe((status) => onStatus?.(status));
}

// ── 인증 연동 재하이드레이션 ────────────────────────────────────────────────
// 최초 fetch 는 비로그인(anon) 상태라 RLS 로 빈 결과다. 로그인(SIGNED_IN) 시
// 모든 컬렉션을 사용자 JWT 로 재-fetch 해야 데이터가 채워진다. 로그아웃 시엔
// 다시 anon 으로 재-fetch → 빈 결과로 스토어가 비워진다.
type AuthEvent = "SIGNED_IN" | "SIGNED_OUT" | "TOKEN_REFRESHED";
const rehydrators: Array<(event: AuthEvent, userId: string | null) => Promise<void>> = [];
let authBound = false;

function bindAuthRehydrate(): void {
  if (authBound || typeof window === "undefined") return;
  authBound = true;
  getSupabase().auth.onAuthStateChange((event, session) => {
    if (
      event === "SIGNED_IN" ||
      event === "SIGNED_OUT" ||
      event === "TOKEN_REFRESHED"
    ) {
      const userId = session?.user.id ?? null;
      for (const rehydrate of rehydrators) void rehydrate(event, userId);
    }
  });
}

/** 지금 세션의 사용자(없으면 null). 페이지 로드 직후엔 세션 복원이 끝날 때까지 기다린다. */
async function currentUserId(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.user.id ?? null;
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
 * **Realtime 구독(SUBSCRIBED) → 전체 fetch → setAll → onHydrated → 버퍼 적용**.
 * 로그인/로그아웃 시 채널을 새 토큰으로 갈아끼우고 다시 적재한다(RLS 반영).
 *
 * 스토어 파일에서 client 진입 시 한 번, useXHydrated() 훅에서 한 번 호출해도
 * started 가드로 단일 실행된다.
 *
 * **구독이 fetch 보다 먼저인 이유**(2026-09-21, 사장님 사이드바에서 방금 만든 대화가
 * 빠지던 버그): 먼저 fetch 하고 나중에 구독하면 그 사이에 들어온 INSERT 는 어느 쪽에도
 * 안 잡혀 **영구 유실**된다(다음 재적재까지 화면에 없다). 반대로 먼저 구독하면 겹침이
 * 생길 뿐인데, upsert 는 멱등이라 겹침은 무해하다. 적재 중 도착한 이벤트는 setAll 이
 * 덮어쓰지 못하게 버퍼에 모았다가 적재 직후 순서대로 적용한다.
 *
 * **채널을 갈아끼우는 이유**: postgres_changes 의 RLS 는 채널이 join 할 때의 토큰으로
 * 평가된다. 로그인 전(anon)에 붙은 채널은 로그인 뒤에도 사장님 행을 못 받으므로,
 * 인증 이벤트마다 채널을 버리고 새 토큰으로 다시 붙는다.
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
  /**
   * true 면 SUBSCRIBED 가 아니라 **"Subscribed to PostgreSQL"(변경이 실제로 흐르기 시작한 때)** 까지 기다린 뒤
   * 적재한다. SUBSCRIBED 는 join 응답일 뿐이고, 로그인 직후 채널은 그 뒤 2.5~3초가 지나야 변경을 받는다
   * (2026-09-21 실측). 그 사이에 적재하면 적재 뒤 · 준비 전에 생긴 행이 **영구 유실**된다 — 채팅방 E2E 에서
   * 페이지를 연 지 3초 안에 수락한 방이 세무사 화면에 안 떴다. 대신 첫 적재가 그만큼 늦는다.
   * 준비가 타임아웃(5초)보다 늦으면(채널이 많은 새 페이지에서 7초까지 실측) 타임아웃에 적재를 먼저 하고,
   * **준비가 오는 순간 한 번 더 적재한다** — 그 사이 닫힌 방이 열린 채로 남던 E2E 실패의 원인.
   * (b)에선 채팅방·메시지만 켰고, (c)부터 **모든 컬렉션이 켠다**(설계 §7 결정). 늦어진 첫 적재는
   * 각 화면이 동그라미 스피너(components/ui/spinner)로 보여 준다.
   */
  waitForPostgresReady?: boolean;
}): () => void {
  let started = false;
  /** 현재 채널과 세대 — 재구독 때 이름이 겹치지 않게 epoch 를 올린다. */
  let channel: RealtimeChannel | null = null;
  let epoch = 0;
  /**
   * 마지막으로 본 원본 행 — Realtime 의 **누락 컬럼을 메우는 용도**.
   *
   * Postgres 는 UPDATE 시 값이 바뀌지 않은 TOAST 컬럼을 WAL 에 싣지 않는다
   * (unchanged-toast datum). 그래서 긴 텍스트 컬럼은 payload.new 에서 **키 자체가
   * 사라진다** — 예: 1284자 총평이 달린 행에 decision 만 바꾸면 echo 에 qualitative 가
   * 없다(2026-07-19 실측). 행 전체를 도메인 객체로 바꿔 통째로 갈아끼우는 우리 구조에서
   * 이걸 그대로 매핑하면 그 컬럼이 빈 값으로 덮인다(DB 는 멀쩡한데 화면만 빈다).
   *
   * 그래서 **누락된 키 = "변경 없음"** 으로 읽고 직전 행의 값으로 메운다. NULL 로 바뀐
   * 경우는 payload 에 키가 null 로 실려 오므로 이 병합에 걸리지 않는다.
   */
  const lastRowByPk = new Map<string, TRow>();

  const pkOf = (row: TRow) =>
    String((row as Record<string, unknown>)[opts.pkColumn]);

  /** payload 의 빈 자리를 직전 행으로 메우고, 그 결과를 다음 병합의 기준으로 남긴다. */
  function fillGaps(row: TRow): TRow {
    const pk = pkOf(row);
    const prev = lastRowByPk.get(pk);
    const merged = prev ? { ...prev, ...row } : row;
    lastRowByPk.set(pk, merged);
    return merged;
  }
  // ── 적재 중 도착한 Realtime 이벤트 버퍼 ──────────────────────────────────
  // setAll(스냅샷)이 그 사이 변경을 덮어쓰지 못하게, 적재 중에는 쌓아 두고 적재 직후
  // 도착 순서대로 적용한다. 스냅샷에 이미 반영된 변경이 겹쳐 적용돼도 upsert 는 멱등.
  type Buffered =
    | { kind: "upsert"; row: TRow }
    | { kind: "delete"; pk: string };
  let buffering = false;
  const buffer: Buffered[] = [];

  function applyUpsertRow(row: TRow): void {
    opts.applyUpsert(opts.rowToDomain(fillGaps(row)));
  }

  function applyDeletePk(pk: string): void {
    lastRowByPk.delete(pk);
    opts.applyDelete(pk);
  }

  function handleUpsert(row: TRow): void {
    if (buffering) buffer.push({ kind: "upsert", row });
    else applyUpsertRow(row);
  }

  function handleDelete(old: Record<string, unknown>): void {
    const pk = String(old[opts.pkColumn]);
    if (buffering) buffer.push({ kind: "delete", pk });
    else applyDeletePk(pk);
  }

  function drainBuffer(): void {
    buffering = false;
    while (buffer.length > 0) {
      const ev = buffer.shift() as Buffered;
      if (ev.kind === "upsert") applyUpsertRow(ev.row);
      else applyDeletePk(ev.pk);
    }
  }

  /** 채널이 SUBSCRIBED(또는 실패로 확정)될 때까지 — 그 뒤에 fetch 해야 틈이 없다. */
  const SUBSCRIBE_TIMEOUT_MS = 5_000;

  /** 지금 채널이 어느 사용자로 붙었는가(붙는 중 포함) — 같은 사용자의 SIGNED_IN 에 채널을 또 만들지 않으려고. */
  let joinedAs: Promise<string | null> | null = null;
  /** 그사이 더 새 resubscribe 가 시작됐으면 이전 것의 join 은 버린다. */
  let subscribeSeq = 0;

  /**
   * 채널을 새로 붙인다(기존 채널은 버린다). 반환 promise 는 구독이 확정되면 resolve —
   * Realtime 이 막혀 있어도 타임아웃으로 풀어 줘서 적재 자체를 막지 않는다.
   */
  function resubscribe(): Promise<void> {
    if (typeof window === "undefined") return Promise.resolve();
    const sb = getSupabase();
    if (channel) {
      void sb.removeChannel(channel);
      channel = null;
    }
    buffering = true; // 구독 직후 ~ 적재 완료까지는 버퍼로 받는다
    // 세션 복원이 끝난 뒤에 붙는다 — 그래야 첫 join 부터 사용자 토큰이 실린다(페이지 로드 직후엔 아직 anon).
    const who = currentUserId().catch(() => null);
    joinedAs = who;
    const mySeq = ++subscribeSeq;
    return who.then(() => (mySeq === subscribeSeq ? join() : undefined));
  }

  function join(): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      // 준비가 타임아웃 뒤에 왔다 = 이미 적재한 스냅샷과 준비 사이의 변경을 못 받았을 수 있다 → 다시 적재.
      const ready = () => {
        if (settled) void hydrate();
        else done();
      };
      const timer = setTimeout(done, SUBSCRIBE_TIMEOUT_MS);
      channel = subscribe<TRow>(
        opts.table,
        handleUpsert,
        handleDelete,
        ++epoch,
        (status) => {
          if (
            (status === "SUBSCRIBED" && !opts.waitForPostgresReady) ||
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          ) {
            done();
          }
        },
        opts.waitForPostgresReady ? ready : undefined,
      );
    });
  }

  /** 진행 중인 hydrate — 중복 호출(auth 이벤트 연발 등)이 재시도를 겹쳐 쌓지 않게. */
  let inflight: Promise<void> | null = null;
  /** 적재 중에 또 요청이 들어왔는가 — 끝나고 한 번 더 당겨 최신 토큰/상태를 반영한다. */
  let refetchRequested = false;
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
    if (inflight) {
      refetchRequested = true;
      return inflight;
    }
    buffering = true;
    inflight = (async () => {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const rows = await fetchOnce();
          // 전체 fetch 는 모든 컬럼이 온다 — 병합 기준을 이걸로 새로 깐다.
          lastRowByPk.clear();
          for (const row of rows) lastRowByPk.set(pkOf(row), row);
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
      // 스냅샷을 깐 뒤에야 그 사이 도착분을 얹는다(순서 보존).
      drainBuffer();
      if (refetchRequested) {
        refetchRequested = false;
        void hydrate();
      }
    });
    return inflight;
  }

  // 인증 이벤트: 채널을 새 토큰으로 다시 붙인 뒤 적재한다(둘 다 해야 RLS 가 맞는다).
  //
  // 단, **같은 사용자로 이미 붙었거나 붙는 중이면 SIGNED_IN 을 건너뛴다**(2026-09-21 (c) 실측).
  // 페이지를 열면 supabase-js 가 저장된 세션을 복원하며 SIGNED_IN 을 한 번 더 쏘는데, 예전엔 이때 모든
  // 컬렉션이 채널을 버리고 다시 붙어 채널이 두 배가 됐다. Realtime 서버는 "Subscribed to PostgreSQL" 을
  // 채널당 ~250ms 씩 **순서대로** 보내므로, 채널 27개면 마지막 컬렉션의 준비가 6~7초 → 준비를 기다리는
  // 첫 적재(waitForPostgresReady)가 5초 타임아웃에 걸렸다. 사용자가 바뀌는 로그인·로그아웃과 토큰 갱신은 그대로 다시 붙는다.
  rehydrators.push(async (event, userId) => {
    if (event === "SIGNED_IN" && joinedAs && (await joinedAs) === userId) return;
    await resubscribe();
    await hydrate();
  });
  bindAuthRehydrate();
  // 실패한 채 남은 컬렉션만 복귀 시점에 다시 당긴다(성공한 것까지 재조회하지 않는다).
  bindRecoveryRetry(() => {
    if (degraded) void hydrate();
  });

  return function start() {
    if (started) return;
    started = true;
    void (async () => {
      await resubscribe(); // 먼저 귀를 열고
      await hydrate(); // 그다음 스냅샷을 뜬다 — 사이에 들어온 변경은 버퍼가 받는다
    })();
  };
}
