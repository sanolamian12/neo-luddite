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

// ── Realtime 채널 허브 — 모든 컬렉션이 채널 **하나**를 공유한다 ──────────────
//
// **왜 하나인가** (설계 §7, 2026-09-23 후속4): Realtime 서버는 변경이 실제로 흐르기
// 시작했다는 신호 `"Subscribed to PostgreSQL"` 을 **채널마다 순서대로 ~250ms 씩** 보낸다.
// 컬렉션마다 채널을 따로 쓰면 뒤 컬렉션의 준비가 그 수만큼 밀린다 — 채널 13개일 때
// 마지막 준비가 2.6초, admin 로그인 직후 첫 화면이 4.8초였다. 바인딩(postgres_changes)은
// 한 채널에 여러 개 걸 수 있고 준비 신호는 **채널당 하나**라, 15개를 한 채널로 모으면
// 그 직렬 대기가 통째로 사라진다.
//
// **틈을 만들지 않는 교체**: 채널을 다시 붙일 때 옛 채널을 먼저 버리면 그 사이 변경이
// 전 컬렉션에서 유실된다(§7 "SUBSCRIBED ≠ 수신 시작"과 같은 종류의 구멍). 그래서 새 채널이
// **준비될 때까지 옛 채널을 살려 둔다.** 겹치는 동안 같은 이벤트가 두 번 와도 upsert 는 멱등이다.
//
// **하나가 죽으면 전부가 멎는다**(2026-09-23 사용자 결정): 채널 단위로 지수 백오프 재구독하고,
// 다시 붙으면 **끊긴 동안의 변경을 놓쳤으므로 전 컬렉션을 재적재**한다.

interface HubBinding {
  table: string;
  onUpsert: (row: unknown) => void;
  onDelete: (oldRow: Record<string, unknown>) => void;
  /** 이 컬렉션이 채널 준비(또는 준비 타임아웃)를 통보받는 자리 — 적재를 풀거나 다시 당긴다. */
  onReady: () => void;
  /** 채널이 확정 실패 — 적재가 "로딩 중…"에 갇히지 않게 대기를 풀어 준다. */
  onFailed: () => void;
}

/** 준비 신호가 타임아웃보다 늦으면 먼저 적재하고, 준비가 온 순간 한 번 더 적재한다. */
const HUB_READY_TIMEOUT_MS = 5_000;
/** 같은 틱에 줄줄이 등록되는 스토어들을 한 채널로 모으는 창. */
const HUB_JOIN_DEBOUNCE_MS = 25;
const HUB_RETRY_BASE_MS = 400; // 400 → 800 → 1600 → 3200 (상한)
const HUB_RETRY_MAX_MS = 3_200;

const hubBindings: HubBinding[] = [];
/** 지금 살아 있는 채널과 그 세대 — 늦게 온 콜백이 새 채널을 덮어쓰지 않게. */
let hubChannel: RealtimeChannel | null = null;
/** 새 채널이 준비될 때까지 살려 두는 옛 채널(교체 중 유실 방지). */
let hubRetiring: RealtimeChannel | null = null;
let hubEpoch = 0;
/** 이미 준비 신호를 받아 본 테이블 — 뒤늦게 합류한 컬렉션만 골라 깨우려고. */
const hubReadyTables = new Set<string>();
let hubJoinScheduled = false;
let hubRetryCount = 0;
let hubRetryTimer: ReturnType<typeof setTimeout> | null = null;
/** 지금 채널이 어느 사용자로 붙었는가(붙는 중 포함) — 같은 사용자의 SIGNED_IN 에 또 붙지 않으려고. */
let hubJoinedAs: Promise<string | null> | null = null;
let hubSeq = 0;

/** 컬렉션 하나를 허브에 등록한다. 채널 합류는 같은 틱의 등록을 모아 한 번만 한다. */
function hubRegister(binding: HubBinding): void {
  hubBindings.push(binding);
  scheduleHubJoin();
}

function scheduleHubJoin(): void {
  if (hubJoinScheduled || typeof window === "undefined") return;
  hubJoinScheduled = true;
  setTimeout(() => {
    hubJoinScheduled = false;
    void openHubChannel("new");
  }, HUB_JOIN_DEBOUNCE_MS);
}

/**
 * 채널을 새로 붙인다. `scope`
 *  - `"new"`  아직 준비를 못 본 컬렉션만 깨운다(뒤늦게 합류한 스토어 — 나머지는 옛 채널이 계속 받고 있었다)
 *  - `"all"`  전 컬렉션을 깨운다(토큰이 바뀌었거나 채널이 끊겨 그동안의 변경을 놓쳤을 때)
 */
