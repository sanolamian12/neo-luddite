import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// 0064 사용 현황 M3 — 관리자 읽기 RPC: 권한 · 직원/데모 브라우저 제외(로그인 전 행 포함) · 경로 분류 · 퍼널 · 질문·연결 집계.
const db = new PGlite();
const admin = "00000000-0000-4000-8000-000000000001";
const member = "00000000-0000-4000-8000-000000000002";   // vA 가 가입한 사장님(m1)
const staff = "00000000-0000-4000-8000-000000000003";    // 세무사
const demo = "00000000-0000-4000-8000-000000000004";     // 데모 사장님(viewer)
const migration = (name: string) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const between = (sql: string, from: string, to: string) => sql.slice(sql.indexOf(from), sql.indexOf(to));

async function as(role: "anon" | "authenticated", uid: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false);`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
  }
}
const rpc = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  ((await as("authenticated", admin, `select ${sql} as r`, params)).rows[0] as { r: T }).r;

// 이벤트 한 줄(서버 시각 = now() - ago). ft 는 0061 처럼 방문자의 첫 유입을 매 행에 싣는다.
type Ev = { v: string; event: string; ago?: string; conv?: string; uid?: string; props?: object;
  ft?: { ref?: string; source?: string; campaign?: string; host?: string } };
async function ev(e: Ev) {
  await db.query(
    `insert into analytics.events (visitor_id, session_id, user_id, event, ts, conversation_id, ft_ref, ft_source, ft_campaign, ft_referrer_host, props)
     values ($1, $1 || '-s', $2, $3, now() - $4::interval, $5, $6, $7, $8, $9, $10::jsonb)`,
    [e.v, e.uid ?? null, e.event, e.ago ?? "1 hour", e.conv ?? null, e.ft?.ref ?? null, e.ft?.source ?? null,
      e.ft?.campaign ?? null, e.ft?.host ?? null, JSON.stringify(e.props ?? {})]);
}
async function turn(conv: string, n: number, extra: { outcome?: string; topic?: string; reason?: string; channel?: string; ago?: string } = {}) {
  await db.query(
    `insert into rag.chat_turns (message_id, conversation_id, created_at, outcome, channel, tax_topic, handoff_reason)
     values ($1, $2, (extract(epoch from now() - $3::interval) * 1000)::bigint, $4, $5, $6, $7)`,
    [`asst_${conv}_${n}`, conv, extra.ago ?? "1 hour", extra.outcome ?? "verdict", extra.channel ?? "chat", extra.topic ?? null, extra.reason ?? null]);
}

before(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table auth.users (id uuid primary key, created_at timestamptz not null default now());
    create table auth.identities (user_id uuid references auth.users(id) on delete cascade, provider text);
    grant usage on schema public, auth to authenticated, anon;
    create schema rag;
    create table rag.chat_turns (message_id text primary key, conversation_id text, created_at bigint, outcome text);
  `);
  const schema = migration("0001_public_schema.sql");
  await db.exec(between(schema, "create type public.app_role", "-- ── pool_candidates"));
  const rls = migration("0002_auth_rls.sql");
  await db.exec(between(rls, "create or replace function public.current_role()", "-- ── 신규 가입 시"));
  await db.exec(`
    create table public.consultation_requests (
      id text primary key, conversation_id text not null, viewer_id text not null, expert_id text not null,
      status text not null default 'pending', status_history jsonb not null default '[]', created_at bigint not null, updated_at bigint not null);
  `);
  await db.exec(migration("0061_analytics_events.sql"));
  await db.exec(migration("0063_chat_turns_analytics_questions.sql"));
  await db.exec(migration("0064_admin_usage_dashboard.sql"));
  await db.exec(migration("0065_admin_usage_turns_after_first_seen.sql"));

  await db.query("insert into auth.users (id) values ($1), ($2), ($3), ($4)", [admin, member, staff, demo]);
  await db.query(`insert into public.profiles (id, domain_id, role, label) values
    ($1, 'admin', 'admin', '운영'), ($2, 'm1', 'user', '사장님'), ($3, 'auditor7', 'auditor', '세무사'), ($4, 'viewer', 'user', '데모')`,
  [admin, member, staff, demo]);
  await db.exec(`insert into public.auditors (id, display_name, email, created_at) values ('auditor2', '김가상 세무사(AI)', 'a2@x', 0)`);

  // vA: /r/apsa1(아직 미등록) → 첫 질문 → AI 카드 → 비회원 클릭 → 가입 → 회원 대화로 즉시 연결(대화 id 가 바뀜 → 회원 경유로 귀속)
  const apsa = { ref: "apsa1" };
  await ev({ v: "visitor-a", event: "visit", ft: apsa });
  await ev({ v: "visitor-a", event: "chat_started", conv: "local-a1", ft: apsa });
  await ev({ v: "visitor-a", event: "handoff_shown", conv: "local-a1", ft: apsa, props: { ai: true, member: false } });
  await ev({ v: "visitor-a", event: "handoff_click", conv: "local-a1", ft: apsa, props: { instant: true, member: false } });
  await ev({ v: "visitor-a", event: "auth", uid: member, ft: apsa, props: { is_new: true, role: "user", provider: "kakao" } });
  // vB: 경리나라 utm, 질문 2개
  const kr = { source: "kyungrinara", campaign: "post-1" };
  await ev({ v: "visitor-b", event: "visit", ft: kr });
  await ev({ v: "visitor-b", event: "chat_started", conv: "local-b1", ft: kr });
  // vC: 네이버 카페에서 방문만
  await ev({ v: "visitor-c", event: "visit", ft: { host: "m.cafe.naver.com" } });
  // vD: 직접 방문으로 시작 → 나중에 등록 안 된 코드로 다시 → 그 코드가 경로
  await ev({ v: "visitor-d", event: "visit", ago: "3 hours" });
  await ev({ v: "visitor-d", event: "visit", ft: { ref: "zzz9" } });
  // 직원: 로그인 전 질문까지 빠져야 한다
  await ev({ v: "visitor-s", event: "visit", ft: kr });
  await ev({ v: "visitor-s", event: "chat_started", conv: "local-s1", ft: kr });
  await ev({ v: "visitor-s", event: "auth", uid: staff, ft: kr, props: { role: "auditor" } });
  // 데모 사장님 브라우저
  await ev({ v: "visitor-demo", event: "visit" });
  await ev({ v: "visitor-demo", event: "auth", uid: demo, props: { role: "user", is_new: false } });
  // 직전 기간(10일 전) 방문자 하나
  await ev({ v: "visitor-old", event: "visit", ago: "10 days" });

  await turn("local-a1", 1, { outcome: "advisory", topic: "부가가치세", reason: "advisory" });
  await turn("local-b1", 1, { outcome: "calc_ask", topic: "종합소득세" });
  await turn("local-b1", 2, { outcome: "calc", topic: "종합소득세" });
  await turn("local-b1", 0, { outcome: "verdict", ago: "10 days" });  // 방문 기록 전 옛 턴(다시 연 옛 대화) — 어디에도 세지 않는다
  await turn("local-s1", 1);
  await turn("local-x", 1);                          // 방문 기록 없는 고객 챗(팀 브라우저·러너)
  await turn("eval-r0-1", 1, { channel: "eval" });
  await db.exec(`
    insert into analytics.questions (conversation_id, message_id, text_masked) values
      ('local-a1', 'asst_local-a1_1', '부가세 신고 언제 해요? 010-1111-2222'),
      ('local-b1', 'asst_local-b1_1', '종소세 얼마 나와요?'),
      ('local-s1', 'asst_local-s1_1', '직원 시험 질문');
  `);
  const now = Date.now();
  await db.query(`insert into public.consultation_requests (id, conversation_id, viewer_id, expert_id, status, status_history, created_at, updated_at) values
    ('req-a', 'srv-conv-a', 'm1', 'auditor2', 'accepted', '[{"status":"accepted","note":"즉시 연결"}]', $1, $1),
    ('req-demo', 'srv-conv-demo', 'viewer', 'auditor2', 'pending', '[]', $1, $1)`, [now - 1800_000]);
});

