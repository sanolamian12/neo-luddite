-- ════════════════════════════════════════════════════════════════════════════
-- 세무사 가입 신청 → 관리자 승인 · 관리자 사용자/사용 현황 · 세무사 연락처 노출 차단 (2026-10-08)
-- ════════════════════════════════════════════════════════════════════════════
-- 설계: design/관리자_세무사가입승인_모니터링_설계.md
--
-- ① expert_applications — 소셜 가입한 회원(role user)이 낸 세무사 신청서. 자격증 사본은 받지 않고
--    관리자가 등록번호로 직접 조회한 뒤 "확인함"을 표시해야 승인할 수 있다.
--    insert/update 정책이 없다 — 아래 RPC 가 유일한 쓰기 경로(0035 방식). 신청자는 표를 직접
--    못 읽고 my_expert_application() 으로 본다(관리자 확인 메모는 빠진다).
-- ② review_expert_application — 승인은 한 트랜잭션: 신청서 approved → profiles.role='auditor'
--    (0047 guard_profile_identity 는 호출자가 admin 이라 통과) → auditors 행 → expert_profiles 행
--    (listed=false, 세무사가 확인 후 직접 공개) → 세무사 우편함에 환영 메일.
-- ③ 반려·철회된 신청서는 30일 뒤 파기(pg_cron 매일). 회원 탈퇴 시 즉시 삭제(_purge_account).
-- ④ admin_list_users · admin_usage_overview — 관리자 전용 집계. auth.users·rag.chat_turns 는
--    클라이언트 권한이 없어 security definer 로만 읽는다.
-- ⑤ auditors 읽기를 본인 행·관리자로 좁힌다(0002 auditors_read 는 로그인 사용자 전원이었다 →
--    세무사 이메일·전화·관리자 메모가 모든 회원에게 내려갔다). 고객 화면이 쓰는 이름은
--    list_expert_names() 로 준다.
-- ⑥ _purge_account 보강 — 세무사 계정을 지우면 auditors 는 상담·원장 FK 때문에 남기되
--    연락처를 비우고 정지, expert_profiles 는 삭제(카드에서 사라짐). 신청서도 삭제.
-- ════════════════════════════════════════════════════════════════════════════

-- ── ① 신청서 ─────────────────────────────────────────────────────────────────
create table public.expert_applications (
  id               text primary key default ('app-' || replace(gen_random_uuid()::text, '-', '')),
  applicant_domain text not null,                       -- = profiles.domain_id (신청 시점 회원)
  name             text not null,
  registration_no  text not null,                       -- 세무사 등록번호
  office_name      text not null,
  office_region    text not null,                       -- 시·구까지
  email            text not null,
  phone            text not null,
  years_experience integer not null default 0 check (years_experience between 0 and 70),
  specialties      text[] not null default '{}',
  bio              text not null default '',
  status           text not null default 'pending'
                   check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  verified_at      bigint,                              -- 관리자가 등록번호 조회를 확인한 시각
  review_note      text,                                -- 관리자 확인 메모(신청자 비공개)
  reject_reason    text,                                -- 신청자에게 보이는 반려 사유
  status_history   jsonb not null default '[]'::jsonb,  -- [{status, at, actor, note?}]
  created_at       bigint not null,
  updated_at       bigint not null,
  decided_at       bigint
);
create unique index expert_applications_one_pending
  on public.expert_applications (applicant_domain) where status = 'pending';
create index expert_applications_status_idx on public.expert_applications (status, created_at desc);

alter table public.expert_applications enable row level security;
revoke insert, update, delete, truncate on public.expert_applications from anon, authenticated;
create policy expert_applications_admin_read on public.expert_applications
  for select using (public.is_admin());

-- 세무사 우편함 메일(kind 'expert_application').
create or replace function public._application_mail(
  p_recipient text, p_sender text, p_subject text, p_body text, p_application_id text
) returns void
  language sql security definer set search_path = public
