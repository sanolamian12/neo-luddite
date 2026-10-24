import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// 0061 방문·유입 기록 — anon 기록 허용 · 검증 · 한도 · 읽기 차단 · 가입 판정을 실제 PostgreSQL(PGlite)에서 확인한다.
const db = new PGlite();
const member = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const veteran = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const migration = (name: string) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const between = (sql: string, from: string, to: string) => sql.slice(sql.indexOf(from), sql.indexOf(to));

const vid = "visitor-0001";
const sid = "session-0001";
const ev = (event: string, extra: Record<string, unknown> = {}) => ({ visitor_id: vid, session_id: sid, event, ...extra });

async function as(role: "anon" | "authenticated", uid: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${uid ?? ""}', false); select set_config('request.jwt.claim.role', '${role}', false);`);
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role;");
  }
}
const track = async (role: "anon" | "authenticated", uid: string | null, events: unknown) =>
  ((await as(role, uid, "select public.analytics_track($1::jsonb) as n", [JSON.stringify(events)])).rows[0] as { n: number }).n;

before(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
    create table auth.users (
      id uuid primary key, email text, raw_user_meta_data jsonb, raw_app_meta_data jsonb,
      created_at timestamptz not null default now(), last_sign_in_at timestamptz
    );
    create table auth.identities (user_id uuid references auth.users(id) on delete cascade, provider text);
    grant usage on schema public, auth to authenticated, anon;
  `);
  const schema = migration("0001_public_schema.sql");
  await db.exec(between(schema, "create type public.app_role", "-- ── pool_candidates"));
  await db.exec(migration("0061_analytics_events.sql"));
  await db.query("insert into auth.users (id, created_at) values ($1, now()), ($2, now() - interval '30 days')", [member, veteran]);
  await db.query("insert into auth.identities (user_id, provider) values ($1, 'kakao'), ($2, 'google')", [member, veteran]);
  await db.query("insert into public.profiles (id, domain_id, role, label) values ($1, 'm1', 'user', '사장님'), ($2, 'v1', 'admin', '운영')", [member, veteran]);
});

after(async () => { await db.close(); });

test("비로그인 방문자도 기록하고, first-touch·경로는 다듬어 저장한다", async () => {
  const n = await track("anon", null, [
    ev("visit", { path: "/?utm_source=apsa", device: "mobile", ft: { source: "apsa", medium: "community", campaign: "post1", ref: "apsa1", referrer_host: "cafe.naver.com" } }),
    ev("chat_started", { conversation_id: "local-123", path: "/chat" }),
  ]);
  assert.equal(n, 2);
  const rows = (await db.query("select event, path, user_id, ft_source, ft_ref, ft_referrer_host, device, conversation_id from analytics.events order by id")).rows as Record<string, unknown>[];
  assert.deepEqual(rows[0], { event: "visit", path: "/", user_id: null, ft_source: "apsa", ft_ref: "apsa1", ft_referrer_host: "cafe.naver.com", device: "mobile", conversation_id: null });
  assert.equal(rows[1].conversation_id, "local-123");
});

test("화이트리스트 밖 이벤트·짧은 id·잘못된 코드·큰 props 는 그 항목만 버린다", async () => {
  await db.exec("delete from analytics.events");
  const n = await track("anon", null, [
    ev("page_view"),
    { visitor_id: "x", session_id: sid, event: "visit" },
    ev("visit", { ft: { ref: "Bad Code!" }, device: "tablet" }),
    ev("handoff_open", { props: { blob: "가".repeat(1000) } }),
    "not-an-object",
  ]);
  assert.equal(n, 2);
  const rows = (await db.query("select event, ft_ref, device, props from analytics.events order by id")).rows as Record<string, unknown>[];
  assert.deepEqual(rows.map((r) => [r.event, r.ft_ref, r.device]), [["visit", null, null], ["handoff_open", null, null]]);
  assert.deepEqual(rows[1].props, {});
});

test("한 번에 20건까지, 방문자당 24시간 500건까지만 받는다", async () => {
  await db.exec("delete from analytics.events");
  assert.equal(await track("anon", null, Array.from({ length: 30 }, () => ev("handoff_open"))), 20);
  await db.query(`insert into analytics.events (visitor_id, session_id, event) select $1, $2, 'visit' from generate_series(1, 480)`, [vid, sid]);
  assert.equal(await track("anon", null, Array.from({ length: 5 }, () => ev("handoff_open"))), 0);
  assert.equal(await track("anon", null, [{ ...ev("visit"), visitor_id: "visitor-0002" }]), 1);
});

test("auth 는 로그인 상태에서만, 가입 여부·경로·역할은 서버가 판정한다", async () => {
  await db.exec("delete from analytics.events");
  assert.equal(await track("anon", null, [ev("auth", { props: { is_new: true } })]), 0);
  await track("authenticated", member, [ev("auth", { props: { is_new: false, role: "admin" } })]);
  await track("authenticated", veteran, [ev("auth", { props: { is_new: true } })]);
  const rows = (await db.query("select user_id, props from analytics.events order by id")).rows as { user_id: string; props: Record<string, unknown> }[];
  assert.equal(rows[0].user_id, member);
  assert.deepEqual(rows[0].props, { is_new: true, provider: "kakao", role: "user" });
  assert.deepEqual(rows[1].props, { is_new: false, provider: "google", role: "admin" });
});

test("anon·authenticated 는 표를 직접 읽거나 쓰지 못한다", async () => {
  for (const role of ["anon", "authenticated"] as const) {
    await assert.rejects(as(role, role === "anon" ? null : member, "select count(*) from analytics.events"), /permission denied/);
    await assert.rejects(as(role, role === "anon" ? null : member, "insert into analytics.events (visitor_id, session_id, event) values ('visitor-9', 'session-9', 'visit')"), /permission denied/);
    await assert.rejects(as(role, role === "anon" ? null : member, "select public.purge_old_analytics_events()"), /permission denied/);
  }
});

test("180일 지난 행만 파기하고, 회원 탈퇴 시 user_id 는 비운다", async () => {
  await db.exec("delete from analytics.events");
  await db.query("insert into analytics.events (visitor_id, session_id, event, ts, user_id) values ('visitor-old', 's-old-0001', 'visit', now() - interval '181 days', null), ('visitor-new', 's-new-0001', 'auth', now(), $1)", [member]);
  const purged = (await db.query("select public.purge_old_analytics_events() as k")).rows[0] as { k: number };
  assert.equal(purged.k, 1);
  await db.query("delete from public.profiles where id = $1", [member]);
  await db.query("delete from auth.users where id = $1", [member]);
  const left = (await db.query("select visitor_id, user_id from analytics.events")).rows;
  assert.deepEqual(left, [{ visitor_id: "visitor-new", user_id: null }]);
});
