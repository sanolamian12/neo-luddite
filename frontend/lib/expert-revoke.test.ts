import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// 0050 세무사 승인 취소(강등) — 실제 PostgreSQL(PGlite)에서 전이·권한·재승인을 검증한다(운영 DB 에 접속하지 않는다).
const db = new PGlite();
const expertUid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const customer = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const admin = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const otherExpert = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const migration = (name: string) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const between = (sql: string, from: string, to: string) => sql.slice(sql.indexOf(from), sql.indexOf(to));
const DAY = 24 * 3600 * 1000;

const form = {
  name: "김세무", registrationNo: "12345", officeName: "김세무 세무회계", officeRegion: "서울 강남구",
  email: "kim@tax.example", phone: "010-1234-5678", yearsExperience: 7, specialties: ["부가세"], bio: "소개",
};

before(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create schema rag;
    create schema kb3;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
    create table auth.users (
      id uuid primary key, email text, raw_user_meta_data jsonb, raw_app_meta_data jsonb,
      created_at timestamptz not null default now(), last_sign_in_at timestamptz
    );
    create table auth.identities (user_id uuid references auth.users(id) on delete cascade, provider text);
  `);
  const schema = migration("0001_public_schema.sql");
  await db.exec(between(schema, "create type public.app_role", "-- ── pool_candidates"));
  const auth = migration("0002_auth_rls.sql");
  await db.exec(between(auth, "create or replace function public.current_role", "-- ── RLS"));
  await db.exec(`
    alter table public.profiles enable row level security;
    alter table public.auditors enable row level security;
  `);
  await db.exec(between(auth, "-- ── profiles ──", "-- ── pool_candidates"));
  await db.exec(migration("0047_social_registration.sql"));
  await db.exec(`
    create table public.expert_profiles (
      auditor_id text primary key references public.auditors(id) on delete cascade,
      listed boolean not null default false, bio text not null default '', specialties text[] not null default '{}',
      years_experience integer not null default 0, contact_phone text, contact_email text, updated_at bigint
    );
    create table public.conversations (id text primary key, owner_id text not null, created_at bigint not null default 0, payload jsonb);
    create table public.consultation_requests (
      id text primary key, conversation_id text, viewer_id text, expert_id text references public.auditors(id), message text,
      status text, status_history jsonb not null default '[]', created_at bigint, updated_at bigint
    );
    create table public.consultation_offers (
      id text primary key, conversation_id text, expert_id text references public.auditors(id), viewer_id text, status text,
      status_history jsonb not null default '[]', created_at bigint, updated_at bigint, expires_at bigint
    );
    create table public.consultation_rooms (
      id text primary key, conversation_id text, viewer_id text, expert_id text references public.auditors(id),
      status text not null default 'open', created_at bigint not null default 0, closed_at bigint
    );
    create table public.consultation_messages (id text primary key, room_id text, sender_id text, body text, deleted_at bigint);
    create table public.expert_likes (expert_id text, conversation_id text, viewer_id text);
    create table public.mail (id text primary key, recipient_id text, sender_id text, kind text, subject text, body text, ref jsonb, sent_at bigint, read_at bigint);
    create table public.audit_tasks (
      id text primary key, conversation_ids text[] not null default '{}', capacity integer not null default 2,
      pickups jsonb not null default '[]', status text not null default 'open'
    );
    create table public.audits (id text primary key, task_id text, conversation_id text, auditor_id text, status text not null default 'draft');
    create table public.reviews (id text primary key, audit_id text);
    create table public.line_feedback (id text primary key, conversation_id text, auditor_id text);
    create table public.session_evaluations (id text primary key, conversation_id text, auditor_id text);
    create table public.inquiries (id text primary key, raised_by text);
    create table public.ledger_entries (id text primary key, auditor_id text, amount integer);
    create table public.pool_candidates (conversation_id text primary key);
    create table rag.passages (id text primary key, conversation_id text);
    create table rag.chat_turns (message_id text primary key, conversation_id text, created_at bigint, outcome text);
    create table kb3.documents (
      id uuid primary key default gen_random_uuid(), corpus text not null, expert_id uuid, publish_state text,
      share_state text, share_note text, share_reviewed_at bigint, share_reviewed_by text,
      status text not null default 'active', updated_at bigint
    );
    create table public.expert_agents (expert_id uuid not null, agent_id text not null, primary key (expert_id, agent_id));
    create function public.conversation_finalized(text) returns boolean language sql stable as $$ select false $$;
    create function public.my_audit_submitted(text) returns boolean language sql stable as $$ select false $$;
    alter table public.consultation_requests enable row level security;
    alter table public.consultation_offers enable row level security;
    alter table public.consultation_rooms enable row level security;
    alter table public.consultation_messages enable row level security;
    alter table public.audits enable row level security;
    alter table public.line_feedback enable row level security;
    alter table public.session_evaluations enable row level security;
    alter table public.inquiries enable row level security;
    alter table public.ledger_entries enable row level security;
    create policy consultation_viewer_read on public.consultation_requests for select using (viewer_id = public.current_domain_id());
    create policy consultation_offers_viewer_read on public.consultation_offers for select using (viewer_id = public.current_domain_id());
    create policy ledger_owner_read on public.ledger_entries for select using (auditor_id = public.current_domain_id());
    grant usage on schema public, auth, kb3 to authenticated, anon;
    grant select, insert, update, delete on all tables in schema public to authenticated, anon;
    alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, anon;
  `);
  // 우편 헬퍼는 실제 마이그레이션 본문을 쓴다.
  const m35 = migration("0035_consultation_transitions.sql");
  await db.exec(between(m35, "create or replace function public._consultation_mail", "-- 사장님 호칭"));
  const m38 = migration("0038_consultation_rooms.sql");
  await db.exec(between(m38, "create or replace function public._room_mail", "-- 새 메시지 →"));
  const m39 = migration("0039_consultation_offers.sql");
  await db.exec(between(m39, "create or replace function public._offer_mail", "-- ── ② 제안 만들기"));
  // 0038 is_room_member(0050 이 다시 정의한다)
  await db.exec(between(m38, "create or replace function public.is_room_member", "-- ── ② 메시지"));
  await db.exec("create policy consultation_messages_member_read on public.consultation_messages for select using (public.is_room_member(room_id))");
  await db.exec(migration("0048_account_deletion.sql"));
  await db.exec(migration("0049_expert_applications_admin_monitoring.sql"));
  await db.exec(migration("0050_expert_revoke.sql"));
  await db.exec(migration("0051_purge_expert_agents_cases.sql"));

  await db.query("insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values ($1, 'kim@x.com', '{}', '{}'), ($2, 'c@x.com', '{}', '{}')",
    [expertUid, customer]);
  await db.query("insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values ($1, 'admin@demo.local', '{}', $2), ($3, 'auditor@demo.local', '{}', $4)",
    [admin, { app_role: "admin", domain_id: "admin" }, otherExpert, { app_role: "auditor", domain_id: "auditor" }]);
  await db.exec(`insert into public.auditors (id, display_name, email, qualifications, status, created_at)
                 values ('auditor', '데모세무사', 'auditor@demo.local', array['세무사'], 'active', 0)`);
});
after(() => db.close());

async function as(id: string | null) {
  if (id === null) await db.exec("set role anon; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', 'anon', false);");
  else await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${id}', false); select set_config('request.jwt.claim.role', 'authenticated', false);`);
}
async function reset() {
  await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', '', false);");
}
async function asUser<T>(id: string | null, fn: () => Promise<T>): Promise<T> {
  await as(id);
  try { return await fn(); } finally { await reset(); }
}
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const count = async (sql: string, params: unknown[] = []) => Number((await one<{ n: number }>(`select count(*)::int n from (${sql}) x`, params)).n);