as $$
  insert into public.mail (id, recipient_id, sender_id, kind, subject, body, ref, sent_at, read_at)
  values (
    'mail-' || replace(gen_random_uuid()::text, '-', ''),
    p_recipient, p_sender, 'expert_application', p_subject, coalesce(p_body, ''),
    jsonb_build_object('kind', 'expert_application', 'applicationId', p_application_id),
    (extract(epoch from clock_timestamp()) * 1000)::bigint,
    null
  );
$$;
revoke all on function public._application_mail(text, text, text, text, text) from public, anon, authenticated;

-- 신청자에게 보여 줄 모양(관리자 메모 제외).
create or replace function public._application_public(a public.expert_applications)
  returns jsonb
  language sql immutable
as $$
  select jsonb_build_object(
    'id', a.id, 'name', a.name, 'registrationNo', a.registration_no,
    'officeName', a.office_name, 'officeRegion', a.office_region,
    'email', a.email, 'phone', a.phone, 'yearsExperience', a.years_experience,
    'specialties', to_jsonb(a.specialties), 'bio', a.bio, 'status', a.status,
    'rejectReason', a.reject_reason, 'createdAt', a.created_at, 'decidedAt', a.decided_at
  )
$$;

-- ── 신청 ─────────────────────────────────────────────────────────────────────
-- p: {name, registrationNo, officeName, officeRegion, email, phone, yearsExperience, specialties[], bio}
create or replace function public.submit_expert_application(p jsonb)
  returns jsonb
  language plpgsql security definer set search_path = public
as $$
declare
  v_me    text := public.current_domain_id();
  v_now   bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_name  text := btrim(coalesce(p ->> 'name', ''));
  v_reg   text := btrim(coalesce(p ->> 'registrationNo', ''));
  v_off   text := btrim(coalesce(p ->> 'officeName', ''));
  v_reg2  text := btrim(coalesce(p ->> 'officeRegion', ''));
  v_email text := lower(btrim(coalesce(p ->> 'email', '')));
  v_phone text := btrim(coalesce(p ->> 'phone', ''));
  v_bio   text := btrim(coalesce(p ->> 'bio', ''));
  v_years integer;
  v_spec  text[];
  v_row   public.expert_applications;
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if public.current_role() <> 'user' then
    raise exception 'only member accounts can apply' using errcode = '42501';
  end if;
  if exists (select 1 from public.expert_applications where applicant_domain = v_me and status = 'pending') then
    raise exception 'an application is already pending' using errcode = '23505';
  end if;

  if char_length(v_name) not between 2 and 40 then raise exception 'invalid name' using errcode = '22023'; end if;
  if v_reg !~ '^[0-9A-Za-z-]{2,20}$' then raise exception 'invalid registration number' using errcode = '22023'; end if;
  if char_length(v_off) not between 1 and 80 then raise exception 'invalid office name' using errcode = '22023'; end if;
  if char_length(v_reg2) not between 1 and 40 then raise exception 'invalid office region' using errcode = '22023'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 120 then raise exception 'invalid email' using errcode = '22023'; end if;
  if regexp_replace(v_phone, '[^0-9]', '', 'g') !~ '^[0-9]{9,11}$' then raise exception 'invalid phone' using errcode = '22023'; end if;
  if char_length(v_bio) > 500 then raise exception 'bio too long' using errcode = '22023'; end if;
  begin
    v_years := coalesce(nullif(p ->> 'yearsExperience', '')::integer, 0);
  exception when others then
    raise exception 'invalid years of experience' using errcode = '22023';
  end;
  if v_years not between 0 and 70 then raise exception 'invalid years of experience' using errcode = '22023'; end if;
  -- 입력 순서를 지키며 중복 제거, 최대 8개.
  select coalesce(array_agg(s order by o), '{}') into v_spec
    from (select s, min(o) o
            from jsonb_array_elements_text(coalesce(p -> 'specialties', '[]'::jsonb)) with ordinality x(v, o),
                 lateral (select left(btrim(x.v), 20) s) t
           where btrim(x.v) <> ''
           group by s order by min(o) limit 8) d;

  insert into public.expert_applications (
    applicant_domain, name, registration_no, office_name, office_region, email, phone,
    years_experience, specialties, bio, status, status_history, created_at, updated_at
  ) values (
    v_me, v_name, v_reg, v_off, v_reg2, v_email, v_phone, v_years, v_spec, v_bio, 'pending',
    jsonb_build_array(jsonb_build_object('status', 'pending', 'at', v_now, 'actor', v_me)),
    v_now, v_now
  ) returning * into v_row;
  return public._application_public(v_row);