after(async () => { await db.close(); });

const RPCS = [
  "public.admin_traffic_overview(7, null)",
  "public.admin_question_stats(7, null)",
  "public.admin_question_feed(7, null, null, null, 10, 0)",
  "public.admin_handoff_demand(7, null)",
  "public.admin_list_campaigns()",
  "public.admin_save_campaign('x1', 'apsa', null, null)",
];

test("관리자 외(비로그인·사장님·세무사)는 모든 읽기 RPC 와 내부 함수가 거부된다", async () => {
  for (const sql of RPCS) {
    await assert.rejects(as("anon", null, `select ${sql}`), /permission denied/, sql);
    await assert.rejects(as("authenticated", member, `select ${sql}`), /admin only/, sql);
    await assert.rejects(as("authenticated", staff, `select ${sql}`), /admin only/, sql);
  }
  await assert.rejects(as("authenticated", admin, "select * from analytics._visitors()"), /permission denied/);
  await assert.rejects(as("authenticated", admin, "select count(*) from analytics.events"), /permission denied/);
});

test("직전 사이트 호스트는 묶고, 경로는 등록 코드 → utm → 호스트 → 미등록 코드 → direct 순", async () => {
  const groups = (await db.query(`select analytics.host_group(h) g from unnest(array[
    'cafe.naver.com', 'm.search.naver.com', 'www.google.co.kr', 'l.facebook.com', 'band.us', 'www.example.org', null]) h`)).rows.map((r) => (r as { g: string | null }).g);
  assert.deepEqual(groups, ["naver_cafe", "naver_search", "google", "facebook", "band", "example.org", null]);
  const src = async (ref: string | null, s: string | null, h: string | null) =>
    ((await db.query("select analytics.source_of($1, $2, $3) s", [ref, s, h])).rows[0] as { s: string }).s;
  assert.equal(await src(null, "Apsa", "cafe.naver.com"), "apsa");
  assert.equal(await src(null, null, "cafe.naver.com"), "naver_cafe");
  assert.equal(await src("nope", null, null), "unregistered");
  assert.equal(await src(null, null, null), "direct");
});