async function applyAndApprove() {
  const app = await asUser(expertUid, () => one<{ a: { id: string } }>("select public.submit_expert_application($1) a", [form]));
  await asUser(admin, () => db.query("select public.review_expert_application($1, 'approved', true)", [app.a.id]));
}

test("setup: the applicant becomes an expert with live consultations, audits and cases", async () => {
  await applyAndApprove();
  const now = Date.now();
  await db.exec(`
    insert into public.conversations (id, owner_id) values ('c1', '${customer}'), ('c2', '${customer}'), ('c3', '${customer}');
    insert into public.consultation_requests (id, conversation_id, viewer_id, expert_id, status, created_at, updated_at) values
      ('q-pending', 'c1', '${customer}', '${expertUid}', 'pending', 1, 1),
      ('q-accepted', 'c2', '${customer}', '${expertUid}', 'accepted', 2, 2),
      ('q-done', 'c3', '${customer}', '${expertUid}', 'completed', 3, 3),
      ('q-other', 'c1', '${customer}', 'auditor', 'pending', 4, 4);
    insert into public.consultation_offers (id, conversation_id, expert_id, viewer_id, status, created_at, updated_at, expires_at) values
      ('o-live', 'c3', '${expertUid}', '${customer}', 'pending', 1, 1, ${now + 7 * DAY}),
      ('o-stale', 'c1', '${expertUid}', '${customer}', 'pending', 1, 1, ${now - DAY});
    insert into public.consultation_rooms (id, conversation_id, viewer_id, expert_id, status) values
      ('room-open', 'c2', '${customer}', '${expertUid}', 'open');
    insert into public.consultation_messages (id, room_id, sender_id, body) values ('m1', 'room-open', '${customer}', '안녕하세요');
    insert into public.audit_tasks (id, capacity, pickups, status) values
      ('t-draft', 2, '[{"auditorId":"${expertUid}","auditId":"a-draft"},{"auditorId":"auditor","auditId":"a-x"}]', 'full'),
      ('t-mixed', 2, '[{"auditorId":"${expertUid}","auditId":"a-sub"}]', 'in_progress');
    insert into public.audits (id, task_id, conversation_id, auditor_id, status) values
      ('a-draft', 't-draft', 'c1', '${expertUid}', 'draft'),
      ('a-x', 't-draft', 'c1', 'auditor', 'draft'),
      ('a-sub', 't-mixed', 'c2', '${expertUid}', 'submitted'),
      ('a-sub-draft', 't-mixed', 'c3', '${expertUid}', 'draft'),
      ('a-final', 't-mixed', 'c3', '${expertUid}', 'finalized');
    insert into public.line_feedback values ('f1', 'c1', '${expertUid}');
    insert into public.ledger_entries values ('l1', '${expertUid}', 10);
    insert into kb3.documents (corpus, expert_id, publish_state, share_state) values
      ('kb3_expert', '${expertUid}', 'draft', null),
      ('kb3_expert', '${expertUid}', 'published', 'pending'),
      ('kb3_expert', '${expertUid}', 'published', 'approved'),
      ('kb3_trib', null, null, null);
  `);
  await asUser(expertUid, async () => {
    assert.equal(await count("select * from public.consultation_rooms"), 1);
    assert.equal(await count("select * from public.consultation_messages"), 1);
    assert.equal(await count("select * from public.consultation_requests"), 3);
    assert.equal(await count("select * from public.audits"), 4);
    await db.query("insert into public.consultation_messages (id, room_id, sender_id, body) values ('m2', 'room-open', $1, '네')", [expertUid]);
  });
});

