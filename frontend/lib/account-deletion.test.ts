import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// 0048 회원 탈퇴 — 실제 PostgreSQL(PGlite)에서 파기 범위와 권한을 검증한다.
// 탈퇴 대상 테이블은 운영과 같은 열·cascade 만 최소로 만든다(운영 DB 에 접속하지 않는다).
const db = new PGlite();
const me = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const expert = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const admin = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const migration = (name: string) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");

before(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create schema rag;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb, raw_app_meta_data jsonb);
  `);
  const schema = migration("0001_public_schema.sql");
  await db.exec(schema.slice(schema.indexOf("create type public.app_role"), schema.indexOf("-- ── auditors")));
  const auth = migration("0002_auth_rls.sql");
  await db.exec(auth.slice(auth.indexOf("create or replace function public.current_role"), auth.indexOf("-- ── RLS")));
  await db.exec(migration("0047_social_registration.sql"));
  await db.exec(`
    create table public.conversations (id text primary key, owner_id text not null, payload jsonb);
    create table public.conversation_pool_consents (conversation_id text primary key references public.conversations(id) on delete cascade, viewer_id text not null);
    create table public.pool_case_views (conversation_id text references public.conversations(id) on delete cascade, expert_id text);
    create table public.consultation_offers (id text primary key, conversation_id text references public.conversations(id) on delete cascade, viewer_id text);
    create table public.consultation_rooms (id text primary key, conversation_id text references public.conversations(id) on delete cascade, viewer_id text);
    create table public.consultation_messages (id text primary key, room_id text references public.consultation_rooms(id) on delete cascade, sender_id text, body text);
    create table public.consultation_requests (id text primary key, conversation_id text, viewer_id text, expert_id text, message text);
    create table public.expert_likes (expert_id text, conversation_id text, viewer_id text);
    create table public.mail (id text primary key, recipient_id text, sender_id text, body text);
    create table public.audits (id text primary key, conversation_id text, auditor_id text);
    create table public.reviews (id text primary key, audit_id text);
    create table public.line_feedback (id text primary key, conversation_id text, body text);
    create table public.session_evaluations (id text primary key, conversation_id text);
    create table public.audit_tasks (id text primary key, conversation_ids text[]);
    create table public.pool_candidates (conversation_id text primary key, first_user_message text);
    create table public.ledger_entries (id text primary key, auditor_id text, amount integer);
    create table rag.passages (id text primary key, conversation_id text, content text);
    create table rag.passage_edges (source_id text references rag.passages(id) on delete cascade, target_id text references rag.passages(id) on delete cascade);
    create table rag.chat_turns (message_id text primary key, conversation_id text);
    grant usage on schema public, auth to authenticated, anon;
  `);
  await db.exec(migration("0048_account_deletion.sql"));

  // 고객 둘(나·다른 고객) + 세무사 + 관리자. 나와 다른 고객은 같은 모양의 데이터를 갖는다.
  await db.query("insert into auth.users values ($1, '{}', '{}'), ($2, '{}', '{}')", [me, other]);
  await db.query("insert into auth.users values ($1, '{}', $2)", [expert, { app_role: "auditor", domain_id: "auditor" }]);
  await db.query("insert into auth.users values ($1, '{}', $2)", [admin, { app_role: "admin", domain_id: "admin" }]);
  for (const [domain, c] of [[me, "c-me"], [other, "c-other"]]) {
    await db.exec(`
      insert into public.conversations values ('${c}', '${domain}', '{"q":"원문"}');
      insert into public.conversation_pool_consents values ('${c}', '${domain}');
      insert into public.pool_case_views values ('${c}', 'auditor');
      insert into public.consultation_offers values ('o-${c}', '${c}', '${domain}');
      insert into public.consultation_rooms values ('r-${c}', '${c}', '${domain}');
      insert into public.consultation_messages values ('m-${c}', 'r-${c}', '${domain}', '안녕하세요');
      insert into public.consultation_requests values ('q-${c}', '${c}', '${domain}', 'auditor', '상담 부탁');
      insert into public.expert_likes values ('auditor', '${c}', '${domain}');
      insert into public.mail values ('mail-${c}', 'auditor', '${domain}', '상담 신청');
      insert into public.audits values ('a-${c}', '${c}', 'auditor');
      insert into public.reviews values ('rv-${c}', 'a-${c}');
      insert into public.line_feedback values ('f-${c}', '${c}', '코멘트');
      insert into public.session_evaluations values ('e-${c}', '${c}');
      insert into public.pool_candidates values ('${c}', '원문 질문');
      insert into rag.passages values ('p-${c}', '${c}', '[질문] 원문');
      insert into rag.chat_turns values ('t-${c}', '${c}');
    `);
  }
  await db.exec(`
    insert into rag.passage_edges values ('p-c-me', 'p-c-other');
    insert into public.audit_tasks values ('task', array['c-me', 'c-other']);
    insert into public.ledger_entries values ('l1', 'auditor', 100);
  `);
});
after(() => db.close());

async function as(id: string | null) {
  if (id === null) await db.exec("set role anon; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', 'anon', false);");
  else await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${id}', false); select set_config('request.jwt.claim.role', 'authenticated', false);`);
}
async function reset() {
  await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', '', false);");
}