end;
$$;
revoke all on function public.submit_expert_application(jsonb) from public, anon;
grant execute on function public.submit_expert_application(jsonb) to authenticated;

-- ── 내 신청서(가장 최근 1건) ─────────────────────────────────────────────────────
create or replace function public.my_expert_application()
  returns jsonb
  language sql stable security definer set search_path = public
as $$
  select public._application_public(a)
    from public.expert_applications a
   where a.applicant_domain = public.current_domain_id()
   order by a.created_at desc
   limit 1
$$;
revoke all on function public.my_expert_application() from public, anon;
grant execute on function public.my_expert_application() to authenticated;

-- ── 철회 ─────────────────────────────────────────────────────────────────────
create or replace function public.withdraw_expert_application(p_id text)
  returns jsonb
  language plpgsql security definer set search_path = public
as $$
declare
  v_me  text := public.current_domain_id();
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_row public.expert_applications;
begin
  select * into v_row from public.expert_applications where id = p_id for update;
  if not found or v_row.applicant_domain is distinct from v_me then
    raise exception 'application not found' using errcode = 'P0002';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'invalid transition: % -> withdrawn', v_row.status;
  end if;
  update public.expert_applications
     set status = 'withdrawn', updated_at = v_now, decided_at = v_now,
         status_history = status_history || jsonb_build_array(
           jsonb_build_object('status', 'withdrawn', 'at', v_now, 'actor', v_me))
   where id = p_id
  returning * into v_row;
  return public._application_public(v_row);
end;
$$;
revoke all on function public.withdraw_expert_application(text) from public, anon;
grant execute on function public.withdraw_expert_application(text) to authenticated;

-- ── ② 관리자 심사 ───────────────────────────────────────────────────────────────
-- p_decision: 'approved' | 'rejected'. 승인은 p_verified(등록번호 조회 확인) 필수, 반려는 사유 필수.
create or replace function public.review_expert_application(
  p_id text, p_decision text, p_verified boolean default false,
  p_reason text default null, p_note text default null
) returns public.expert_applications
  language plpgsql security definer set search_path = public