test("only an administrator can revoke, with a reason, and only expert accounts", async () => {
  await asUser(expertUid, () => assert.rejects(db.query("select public.revoke_expert($1, '사유')", [expertUid]), /admin only/));
  await asUser(customer, () => assert.rejects(db.query("select public.admin_expert_revoke_preview($1)", [expertUid]), /admin only/));
  await asUser(null, () => assert.rejects(db.query("select public.revoke_expert($1, '사유')", [expertUid]), /permission denied/i));
  await asUser(admin, async () => {
    await assert.rejects(db.query("select public.revoke_expert($1, '  ')", [expertUid]), /reason is required/);
    await assert.rejects(db.query("select public.revoke_expert('nobody', '사유')"), /expert not found/);
    const p = await one<{ p: Record<string, number> }>("select public.admin_expert_revoke_preview($1) p", [expertUid]);
    assert.deepEqual(p.p, {
      requestsPending: 1, requestsAccepted: 1, offersPending: 1, roomsOpen: 1, auditsDraft: 2,
      auditsSubmitted: 1, expertCases: 3, sharedCases: 1, ledgerEntries: 1,
    });
  });
});

test("revoking closes live consultations, cancels drafts, archives cases and demotes the account", async () => {
  const before = await count("select * from public.mail where recipient_id = $1", [customer]);
  const res = await asUser(admin, () => one<{ r: Record<string, number> }>("select public.revoke_expert($1, '등록 취소 확인') r", [expertUid]));
  assert.deepEqual(res.r, {
    requestsDeclined: 1, requestsCompleted: 1, offersWithdrawn: 1, roomsClosed: 1,
    auditsCancelled: 2, pickupsReleased: 1, expertCasesArchived: 3,
  });

  const st = async (table: string, id: string) => (await one<{ status: string }>(`select status from public.${table} where id = $1`, [id])).status;
  assert.equal(await st("consultation_requests", "q-pending"), "declined");
  assert.equal(await st("consultation_requests", "q-accepted"), "completed");
  assert.equal(await st("consultation_requests", "q-done"), "completed");
  assert.equal(await st("consultation_requests", "q-other"), "pending");
  assert.equal(await st("consultation_offers", "o-live"), "withdrawn");
  assert.equal(await st("consultation_offers", "o-stale"), "expired");
  assert.equal(await st("consultation_rooms", "room-open"), "closed");
  assert.equal(await st("audits", "a-draft"), "cancelled");
  assert.equal(await st("audits", "a-sub-draft"), "cancelled");
  assert.equal(await st("audits", "a-sub"), "submitted");
  assert.equal(await st("audits", "a-final"), "finalized");
  assert.equal(await st("audits", "a-x"), "draft");
  const hist = await one<{ h: { status: string; note: string }[] }>("select status_history h from public.consultation_requests where id = 'q-pending'");
  assert.deepEqual(hist.h.at(-1)?.note, "expert_revoked");

  // 모든 일감이 취소된 일감만 슬롯 반납(full → in_progress), 제출 건이 남은 일감은 그대로.
  const tDraft = await one<{ pickups: { auditorId: string }[]; status: string }>("select pickups, status from public.audit_tasks where id = 't-draft'");
  assert.deepEqual(tDraft.pickups.map((p) => p.auditorId), ["auditor"]);
  assert.equal(tDraft.status, "in_progress");
  assert.equal((await one<{ n: number }>("select jsonb_array_length(pickups) n from public.audit_tasks where id = 't-mixed'")).n, 1);

  // 고객에게 신청 2 · 제안 1 · 방 1 = 4통, 중립 문구.
  const mails = (await db.query<{ subject: string; body: string }>("select subject, body from public.mail where recipient_id = $1 order by sent_at", [customer])).rows.slice(before);
  assert.equal(mails.length, 4);
  for (const m of mails) assert.match(m.body, /세무사 사정으로/);
  assert.ok(mails.every((m) => !/자격|취소 확인/.test(m.body)));

  const docs = (await db.query<{ share_state: string | null; status: string; share_note: string | null }>(
    "select share_state, status, share_note from kb3.documents where corpus = 'kb3_expert' order by publish_state, share_state")).rows;
  assert.ok(docs.every((d) => d.status === "archived"));
  assert.deepEqual(docs.map((d) => d.share_state).sort(), ["approved", "rejected", null].sort());
  assert.equal((await one<{ status: string }>("select status from kb3.documents where corpus = 'kb3_trib'")).status, "active");

  const aud = await one<{ status: string; display_name: string; phone: string | null; email: string; note: string }>(
    "select status, display_name, phone, email, note from public.auditors where id = $1", [expertUid]);
  assert.equal(aud.status, "revoked");
  assert.equal(aud.display_name, "김세무");
  assert.equal(aud.phone, null);
  assert.equal(aud.email, "");
  assert.match(aud.note, /\[승인 취소 \d{4}-\d{2}-\d{2}\] 등록 취소 확인/);
  assert.equal(await count("select * from public.expert_profiles where auditor_id = $1", [expertUid]), 0);
  assert.equal((await one<{ role: string }>("select role::text from public.profiles where id = $1", [expertUid])).role, "user");

  // 신청자는 /expert/apply 에서 사유를 본다.
  const mine = await asUser(expertUid, () => one<{ a: Record<string, unknown> }>("select public.my_expert_application() a"));
  assert.equal(mine.a.status, "revoked");
  assert.equal(mine.a.rejectReason, "등록 취소 확인");

  await asUser(admin, () => assert.rejects(db.query("select public.revoke_expert($1, '다시')", [expertUid]), /already revoked/));
  await asUser(admin, () => assert.rejects(db.query("select public.revoke_expert('admin', '사유')"), /expert not found/));
});

