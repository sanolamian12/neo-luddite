-- ════════════════════════════════════════════════════════════════════════════
-- 인앱 상담사 채팅 (c) — 경로 B: 세무사가 풀에서 연결 요청(제안) → 사장님 승인 → 채팅방
-- ════════════════════════════════════════════════════════════════════════════
-- 설계: design/인앱상담사채팅_상담사풀_설계.md §1 경로 B, §3.3·3.4·3.5·3.8, §5
--
-- ① consultation_offers — 세무사 → 사장님 방향. 기존 consultation_requests(경로 A)와 방향·승인 주체가
--    반대라 테이블을 따로 둔다(0035 전이 함수를 두 갈래로 쪼개지 않는다).
--    unique(conversation_id, expert_id) — 같은 대화에 한 세무사는 **1회만** 제안한다
--    (사용자 결정 2026-09-21, 설계 §10-3: 거절·철회·만료 뒤 재제안 없음).
--    직접 쓰기 정책 없음 — 생성은 make_offer(), 상태 변경은 transition_offer() 로만.
-- ② make_offer(conversation_id, message) — 세무사 본인 + 공개 프로필 + 유효한 풀 동의 +
--    대화당 대기(pending) 제안 5건 상한. 사장님에게 알림 메일.
-- ③ transition_offer(id, next, note) — 유일한 전이 경로(0035 원칙).
--      pending → approved | declined   사장님(본인 앞)            → 세무사에게 메일 · 승인은 open_room()
--      pending → withdrawn             세무사(본인 제안)          → 사장님에게 메일
--      pending → declined | withdrawn  admin(브레이크, 승인은 불가 — 사장님 대신 방을 열지 않는다)
--    만료(7일)는 pg_cron 없이 **읽을 때·전이할 때** 판정한다: 만료된 pending 에 전이를 걸면
--    요청한 전이 대신 expired 로 확정하고 그 행을 돌려준다(오류로 올리면 확정이 롤백되므로).
-- ④ open_room() — 0038 을 create or replace: origin='offer' 면 같은 (대화·사장님·세무사)의
--    approved 제안이 있어야 한다. 나머지(상한 3·닫힌 방 재개·직렬화)는 그대로.
-- ⑤ list_pool_cases() — 반환 열에 my_offer_status(내 제안 상태, 없으면 null) 추가.
--    반환 열이 바뀌므로 drop 후 재생성.
-- ⑥ 알림 메일 = kind 'consultation' 재사용, ref {kind:'offer', id}.
-- ⑦ Realtime publication 에 consultation_offers. 정책은 current_domain_id()/is_admin() 만 쓴다
--    (둘 다 anon 실행 가능 — anon 구독자의 정책 평가 오류가 이벤트를 지우는 함정, 설계 §7).
-- ════════════════════════════════════════════════════════════════════════════

-- ── ① 제안 ───────────────────────────────────────────────────────────────────────
create table public.consultation_offers (
  id               text primary key,
  conversation_id  text not null references public.conversations (id) on delete cascade,
  expert_id        text not null references public.auditors (id),
  viewer_id        text not null,                          -- 받는 사장님 domain_id
  message          text check (message is null or char_length(message) <= 300),
  status           text not null default 'pending'
                   check (status in ('pending', 'approved', 'declined', 'withdrawn', 'expired')),
  status_history   jsonb not null default '[]'::jsonb,     -- [{status, at, actor, note?}]
  created_at       bigint not null,
  updated_at       bigint not null,
  expires_at       bigint not null,                        -- created_at + 7일
  unique (conversation_id, expert_id)
);
create index consultation_offers_viewer_idx on public.consultation_offers (viewer_id);
create index consultation_offers_expert_idx on public.consultation_offers (expert_id);

alter table public.consultation_offers enable row level security;

create policy consultation_offers_expert_read on public.consultation_offers
  for select using (expert_id = public.current_domain_id());

create policy consultation_offers_viewer_read on public.consultation_offers
  for select using (viewer_id = public.current_domain_id());

create policy consultation_offers_admin_read on public.consultation_offers
  for select using (public.is_admin());

-- ── ⑥ 알림 메일 ──────────────────────────────────────────────────────────────────
create or replace function public._offer_mail(
  p_recipient text, p_sender text, p_subject text, p_body text, p_offer_id text
) returns void
  language sql security definer set search_path = public