async function openHubChannel(scope: "all" | "new"): Promise<void> {
  if (typeof window === "undefined" || hubBindings.length === 0) return;
  const mySeq = ++hubSeq;
  // 세션 복원이 끝난 뒤에 붙는다 — 그래야 첫 join 부터 사용자 토큰이 실린다(페이지 로드 직후엔 아직 anon).
  const who = currentUserId().catch(() => null);
  hubJoinedAs = who;
  await who;
  if (mySeq !== hubSeq) return; // 그사이 더 새 합류가 시작됐다

  const sb = getSupabase();
  // 두 세대 전 채널은 이제 확실히 버린다(준비를 못 본 채 다음 교체가 온 경우).
  if (hubRetiring) {
    void sb.removeChannel(hubRetiring);
    hubRetiring = null;
  }
  hubRetiring = hubChannel; // 새 채널이 준비될 때까지 옛 채널을 살려 둔다

  const epoch = ++hubEpoch;
  const bound = hubBindings.slice();
  let channel = sb.channel(`rt:hub#${epoch}`);
  for (const binding of bound) {
    channel = channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: binding.table },
      (payload) => {
        if (payload.eventType === "DELETE") binding.onDelete(payload.old ?? {});
        else binding.onUpsert(payload.new);
      },
    );
  }

  let settled = false;
  let readySeen = false;
  let refired = false;

  /** 깨울 대상을 고른다 — readyTables 를 갱신하기 **전에** 계산해야 한다. */
  const targets = () =>
    scope === "all" ? bound : bound.filter((b) => !hubReadyTables.has(b.table));

  const fire = () => {
    if (epoch !== hubEpoch) return;
    const woken = targets();
    if (readySeen) {
      hubRetryCount = 0;
      if (hubRetiring) {
        void sb.removeChannel(hubRetiring);
        hubRetiring = null;
      }
      for (const b of bound) hubReadyTables.add(b.table);
    }
    for (const b of woken) b.onReady();
  };

  const settle = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    fire();
  };

  const onReadySignal = () => {
    if (readySeen) return; // 바인딩마다 신호가 와도 한 번만 센다
    readySeen = true;
    if (!settled) {
      settle();
      return;
    }
    // 준비가 타임아웃 뒤에 왔다 = 이미 적재한 스냅샷과 준비 사이의 변경을 못 받았을 수 있다 → 다시 적재.
    if (refired) return;
    refired = true;
    fire();
  };

  const timer = setTimeout(settle, HUB_READY_TIMEOUT_MS);

  channel = channel
    .on("system", {}, (payload: { extension?: string; status?: string }) => {
      if (payload?.extension === "postgres_changes" && payload.status === "ok") onReadySignal();
    })
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        onHubFailure(epoch);
      }
    });
  hubChannel = channel;
}

/**
 * 채널이 끊겼다. 대기 중인 적재를 풀어 주고(로딩 고착 방지) 지수 백오프로 다시 붙는다.
 * 다시 붙으면 끊긴 동안의 변경을 놓쳤으므로 **전 컬렉션을 재적재**한다(2026-09-23 결정).
 */
function onHubFailure(epoch: number): void {
  if (epoch !== hubEpoch) return; // 교체로 버려진 옛 채널의 CLOSED 는 무시한다
  for (const b of hubBindings) b.onFailed();
  if (hubRetryTimer) return;
  const delay = Math.min(HUB_RETRY_BASE_MS * 2 ** hubRetryCount, HUB_RETRY_MAX_MS);
  hubRetryCount += 1;
  hubRetryTimer = setTimeout(() => {
    hubRetryTimer = null;
    hubReadyTables.clear();
    void openHubChannel("all");
  }, delay);
}

// ── 인증 연동 재하이드레이션 ────────────────────────────────────────────────
// 최초 fetch 는 비로그인(anon) 상태라 RLS 로 빈 결과다. 로그인(SIGNED_IN) 시
// 모든 컬렉션을 사용자 JWT 로 재-fetch 해야 데이터가 채워진다. 로그아웃 시엔
// 다시 anon 으로 재-fetch → 빈 결과로 스토어가 비워진다.
//
// postgres_changes 의 RLS 는 채널이 join 할 때의 토큰으로 평가되므로 채널도 같이 갈아끼운다.
// **이제 그 일을 허브가 한 번만 한다**(전엔 컬렉션마다 따로 했다). 새 채널이 준비되면
// 허브가 전 컬렉션을 깨우고(`scope: "all"`), 그때 각자 재적재한다.
//
// 단, **같은 사용자로 이미 붙었거나 붙는 중이면 SIGNED_IN 을 건너뛴다**(2026-09-21 (c) 실측).
// 페이지를 열면 supabase-js 가 저장된 세션을 복원하며 SIGNED_IN 을 한 번 더 쏘는데, 예전엔
// 이때 모든 컬렉션이 채널을 버리고 다시 붙어 채널이 두 배가 됐다. 사용자가 바뀌는
// 로그인·로그아웃과 토큰 갱신은 그대로 다시 붙는다.
let authBound = false;

