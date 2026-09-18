-- ════════════════════════════════════════════════════════════════════════════
-- 세무사 연결(전문가 상담 핸드오프) — 상담 프로필 · 하트 · 상담 신청
-- ════════════════════════════════════════════════════════════════════════════
-- 설계: docs/doing/세무사연결_핸드오프_이식설계.md (credigraph 프로토타입 이식)
--
-- ① expert_profiles  — 세무사가 직접 기입하는 "채팅 카드에 뜰 정보" + 연락처 공개 범위.
--    auditors 를 넓히지 않고 별도 테이블로 둔다: auditors 는 인증자 전원이 읽을 수 있어
--    (0002 auditors_read) 연락처 공개 범위를 DB 단에서 강제할 수 없다.
--    사장님은 이 테이블을 직접 못 읽고 list_experts() 로만 본다 → 공개 범위대로 걸러진다.
-- ② expert_likes     — 채팅 카드의 하트. (세무사, 대화 세션, 사용자)당 1행.
--    누르면 행 생성(+1), 다시 누르면 삭제(−1). 개수는 행을 세서 낸다(카운터 컬럼 없음 →
--    저장된 수치와 실제가 어긋날 수 없다). 검수 기록과 무관 — 상담받은 사람이 주는 값.
-- ③ consultation_requests — 상담 신청. 이번 단계는 신청(pending) insert 까지.
--    상태 전이(수락/거절/완료/취소)는 다음 단계(b)에서 붙인다.
-- ════════════════════════════════════════════════════════════════════════════