as $$
  insert into public.mail (id, recipient_id, sender_id, kind, subject, body, ref, sent_at, read_at)
  values (
    'mail-' || replace(gen_random_uuid()::text, '-', ''),
    p_recipient, p_sender, 'consultation', p_subject, coalesce(p_body, ''),
    jsonb_build_object('kind', 'offer', 'id', p_offer_id),
    (extract(epoch from clock_timestamp()) * 1000)::bigint,
    null
  );
$$;
revoke all on function public._offer_mail(text, text, text, text, text) from public, anon, authenticated;

-- ── ② 제안 만들기 ────────────────────────────────────────────────────────────────
create or replace function public.make_offer(p_conversation_id text, p_message text default null)
  returns public.consultation_offers
  language plpgsql security definer set search_path = public
as $$
declare
  v_me      text := public.current_domain_id();
  v_now     bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_msg     text := nullif(btrim(coalesce(p_message, '')), '');
  v_consent public.conversation_pool_consents;
  v_pending integer;
  v_expert  text;
  v_row     public.consultation_offers;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  if public.current_role()::text <> 'auditor' then
    raise exception 'only experts can make offers';
  end if;
  -- 사장님이 받는 것은 프로필 카드다 — 카드가 안 뜨는 세무사(비공개·비활성)는 제안할 수 없다.
  if not exists (
    select 1 from public.auditors a join public.expert_profiles p on p.auditor_id = a.id
     where a.id = v_me and a.status = 'active' and p.listed
  ) then
    raise exception 'expert profile is not listed';
  end if;
  if v_msg is not null and char_length(v_msg) > 300 then
    raise exception 'offer message too long (max 300)';
  end if;

  -- 같은 대화의 제안을 직렬화 — 상한 검사와 insert 사이에 다른 제안이 끼지 않게.
  perform pg_advisory_xact_lock(hashtext('consultation_offer:' || p_conversation_id));

  select * into v_consent from public.conversation_pool_consents
   where conversation_id = p_conversation_id
     and revoked_at is null and expires_at > v_now and masked_payload is not null;
  if not found then
    raise exception 'pool case not available: %', p_conversation_id;
  end if;

  if exists (select 1 from public.consultation_offers
              where conversation_id = p_conversation_id and expert_id = v_me) then
    raise exception 'already offered to this case (one offer per case)';
  end if;
  if exists (select 1 from public.consultation_rooms
              where conversation_id = p_conversation_id and expert_id = v_me and status = 'open') then
    raise exception 'room already open for this case';
  end if;
  if exists (select 1 from public.consultation_requests
              where conversation_id = p_conversation_id and expert_id = v_me and status = 'pending') then
    raise exception 'owner already requested you for this case';
  end if;

  select count(*) into v_pending from public.consultation_offers
   where conversation_id = p_conversation_id and status = 'pending' and expires_at > v_now;
  if v_pending >= 5 then
    raise exception 'offer limit reached: 5 pending offers per case';
  end if;

  insert into public.consultation_offers (
    id, conversation_id, expert_id, viewer_id, message, status, status_history,
    created_at, updated_at, expires_at
  ) values (
    'offer-' || replace(gen_random_uuid()::text, '-', ''),
    p_conversation_id, v_me, v_consent.viewer_id, v_msg, 'pending',
    jsonb_build_array(jsonb_build_object('status', 'pending', 'at', v_now, 'actor', v_me)),
    v_now, v_now, v_now + 7 * 24 * 3600 * 1000
  )
  returning * into v_row;

  select coalesce(a.display_name, v_me) into v_expert from public.auditors a where a.id = v_me;
  v_expert := coalesce(v_expert, v_me);
  perform public._offer_mail(v_row.viewer_id, v_me,
    v_expert || ' 세무사가 상담 연결을 요청했습니다',
    v_expert || ' 세무사가 상담사 풀에 공개된 사례를 보고 상담 연결을 요청했습니다.'
      || case when v_msg is not null then E'\n\n세무사 메시지:\n' || v_msg else '' end
      || E'\n\n설정 메뉴의 [세무사 연결 요청]에서 세무사 프로필을 보고 승인하거나 거절할 수 있습니다.'
      || ' 승인하면 이 세무사와의 채팅방이 열립니다. 7일 안에 답하지 않으면 요청은 만료됩니다.',
    v_row.id);

  return v_row;
end;
$$;
revoke all on function public.make_offer(text, text) from public, anon;
grant execute on function public.make_offer(text, text) to authenticated;

