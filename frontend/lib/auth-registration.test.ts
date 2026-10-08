import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const uid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const migrationPath = new URL("../../supabase/migrations/0047_social_registration.sql", import.meta.url);
before(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb, raw_app_meta_data jsonb);
  `);
  // Use the real baseline schema, profile trigger and RLS, without unrelated domains.
  const schema = readFileSync(new URL("../../supabase/migrations/0001_public_schema.sql", import.meta.url), "utf8");
  await db.exec(schema.slice(schema.indexOf("create type public.app_role"), schema.indexOf("-- ── auditors")));
  const auth = readFileSync(new URL("../../supabase/migrations/0002_auth_rls.sql", import.meta.url), "utf8");
  await db.exec(auth.slice(auth.indexOf("create or replace function public.current_role"), auth.indexOf("-- ── RLS")));
  await db.exec("alter table public.profiles enable row level security; grant usage on schema public, auth to authenticated, anon; grant all on public.profiles to authenticated; grant select on public.profiles to anon;");
  await db.exec(auth.slice(auth.indexOf("create policy profiles_self_select"), auth.indexOf("-- ── auditors:")));
  if (existsSync(migrationPath)) await db.exec(readFileSync(migrationPath, "utf8"));
});
after(() => db.close());

async function asUser(id: string) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${id}', false); select set_config('request.jwt.claim.role', 'authenticated', false);`);
}
async function resetRole() {
  await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', '', false);");
}

test("public registration ignores role/domain metadata and creates a unique customer", async () => {
  await db.query("insert into auth.users values ($1, $2, '{}')", [uid, { role: "admin", domain_id: "admin", full_name: "새 고객" }]);
  const { rows } = await db.query("select role::text, domain_id, display_name from public.profiles where id=$1", [uid]);
  assert.deepEqual(rows[0], { role: "user", domain_id: uid, display_name: "새 고객" });
});

test("an ordinary profile cannot change its role or domain identity", async () => {
  // Reset the baseline fixture after the previous test, even when testing the old code.
  await resetRole();
  await db.query("update public.profiles set role='user', domain_id=$1 where id=$1::uuid", [uid]);
  await asUser(uid);
  try {
    await assert.rejects(db.query("update public.profiles set role='admin' where id=$1", [uid]), /protected|permission/i);
    await assert.rejects(db.query("update public.profiles set domain_id='victim' where id=$1", [uid]), /protected|permission/i);
    await assert.rejects(db.query("update public.profiles set created_at=0 where id=$1", [uid]), /protected|permission/i);
  } finally { await resetRole(); }
});

test("customers can edit their own display name and occupation, never another profile", async () => {
  await db.query("insert into auth.users values ($1, '{}', '{}')", [second]);
  await asUser(uid);
  try {
    await db.query("update public.profiles set display_name='내 이름', occupation='clinic' where id=$1", [uid]);
    const { rows } = await db.query("select display_name, occupation from public.profiles where id=$1", [uid]);
    assert.deepEqual(rows[0], { display_name: "내 이름", occupation: "clinic" });
    const other = await db.query("update public.profiles set display_name='changed' where id=$1 returning id", [second]);
    assert.equal(other.rows.length, 0);
  } finally { await resetRole(); }
});

test("only trusted provisioning can create staff identities; approved admins retain management", async () => {
  const admin = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  await db.query("insert into auth.users values ($1, '{}', $2)", [admin, { app_role: "admin", domain_id: "staff-admin" }]);
  const { rows } = await db.query("select role::text, domain_id from public.profiles where id=$1", [admin]);
  assert.deepEqual(rows[0], { role: "admin", domain_id: "staff-admin" });
  await asUser(admin);
  try {
    await db.query("update public.profiles set role='auditor' where id=$1", [second]);
    const { rows: approved } = await db.query("select role::text from public.profiles where id=$1", [second]);
    assert.deepEqual(approved[0], { role: "auditor" });
  } finally { await resetRole(); }
});