-- ── ① expert_profiles ──────────────────────────────────────────────────────────
create table public.expert_profiles (
  auditor_id        text primary key references public.auditors (id) on delete cascade,
  listed            boolean not null default false,          -- 채팅 카드에 노출할지
  bio               text not null default '',                -- 한 줄 소개
  specialties       text[] not null default '{}',            -- 전문 분야
  years_experience  integer not null default 0 check (years_experience >= 0),
  availability      text not null default 'available'
                    check (availability in ('available', 'busy', 'offline')),
  avatar_url        text,                                    -- 프리셋 일러스트 경로 (/experts/*.png)
  contact_phone     text,
  phone_visibility  text not null default 'hidden'
                    check (phone_visibility in ('public', 'after_accept', 'hidden')),
  contact_email     text,
  email_visibility  text not null default 'hidden'
                    check (email_visibility in ('public', 'after_accept', 'hidden')),
  contact_kakao     text,                                    -- 카카오톡 오픈채팅 링크
  kakao_visibility  text not null default 'hidden'
                    check (kakao_visibility in ('public', 'after_accept', 'hidden')),
  updated_at        bigint not null default (extract(epoch from now()) * 1000)::bigint
);

alter table public.expert_profiles enable row level security;

-- 세무사 본인만 자기 프로필 읽기·쓰기
create policy expert_profiles_self on public.expert_profiles
  for all using (auditor_id = public.current_domain_id() and public.current_role() = 'auditor')
  with check (auditor_id = public.current_domain_id() and public.current_role() = 'auditor');

create policy expert_profiles_admin_all on public.expert_profiles
  for all using (public.is_admin()) with check (public.is_admin());

-- ── ② expert_likes ─────────────────────────────────────────────────────────────
create table public.expert_likes (
  expert_id        text not null references public.auditors (id) on delete cascade,
  conversation_id  text not null,
  viewer_id        text not null,
  created_at       bigint not null default (extract(epoch from now()) * 1000)::bigint,
  primary key (expert_id, conversation_id, viewer_id)
);
create index expert_likes_expert_idx on public.expert_likes (expert_id);

alter table public.expert_likes enable row level security;

-- 본인이 누른 하트만 직접 조회 가능. 쓰기는 toggle_expert_like() 로만.
create policy expert_likes_self_read on public.expert_likes
  for select using (viewer_id = public.current_domain_id());

create policy expert_likes_admin_all on public.expert_likes
  for all using (public.is_admin()) with check (public.is_admin());

-- ── ③ consultation_requests ────────────────────────────────────────────────────
create table public.consultation_requests (
  id               text primary key,
  conversation_id  text not null,
  viewer_id        text not null,                            -- 신청한 사장님 domain_id
  expert_id        text not null references public.auditors (id),
  message          text,
  status           text not null default 'pending'
                   check (status in ('pending', 'accepted', 'declined', 'completed', 'cancelled')),
  status_history   jsonb not null default '[]'::jsonb,       -- [{status, at, actor?, note?}]
  created_at       bigint not null,
  updated_at       bigint not null
);
create index consultation_requests_viewer_idx on public.consultation_requests (viewer_id);
create index consultation_requests_expert_idx on public.consultation_requests (expert_id);
create index consultation_requests_status_idx on public.consultation_requests (status);

alter table public.consultation_requests enable row level security;

-- 사장님: 본인 신청 조회 + 대기 상태로만 신청
create policy consultation_viewer_read on public.consultation_requests
  for select using (viewer_id = public.current_domain_id());
create policy consultation_viewer_insert on public.consultation_requests
  for insert with check (viewer_id = public.current_domain_id() and status = 'pending');

-- 세무사: 본인 앞으로 온 신청 조회
create policy consultation_expert_read on public.consultation_requests
  for select using (expert_id = public.current_domain_id());

create policy consultation_admin_all on public.consultation_requests
  for all using (public.is_admin()) with check (public.is_admin());

alter publication supabase_realtime add table public.consultation_requests;

-- ── list_experts(): 채팅 카드용 세무사 목록 (연락처 공개 범위 강제 지점) ─────────
-- 연락처 값은 다음 경우에만 채워서 돌려준다:
--   public        → 누구에게나
--   after_accept  → 호출자가 이 세무사와 수락(accepted/completed)된 신청을 가진 경우
--   (세무사 본인·admin 은 항상)
-- 공개 범위(visibility) 자체는 항상 돌려준다 — 카드가 "수락 후 공개"를 표시해야 하므로.
create or replace function public.list_experts(p_conversation_id text default null)
  returns table (
    auditor_id          text,
    display_name        text,
    qualifications      text[],
    bio                 text,
    specialties         text[],
    years_experience    integer,
    availability        text,
    avatar_url          text,
    avatar_color        text,
    contact_phone       text,
    phone_visibility    text,
    contact_email       text,
    email_visibility    text,
    contact_kakao       text,
    kakao_visibility    text,
    like_count          integer,
    liked_by_me         boolean,
    reviewed_count      integer,
    reviewed_this_case  boolean
  )
  language sql stable security definer set search_path = public
as $$
  with me as (
    select public.current_domain_id() as id, public.is_admin() as admin
  ),
  base as (
    select
      a.id, a.display_name, a.qualifications,
      p.bio, p.specialties, p.years_experience, p.availability, p.avatar_url,
      pr.avatar_color,
      p.contact_phone, p.phone_visibility,
      p.contact_email, p.email_visibility,
      p.contact_kakao, p.kakao_visibility,
      (me.admin or me.id = a.id) as privileged,
      exists (
        select 1 from public.consultation_requests c
        where c.expert_id = a.id and c.viewer_id = me.id
          and c.status in ('accepted', 'completed')
      ) as accepted_with_me,
      me.id as me_id
    from public.auditors a
    join public.expert_profiles p on p.auditor_id = a.id
    left join public.profiles pr on pr.domain_id = a.id
    cross join me
    where me.id is not null
      and a.status = 'active'
      and p.listed
  )
  select
    b.id,
    b.display_name,
    b.qualifications,
    b.bio,
    b.specialties,
    b.years_experience,
    b.availability,
    b.avatar_url,
    b.avatar_color,
    case when b.privileged or b.phone_visibility = 'public'
              or (b.phone_visibility = 'after_accept' and b.accepted_with_me)
         then b.contact_phone end,
    b.phone_visibility,
    case when b.privileged or b.email_visibility = 'public'
              or (b.email_visibility = 'after_accept' and b.accepted_with_me)
         then b.contact_email end,
    b.email_visibility,
    case when b.privileged or b.kakao_visibility = 'public'
              or (b.kakao_visibility = 'after_accept' and b.accepted_with_me)
         then b.contact_kakao end,
    b.kakao_visibility,
    (select count(*)::int from public.expert_likes l where l.expert_id = b.id),
    exists (
      select 1 from public.expert_likes l
      where l.expert_id = b.id and l.viewer_id = b.me_id
        and l.conversation_id = p_conversation_id
    ),
    (select count(*)::int from public.audits au
      where au.auditor_id = b.id and au.status in ('submitted', 'reviewed', 'finalized')),
    (p_conversation_id is not null and exists (
      select 1 from public.audits au
      where au.auditor_id = b.id and au.conversation_id = p_conversation_id
    ))
  from base b
$$;

revoke all on function public.list_experts(text) from public;
grant execute on function public.list_experts(text) to authenticated;

-- ── toggle_expert_like(): 하트 누르기/취소 (세션당 1회) ──────────────────────────
-- 반환: 토글 후 상태(liked)와 그 세무사의 전체 하트 수.
create or replace function public.toggle_expert_like(p_expert_id text, p_conversation_id text)
  returns table (liked boolean, like_count integer)
  language plpgsql security definer set search_path = public
as $$
declare
  v_me text := public.current_domain_id();
  v_liked boolean;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  if coalesce(p_conversation_id, '') = '' then
    raise exception 'conversation_id required';
  end if;
  if not exists (
    select 1 from public.expert_profiles p
    join public.auditors a on a.id = p.auditor_id
    where p.auditor_id = p_expert_id and p.listed and a.status = 'active'
  ) then
    raise exception 'expert not available: %', p_expert_id;
  end if;

  delete from public.expert_likes
  where expert_id = p_expert_id and conversation_id = p_conversation_id and viewer_id = v_me;

  if found then
    v_liked := false;
  else
    insert into public.expert_likes (expert_id, conversation_id, viewer_id)
    values (p_expert_id, p_conversation_id, v_me)
    on conflict do nothing;
    v_liked := true;
  end if;

  return query
    select v_liked, (select count(*)::int from public.expert_likes l where l.expert_id = p_expert_id);
end;
$$;

revoke all on function public.toggle_expert_like(text, text) from public;
grant execute on function public.toggle_expert_like(text, text) to authenticated;