-- ── ④ 방 개설 — 0038 + 경로 B(승인된 제안) 출처 검증 ─────────────────────────────
create or replace function public.open_room(
  p_conversation_id text, p_viewer_id text, p_expert_id text, p_origin text, p_origin_id text
) returns public.consultation_rooms
  language plpgsql security definer set search_path = public
as $$
declare
  v_room  public.consultation_rooms;
  v_now   bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_open  integer;
  v_exists boolean;
begin
  -- 출처 검증: 방은 성립한 신청(경로 A)·승인된 제안(경로 B)에서만 열린다.
  if p_origin = 'request' then
    if not exists (
      select 1 from public.consultation_requests c
      where c.id = p_origin_id and c.conversation_id = p_conversation_id
        and c.viewer_id = p_viewer_id and c.expert_id = p_expert_id
        and c.status in ('accepted', 'completed')
    ) then
      raise exception 'no accepted request % for this room', p_origin_id;
    end if;
  elsif p_origin = 'offer' then
    if not exists (
      select 1 from public.consultation_offers o
      where o.id = p_origin_id and o.conversation_id = p_conversation_id
        and o.viewer_id = p_viewer_id and o.expert_id = p_expert_id
        and o.status = 'approved'
    ) then
      raise exception 'no approved offer % for this room', p_origin_id;
    end if;
  else
    raise exception 'unsupported room origin: %', p_origin;
  end if;

  -- 같은 대화의 방 개설을 직렬화 — 상한 검사와 insert 사이에 다른 개설이 끼지 않게.
  perform pg_advisory_xact_lock(hashtext('consultation_room:' || p_conversation_id));

  select * into v_room from public.consultation_rooms
   where conversation_id = p_conversation_id and expert_id = p_expert_id
   for update;
  v_exists := found;   -- 아래 count 가 FOUND 를 덮어쓰므로 여기서 잡아 둔다

  if v_exists and v_room.status = 'open' then
    return v_room;
  end if;

  select count(*) into v_open from public.consultation_rooms
   where conversation_id = p_conversation_id and status = 'open';
  if v_open >= 3 then
    raise exception 'room limit reached: 3 open rooms per conversation';
  end if;

  if v_exists then
    -- 닫힌 방을 다시 연다(같은 쌍의 방은 하나뿐 — 이전 대화가 그대로 이어진다).
    update public.consultation_rooms
       set status = 'open', closed_at = null, origin = p_origin, origin_id = p_origin_id
     where id = v_room.id
    returning * into v_room;
    return v_room;
  end if;

  insert into public.consultation_rooms (id, conversation_id, viewer_id, expert_id, origin, origin_id, created_at)
  values ('room-' || replace(gen_random_uuid()::text, '-', ''),
          p_conversation_id, p_viewer_id, p_expert_id, p_origin, p_origin_id, v_now)
  returning * into v_room;
  return v_room;
end;
$$;
revoke all on function public.open_room(text, text, text, text, text) from public, anon, authenticated;

-- ── ③ 제안 전이 ──────────────────────────────────────────────────────────────────
create or replace function public.transition_offer(
  p_id text, p_next text, p_note text default null
) returns public.consultation_offers
  language plpgsql security definer set search_path = public
