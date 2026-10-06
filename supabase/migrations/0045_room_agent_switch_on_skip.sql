-- ════════════════════════════════════════════════════════════════════════════
-- 3자 방 스위치를 다시 켤 때, 꺼 둔 동안의 메시지에 세무사 AI 가 뒤늦게 답하지 않게 (0044 후속)
-- ════════════════════════════════════════════════════════════════════════════
-- 2026-10-06 밤 프로덕션 확인: '고객에게 답하기' OFF 동안 온 고객 메시지에, 세무사가 스위치를 다시 켜자
-- 세무사 브라우저의 백업 호출(최근 60초 · run 없음)이 그 메시지를 불러 답이 달렸다.
-- 꺼짐 → 켜짐 전이 때 그 역할의 run 없는 메시지에 skipped run(error 'switch_off')을 박아 둔다 —
-- run 은 트리거 메시지 PK 라 백업 호출·서버 후속(api/room_agent._follow_up) 모두 다시 잡지 못한다.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.set_room_agent_switches(
  p_room_id text, p_customer boolean, p_expert boolean
) returns public.consultation_rooms
  language plpgsql security definer set search_path = public
as $$
declare
  v_me   text := public.current_domain_id();
  v_room public.consultation_rooms;
  v_old  public.consultation_rooms;
  v_now  bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  select * into v_old from public.consultation_rooms where id = p_room_id for update;
  if not found then
    raise exception 'room not found: %', p_room_id;
  end if;
  if v_old.expert_id <> v_me or public.current_role()::text <> 'auditor' then
    raise exception 'only the room expert can change agent switches';
  end if;
  update public.consultation_rooms
     set agent_reply_customer = coalesce(p_customer, agent_reply_customer),
         agent_reply_expert   = coalesce(p_expert, agent_reply_expert)
   where id = p_room_id
  returning * into v_room;

  insert into public.room_agent_runs (trigger_message_id, room_id, status, caller_id, started_at, finished_at, error)
  select m.id, p_room_id, 'skipped', v_me, v_now, v_now, 'switch_off'
    from public.consultation_messages m
   where m.room_id = p_room_id
     and ((m.sender_role = 'user' and v_room.agent_reply_customer and not v_old.agent_reply_customer)
       or (m.sender_role = 'auditor' and v_room.agent_reply_expert and not v_old.agent_reply_expert))
  on conflict do nothing;

  return v_room;
end;
$$;
revoke all on function public.set_room_agent_switches(text, boolean, boolean) from public, anon;
grant execute on function public.set_room_agent_switches(text, boolean, boolean) to authenticated;