function bindAuthRehydrate(): void {
  if (authBound || typeof window === "undefined") return;
  authBound = true;
  getSupabase().auth.onAuthStateChange((event, session) => {
    if (
      event !== "SIGNED_IN" &&
      event !== "SIGNED_OUT" &&
      event !== "TOKEN_REFRESHED"
    ) {
      return;
    }
    const userId = session?.user.id ?? null;
    void (async () => {
      // **아직 한 번도 안 붙었는데 첫 합류가 예약돼 있다면** 그 합류가 지금 복원된 세션 토큰으로
      // 붙는다 — 또 붙지 않는다. (이 가드가 없으면 세션 복원이 쏘는 SIGNED_IN 이 첫 합류와 겹쳐
      // 채널이 2개가 된다.) `hubJoinedAs === null` 조건이 핵심이다 — 이미 붙어 있는 상태(예: 로그인
      // 화면에서 anon 으로 붙은 채널)에서 들어온 진짜 로그인은 반드시 새 토큰으로 다시 붙어야 한다.
      if (event === "SIGNED_IN" && hubJoinScheduled && hubJoinedAs === null) return;
      if (event === "SIGNED_IN" && hubJoinedAs && (await hubJoinedAs) === userId) return;
      hubReadyTables.clear(); // 토큰이 바뀌면 전 컬렉션이 새 준비 신호를 기다린다
      await openHubChannel("all");
    })();
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
   *
   * 후속4(2026-09-23)부터 그 기다림은 **허브 채널 하나**의 준비 신호를 기다리는 것이다 — 채널이
   * 하나라 신호도 한 번이고, 직렬 대기가 없다. 지금 15개 컬렉션이 모두 true 로 켠다.
   */
  waitForPostgresReady?: boolean;
}): () => void {
  let started = false;
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

  /**
   * 첫 적재가 기다리는 중인 허브 합류 — 허브가 준비(또는 실패·타임아웃)를 알리면 풀린다.
   * 이미 풀린 뒤에 오는 준비 통보는 "재적재"로 읽는다(허브가 늦은 준비를 한 번 더 알려 준다).
   */
  let pendingJoin: (() => void) | null = null;

  function awaitHubJoin(): Promise<void> {
    if (typeof window === "undefined") return Promise.resolve();
    return new Promise<void>((resolve) => {
      pendingJoin = () => {
        pendingJoin = null;
        resolve();
      };
    });
  }

  /**
   * 허브 채널이 준비됐다(또는 준비 타임아웃이 지났다).
   *  - 첫 적재가 기다리는 중이면 그 대기를 푼다 → start() 가 이어서 적재한다.
   *  - 아니면 재적재다: 토큰이 바뀌었거나(로그인·로그아웃), 끊겼다 다시 붙었거나,
   *    준비가 타임아웃보다 늦게 와 그 사이 변경을 못 받았을 수 있는 경우.
   */
  function onHubReady(): void {
    if (pendingJoin) pendingJoin();
    else void hydrate();
  }

  /** 채널이 끊겼다 — 적재가 "로딩 중…"에 갇히지 않게 대기만 풀어 준다(재적재는 다시 붙을 때). */
  function onHubFailed(): void {
    if (pendingJoin) pendingJoin();
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

  // 인증 이벤트로 채널을 갈아끼우는 일은 **허브가 한 번만** 한다(bindAuthRehydrate).
  // 새 채널이 준비되면 허브가 이 컬렉션의 onHubReady 를 불러 주고, 거기서 재적재한다.
  bindAuthRehydrate();
  // 실패한 채 남은 컬렉션만 복귀 시점에 다시 당긴다(성공한 것까지 재조회하지 않는다).
  bindRecoveryRetry(() => {
    if (degraded) void hydrate();
  });

  return function start() {
    if (started) return;
    started = true;
    buffering = true; // 등록 직후 ~ 적재 완료까지는 버퍼로 받는다
    // waitForPostgresReady 를 끄면 준비를 안 기다리고 곧바로 적재한다(지금은 15개 전부 켜 둔다).
    const joined = opts.waitForPostgresReady ? awaitHubJoin() : Promise.resolve();
    hubRegister({
      table: opts.table,
      onUpsert: (row) => handleUpsert(row as TRow),
      onDelete: handleDelete,
      onReady: onHubReady,
      onFailed: onHubFailed,
    });
    void (async () => {
      await joined; // 먼저 귀를 열고 — 허브 채널이 준비될 때까지
      await hydrate(); // 그다음 스냅샷을 뜬다 — 사이에 들어온 변경은 버퍼가 받는다
    })();
  };
}