as $$
declare
  v_me     text := public.current_domain_id();
  v_now    bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_row    public.expert_applications;
  v_entry  jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  select * into v_row from public.expert_applications where id = p_id for update;
  if not found then
    raise exception 'application not found' using errcode = 'P0002';
  end if;
  if v_row.status <> 'pending' or p_decision not in ('approved', 'rejected') then
    raise exception 'invalid transition: % -> %', v_row.status, p_decision;
  end if;
  if p_decision = 'approved' and not coalesce(p_verified, false) then
    raise exception 'registration number must be verified before approval' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and v_reason is null then
    raise exception 'a rejection reason is required' using errcode = '22023';
  end if;

  if p_decision = 'approved' then
    if not exists (select 1 from public.profiles where domain_id = v_row.applicant_domain and role = 'user') then
      raise exception 'applicant is no longer a member account' using errcode = '22023';
    end if;
    if exists (select 1 from public.auditors where id = v_row.applicant_domain) then
      raise exception 'an expert record already exists for this account' using errcode = '23505';
    end if;
    update public.profiles
       set role = 'auditor', label = v_row.name, display_name = v_row.name
     where domain_id = v_row.applicant_domain;
    insert into public.auditors (id, display_name, email, phone, qualifications, status, created_at, note)
    values (v_row.applicant_domain, v_row.name, v_row.email, v_row.phone, array['세무사'], 'active', v_now, v_note);
    insert into public.expert_profiles (
      auditor_id, listed, bio, specialties, years_experience,
      contact_phone, contact_email, updated_at
    ) values (
      v_row.applicant_domain, false, v_row.bio, v_row.specialties, v_row.years_experience,
      v_row.phone, v_row.email, v_now
    );
  end if;

  v_entry := jsonb_build_object('status', p_decision, 'at', v_now, 'actor', v_me);
  if coalesce(v_reason, v_note) is not null then
    v_entry := v_entry || jsonb_build_object('note', coalesce(v_reason, v_note));
  end if;
  update public.expert_applications
     set status = p_decision,
         verified_at = case when p_decision = 'approved' then v_now else verified_at end,
         review_note = coalesce(v_note, review_note),
         reject_reason = v_reason,
         status_history = status_history || jsonb_build_array(v_entry),
         updated_at = v_now, decided_at = v_now
   where id = p_id
  returning * into v_row;

  if p_decision = 'approved' then
    perform public._application_mail(v_row.applicant_domain, v_me,
      '세무사 가입이 승인되었습니다',
      v_row.name || ' 세무사님, 가입 신청이 승인되었습니다.'
        || E'\n\n[내 프로필] 에서 소개·전문 분야·연락처 공개 범위를 확인하고 "카드에 노출"을 켜면'
        || ' 상담 화면의 세무사 카드에 표시됩니다. 연락처는 처음에 모두 비공개로 설정되어 있습니다.',
      v_row.id);
  end if;
  return v_row;
end;
$$;
revoke all on function public.review_expert_application(text, text, boolean, text, text) from public, anon;
grant execute on function public.review_expert_application(text, text, boolean, text, text) to authenticated;

-- ── ③ 반려·철회 30일 뒤 파기 ─────────────────────────────────────────────────────
create or replace function public.purge_stale_expert_applications()
  returns integer
  language plpgsql security definer set search_path = public
as $$
declare
  k integer;
begin
  delete from public.expert_applications
   where status in ('rejected', 'withdrawn')
     and decided_at < (extract(epoch from now() - interval '30 days') * 1000)::bigint;
  get diagnostics k = row_count;
  return k;
end;
$$;
revoke all on function public.purge_stale_expert_applications() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'purge-stale-expert-applications') then
      perform cron.unschedule('purge-stale-expert-applications');
    end if;
    -- 매일 03:30 KST
    perform cron.schedule('purge-stale-expert-applications', '30 18 * * *',
      $cron$select public.purge_stale_expert_applications()$cron$);
  end if;
end $$;

-- ── ④ 관리자 모니터링 ─────────────────────────────────────────────────────────────
create or replace function public.admin_list_users(
  p_role text default null, p_q text default null,
  p_limit integer default 50, p_offset integer default 0
) returns table (
  domain_id text, role public.app_role, display_name text, email text, providers text[],
  created_at bigint, last_sign_in_at bigint, conversation_count integer,
  last_conversation_at bigint, application_status text, total bigint
)
  language plpgsql stable security definer set search_path = public
as $$
declare
  v_q text := nullif(btrim(coalesce(p_q, '')), '');
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
  with base as (
    select p.domain_id, p.role, coalesce(nullif(p.display_name, ''), p.label) as display_name,
           u.email::text as email,
           coalesce((select array_agg(distinct i.provider order by i.provider)
                       from auth.identities i where i.user_id = u.id), '{}') as providers,
           (extract(epoch from u.created_at) * 1000)::bigint as created_at,
           (extract(epoch from u.last_sign_in_at) * 1000)::bigint as last_sign_in_at
      from public.profiles p
      join auth.users u on u.id = p.id
     where (p_role is null or p.role::text = p_role)
       and (v_q is null or p.domain_id ilike '%' || v_q || '%'
            or coalesce(p.display_name, p.label) ilike '%' || v_q || '%'
            or coalesce(u.email::text, '') ilike '%' || v_q || '%')
  )
  select b.domain_id, b.role, b.display_name, b.email, b.providers, b.created_at, b.last_sign_in_at,
         (select count(*)::int from public.conversations c where c.owner_id = b.domain_id),
         (select max(c.created_at) from public.conversations c where c.owner_id = b.domain_id),
         (select a.status from public.expert_applications a
           where a.applicant_domain = b.domain_id order by a.created_at desc limit 1),
         count(*) over ()
    from base b
   order by b.created_at desc nulls last
   limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
