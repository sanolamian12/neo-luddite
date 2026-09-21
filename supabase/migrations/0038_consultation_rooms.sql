-- ════════════════════════════════════════════════════════════════════════════
-- 인앱 상담사 채팅 (b) — 채팅방 · 메시지 · 경로 A 수락 시 방 개설
-- ════════════════════════════════════════════════════════════════════════════
-- 설계: design/인앱상담사채팅_상담사풀_설계.md §2 D3, §3.5·3.6·3.8, §5
--
-- ① consultation_rooms — (대화, 세무사) 쌍당 1:1 방. unique(conversation_id, expert_id).
--    직접 쓰기 정책 없음 — 개설은 open_room(), 종료는 close_room(), 읽음은 mark_room_read() 로만.
-- ② consultation_messages — 방 참여자만 읽기·쓰기(admin 은 읽기). update 는 본인 메시지의
--    deleted_at 만(soft delete, 컬럼 권한으로 강제). 보낸 사람·역할·시각은 트리거가 서버에서 채운다.
-- ③ open_room() — 방 개설의 유일한 경로. 사용자 직접 실행 불가(내부 전용): 경로 A 는
--    transition_consultation 의 accepted, 경로 B 는 (c) 의 transition_offer 가 부른다.
--    이미 있으면 그 방을 돌려준다(닫힌 방이면 다시 연다). 대화당 열린 방 상한 3.
-- ④ transition_consultation — 0035 를 그대로 두고 accepted 때 open_room() 호출만 더한다(D3).
--    수락 메일 문구만 "채팅방이 열렸다"로 바꾼다.
-- ⑤ 읽음 = 방의 viewer_last_read_at / expert_last_read_at 한 칸(메시지별 읽음 행 없음).
-- ⑥ 알림 메일 = kind 'consultation' 재사용, ref {kind:'room', id}. 받는 사람마다 방당 1건 —
--    그 방에서 처음 받은 메시지에만 보내고, 그 뒤로는 뱃지만.
-- ⑦ close_room() — 양쪽 참여자 누구나 + admin (사용자 결정 2026-09-21, 설계 §10-2).
-- ════════════════════════════════════════════════════════════════════════════

-- ── ① 채팅방 ─────────────────────────────────────────────────────────────────────
create table public.consultation_rooms (
  id                   text primary key,
  conversation_id      text not null references public.conversations (id) on delete cascade,
  viewer_id            text not null,                     -- 사장님 domain_id
  expert_id            text not null references public.auditors (id),
  origin               text not null check (origin in ('request', 'offer')),
  origin_id            text not null,                     -- consultation_requests.id | consultation_offers.id
  status               text not null default 'open' check (status in ('open', 'closed')),
  created_at           bigint not null,
  closed_at            bigint,
  last_message_at      bigint,
  viewer_last_read_at  bigint,
  expert_last_read_at  bigint,
  unique (conversation_id, expert_id)
);
create index consultation_rooms_viewer_idx on public.consultation_rooms (viewer_id);
create index consultation_rooms_expert_idx on public.consultation_rooms (expert_id);

alter table public.consultation_rooms enable row level security;

create policy consultation_rooms_member_read on public.consultation_rooms
  for select using (viewer_id = public.current_domain_id() or expert_id = public.current_domain_id());

create policy consultation_rooms_admin_read on public.consultation_rooms
  for select using (public.is_admin());

-- 방 참여 여부 — 메시지 정책이 방 테이블 RLS 를 한 번 더 타지 않게 security definer 로.
-- **anon 실행 권한을 빼면 안 된다**(2026-09-21 E2E): Realtime 은 로그인 전 anon 구독자에게도 이 정책을
-- 평가하는데, 그 평가가 권한 오류를 내면 그 이벤트가 **모든 구독자에게서** 사라진다(방 참여자도 못 받음).
-- anon 이 부르면 current_domain_id() 가 null 이라 항상 false 다.
create or replace function public.is_room_member(p_room_id text)
  returns boolean
  language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.consultation_rooms r
    where r.id = p_room_id
      and (r.viewer_id = public.current_domain_id() or r.expert_id = public.current_domain_id())
  )
$$;
revoke all on function public.is_room_member(text) from public;
grant execute on function public.is_room_member(text) to anon, authenticated;

-- ── ② 메시지 ─────────────────────────────────────────────────────────────────────
create table public.consultation_messages (
  id           text primary key,
  room_id      text not null references public.consultation_rooms (id) on delete cascade,
  sender_id    text not null,
  sender_role  text not null check (sender_role in ('user', 'auditor')),
  body         text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at   bigint not null,
  edited_at    bigint,
  deleted_at   bigint
);
create index consultation_messages_room_idx on public.consultation_messages (room_id, created_at);

