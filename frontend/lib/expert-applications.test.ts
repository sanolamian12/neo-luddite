import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

// 0049 세무사 가입 신청·승인 · 관리자 모니터링 · auditors 읽기 축소 — 실제 PostgreSQL(PGlite)에서
// 권한과 전이를 검증한다(운영 DB 에 접속하지 않는다).
const db = new PGlite();
const applicant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const expert = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const admin = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const migration = (name: string) => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
const between = (sql: string, from: string, to: string) => sql.slice(sql.indexOf(from), sql.indexOf(to));

const form = {
  name: "김세무",
  registrationNo: "12345",
  officeName: "김세무 세무회계",
  officeRegion: "서울 강남구",
  email: "Kim@Tax.example",
  phone: "010-1234-5678",
  yearsExperience: 7,
  specialties: ["부가세", "종합소득세", "부가세"],
  bio: "개인사업자 신고 전문",
};

before(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create schema rag;
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
    create table public.consultation_requests (id text primary key, conversation_id text, viewer_id text, expert_id text, status text, created_at bigint);
    create table public.consultation_rooms (id text primary key, conversation_id text, viewer_id text);
    create table public.expert_likes (expert_id text, conversation_id text, viewer_id text);
    create table public.mail (id text primary key, recipient_id text, sender_id text, kind text, subject text, body text, ref jsonb, sent_at bigint, read_at bigint);
    create table public.audits (id text primary key, conversation_id text, auditor_id text);
    create table public.reviews (id text primary key, audit_id text);
    create table public.line_feedback (id text primary key, conversation_id text);
    create table public.session_evaluations (id text primary key, conversation_id text);
    create table public.audit_tasks (id text primary key, conversation_ids text[]);
    create table public.pool_candidates (conversation_id text primary key);
    create table rag.passages (id text primary key, conversation_id text);
    create table rag.chat_turns (message_id text primary key, conversation_id text, created_at bigint, outcome text);
    grant usage on schema public, auth to authenticated, anon;
    grant select, insert, update, delete on all tables in schema public to authenticated, anon;
    -- Supabase 와 같게: 이후 만드는 표도 기본 권한을 받는다(정책·revoke 가 실제 방어선).
    alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, anon;
  `);
  await db.exec(migration("0048_account_deletion.sql"));
  await db.exec(migration("0049_expert_applications_admin_monitoring.sql"));

  await db.query("insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, last_sign_in_at) values ($1, 'a@x.com', $2, '{}', now()), ($3, null, '{}', '{}', now() - interval '20 days')",
    [applicant, { full_name: "카카오닉" }, other]);
  await db.query("insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values ($1, 'auditor@demo.local', '{}', $2)", [expert, { app_role: "auditor", domain_id: "auditor" }]);
  await db.query("insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values ($1, 'admin@demo.local', '{}', $2)", [admin, { app_role: "admin", domain_id: "admin" }]);
  await db.query("insert into auth.identities values ($1, 'kakao'), ($2, 'google'), ($3, 'email'), ($4, 'email')", [applicant, other, expert, admin]);
  const now = Date.now();
  await db.exec(`
    insert into public.auditors (id, display_name, email, phone, qualifications, status, created_at, note)
      values ('auditor', '평가자', 'auditor@demo.local', '010-0000-0000', array['세무사'], 'active', 0, '관리자 메모');
    insert into public.expert_profiles (auditor_id, listed) values ('auditor', true);
    insert into public.conversations (id, owner_id, created_at) values ('c-applicant', '${applicant}', ${now});
    insert into rag.chat_turns values ('t1', 'c-applicant', ${now}, 'verdict'), ('t2', 'guest-1', ${now}, 'advisory'), ('t3', 'guest-2', ${now}, 'advisory');
    insert into public.consultation_requests values ('q1', 'c-applicant', '${applicant}', 'auditor', 'pending', ${now});
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
async function asUser<T>(id: string | null, fn: () => Promise<T>): Promise<T> {
  await as(id);
  try { return await fn(); } finally { await reset(); }
}
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

test("customers no longer read expert contact details, only names", async () => {
  await asUser(applicant, async () => {
    const { rows } = await db.query("select * from public.auditors");
    assert.equal(rows.length, 0);
    const names = await db.query<{ id: string; display_name: string }>("select * from public.list_expert_names()");
    assert.deepEqual(names.rows, [{ id: "auditor", display_name: "평가자" }]);
  });
  await asUser(expert, async () => {
    const { rows } = await db.query<{ id: string }>("select id from public.auditors");
    assert.deepEqual(rows.map((r) => r.id), ["auditor"]);
  });
  await asUser(null, async () => {
    await assert.rejects(db.query("select * from public.list_expert_names()"), /permission denied/i);
  });
});

test("only member accounts can apply, with validated fields and one pending application", async () => {
  await asUser(null, () => assert.rejects(db.query("select public.submit_expert_application($1)", [form]), /permission denied/i));
  await asUser(expert, () => assert.rejects(db.query("select public.submit_expert_application($1)", [form]), /only member/i));
  await asUser(applicant, async () => {
    await assert.rejects(db.query("select public.submit_expert_application($1)", [{ ...form, phone: "123" }]), /invalid phone/i);
    await assert.rejects(db.query("select public.submit_expert_application($1)", [{ ...form, registrationNo: "" }]), /registration/i);
    const app = await one<{ a: Record<string, unknown> }>("select public.submit_expert_application($1) a", [form]);
    assert.equal(app.a.status, "pending");
    assert.equal(app.a.email, "kim@tax.example");
    assert.deepEqual(app.a.specialties, ["부가세", "종합소득세"]);
    assert.equal("reviewNote" in app.a, false);
    await assert.rejects(db.query("select public.submit_expert_application($1)", [form]), /already pending/i);
    // 신청자는 표를 직접 읽지 못하고 RPC 로만 본다.
    const { rows } = await db.query("select * from public.expert_applications");
    assert.equal(rows.length, 0);
    await assert.rejects(db.query("update public.expert_applications set status = 'approved'"), /permission denied/i);
  });
});

test("approval requires an administrator, a verified number, and promotes the same account", async () => {
  const { id } = await one<{ id: string }>("select id from public.expert_applications where status = 'pending'");
  await asUser(expert, () => assert.rejects(db.query("select public.review_expert_application($1, 'approved', true)", [id]), /admin only/i));
  await asUser(applicant, () => assert.rejects(db.query("select public.review_expert_application($1, 'approved', true)", [id]), /admin only/i));
  await asUser(admin, async () => {
    await assert.rejects(db.query("select public.review_expert_application($1, 'approved', false)", [id]), /verified/i);
    await db.query("select public.review_expert_application($1, 'approved', true, null, '세무사회 조회 확인')", [id]);
    await assert.rejects(db.query("select public.review_expert_application($1, 'rejected', false, '중복')", [id]), /invalid transition/i);
  });
  const profile = await one<{ role: string; label: string }>("select role, label from public.profiles where domain_id = $1", [applicant]);
  assert.deepEqual(profile, { role: "auditor", label: "김세무" });
  const card = await one<{ listed: boolean; contact_email: string }>("select listed, contact_email from public.expert_profiles where auditor_id = $1", [applicant]);
  assert.deepEqual(card, { listed: false, contact_email: "kim@tax.example" });
  const reg = await one<{ status: string; note: string }>("select status, note from public.auditors where id = $1", [applicant]);
  assert.deepEqual(reg, { status: "active", note: "세무사회 조회 확인" });
  const mail = await one<{ n: number }>("select count(*)::int n from public.mail where recipient_id = $1 and kind = 'expert_application'", [applicant]);
  assert.equal(mail.n, 1);
  // 승인된 세무사는 자기 auditors 행과 카드를 직접 관리한다.
  await asUser(applicant, async () => {
    const { rows } = await db.query<{ id: string }>("select id from public.auditors");
    assert.deepEqual(rows.map((r) => r.id), [applicant]);
  });
});

test("rejection needs a reason, the applicant sees it, and can apply again", async () => {
  await asUser(other, () => db.query("select public.submit_expert_application($1)", [{ ...form, name: "이세무" }]));
  const { id } = await one<{ id: string }>("select id from public.expert_applications where status = 'pending'");
  await asUser(admin, async () => {
    await assert.rejects(db.query("select public.review_expert_application($1, 'rejected')", [id]), /reason/i);
    await db.query("select public.review_expert_application($1, 'rejected', false, '등록번호 조회 불가', '내부 메모')", [id]);
  });
  await asUser(other, async () => {
    const mine = await one<{ a: Record<string, unknown> }>("select public.my_expert_application() a");
    assert.equal(mine.a.status, "rejected");
    assert.equal(mine.a.rejectReason, "등록번호 조회 불가");
    assert.equal(JSON.stringify(mine.a).includes("내부 메모"), false);
    const again = await one<{ a: Record<string, unknown> }>("select public.submit_expert_application($1) a", [{ ...form, name: "이세무" }]);
    await assert.rejects(db.query("select public.withdraw_expert_application($1)", [id]), /invalid transition/i);
    await db.query("select public.withdraw_expert_application($1)", [again.a.id]);
  });
  await asUser(applicant, () => assert.rejects(db.query("select public.withdraw_expert_application($1)", [id]), /not found/i));
});

test("rejected and withdrawn applications are purged after 30 days", async () => {
  await db.exec("update public.expert_applications set decided_at = decided_at - 31::bigint * 86400000 where status = 'rejected'");
  const purged = await one<{ n: number }>("select public.purge_stale_expert_applications() n");
  assert.equal(purged.n, 1);
  const left = await db.query<{ status: string }>("select status from public.expert_applications order by status");
  assert.deepEqual(left.rows.map((r) => r.status), ["approved", "withdrawn"]);
  await asUser(admin, () => assert.rejects(db.query("select public.purge_stale_expert_applications()"), /permission denied/i));
});

test("administrators see every user and usage; others cannot", async () => {
  await asUser(expert, async () => {
    await assert.rejects(db.query("select * from public.admin_list_users()"), /admin only/i);
    await assert.rejects(db.query("select public.admin_usage_overview()"), /admin only/i);
  });
  await asUser(admin, async () => {
    const users = await db.query<{ domain_id: string; providers: string[]; conversation_count: number; application_status: string | null; total: number }>(
      "select * from public.admin_list_users()");
    assert.equal(users.rows.length, 4);
    const app = users.rows.find((u) => u.domain_id === applicant)!;
    assert.deepEqual(app.providers, ["kakao"]);
    assert.equal(app.conversation_count, 1);
    assert.equal(app.application_status, "approved");
    const filtered = await db.query("select * from public.admin_list_users('auditor', '김세')");
    assert.equal(filtered.rows.length, 1);
    const { o } = await one<{ o: Record<string, any> }>("select public.admin_usage_overview(7) o");
    assert.equal(o.users.total, 4);
    assert.deepEqual(o.users.byRole, { user: 1, auditor: 2, admin: 1 });
    assert.equal(o.users.byProvider.kakao, 1);
    assert.equal(o.users.active7d, 1);
    assert.deepEqual([o.turns.member, o.turns.guest], [1, 2]);
    assert.equal(o.daily.length, 7);
    assert.equal(o.consultations.pending, 1);
  });
});

test("removing an expert account retires its card and contact details", async () => {
  await asUser(admin, () => db.query("select public.admin_delete_account($1)", [applicant]));
  const reg = await one<{ status: string; email: string; phone: string | null; display_name: string }>(
    "select status, email, phone, display_name from public.auditors where id = $1", [applicant]);
  assert.deepEqual(reg, { status: "suspended", email: "", phone: null, display_name: "탈퇴한 세무사" });
  const cards = await one<{ n: number }>("select count(*)::int n from public.expert_profiles where auditor_id = $1", [applicant]);
  assert.equal(cards.n, 0);
  const apps = await one<{ n: number }>("select count(*)::int n from public.expert_applications where applicant_domain = $1", [applicant]);
  assert.equal(apps.n, 0);
  // 고객 탈퇴도 신청서를 지운다.
  await asUser(other, () => db.query("select public.delete_my_account()"));
  const rest = await one<{ n: number }>("select count(*)::int n from public.expert_applications");
  assert.equal(rest.n, 0);
});
