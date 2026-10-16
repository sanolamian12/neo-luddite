import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// 0059 옛 검수 흐름 보관(절단 S6a) — 실제 PostgreSQL(PGlite)에서 이동·권한·탈퇴 파기 범위를 검증한다(운영 DB 에 접속하지 않는다).
const db = new PGlite();
const migration = (name: string) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const MOVED = ["pool_candidates", "audit_tasks", "audits", "line_feedback", "session_evaluations", "reviews",
  "inquiries", "training_batches", "model_versions", "kb_documents"];

before(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create table public.conversations (
      id text primary key, owner_id text not null, payload jsonb,
      snapshot_at bigint, snapshot_payload jsonb, excluded_at bigint
    );
    create index conversations_snapshot_idx on public.conversations (snapshot_at desc) where snapshot_at is not null;
    create table public.pool_candidates (conversation_id text primary key, first_user_message text);
    create table public.audit_tasks (id text primary key, conversation_ids text[] not null default '{}');
    create table public.audits (id text primary key, conversation_id text, auditor_id text);
    create index audits_conversation_idx on public.audits (conversation_id);
    create table public.line_feedback (id text primary key, conversation_id text, body text);
    create table public.session_evaluations (id text primary key, conversation_id text);
    create table public.reviews (id text primary key, audit_id text);
    create table public.inquiries (id text primary key);
    create table public.training_batches (id text primary key);
    create table public.model_versions (id text primary key);
    create table public.kb_documents (id text primary key);
    create table public.settlement_rounds (id text primary key);
    alter table public.audits enable row level security;
    create policy audits_owner on public.audits for all using (auditor_id = current_user);
    grant usage on schema public to anon, authenticated;
    grant select, insert, update, delete on all tables in schema public to anon, authenticated;
  `);
  for (const c of ["c1", "c2"]) {
    await db.exec(`
      insert into public.conversations values ('${c}', 'owner-${c}', '{"q":"라이브"}', 1, '{"q":"5분 사진"}', ${c === "c1" ? 7 : "null"});
      insert into public.pool_candidates values ('${c}', '원문 질문');
      insert into public.audits values ('a-${c}', '${c}', 'auditor');
      insert into public.line_feedback values ('f-${c}', '${c}', '코멘트');
      insert into public.session_evaluations values ('e-${c}', '${c}');
      insert into public.reviews values ('r-${c}', 'a-${c}');
    `);
  }
  await db.exec(`
    insert into public.conversations (id, owner_id, payload) values ('c3', 'owner-c3', '{"q":"사진 없음"}');
    insert into public.audit_tasks values ('t1', array['c1', 'c2']);
    insert into public.settlement_rounds values ('s1');
  `);
  await db.exec(migration("0059_archive_old_review_tables.sql"));
});
after(() => db.close());

const reg = async (name: string) => (await db.query<{ r: string | null }>("select to_regclass($1)::text r", [name])).rows[0].r;
const n = async (sql: string) => Number((await db.query<{ n: number }>(`select count(*)::int n from (${sql}) x`)).rows[0].n);

test("old review tables move to archive with their rows, indexes and policies; settlement_rounds stays", async () => {
  for (const t of MOVED) {
    assert.equal(await reg(`public.${t}`), null, `public.${t} should be gone`);
    assert.equal(await reg(`archive.${t}`), `archive.${t}`);
  }
  assert.equal(await n("select * from archive.audits"), 2);
  assert.equal(await n("select * from archive.line_feedback"), 2);
  assert.equal(await reg("archive.audits_conversation_idx"), "archive.audits_conversation_idx");
  assert.equal(await n("select * from pg_policies where schemaname = 'archive' and tablename = 'audits'"), 1);
  assert.notEqual(await reg("public.settlement_rounds"), null);   // D7 — 정산 테이블은 남긴다
});

test("snapshot columns leave conversations for archive.conversation_snapshots; live payload stays", async () => {
  const cols = (await db.query<{ column_name: string }>(
    "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'conversations' order by 1")).rows
    .map((r) => r.column_name);
  assert.deepEqual(cols, ["id", "owner_id", "payload"]);
  assert.equal(await reg("public.conversations_snapshot_idx"), null);
  const snaps = (await db.query<{ conversation_id: string; snapshot_payload: { q: string }; excluded_at: number | null }>(
    "select conversation_id, snapshot_payload, excluded_at from archive.conversation_snapshots order by 1")).rows;
  assert.deepEqual(snaps.map((s) => s.conversation_id), ["c1", "c2"]);   // 사진 없는 c3 은 옮기지 않는다
  assert.equal(snaps[0].snapshot_payload.q, "5분 사진");
  assert.equal(Number(snaps[0].excluded_at), 7);
  assert.equal((await db.query<{ q: string }>("select payload->>'q' q from public.conversations where id = 'c1'")).rows[0].q, "라이브");
});

test("API roles cannot reach the archive schema", async () => {
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    try {
      await assert.rejects(db.query("select * from archive.audits"), /permission denied/i);
      await assert.rejects(db.query("select * from archive.conversation_snapshots"), /permission denied/i);
      assert.equal((await db.query("select * from public.conversations")).rows.length, 3);
    } finally {
      await db.exec("reset role");
    }
  }
});

test("account deletion purge reaches every archived row of that customer's chats, including the snapshot copy", async () => {
  const { rows: [r] } = await db.query<{ r: { legacy_review_rows: number } }>("select public._purge_legacy_review_rows(array['c1']) r");
  // reviews 1 + line_feedback 1 + session_evaluations 1 + audits 1 + pool_candidates 1 + conversation_snapshots 1
  assert.equal(r.r.legacy_review_rows, 6);
  for (const t of ["line_feedback", "session_evaluations", "audits", "pool_candidates", "conversation_snapshots"]) {
    assert.equal(await n(`select * from archive.${t} where conversation_id = 'c1'`), 0, t);
    assert.equal(await n(`select * from archive.${t} where conversation_id = 'c2'`), 1, t);
  }
  assert.equal(await n("select * from archive.reviews where audit_id = 'a-c1'"), 0);
  assert.deepEqual((await db.query<{ ids: string[] }>("select conversation_ids ids from archive.audit_tasks where id = 't1'")).rows[0].ids, ["c2"]);
});

test("re-running 0059 is a no-op", async () => {
  await db.exec(migration("0059_archive_old_review_tables.sql"));
  assert.equal(await n("select * from archive.conversation_snapshots"), 1);
  assert.equal(await n("select * from archive.audits"), 1);
});