alter table public.consultation_messages enable row level security;

create policy consultation_messages_member_read on public.consultation_messages
  for select using (public.is_room_member(room_id));

create policy consultation_messages_admin_read on public.consultation_messages
  for select using (public.is_admin());

-- 쓰기: 본인 이름으로, 내가 참여한 **열린** 방에만. (sender_id 는 아래 트리거가 호출자로 덮어쓴다 —
-- 정책은 BEFORE 트리거 뒤의 행을 검사한다.)
create policy consultation_messages_member_insert on public.consultation_messages
  for insert with check (
    sender_id = public.current_domain_id()
    and exists (
      select 1 from public.consultation_rooms r
      where r.id = room_id and r.status = 'open'
        and (r.viewer_id = public.current_domain_id() or r.expert_id = public.current_domain_id())
    )
  );

-- soft delete: 본인 메시지만, 그리고 deleted_at 컬럼만(아래 컬럼 권한).
create policy consultation_messages_own_delete_mark on public.consultation_messages
  for update using (sender_id = public.current_domain_id())
  with check (sender_id = public.current_domain_id());

revoke update, delete on public.consultation_messages from anon, authenticated;
grant update (deleted_at) on public.consultation_messages to authenticated;

-- 보낸 사람·역할·시각은 서버가 정한다(클라이언트 값은 무시).
create or replace function public._room_message_before_insert()
  returns trigger
  language plpgsql security definer set search_path = public
as $$
declare
  v_room public.consultation_rooms;
  v_me   text := public.current_domain_id();
begin
  select * into v_room from public.consultation_rooms where id = new.room_id;
  if not found then
    raise exception 'room not found: %', new.room_id;
  end if;
  new.sender_id := coalesce(v_me, new.sender_id);
  new.sender_role := case
    when new.sender_id = v_room.viewer_id then 'user'
    when new.sender_id = v_room.expert_id then 'auditor'
  end;
  new.created_at := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  new.edited_at := null;
  new.deleted_at := null;
  return new;
end;
$$;
revoke all on function public._room_message_before_insert() from public, anon, authenticated;

create trigger consultation_messages_before_insert
  before insert on public.consultation_messages
  for each row execute function public._room_message_before_insert();

-- 지운 시각은 서버 시각, 되살리기 없음.
create or replace function public._room_message_before_update()
  returns trigger
  language plpgsql set search_path = public
as $$
begin
  if old.deleted_at is not null then
    new.deleted_at := old.deleted_at;
  elsif new.deleted_at is not null then
    new.deleted_at := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  end if;
  return new;
end;
$$;
revoke all on function public._room_message_before_update() from public, anon, authenticated;

create trigger consultation_messages_before_update
  before update on public.consultation_messages
  for each row execute function public._room_message_before_update();

-- ── ⑥ 알림 메일 (방당 · 받는 사람당 1건) ────────────────────────────────────────────
create or replace function public._room_mail(
  p_recipient text, p_sender text, p_subject text, p_body text, p_room_id text
) returns void
  language sql security definer set search_path = public
as $$
  insert into public.mail (id, recipient_id, sender_id, kind, subject, body, ref, sent_at, read_at)
  values (
    'mail-' || replace(gen_random_uuid()::text, '-', ''),
    p_recipient, p_sender, 'consultation', p_subject, coalesce(p_body, ''),
    jsonb_build_object('kind', 'room', 'id', p_room_id),
    (extract(epoch from clock_timestamp()) * 1000)::bigint,
    null
  );
$$;
revoke all on function public._room_mail(text, text, text, text, text) from public, anon, authenticated;

-- 새 메시지 → 방의 마지막 메시지 시각 · 보낸 사람 읽음 갱신 · 상대에게 첫 메일.
create or replace function public._room_message_after_insert()
  returns trigger
  language plpgsql security definer set search_path = public
as $$
declare
  v_room      public.consultation_rooms;
  v_recipient text;
  v_expert    text;