const linked = `
  select 'conversations' t, count(*) from public.conversations where owner_id = $1
  union all select 'pool_consents', count(*) from public.conversation_pool_consents where viewer_id = $1
  union all select 'offers', count(*) from public.consultation_offers where viewer_id = $1
  union all select 'rooms', count(*) from public.consultation_rooms where viewer_id = $1
  union all select 'messages', count(*) from public.consultation_messages where sender_id = $1
  union all select 'requests', count(*) from public.consultation_requests where viewer_id = $1
  union all select 'likes', count(*) from public.expert_likes where viewer_id = $1
  union all select 'mail', count(*) from public.mail where sender_id = $1
  union all select 'audits', count(*) from public.audits where conversation_id = $2
  union all select 'reviews', count(*) from public.reviews where audit_id = 'a-' || $2
  union all select 'feedback', count(*) from public.line_feedback where conversation_id = $2
  union all select 'evaluations', count(*) from public.session_evaluations where conversation_id = $2
  union all select 'pool_candidates', count(*) from public.pool_candidates where conversation_id = $2
  union all select 'pool_views', count(*) from public.pool_case_views where conversation_id = $2
  union all select 'rag_passages', count(*) from rag.passages where conversation_id = $2
  union all select 'chat_turns', count(*) from rag.chat_turns where conversation_id = $2
  union all select 'profile', count(*) from public.profiles where domain_id = $1
  union all select 'auth_user', count(*) from auth.users where id::text = $1`;
async function counts(domain: string, conv: string) {
  const { rows } = await db.query<{ t: string; count: number }>(linked, [domain, conv]);
  return Object.fromEntries(rows.map((r) => [r.t, Number(r.count)]));
}

test("anonymous visitors and staff cannot use self-service deletion", async () => {
  await as(null);
  try { await assert.rejects(db.query("select public.delete_my_account()"), /permission denied/i); } finally { await reset(); }
  await as(expert);
  try { await assert.rejects(db.query("select public.delete_my_account()"), /administrator/i); } finally { await reset(); }
  await as(me);
  try { await assert.rejects(db.query("select public._purge_account($1)", [other]), /permission denied/i); } finally { await reset(); }
});

test("a customer deletes their account and every record derived from their chats", async () => {
  await as(me);
  try { await db.query("select public.delete_my_account()"); } finally { await reset(); }
  const mine = await counts(me, "c-me");
  for (const [table, n] of Object.entries(mine)) assert.equal(n, 0, `${table} should be purged`);
  const { rows: [task] } = await db.query<{ conversation_ids: string[] }>("select conversation_ids from public.audit_tasks where id='task'");
  assert.deepEqual(task.conversation_ids, ["c-other"]);
});

test("another customer's data and the expert's own ledger stay intact", async () => {
  const theirs = await counts(other, "c-other");
  for (const [table, n] of Object.entries(theirs)) assert.equal(n, 1, `${table} should remain`);
  const { rows } = await db.query("select count(*)::int n from public.ledger_entries");
  assert.equal((rows[0] as { n: number }).n, 1);
});

test("only an administrator can remove another customer, never an admin account", async () => {
  await as(expert);
  try { await assert.rejects(db.query("select public.admin_delete_account($1)", [other]), /admin only/i); } finally { await reset(); }
  await as(admin);
  try {
    await assert.rejects(db.query("select public.admin_delete_account('admin')"), /cannot be removed/i);
    await db.query("select public.admin_delete_account($1)", [other]);
  } finally { await reset(); }
  const theirs = await counts(other, "c-other");
  for (const [table, n] of Object.entries(theirs)) assert.equal(n, 0, `${table} should be purged`);
});
