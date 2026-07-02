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

-- ── 샘플 풀 후보 (데모 데이터 — 실제는 하차장 intake 로 유입) ───────────────────
insert into public.pool_candidates
  (conversation_id, occupation, topic, turn_count, first_user_message, added_at, status)
values
  ('conv-demo-001', 'clinic', '차량유지비 손금산입', 6,
   '병원 차량 유지비를 경비 처리할 수 있나요?', (extract(epoch from now()) * 1000)::bigint, 'new'),
  ('conv-demo-002', 'creator', '유튜브 수입 부가세', 4,
   '유튜브 광고 수익도 부가세 신고 대상인가요?', (extract(epoch from now()) * 1000)::bigint, 'new')
on conflict (conversation_id) do nothing;

-- 추가 시드(정산/원장/모델버전 등)는 완료정의 시연 시 UI 흐름으로 생성 → 여기선 최소만.