test("a demoted account loses the expert side but keeps its own ledger; the customer keeps the room", async () => {
  await asUser(expertUid, async () => {
    assert.equal(await count("select * from public.consultation_rooms"), 0);
    assert.equal(await count("select * from public.consultation_messages"), 0);
    assert.equal(await count("select * from public.consultation_requests"), 0);
    assert.equal(await count("select * from public.consultation_offers"), 0);
    assert.equal(await count("select * from public.audits"), 0);
    assert.equal(await count("select * from public.line_feedback"), 0);
    assert.equal(await count("select * from public.ledger_entries"), 1);
    await assert.rejects(db.query("insert into public.consultation_messages (id, room_id, sender_id, body) values ('m3', 'room-open', $1, 'x')", [expertUid]), /row-level security/);
    await assert.rejects(db.query("insert into public.line_feedback values ('f2', 'c1', $1)", [expertUid]), /row-level security/);
    const upd = await db.query("update public.audits set status = 'draft' where id = 'a-sub' returning id");
    assert.equal(upd.rows.length, 0);
  });
  await asUser(customer, async () => {
    assert.equal(await count("select * from public.consultation_rooms"), 1);
    assert.equal(await count("select * from public.consultation_messages"), 2);
  });
  // Realtime 함정: anon 도 정책 함수를 부를 수 있어야 한다(오류 대신 false).
  await asUser(null, async () => {
    assert.equal((await one<{ m: boolean }>("select public.is_room_member('room-open') m")).m, false);
    assert.equal((await one<{ s: boolean }>("select public.is_staff() s")).s, false);
  });
  // 다른 세무사(정지 아님)는 그대로 세무사 쪽을 본다.
  await asUser(otherExpert, async () => {
    assert.equal(await count("select * from public.consultation_requests"), 1);
    assert.equal(await count("select * from public.audits where auditor_id = 'auditor'"), 1);
  });
});

