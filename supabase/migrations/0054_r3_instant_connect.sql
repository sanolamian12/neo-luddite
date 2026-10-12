-- 0054 — R3 세무사 즉시 연결 (10/12, 데모 로드맵 R3 · 결정: "선택 시 간편 로그인" · "즉시 연결은 데모용 가상 세무사만")
--
-- 흐름: 비로그인 고객도 답변의 세무사 카드에서 목록을 본다 → 즉시 연결 세무사를 고르면 간편 로그인 → 같은 대화로 돌아와
--       connect_instant() 가 수락된 신청 + 3자 방을 한 번에 만든다 → 방에서 전환 장면 → 세무사 AI 첫 인사(백엔드).
-- 실제 세무사는 지금처럼 신청(pending) → 세무사 수락 흐름 그대로다(instant_connect 기본 false).
--
-- ① expert_profiles.instant_connect   ② 가상 세무사 3명(이름·소개·사진, D-3)   ③ list_experts: 비로그인 열람 + instant_connect
-- ④ connect_instant()                  ⑤ 신청 알림 메일은 대기(pending) 신청에만

-- ── ① 즉시 연결 표시 ────────────────────────────────────────────────────────────
alter table public.expert_profiles add column if not exists instant_connect boolean not null default false;

-- ── ② 데모용 가상 세무사 3명 (R3-a · D-3 "이름 변경 허용") ─────────────────────
-- 검수 보드의 기존 평가자 표기도 함께 바뀌는 것을 수용. "가상 인물" 표기를 소개·자격에 남긴다(실존 세무사 오인 방지).
-- 사진 = 프론트 정적 파일(frontend/public/demo/experts/*.png, 팀장 09519ef) — 버킷 업로드 없음.
-- 되돌리기: display_name '평가자'·'평가자2'·'평가자3', avatar_url '/experts/preset-1.webp'…, instant_connect false.
update public.auditors set display_name = '윤서진 세무사', qualifications = array['세무사 · 가상 프로필'] where id = 'auditor';
update public.auditors set display_name = '김도현 세무사', qualifications = array['세무사 · 가상 프로필'] where id = 'auditor2';
update public.auditors set display_name = '이수민 세무사', qualifications = array['세무사 · 가상 프로필'] where id = 'auditor3';

update public.expert_profiles set
  listed = true, availability = 'available', years_experience = 8, instant_connect = true,
  bio = '병의원 상담 · 사용 내역과 증빙을 먼저 확인합니다. 가상 인물입니다.',
  specialties = array['병의원', '장비·증빙', '접대비·차량'],
  avatar_url = '/demo/experts/yun-seojin.png',
  updated_at = (extract(epoch from now()) * 1000)::bigint
where auditor_id = 'auditor';

update public.expert_profiles set
  listed = true, availability = 'available', years_experience = 9, instant_connect = true,
  bio = '근로소득·연말정산과 개원 절세 설계를 차근차근 살펴봅니다. 가상 인물입니다.',
  specialties = array['근로소득·연말정산', '개원', '세무조사'],
  avatar_url = '/demo/experts/kim-dohyeon.png',
  updated_at = (extract(epoch from now()) * 1000)::bigint
where auditor_id = 'auditor2';

update public.expert_profiles set
  listed = true, availability = 'available', years_experience = 10, instant_connect = true,
  bio = '사업자의 상황과 자료를 차근차근 살펴봅니다. 부가세·장부 정리를 주로 봅니다. 가상 인물입니다.',
  specialties = array['소상공인', '부가세', '간편장부'],
  avatar_url = '/demo/experts/lee-sumin.png',
  updated_at = (extract(epoch from now()) * 1000)::bigint
where auditor_id = 'auditor3';

-- ── ③ list_experts — 비로그인 열람 + instant_connect 반환 ──────────────────────
-- 예전엔 `where me.id is not null` + authenticated 전용이라 비로그인 입구챗의 세무사 카드가 "목록을 불러오지 못했습니다"였다
-- (e2e 는 RPC 를 모킹해서 드러나지 않았다). 비로그인이면 연락처는 public 공개분만, 하트·수락 여부는 false 로 나온다.
-- 반환 열이 바뀌므로 drop 후 다시 만든다.
drop function if exists public.list_experts(text);
create function public.list_experts(p_conversation_id text default null)
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
    reviewed_this_case  boolean,
    instant_connect     boolean
  )
  language sql stable security definer set search_path = public
as $$
  with me as (
    select public.current_domain_id() as id, coalesce(public.is_admin(), false) as admin
  ),
  base as (
    select
      a.id, a.display_name, a.qualifications,
      p.bio, p.specialties, p.years_experience, p.availability, p.avatar_url,
      pr.avatar_color,
      p.contact_phone, p.phone_visibility,
      p.contact_email, p.email_visibility,
      p.contact_kakao, p.kakao_visibility,
      p.instant_connect,
      coalesce(me.admin or me.id = a.id, false) as privileged,
      (me.id is not null and exists (
        select 1 from public.consultation_requests c
        where c.expert_id = a.id and c.viewer_id = me.id
          and c.status in ('accepted', 'completed')
      )) as accepted_with_me,
      me.id as me_id
    from public.auditors a
    join public.expert_profiles p on p.auditor_id = a.id
    left join public.profiles pr on pr.domain_id = a.id
    cross join me
    where a.status = 'active'
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
    (b.me_id is not null and exists (
      select 1 from public.expert_likes l
      where l.expert_id = b.id and l.viewer_id = b.me_id
        and l.conversation_id = p_conversation_id
    )),
    (select count(*)::int from public.audits au
      where au.auditor_id = b.id and au.status in ('submitted', 'reviewed', 'finalized')),
    (p_conversation_id is not null and exists (
      select 1 from public.audits au
      where au.auditor_id = b.id and au.conversation_id = p_conversation_id
    )),
    b.instant_connect
  from base b
$$;

revoke all on function public.list_experts(text) from public;
grant execute on function public.list_experts(text) to anon, authenticated;

-- ── ④ connect_instant — 즉시 연결 세무사와 수락된 신청 + 3자 방을 한 번에 ─────────
-- 사장님(viewer) 본인 대화만 · 즉시 연결로 표시된(listed·active) 세무사만. 이미 이 쌍의 성립된 신청이 있으면 그것으로 방을 연다.
-- open_room 이 같은 쌍의 열린 방을 그대로 돌려주므로 두 번 눌러도 방은 하나다.
create or replace function public.connect_instant(p_conversation_id text, p_expert_id text)
  returns public.consultation_rooms
  language plpgsql security definer set search_path = public
as $$
declare
  v_me    text := public.current_domain_id();
  v_role  text := public.current_role()::text;
  v_now   bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_req   text;
begin
  if v_me is null or v_role <> 'user' then   -- 사장님 = 'user' 역할(0002)
    raise exception 'only a signed-in owner can connect';
  end if;
  if not exists (select 1 from public.conversations where id = p_conversation_id and owner_id = v_me) then
    raise exception 'conversation % is not yours', p_conversation_id;
  end if;
  if not exists (
    select 1 from public.expert_profiles p join public.auditors a on a.id = p.auditor_id
    where p.auditor_id = p_expert_id and p.listed and p.instant_connect and a.status = 'active'
  ) then
    raise exception 'expert % does not accept instant connections', p_expert_id;
  end if;

  select id into v_req from public.consultation_requests
   where conversation_id = p_conversation_id and viewer_id = v_me and expert_id = p_expert_id
     and status in ('accepted', 'completed')
   order by created_at desc limit 1;

  if v_req is null then
    v_req := 'consult-' || replace(gen_random_uuid()::text, '-', '');
    insert into public.consultation_requests
      (id, conversation_id, viewer_id, expert_id, message, status, status_history, created_at, updated_at)
    values
      (v_req, p_conversation_id, v_me, p_expert_id, null, 'accepted',
       jsonb_build_array(jsonb_build_object('status', 'accepted', 'at', v_now, 'actor', v_me, 'note', '즉시 연결')),
       v_now, v_now);
  end if;

  return public.open_room(p_conversation_id, v_me, p_expert_id, 'request', v_req);
end;
$$;

revoke all on function public.connect_instant(text, text) from public, anon;
grant execute on function public.connect_instant(text, text) to authenticated;

-- ── ⑤ 신청 알림 메일 — 대기 신청에만 (즉시 연결은 이미 수락 상태라 "수락해 주세요" 메일이 엉뚱하다) ──
create or replace function public._consultation_on_insert()
  returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  if new.status <> 'pending' then
    return new;
  end if;
  perform public._consultation_mail(
    new.expert_id,
    new.viewer_id,
    '새 상담 신청 — ' || public._consultation_owner_name(new.viewer_id),
    public._consultation_owner_name(new.viewer_id) || '이 AI 상담 중 세무사 상담을 신청했습니다.'
      || case when coalesce(new.message, '') <> ''
              then E'\n\n남긴 메시지:\n' || new.message else '' end
      || E'\n\n[상담 신청] 화면에서 대화 원문을 확인하고 수락 또는 거절해 주세요.',
    new.id
  );
  return new;
end;
$$;