test("방문·퍼널·경로표 — 직원·데모 브라우저는 로그인 전 행까지 빠지고, 등록한 코드는 지난 방문에도 적용된다", async () => {
  type Overview = { kpi: Record<string, number>; prev: Record<string, number>; funnel: Record<string, number>;
    sources: { source: string; visitors: number; questions: number; campaigns: { campaign: string }[] }[];
    daily: { visitors: number; questions: number }[]; unattributedTurns: number; liveNow: number };
  let o = await rpc<Overview>("public.admin_traffic_overview(7, null)");
  assert.deepEqual(o.kpi, { visitors: 4, sessions: 2, questions: 3, signups: 1, handoffClicks: 1, connections: 1 });
  assert.equal(o.prev.visitors, 1);
  assert.equal(o.prev.questions, 0);
  assert.deepEqual(o.funnel, { visitors: 4, asked: 2, shown: 1, clicked: 1, connected: 1, signedUp: 1 });
  assert.equal(o.unattributedTurns, 1);
  assert.equal(o.daily.length, 7);
  assert.equal(o.daily.reduce((a, d) => a + d.questions, 0), 3);
  assert.deepEqual(o.sources.map((s) => [s.source, s.visitors]).sort(), [["kyungrinara", 1], ["naver_cafe", 1], ["unregistered", 2]]);

  await rpc("public.admin_save_campaign('APSA1', 'apsa', '10월 첫 글', '아사 자유게시판')");
  o = await rpc<Overview>("public.admin_traffic_overview(7, null)");
  const apsa = o.sources.find((s) => s.source === "apsa");
  assert.ok(apsa);
  assert.equal(apsa.visitors, 1);
  assert.equal(apsa.questions, 1);
  assert.deepEqual(apsa.campaigns.map((c) => c.campaign), ["10월 첫 글"]);

  const kr = await rpc<Overview>("public.admin_traffic_overview(7, 'kyungrinara')");
  assert.deepEqual(kr.kpi, { visitors: 1, sessions: 1, questions: 2, signups: 0, handoffClicks: 0, connections: 0 });
  const campaigns = await rpc<{ code: string; visitors: number }[]>("public.admin_list_campaigns()");
  assert.deepEqual(campaigns.map((c) => [c.code, c.visitors]), [["apsa1", 1]]);
});