test("a revoked expert can apply again and approval reactivates the same record", async () => {
  await applyAndApprove();
  const aud = await one<{ status: string; email: string; note: string }>("select status, email, note from public.auditors where id = $1", [expertUid]);
  assert.equal(aud.status, "active");
  assert.equal(aud.email, "kim@tax.example");
  assert.match(aud.note, /승인 취소[\s\S]*\[재승인/);
  assert.equal((await one<{ role: string }>("select role::text from public.profiles where id = $1", [expertUid])).role, "auditor");
  assert.equal(await count("select * from public.expert_profiles where auditor_id = $1 and not listed", [expertUid]), 1);
  await asUser(expertUid, async () => {
    assert.equal(await count("select * from public.ledger_entries"), 1);
    assert.equal(await count("select * from public.audits"), 4);
  });
  // 정지된(취소 아님) 기존 행은 여전히 재승인 대상이 아니다.
  await db.exec("update public.auditors set status = 'suspended' where id = 'auditor'");
  assert.equal((await one<{ status: string }>("select status from public.auditors where id = 'auditor'")).status, "suspended");
  await assert.rejects(db.exec("update public.auditors set status = 'gone' where id = 'auditor'"), /auditors_status_check/);
});

test("revoked applications are purged after 30 days", async () => {
  await db.query("update public.expert_applications set decided_at = $1 where status = 'revoked'", [Date.now() - 31 * DAY]);
  const purged = await one<{ n: number }>("select public.purge_stale_expert_applications() n");
  assert.equal(purged.n, 1);
  assert.equal(await count("select * from public.expert_applications where status = 'revoked'"), 0);
  assert.equal(await count("select * from public.expert_applications where status = 'approved'"), 1);
});

test("deleting an expert account removes its agent settings and expert cases but keeps the ledger", async () => {
  await db.query("insert into public.expert_agents values ($1, 'agent-1')", [expertUid]);
  await db.query("insert into kb3.documents (corpus, expert_id, publish_state, share_state) values ('kb3_expert', $1, 'published', 'approved')", [expertUid]);
  const res = await one<{ r: Record<string, unknown> }>("select public._purge_account($1) r", [expertUid]);
  assert.equal(res.r.expert_retired, true);
  assert.equal(res.r.expert_cases, 4);
  assert.equal(await count("select * from public.expert_agents where expert_id = $1", [expertUid]), 0);
  assert.equal(await count("select * from kb3.documents where corpus = 'kb3_expert'"), 0);
  assert.equal(await count("select * from kb3.documents where corpus = 'kb3_trib'"), 1);
  assert.equal(await count("select * from public.ledger_entries where auditor_id = $1", [expertUid]), 1);
  const aud = await one<{ display_name: string; status: string }>("select display_name, status from public.auditors where id = $1", [expertUid]);
  assert.deepEqual(aud, { display_name: "탈퇴한 세무사", status: "suspended" });
});