end;
$$;
revoke all on function public.admin_list_users(text, text, integer, integer) from public, anon;
grant execute on function public.admin_list_users(text, text, integer, integer) to authenticated;

-- 날짜는 KST 기준 'YYYY-MM-DD'. 비회원 턴 = 대화 행이 없는 chat_turns(비회원 대화는 서버에 저장되지 않는다).
create or replace function public.admin_usage_overview(p_days integer default 30)
  returns jsonb
  language plpgsql stable security definer set search_path = public
as $$
declare
  v_days  integer := greatest(1, least(coalesce(p_days, 30), 180));
  v_since bigint := (extract(epoch from date_trunc('day', now() at time zone 'Asia/Seoul')
                       - make_interval(days => v_days - 1)) * 1000)::bigint
                    - 9 * 3600 * 1000;
  v_now   bigint := (extract(epoch from now()) * 1000)::bigint;
  v_out   jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  with days as (
    select to_char(d, 'YYYY-MM-DD') as day
      from generate_series(
        (now() at time zone 'Asia/Seoul')::date - (v_days - 1),
        (now() at time zone 'Asia/Seoul')::date, interval '1 day') d
  ),
  u as (
    select p.role, u.created_at, u.last_sign_in_at, u.id
      from public.profiles p join auth.users u on u.id = p.id
  ),
  t as (
    select to_char(to_timestamp(ct.created_at / 1000.0) at time zone 'Asia/Seoul', 'YYYY-MM-DD') as day,
           ct.outcome,
           exists (select 1 from public.conversations c where c.id = ct.conversation_id) as member
      from rag.chat_turns ct
     where ct.created_at >= v_since
  ),
  cv as (
    select to_char(to_timestamp(c.created_at / 1000.0) at time zone 'Asia/Seoul', 'YYYY-MM-DD') as day
      from public.conversations c where c.created_at >= v_since
  ),
  su as (
    select to_char(u.created_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') as day
      from u where (extract(epoch from u.created_at) * 1000)::bigint >= v_since
  )
  select jsonb_build_object(
    'days', v_days,
    'generatedAt', v_now,
    'users', jsonb_build_object(
      'total', (select count(*) from u),
      'byRole', (select coalesce(jsonb_object_agg(role, n), '{}') from (select role, count(*) n from u group by role) x),
      'byProvider', (select coalesce(jsonb_object_agg(provider, n), '{}')
                       from (select i.provider, count(distinct i.user_id) n
                               from auth.identities i join u on u.id = i.user_id group by i.provider) x),
      'active7d', (select count(*) from u where u.last_sign_in_at >= now() - interval '7 days'),
      'active30d', (select count(*) from u where u.last_sign_in_at >= now() - interval '30 days'),
      'newInPeriod', (select count(*) from su)
    ),
    'daily', (select jsonb_agg(jsonb_build_object(
                'day', d.day,
                'signups', (select count(*) from su where su.day = d.day),
                'memberTurns', (select count(*) from t where t.day = d.day and t.member),
                'guestTurns', (select count(*) from t where t.day = d.day and not t.member),
                'conversations', (select count(*) from cv where cv.day = d.day)
              ) order by d.day) from days d),
    'turns', jsonb_build_object(
      'member', (select count(*) from t where t.member),
      'guest', (select count(*) from t where not t.member),
      'byOutcome', (select coalesce(jsonb_object_agg(coalesce(outcome, 'unknown'), n), '{}')
                      from (select outcome, count(*) n from t group by outcome) x)
    ),
    'consultations', (select coalesce(jsonb_object_agg(status, n), '{}')
                        from (select status, count(*) n from public.consultation_requests
                               where created_at >= v_since group by status) x),
    'pendingApplications', (select count(*) from public.expert_applications where status = 'pending')
  ) into v_out;
  return v_out;
end;
$$;
revoke all on function public.admin_usage_overview(integer) from public, anon;
grant execute on function public.admin_usage_overview(integer) to authenticated;

-- ── ⑤ auditors 읽기 축소 + 이름 목록 ─────────────────────────────────────────────
drop policy if exists auditors_read on public.auditors;
create policy auditors_read on public.auditors
  for select using (id = public.current_domain_id() or public.is_admin());

-- 고객 화면(상담·제안·카드)이 세무사 이름을 표시할 때 쓴다. 연락처·메모는 주지 않는다.
create or replace function public.list_expert_names()
  returns table (id text, display_name text)
  language sql stable security definer set search_path = public
as $$
  select a.id, a.display_name from public.auditors a where auth.uid() is not null
$$;
revoke all on function public.list_expert_names() from public, anon;
grant execute on function public.list_expert_names() to authenticated;

-- ── ⑥ 회원 탈퇴 보강 (0048 본문 + 신청서 · 세무사 정리) ───────────────────────────────
create or replace function public._purge_account(p_domain text)
  returns jsonb
  language plpgsql security definer set search_path = public
as $$
declare
  convs text[];
  uid   uuid;
  n     jsonb := '{}'::jsonb;
  k     integer;
begin
  select id into uid from public.profiles where domain_id = p_domain;
  if uid is null then
    raise exception 'account not found' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(id), '{}') into convs from public.conversations where owner_id = p_domain;

  -- KB(공용 지식) 에 들어간 이 고객 대화 유래 passage. edges·edits 는 cascade.
  delete from rag.passages where conversation_id = any(convs);
  get diagnostics k = row_count; n := n || jsonb_build_object('rag_passages', k);
  delete from rag.chat_turns where conversation_id = any(convs);

  -- 검수 기록(고객 대화에 단 코멘트·총평·검수 결과).
  delete from public.reviews where audit_id in (select id from public.audits where conversation_id = any(convs));
  delete from public.line_feedback where conversation_id = any(convs);
  delete from public.session_evaluations where conversation_id = any(convs);
  delete from public.audits where conversation_id = any(convs);
  update public.audit_tasks
     set conversation_ids = array(select x from unnest(conversation_ids) x where x <> all(convs))
   where conversation_ids && convs;
  delete from public.pool_candidates where conversation_id = any(convs);

  -- 세무사 연결.
  delete from public.consultation_requests where viewer_id = p_domain or conversation_id = any(convs);
  delete from public.expert_likes where viewer_id = p_domain;
  delete from public.consultation_rooms where viewer_id = p_domain;   -- messages·agent runs cascade
  delete from public.mail where recipient_id = p_domain or sender_id = p_domain;

  -- 세무사 가입 신청서(0049).
  delete from public.expert_applications where applicant_domain = p_domain;

  -- 세무사 계정이면: 카드(expert_profiles)는 지우고, auditors 행은 상담·원장 FK 때문에 남기되
  -- 연락처·메모를 비우고 정지한다(0049).
  if exists (select 1 from public.auditors where id = p_domain) then
    delete from public.expert_profiles where auditor_id = p_domain;
    update public.auditors
       set status = 'suspended', display_name = '탈퇴한 세무사', email = '', phone = null,
           note = null, qualifications = '{}'
     where id = p_domain;
    n := n || jsonb_build_object('expert_retired', true);
  end if;

  -- 대화 원문(스냅샷 포함). 풀 동의·열람 기록·제안·방은 cascade.
  delete from public.conversations where owner_id = p_domain;
  get diagnostics k = row_count; n := n || jsonb_build_object('conversations', k);

  -- 계정(auth.identities·profiles cascade).
  delete from auth.users where id = uid;
  return n;
end;
$$;
revoke all on function public._purge_account(text) from public, anon, authenticated;