begin
  update public.consultation_rooms
     set last_message_at = new.created_at,
         viewer_last_read_at = case when new.sender_role = 'user' then new.created_at else viewer_last_read_at end,
         expert_last_read_at = case when new.sender_role = 'auditor' then new.created_at else expert_last_read_at end
   where id = new.room_id
  returning * into v_room;

  v_recipient := case when new.sender_role = 'user' then v_room.expert_id else v_room.viewer_id end;

  if not exists (
    select 1 from public.mail m
    where m.recipient_id = v_recipient
      and m.ref ->> 'kind' = 'room' and m.ref ->> 'id' = new.room_id
  ) then
    if new.sender_role = 'user' then
      perform public._room_mail(v_recipient, new.sender_id,
        '새 채팅 메시지 — ' || public._consultation_owner_name(v_room.viewer_id),
        public._consultation_owner_name(v_room.viewer_id) || '이 채팅방에 메시지를 보냈습니다.'
          || E'\n\n[채팅방] 화면에서 확인해 주세요. 이 방의 다음 메시지부터는 메일 없이 사이드바 뱃지로 알려 드립니다.',
        new.room_id);
    else
      select coalesce(a.display_name, v_room.expert_id) into v_expert
        from public.auditors a where a.id = v_room.expert_id;
      v_expert := coalesce(v_expert, v_room.expert_id);
      perform public._room_mail(v_recipient, new.sender_id,
        v_expert || ' 세무사가 채팅 메시지를 보냈습니다',
        v_expert || ' 세무사가 채팅방에 메시지를 보냈습니다.'
          || E'\n\n[세무사 상담] 화면에서 [채팅방 열기]로 확인해 주세요. 이 방의 다음 메시지부터는 메일 없이 뱃지로 알려 드립니다.',
        new.room_id);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public._room_message_after_insert() from public, anon, authenticated;

create trigger consultation_messages_after_insert
  after insert on public.consultation_messages
  for each row execute function public._room_message_after_insert();

-- ── ③ 방 개설 (내부 전용) ────────────────────────────────────────────────────────
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
  -- 출처 검증: 방은 성립한 신청(경로 A)·승인된 제안(경로 B, (c))에서만 열린다.
  if p_origin = 'request' then
    if not exists (
      select 1 from public.consultation_requests c
      where c.id = p_origin_id and c.conversation_id = p_conversation_id
        and c.viewer_id = p_viewer_id and c.expert_id = p_expert_id
        and c.status in ('accepted', 'completed')
    ) then
      raise exception 'no accepted request % for this room', p_origin_id;
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

-- ── 읽음 ─────────────────────────────────────────────────────────────────────────
-- 호출자 쪽 *_last_read_at 을 지금으로, 그리고 이 방 알림 메일도 읽음으로(사이드바 뱃지).
create or replace function public.mark_room_read(p_room_id text)
  returns public.consultation_rooms
  language plpgsql security definer set search_path = public
as $$
declare
  v_me   text := public.current_domain_id();
  v_room public.consultation_rooms;
  v_now  bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  select * into v_room from public.consultation_rooms where id = p_room_id;
  if not found or (v_room.viewer_id <> v_me and v_room.expert_id <> v_me) then
    raise exception 'not a member of room %', p_room_id;
  end if;

  update public.consultation_rooms
     set viewer_last_read_at = case when viewer_id = v_me then v_now else viewer_last_read_at end,
         expert_last_read_at = case when expert_id = v_me then v_now else expert_last_read_at end
   where id = p_room_id
  returning * into v_room;

  update public.mail
     set read_at = v_now
   where recipient_id = v_me and read_at is null
     and ref ->> 'kind' = 'room' and ref ->> 'id' = p_room_id;

  return v_room;
end;
$$;
revoke all on function public.mark_room_read(text) from public, anon;
grant execute on function public.mark_room_read(text) to authenticated;

-- ── ⑦ 방 종료 — 양쪽 참여자 누구나 + admin ────────────────────────────────────────
create or replace function public.close_room(p_room_id text)
  returns public.consultation_rooms
  language plpgsql security definer set search_path = public
as $$
declare
  v_me   text := public.current_domain_id();
  v_room public.consultation_rooms;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  select * into v_room from public.consultation_rooms where id = p_room_id for update;
  if not found then
    raise exception 'room not found: %', p_room_id;
  end if;
  if not (public.is_admin() or v_room.viewer_id = v_me or v_room.expert_id = v_me) then
    raise exception 'only room members or admin can close room';
  end if;
  if v_room.status = 'closed' then
    return v_room;   -- 두 번 눌러도 같은 결과
  end if;

  update public.consultation_rooms
     set status = 'closed', closed_at = (extract(epoch from clock_timestamp()) * 1000)::bigint
   where id = p_room_id
  returning * into v_room;
  return v_room;
end;
$$;
revoke all on function public.close_room(text) from public, anon;
grant execute on function public.close_room(text) to authenticated;

