-- ════════════════════════════════════════════════════════════════════════════
-- 세무사 연결 (b) — 상담 신청 상태 전이 + 알림 메일
-- ════════════════════════════════════════════════════════════════════════════
-- 설계: docs/doing/세무사연결_핸드오프_이식설계.md §1 (credigraph transition() 한 곳 원칙을 DB 로)
--
-- ① transition_consultation(id, next, note) — 유일한 상태 변경 경로.
--    consultation_requests 에는 update 정책이 없다(0034). 이 함수가 역할·소유·직전 상태를
--    검사하고, status_history 에 {status, at, actor, note} 를 쌓고, 상대방에게 메일을 넣는다.
--      pending  → accepted | declined   세무사(본인 앞) · admin      → 사장님에게 메일
--      accepted → completed             세무사(본인 앞) · admin      → 사장님에게 메일
--      pending  → cancelled             사장님(본인 신청) · admin    → 세무사에게 메일
--    거절 사유(note)는 선택.
-- ② 신청 insert 트리거 — 세무사에게 "새 상담 신청" 메일.
--    메일을 DB 안에서 보내므로 상태 변경과 알림이 한 트랜잭션이다(클라이언트가 중간에 끊겨도
--    상태만 바뀌고 알림이 빠지는 일이 없다). mail.kind 에는 CHECK 가 없다(0001) — 'consultation'.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 메일 헬퍼 ────────────────────────────────────────────────────────────────
create or replace function public._consultation_mail(
  p_recipient text, p_sender text, p_subject text, p_body text, p_request_id text
) returns void
  language sql security definer set search_path = public
as $$
  insert into public.mail (id, recipient_id, sender_id, kind, subject, body, ref, sent_at, read_at)
  values (
    'mail-' || replace(gen_random_uuid()::text, '-', ''),
    p_recipient, p_sender, 'consultation', p_subject, coalesce(p_body, ''),
    jsonb_build_object('kind', 'consultation', 'requestId', p_request_id),
    (extract(epoch from clock_timestamp()) * 1000)::bigint,
    null
  );
$$;
revoke all on function public._consultation_mail(text, text, text, text, text) from public, anon, authenticated;

-- 사장님 호칭 (profiles.display_name → label → id, 끝에 '님'). 데모 라벨 "사장님"·"사장님2" 는
-- 이미 호칭이라 '님'을 덧붙이지 않는다("사장님님" 방지).
create or replace function public._consultation_owner_name(p_domain_id text)
  returns text
  language sql stable security definer set search_path = public
as $$
  select case when n ~ '님[0-9]*$' then n else n || '님' end
  from (
    select coalesce(
      (select coalesce(nullif(p.display_name, ''), p.label) from public.profiles p
        where p.domain_id = p_domain_id limit 1),
      p_domain_id) as n
  ) x
$$;
revoke all on function public._consultation_owner_name(text) from public, anon, authenticated;

-- ── ② 신청 insert → 세무사에게 메일 ─────────────────────────────────────────────
create or replace function public._consultation_on_insert()
  returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
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

drop trigger if exists consultation_requests_notify_insert on public.consultation_requests;
create trigger consultation_requests_notify_insert
  after insert on public.consultation_requests
  for each row execute function public._consultation_on_insert();

-- ── ① 상태 전이 ──────────────────────────────────────────────────────────────────
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

  -- 알림 메일
  select coalesce(a.display_name, v_req.expert_id) into v_expert
    from public.auditors a where a.id = v_req.expert_id;
  v_expert := coalesce(v_expert, v_req.expert_id);
  v_owner := public._consultation_owner_name(v_req.viewer_id);

  if p_next = 'accepted' then
    perform public._consultation_mail(v_req.viewer_id, v_me,
      v_expert || ' 세무사가 상담을 수락했습니다',
      v_expert || ' 세무사가 상담 신청을 수락했습니다.'
        || E'\n\n[세무사 상담] 화면에서 담당 세무사의 연락처를 확인하고 연락해 보세요.'
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
