-- ════════════════════════════════════════════════════════════════════════════
-- Workstream A — 데모 시드
-- ════════════════════════════════════════════════════════════════════════════
-- 구 account-schema.DEMO_CREDENTIALS 3계정을 Supabase Auth 로 재현.
--   owner / demo1234   → role=user,    domain_id=viewer
--   auditor / demo1234 → role=auditor, domain_id=auditor
--   admin / demo1234   → role=admin,   domain_id=admin
-- 이메일은 username@demo.local 로 매핑(Supabase 는 이메일 로그인).
--
-- 주의: auth.users 직접 insert 는 Supabase 로컬(supabase db reset) 기준.
--       on_auth_user_created 트리거가 raw_user_meta_data 로 profiles 를 채운다.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Auth 계정 3종 ──────────────────────────────────────────────────────────────
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000',
   '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated',
   'owner@demo.local', crypt('demo1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}',
   '{"domain_id":"viewer","role":"user","label":"사장님","avatar_color":"var(--brand-blue)","occupation":"clinic"}',
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated',
   'auditor@demo.local', crypt('demo1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}',
   '{"domain_id":"auditor","role":"auditor","label":"평가자","avatar_color":"var(--brand-green)","display_name":"평가자"}',
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated',
   'admin@demo.local', crypt('demo1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}',
   '{"domain_id":"admin","role":"admin","label":"운영자","avatar_color":"var(--brand-amber)","display_name":"운영자"}',
   now(), now())
on conflict (id) do nothing;

-- identities (이메일 로그인에 필요) ────────────────────────────────────────────
insert into auth.identities
  (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   '{"sub":"11111111-1111-1111-1111-111111111111","email":"owner@demo.local"}', 'email', now(), now(), now()),
  (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222',
   '{"sub":"22222222-2222-2222-2222-222222222222","email":"auditor@demo.local"}', 'email', now(), now(), now()),
  (gen_random_uuid(), '33333333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333',
   '{"sub":"33333333-3333-3333-3333-333333333333","email":"admin@demo.local"}', 'email', now(), now(), now())
on conflict do nothing;

-- GoTrue(Auth)는 아래 토큰 컬럼을 non-nullable 로 읽는다. auth.users 직접 insert 는
-- 이들을 NULL 로 남기므로 signInWithPassword 가 500 을 던진다 → '' 로 정규화.
update auth.users set
  confirmation_token     = coalesce(confirmation_token, ''),
  recovery_token         = coalesce(recovery_token, ''),
  email_change_token_new = coalesce(email_change_token_new, ''),
  email_change           = coalesce(email_change, '')
where email like '%@demo.local';

-- ── 평가자 레지스트리 (시드 auditor) ───────────────────────────────────────────
insert into public.auditors (id, display_name, email, qualifications, status, created_at)
values ('auditor', '평가자', 'auditor@demo.local', '{"세무사"}', 'active',
        (extract(epoch from now()) * 1000)::bigint)
on conflict (id) do nothing;

-- ── 2번째 세무사 (공용 보드 다인원 시연용) ─────────────────────────────────────
--   auditor2 / demo1234 → role=auditor, domain_id=auditor2
--   같은 대화를 여러 세무사가 함께 검수하는 "단체 채팅방"을 실제 두 신원으로 보이기 위함.
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000',
   '44444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated',
   'auditor2@demo.local', crypt('demo1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}',
   '{"domain_id":"auditor2","role":"auditor","label":"평가자2","avatar_color":"var(--brand-green)","display_name":"평가자2"}',
   now(), now())
on conflict (id) do nothing;

insert into auth.identities
  (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values
  (gen_random_uuid(), '44444444-4444-4444-4444-444444444444', '44444444-4444-4444-4444-444444444444',
   '{"sub":"44444444-4444-4444-4444-444444444444","email":"auditor2@demo.local"}', 'email', now(), now(), now())
on conflict do nothing;

update auth.users set
  confirmation_token     = coalesce(confirmation_token, ''),
  recovery_token         = coalesce(recovery_token, ''),
  email_change_token_new = coalesce(email_change_token_new, ''),
  email_change           = coalesce(email_change, '')
where email like '%@demo.local';

insert into public.auditors (id, display_name, email, qualifications, status, created_at)
values ('auditor2', '평가자2', 'auditor2@demo.local', '{"세무사"}', 'active',
        (extract(epoch from now()) * 1000)::bigint)
on conflict (id) do nothing;

-- ── 하차장 후보 ──────────────────────────────────────────────────────────────
-- 하차장은 이제 사장님 라이브 대화의 "5분 정지 스냅샷"(public.conversations,
-- 0006)에서만 유입된다. 구 pool_candidates 엑셀 intake 는 폐지 → 시드 없음.
-- (pool_candidates 테이블은 하위호환상 잔존하나 앱은 더 이상 읽지 않는다.)

-- ── 팀 역할극 확장 계정 (2026-07-09, 배포 후) ──────────────────────────────────
--   손님4/세무사3/관리자1 = 8 을 위해 owner2~4 + auditor3 추가. 전부 demo1234.
--   손님은 domain_id 고유(각자 대화 격리), occupation=clinic.
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000',
   '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated',
   'owner2@demo.local', crypt('demo1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}',
   '{"domain_id":"owner2","role":"user","label":"사장님2","avatar_color":"var(--brand-blue)","occupation":"clinic"}',
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '66666666-6666-6666-6666-666666666666', 'authenticated', 'authenticated',
   'owner3@demo.local', crypt('demo1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}',
   '{"domain_id":"owner3","role":"user","label":"사장님3","avatar_color":"var(--brand-blue)","occupation":"clinic"}',
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '77777777-7777-7777-7777-777777777777', 'authenticated', 'authenticated',
   'owner4@demo.local', crypt('demo1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}',
   '{"domain_id":"owner4","role":"user","label":"사장님4","avatar_color":"var(--brand-blue)","occupation":"clinic"}',
   now(), now()),
  ('00000000-0000-0000-0000-000000000000',
   '88888888-8888-8888-8888-888888888888', 'authenticated', 'authenticated',
   'auditor3@demo.local', crypt('demo1234', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}',
   '{"domain_id":"auditor3","role":"auditor","label":"평가자3","avatar_color":"var(--brand-green)","display_name":"평가자3"}',
   now(), now())
on conflict (id) do nothing;

insert into auth.identities
  (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values
  (gen_random_uuid(), '55555555-5555-5555-5555-555555555555', '55555555-5555-5555-5555-555555555555',
   '{"sub":"55555555-5555-5555-5555-555555555555","email":"owner2@demo.local"}', 'email', now(), now(), now()),
  (gen_random_uuid(), '66666666-6666-6666-6666-666666666666', '66666666-6666-6666-6666-666666666666',
   '{"sub":"66666666-6666-6666-6666-666666666666","email":"owner3@demo.local"}', 'email', now(), now(), now()),
  (gen_random_uuid(), '77777777-7777-7777-7777-777777777777', '77777777-7777-7777-7777-777777777777',
   '{"sub":"77777777-7777-7777-7777-777777777777","email":"owner4@demo.local"}', 'email', now(), now(), now()),
  (gen_random_uuid(), '88888888-8888-8888-8888-888888888888', '88888888-8888-8888-8888-888888888888',
   '{"sub":"88888888-8888-8888-8888-888888888888","email":"auditor3@demo.local"}', 'email', now(), now(), now())
on conflict do nothing;

update auth.users set
  confirmation_token     = coalesce(confirmation_token, ''),
  recovery_token         = coalesce(recovery_token, ''),
  email_change_token_new = coalesce(email_change_token_new, ''),
  email_change           = coalesce(email_change, '')
where email like '%@demo.local';

insert into public.auditors (id, display_name, email, qualifications, status, created_at)
values ('auditor3', '평가자3', 'auditor3@demo.local', '{"세무사"}', 'active',
        (extract(epoch from now()) * 1000)::bigint)
on conflict (id) do nothing;

-- 추가 시드(정산/원장/모델버전 등)는 완료정의 시연 시 UI 흐름으로 생성 → 여기선 최소만.