-- ── ④ 상태 전이 — 0035 그대로 + accepted 때 방 개설(D3) ───────────────────────────
create or replace function public.transition_consultation(
  p_id text, p_next text, p_note text default null
) returns public.consultation_requests
  language plpgsql security definer set search_path = public
as $$
declare
  v_me      text := public.current_domain_id();
  v_role    text := public.current_role()::text;
  v_admin   boolean := public.is_admin();
  v_req     public.consultation_requests;
  v_now     bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_expert  text;
  v_owner   text;
  v_entry   jsonb;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;

  select * into v_req from public.consultation_requests where id = p_id for update;
  if not found then
    raise exception 'consultation not found: %', p_id;
  end if;

  -- 허용 전이 (직전 상태 → 다음 상태)
  if not (
    (v_req.status = 'pending'  and p_next in ('accepted', 'declined', 'cancelled')) or
    (v_req.status = 'accepted' and p_next = 'completed')
  ) then
    raise exception 'invalid transition: % -> %', v_req.status, p_next;
  end if;

  -- 누가 할 수 있는가
  if not v_admin then
    if p_next in ('accepted', 'declined', 'completed') then
      if not (v_role = 'auditor' and v_req.expert_id = v_me) then
        raise exception 'only the assigned expert can %', p_next;
      end if;
    elsif p_next = 'cancelled' then
      if v_req.viewer_id <> v_me then
        raise exception 'only the requester can cancel';
      end if;
    end if;
  end if;

  v_entry := jsonb_build_object('status', p_next, 'at', v_now, 'actor', v_me);
  if v_note is not null then
    v_entry := v_entry || jsonb_build_object('note', v_note);
  end if;

  update public.consultation_requests
     set status = p_next,
         status_history = status_history || jsonb_build_array(v_entry),
         updated_at = v_now
   where id = p_id
  returning * into v_req;

  -- 경로 A 수락 = 채팅방 개설(D3). 상한 초과면 여기서 예외 → 수락 자체가 롤백된다.
  if p_next = 'accepted' then
    perform public.open_room(v_req.conversation_id, v_req.viewer_id, v_req.expert_id, 'request', v_req.id);
  end if;

  -- 알림 메일
  select coalesce(a.display_name, v_req.expert_id) into v_expert
    from public.auditors a where a.id = v_req.expert_id;
  v_expert := coalesce(v_expert, v_req.expert_id);
  v_owner := public._consultation_owner_name(v_req.viewer_id);

  if p_next = 'accepted' then
    perform public._consultation_mail(v_req.viewer_id, v_me,
      v_expert || ' 세무사가 상담을 수락했습니다',
      v_expert || ' 세무사가 상담 신청을 수락했습니다.'
        || E'\n\n[세무사 상담] 화면에서 [채팅방 열기]로 세무사와 바로 대화할 수 있습니다.'
        || ' 세무사가 공개한 연락처도 같은 화면에서 볼 수 있습니다.'
        || case when v_note is not null then E'\n\n세무사 메모:\n' || v_note else '' end,
      v_req.id);
  elsif p_next = 'declined' then
    perform public._consultation_mail(v_req.viewer_id, v_me,
      v_expert || ' 세무사가 상담을 정중히 거절했습니다',
      v_expert || ' 세무사가 이번 상담 신청을 받기 어렵다고 알려 왔습니다.'
        || case when v_note is not null then E'\n\n사유:\n' || v_note else '' end
        || E'\n\nAI 상담 화면에서 다른 세무사에게 다시 신청할 수 있습니다.',
      v_req.id);
  elsif p_next = 'completed' then
    perform public._consultation_mail(v_req.viewer_id, v_me,
      v_expert || ' 세무사와의 상담이 완료되었습니다',
      v_expert || ' 세무사가 상담을 완료로 표시했습니다.'
        || E'\n\n상담이 도움이 됐다면 [세무사 상담] 화면에서 하트를 남겨 주세요.'
        || case when v_note is not null then E'\n\n세무사 메모:\n' || v_note else '' end,
      v_req.id);
  elsif p_next = 'cancelled' then
    perform public._consultation_mail(v_req.expert_id, v_me,
      '상담 신청 취소 — ' || v_owner,
      v_owner || '이 대기 중이던 상담 신청을 취소했습니다.'
        || case when v_note is not null then E'\n\n사유:\n' || v_note else '' end,
      v_req.id);
  end if;

  return v_req;
end;
$$;

revoke all on function public.transition_consultation(text, text, text) from public, anon;
grant execute on function public.transition_consultation(text, text, text) to authenticated;

-- ── Realtime ─────────────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.consultation_rooms;
alter publication supabase_realtime add table public.consultation_messages;