as $$
declare
  v_me      text := public.current_domain_id();
  v_admin   boolean := public.is_admin();
  v_offer   public.consultation_offers;
  v_now     bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_expert  text;
  v_owner   text;
  v_entry   jsonb;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;

  select * into v_offer from public.consultation_offers where id = p_id for update;
  if not found then
    raise exception 'offer not found: %', p_id;
  end if;

  -- 누가 할 수 있는가(상태보다 먼저 — 남의 제안은 만료 확정도 못 건드린다)
  if p_next in ('approved', 'declined') then
    if not (v_offer.viewer_id = v_me or (v_admin and p_next = 'declined')) then
      raise exception 'only the owner can %', p_next;
    end if;
  elsif p_next = 'withdrawn' then
    if not (v_offer.expert_id = v_me or v_admin) then
      raise exception 'only the offering expert can withdraw';
    end if;
  else
    raise exception 'invalid transition target: %', p_next;
  end if;

  if v_offer.status <> 'pending' then
    raise exception 'invalid transition: % -> %', v_offer.status, p_next;
  end if;

  -- 7일 만료 — 요청한 전이 대신 expired 로 확정하고 돌려준다(호출자는 status 로 안다).
  if v_offer.expires_at <= v_now then
    update public.consultation_offers
       set status = 'expired',
           status_history = status_history || jsonb_build_array(
             jsonb_build_object('status', 'expired', 'at', v_now, 'actor', 'system')),
           updated_at = v_now
     where id = p_id
    returning * into v_offer;
    return v_offer;
  end if;

  v_entry := jsonb_build_object('status', p_next, 'at', v_now, 'actor', v_me);
  if v_note is not null then
    v_entry := v_entry || jsonb_build_object('note', v_note);
  end if;

  update public.consultation_offers
     set status = p_next,
         status_history = status_history || jsonb_build_array(v_entry),
         updated_at = v_now
   where id = p_id
  returning * into v_offer;

  -- 경로 B 승인 = 채팅방 개설. 상한 초과면 여기서 예외 → 승인 자체가 롤백된다(제안은 pending 그대로).
  if p_next = 'approved' then
    perform public.open_room(v_offer.conversation_id, v_offer.viewer_id, v_offer.expert_id, 'offer', v_offer.id);
  end if;

  select coalesce(a.display_name, v_offer.expert_id) into v_expert
    from public.auditors a where a.id = v_offer.expert_id;
  v_expert := coalesce(v_expert, v_offer.expert_id);
  v_owner := public._consultation_owner_name(v_offer.viewer_id);

  if p_next = 'approved' then
    perform public._offer_mail(v_offer.expert_id, v_me,
      '연결 요청 승인 — ' || v_owner,
      v_owner || '이 상담 연결 요청을 승인했습니다. 채팅방이 열렸습니다.'
        || E'\n\n[채팅방] 화면에서 바로 대화를 시작해 주세요. 원 대화도 채팅방에서 열어 볼 수 있습니다.',
      v_offer.id);
  elsif p_next = 'declined' then
    perform public._offer_mail(v_offer.expert_id, v_me,
      '연결 요청 거절 — ' || v_owner,
      v_owner || '이 이번 상담 연결 요청을 받지 않기로 했습니다.'
        || case when v_note is not null then E'\n\n사유:\n' || v_note else '' end,
      v_offer.id);
  elsif p_next = 'withdrawn' then
    perform public._offer_mail(v_offer.viewer_id, v_me,
      v_expert || ' 세무사가 연결 요청을 철회했습니다',
      v_expert || ' 세무사가 보냈던 상담 연결 요청을 철회했습니다.'
        || case when v_note is not null then E'\n\n사유:\n' || v_note else '' end,
      v_offer.id);
  end if;

  return v_offer;
end;
$$;
revoke all on function public.transition_offer(text, text, text) from public, anon;
grant execute on function public.transition_offer(text, text, text) to authenticated;

-- ── ⑤ 풀 목록 — 내 제안 상태 열 추가(반환 열이 바뀌므로 drop 후 재생성) ────────────────
drop function if exists public.list_pool_cases();
create function public.list_pool_cases()
  returns table (
    conversation_id  text,
    occupation       text,
    tax_category     text,
    title            text,
    first_question   text,
    turn_count       integer,
    granted_at       bigint,
    expires_at       bigint,
    mask_report      jsonb,
    viewed_by_me     boolean,
    my_offer_status  text            -- 내 제안: pending|approved|declined|withdrawn|expired, 없으면 null
  )
  language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_me  text := public.current_domain_id();
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if v_me is null or public.current_role()::text not in ('auditor', 'admin') then
    raise exception 'pool is for experts only';
  end if;
  return query
    select
      c.conversation_id,
      c.occupation,
      c.tax_category,
      c.title,
      (select string_agg(s ->> 'text', ' ')
         from jsonb_array_elements(
                (select m from jsonb_array_elements(c.masked_payload -> 'messages') m
                  where m ->> 'role' = 'user' order by (m ->> 'order')::int limit 1) -> 'segments') s),
      (select count(*)::int from jsonb_array_elements(c.masked_payload -> 'messages') m
        where m ->> 'role' = 'user'),
      c.granted_at,
      c.expires_at,
      c.mask_report,
      exists (select 1 from public.pool_case_views v
               where v.conversation_id = c.conversation_id and v.auditor_id = v_me),
      (select case when o.status = 'pending' and o.expires_at <= v_now then 'expired' else o.status end
         from public.consultation_offers o
        where o.conversation_id = c.conversation_id and o.expert_id = v_me)
    from public.conversation_pool_consents c
    where c.revoked_at is null and c.expires_at > v_now and c.masked_payload is not null
    order by c.granted_at desc;
end;
$$;
revoke all on function public.list_pool_cases() from public, anon;
grant execute on function public.list_pool_cases() to authenticated;

-- ── ⑦ Realtime ───────────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.consultation_offers;
