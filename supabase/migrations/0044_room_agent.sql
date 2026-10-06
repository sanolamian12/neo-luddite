-- ════════════════════════════════════════════════════════════════════════════
-- 세무사 에이전트 3자 대화방 — agent 메시지 · 응답 스위치 2개 · 호출 선점(중복 방지) · 에이전트 설정 서버 저장
-- ════════════════════════════════════════════════════════════════════════════
-- 설계: design/세무사에이전트_3자방_설계.md §4·§7 (D1~D7 사용자 확정 2026-10-06 밤)
--
-- ① consultation_messages.sender_role 에 'agent'. agent 메시지는 **서버(서비스 연결, auth uid 없음)만** 넣는다 —
--    로그인 사용자의 insert 는 지금처럼 트리거가 호출자로 덮어쓰므로 agent 를 사칭할 수 없다.
--    agent 메시지는 메일을 보내지 않고 읽음 칸을 건드리지 않는다(last_message_at 만).
-- ② consultation_rooms 응답 스위치 — 고객에게 답하기(기본 ON) · 세무사에게 답하기(기본 OFF). 기존 방도 기본값(D3).
--    바꾸는 건 그 방 세무사만(set_room_agent_switches).
-- ③ room_agent_runs — 트리거 메시지 하나에 run 하나(PK). 두 브라우저가 동시에 불러도 선점은 하나만(D1).
--    방당 running 하나(부분 유니크). 쓰기 정책 없음 = 서버만. 방 참여자·admin 읽기 + Realtime(대기 표시).
-- ④ expert_agents — 에이전트 스튜디오 설정(브라우저 localStorage → 서버, D5). 본인만 읽기·쓰기.
--    세무사당 방 에이전트 1개(D4, 부분 유니크). 서버는 서비스 연결로 방 세무사의 방 에이전트만 읽는다.
-- ════════════════════════════════════════════════════════════════════════════

-- ── ① agent 메시지 ────────────────────────────────────────────────────────────────
alter table public.consultation_messages drop constraint consultation_messages_sender_role_check;
alter table public.consultation_messages
  add constraint consultation_messages_sender_role_check check (sender_role in ('user', 'auditor', 'agent'));

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
  if v_me is null and new.sender_role = 'agent' then
    -- 서버 전용 경로(0044). 로그인 사용자는 v_me 가 있어 이 갈래에 못 온다(RLS insert 정책도 막는다).
    new.sender_id := 'agent:' || v_room.expert_id;
  else
    new.sender_id := coalesce(v_me, new.sender_id);
    new.sender_role := case
      when new.sender_id = v_room.viewer_id then 'user'
      when new.sender_id = v_room.expert_id then 'auditor'
    end;
  end if;
  new.created_at := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  new.edited_at := null;
  new.deleted_at := null;
  return new;
end;
$$;
revoke all on function public._room_message_before_insert() from public, anon, authenticated;

create or replace function public._room_message_after_insert()
  returns trigger
  language plpgsql security definer set search_path = public
as $$
declare
  v_room      public.consultation_rooms;
  v_recipient text;
  v_expert    text;
begin
  if new.sender_role = 'agent' then
    update public.consultation_rooms set last_message_at = new.created_at where id = new.room_id;
    return new;
  end if;

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

-- ── ② 응답 스위치 ─────────────────────────────────────────────────────────────────
alter table public.consultation_rooms
  add column agent_reply_customer boolean not null default true,
  add column agent_reply_expert   boolean not null default false;

create or replace function public.set_room_agent_switches(
  p_room_id text, p_customer boolean, p_expert boolean
) returns public.consultation_rooms
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
  if v_room.expert_id <> v_me or public.current_role()::text <> 'auditor' then
    raise exception 'only the room expert can change agent switches';
  end if;
  update public.consultation_rooms
     set agent_reply_customer = coalesce(p_customer, agent_reply_customer),
         agent_reply_expert   = coalesce(p_expert, agent_reply_expert)
   where id = p_room_id
  returning * into v_room;
  return v_room;
end;
$$;
revoke all on function public.set_room_agent_switches(text, boolean, boolean) from public, anon;
grant execute on function public.set_room_agent_switches(text, boolean, boolean) to authenticated;

-- ── ③ 호출 선점 ───────────────────────────────────────────────────────────────────
create table public.room_agent_runs (
  trigger_message_id text primary key references public.consultation_messages (id) on delete cascade,
  room_id            text not null references public.consultation_rooms (id) on delete cascade,
  status             text not null check (status in ('running', 'done', 'expired', 'failed', 'skipped')),
  caller_id          text,                 -- 누가 불렀나(domain_id, 계측)
  attempts           integer not null default 1,
  started_at         bigint not null,
  finished_at        bigint,
  reply_message_id   text,
  error              text
);
create unique index room_agent_runs_one_running on public.room_agent_runs (room_id) where status = 'running';
create index room_agent_runs_room_idx on public.room_agent_runs (room_id, started_at);

alter table public.room_agent_runs enable row level security;

-- is_room_member 는 anon 실행권을 유지한다(0038 함정 ①: 정책 평가 오류 → 이벤트가 모두에게서 사라짐).
create policy room_agent_runs_member_read on public.room_agent_runs
  for select using (public.is_room_member(room_id));
create policy room_agent_runs_admin_read on public.room_agent_runs
  for select using (public.is_admin());
revoke insert, update, delete on public.room_agent_runs from anon, authenticated;

-- ── ④ 에이전트 설정 ───────────────────────────────────────────────────────────────
create table public.expert_agents (
  expert_id     uuid not null default auth.uid(),   -- auth uid (kb3.documents.expert_id 와 같은 키)
  agent_id      text not null,
  name          text not null default '' check (char_length(name) <= 100),
  agent         jsonb not null,                     -- 스튜디오 Agent 객체 통째(practice 포함)
  is_room_agent boolean not null default false,
  created_at    bigint not null,
  updated_at    bigint not null,
  primary key (expert_id, agent_id),
  check (pg_column_size(agent) <= 2000000)
);
create unique index expert_agents_one_room_agent on public.expert_agents (expert_id) where is_room_agent;

alter table public.expert_agents enable row level security;

create policy expert_agents_own_all on public.expert_agents
  for all
  using (expert_id = auth.uid() and public.current_role()::text in ('auditor', 'admin'))
  with check (expert_id = auth.uid() and public.current_role()::text in ('auditor', 'admin'));
revoke all on public.expert_agents from anon;

-- ── Realtime ─────────────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.room_agent_runs;