test("질문 분포·목록은 고객 챗 중 방문 기록과 이어진 것만, 결과 원값으로 거른다", async () => {
  const s = await rpc<{ total: number; sessions: number; byTopic: Record<string, number>; byOutcome: Record<string, number>; perSession: Record<string, number> }>(
    "public.admin_question_stats(7, null)");
  assert.equal(s.total, 3);
  assert.equal(s.sessions, 2);
  assert.deepEqual(s.byTopic, { 부가가치세: 1, 종합소득세: 2 });
  assert.deepEqual(s.byOutcome, { advisory: 1, calc_ask: 1, calc: 1 });
  assert.deepEqual(s.perSession, { "1": 1, "2": 1 });

  type Feed = { total: number; rows: { text: string; outcome: string; clicked: boolean; source: string }[] };
  const all = await rpc<Feed>("public.admin_question_feed(7, null, null, null, 10, 0)");
  assert.equal(all.total, 2);
  const a = all.rows.find((r) => r.outcome === "advisory");
  assert.ok(a);
  assert.equal(a.text, "부가세 신고 언제 해요? [가림]");
  assert.equal(a.clicked, true);
  const asked = await rpc<Feed>("public.admin_question_feed(7, null, null, $1::text[], 10, 0)", [["calc_ask", "calc_missing"]]);
  assert.deepEqual(asked.rows.map((r) => r.text), ["종소세 얼마 나와요?"]);
  const topic = await rpc<Feed>("public.admin_question_feed(7, null, '부가가치세', null, 10, 0)");
  assert.equal(topic.total, 1);
});

test("세무사 연결 수요 — 화면 이벤트 퍼널 · 서버 사유별 · 최근 요청(데모 요청 제외, 즉시·가상 세무사 표시)", async () => {
  const h = await rpc<{ funnel: Record<string, number>; byReason: { reason: string; conversations: number; clicked: number }[];
    recent: { id: string; instant: boolean; virtualExpert: boolean; taxTopic: string | null; source: string }[] }>("public.admin_handoff_demand(7, null)");
  assert.deepEqual(h.funnel, { shown: 1, shownAi: 1, opened: 0, clicked: 1, clickedMember: 0, clickedGuest: 1, clickedInstant: 1, requests: 1, requestsInstant: 1 });
  assert.deepEqual(h.byReason, [{ reason: "advisory", conversations: 1, clicked: 1 }]);
  assert.equal(h.recent.length, 1);
  assert.equal(h.recent[0].id, "req-a");
  assert.equal(h.recent[0].instant, true);
  assert.equal(h.recent[0].virtualExpert, true);
  assert.equal(h.recent[0].source, "apsa");
});

test("게시 코드는 형식을 검사하고 같은 코드면 고친다", async () => {
  await assert.rejects(rpc("public.admin_save_campaign('bad code', 'apsa', null, null)"), /invalid code/);
  await assert.rejects(rpc("public.admin_save_campaign('ok1', '경리나라', null, null)"), /invalid source/);
  await rpc("public.admin_save_campaign('apsa1', 'apsa', '10월 첫 글(고침)', null)");
  const rows = (await db.query("select campaign, label from analytics.campaigns where code = 'apsa1'")).rows;
  assert.deepEqual(rows, [{ campaign: "10월 첫 글(고침)", label: null }]);
});
