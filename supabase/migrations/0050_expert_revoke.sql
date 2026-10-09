-- ════════════════════════════════════════════════════════════════════════════
-- 세무사 승인 취소(세무사 → 회원 강등) (2026-10-08)
-- ════════════════════════════════════════════════════════════════════════════
-- 설계: design/세무사_승인취소_강등_설계.md (D1~D5 사용자 확정)
--
-- ① is_staff() — 세무사 쪽 접근을 역할로 좁히는 헬퍼. 지금까지 채팅방·신청·제안·검수 정책은
--    domain_id 만 봐서, profiles.role 을 user 로 바꿔도 강등자가 열린 방에 "세무사"로 글을 쓰고
--    고객 대화·검수 기록을 계속 읽을 수 있었다. 세무사 쪽 조건에 is_staff() 를 붙인다(D2).
--    Realtime 이 anon 구독자에게도 정책을 평가하므로 anon 실행권을 준다(로그인 전엔 false).
--    정지(suspended) 세무사는 역할이 auditor 그대로라 영향 없다. 원장 읽기는 그대로(D3, 본인 기록).
-- ② auditors.status 에 'revoked', expert_applications.status 에 'revoked'.
--    승인 취소된 신청서는 반려·철회처럼 30일 뒤 파기(신청자는 그 사이 /expert/apply 에서 사유를 본다).
-- ③ revoke_expert(domain, reason) — 유일한 강등 경로(0035 방식 단일 전이, admin 만). 한 트랜잭션에서
--    대기 신청 declined · 수락 신청 completed · 대기 제안 withdrawn · 열린 방 closed(고객에게 우편, D1)
--    → 진행 중(draft) 검수 cancelled + 픽업 슬롯 반납 → 세무사 카드 삭제 → 세무사 사례 archived
--    (공유 대기분은 rejected, 공용 승인분도 archived — D4) → 신청서 revoked → auditors revoked(행은
--    상담·원장 FK 때문에 남기고 전화 비움, 이름은 과거 기록 표시용으로 유지) → profiles.role = user.
--    0047 guard_profile_identity 는 호출자가 admin 이라 통과한다.
-- ④ admin_expert_revoke_preview(domain) — 관리자 확인 창에 보여 줄 영향 건수(읽기 전용).
-- ⑤ review_expert_application — revoked 행이 있으면 오류 대신 재활성(D5). 원장·검수 이력이 이어진다.
-- ════════════════════════════════════════════════════════════════════════════

-- ── ① 세무사 쪽 접근 헬퍼 ────────────────────────────────────────────────────────
create or replace function public.is_staff()
  returns boolean
  language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_role() in ('auditor', 'admin'), false)
$$;
revoke all on function public.is_staff() from public;
grant execute on function public.is_staff() to anon, authenticated;

-- 채팅방: 사장님 쪽은 그대로, 세무사 쪽은 역할이 있을 때만.
create or replace function public.is_room_member(p_room_id text)
  returns boolean
  language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.consultation_rooms r
    where r.id = p_room_id
      and (r.viewer_id = public.current_domain_id()
           or (r.expert_id = public.current_domain_id() and public.is_staff()))
  )
$$;
revoke all on function public.is_room_member(text) from public;
grant execute on function public.is_room_member(text) to anon, authenticated;

drop policy if exists consultation_rooms_member_read on public.consultation_rooms;
create policy consultation_rooms_member_read on public.consultation_rooms
  for select using (viewer_id = public.current_domain_id()
                    or (expert_id = public.current_domain_id() and public.is_staff()));

drop policy if exists consultation_messages_member_insert on public.consultation_messages;
create policy consultation_messages_member_insert on public.consultation_messages
  for insert with check (
    sender_id = public.current_domain_id()
    and exists (
      select 1 from public.consultation_rooms r
      where r.id = room_id and r.status = 'open'
        and (r.viewer_id = public.current_domain_id()
             or (r.expert_id = public.current_domain_id() and public.is_staff()))
    )
  );

drop policy if exists consultation_messages_own_delete_mark on public.consultation_messages;
create policy consultation_messages_own_delete_mark on public.consultation_messages
  for update using (sender_id = public.current_domain_id() and public.is_room_member(room_id))
  with check (sender_id = public.current_domain_id() and public.is_room_member(room_id));

drop policy if exists consultation_expert_read on public.consultation_requests;
create policy consultation_expert_read on public.consultation_requests
  for select using (expert_id = public.current_domain_id() and public.is_staff());

drop policy if exists consultation_offers_expert_read on public.consultation_offers;
create policy consultation_offers_expert_read on public.consultation_offers
  for select using (expert_id = public.current_domain_id() and public.is_staff());

-- 검수: 형제 audit·리뷰 열람(0011)의 근거가 되는 "내가 참여한 대화" 부터 좁힌다.
create or replace function public.my_conversation_ids()
  returns setof text
  language sql stable security definer set search_path = public
as $$
  select a.conversation_id
    from public.audits a
   where a.auditor_id = public.current_domain_id() and public.is_staff();
$$;

drop policy if exists audits_owner on public.audits;
create policy audits_owner on public.audits
  for all using (auditor_id = public.current_domain_id() and public.is_staff())
  with check (auditor_id = public.current_domain_id() and public.is_staff());

drop policy if exists feedback_member_read on public.line_feedback;
create policy feedback_member_read on public.line_feedback
  for select using (public.is_admin() or (public.is_staff() and exists (
    select 1 from public.audits a
     where a.conversation_id = line_feedback.conversation_id and a.auditor_id = public.current_domain_id())));

drop policy if exists feedback_owner_read on public.line_feedback;
create policy feedback_owner_read on public.line_feedback
  for select using (auditor_id = public.current_domain_id() and public.is_staff());

drop policy if exists feedback_owner_insert on public.line_feedback;
create policy feedback_owner_insert on public.line_feedback
  for insert with check (
    auditor_id = public.current_domain_id() and public.is_staff()
    and not public.conversation_finalized(conversation_id)
    and not public.my_audit_submitted(conversation_id)
  );

drop policy if exists feedback_owner_update on public.line_feedback;
create policy feedback_owner_update on public.line_feedback
  for update using (
    auditor_id = public.current_domain_id() and public.is_staff()
    and not public.conversation_finalized(conversation_id)
    and not public.my_audit_submitted(conversation_id)
  ) with check (
    auditor_id = public.current_domain_id() and public.is_staff()
    and not public.conversation_finalized(conversation_id)
    and not public.my_audit_submitted(conversation_id)
  );

drop policy if exists feedback_owner_delete on public.line_feedback;
create policy feedback_owner_delete on public.line_feedback
  for delete using (
    auditor_id = public.current_domain_id() and public.is_staff()
    and not public.conversation_finalized(conversation_id)
    and not public.my_audit_submitted(conversation_id)
  );

drop policy if exists eval_member_read on public.session_evaluations;
create policy eval_member_read on public.session_evaluations
  for select using (public.is_admin() or (public.is_staff() and exists (
    select 1 from public.audits a
     where a.conversation_id = session_evaluations.conversation_id and a.auditor_id = public.current_domain_id())));

drop policy if exists eval_owner_read on public.session_evaluations;
create policy eval_owner_read on public.session_evaluations
  for select using (auditor_id = public.current_domain_id() and public.is_staff());

drop policy if exists eval_owner_insert on public.session_evaluations;
create policy eval_owner_insert on public.session_evaluations
  for insert with check (
    auditor_id = public.current_domain_id() and public.is_staff()
    and not public.conversation_finalized(conversation_id)
    and not public.my_audit_submitted(conversation_id)
  );

drop policy if exists eval_owner_update on public.session_evaluations;
create policy eval_owner_update on public.session_evaluations
  for update using (
    auditor_id = public.current_domain_id() and public.is_staff()
    and not public.conversation_finalized(conversation_id)
    and not public.my_audit_submitted(conversation_id)
  ) with check (
    auditor_id = public.current_domain_id() and public.is_staff()
    and not public.conversation_finalized(conversation_id)
    and not public.my_audit_submitted(conversation_id)
  );

drop policy if exists eval_owner_delete on public.session_evaluations;
create policy eval_owner_delete on public.session_evaluations
  for delete using (
    auditor_id = public.current_domain_id() and public.is_staff()
    and not public.conversation_finalized(conversation_id)
    and not public.my_audit_submitted(conversation_id)
  );

drop policy if exists inquiries_owner on public.inquiries;
create policy inquiries_owner on public.inquiries
  for all using (raised_by = public.current_domain_id() and public.is_staff())
  with check (raised_by = public.current_domain_id() and public.is_staff());

-- ── ② 상태값 ─────────────────────────────────────────────────────────────────────
alter table public.auditors drop constraint if exists auditors_status_check;
alter table public.auditors add constraint auditors_status_check
  check (status in ('active', 'suspended', 'revoked'));

alter table public.expert_applications drop constraint if exists expert_applications_status_check;
alter table public.expert_applications add constraint expert_applications_status_check
  check (status in ('pending', 'approved', 'rejected', 'withdrawn', 'revoked'));

create or replace function public.purge_stale_expert_applications()
  returns integer
  language plpgsql security definer set search_path = public
as $$
declare
  k integer;
begin
  delete from public.expert_applications
   where status in ('rejected', 'withdrawn', 'revoked')
     and decided_at < (extract(epoch from now() - interval '30 days') * 1000)::bigint;
  get diagnostics k = row_count;
  return k;
end;
$$;
revoke all on function public.purge_stale_expert_applications() from public, anon, authenticated;

-- ── ④ 영향 미리보기 ──────────────────────────────────────────────────────────────
create or replace function public.admin_expert_revoke_preview(p_domain text)
  returns jsonb
  language plpgsql stable security definer set search_path = public
as $$
declare
  v_uid uuid;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  select id into v_uid from public.profiles where domain_id = p_domain;
  return jsonb_build_object(
    'requestsPending', (select count(*) from public.consultation_requests where expert_id = p_domain and status = 'pending'),
    'requestsAccepted', (select count(*) from public.consultation_requests where expert_id = p_domain and status = 'accepted'),
    'offersPending', (select count(*) from public.consultation_offers
                       where expert_id = p_domain and status = 'pending' and expires_at > v_now),
    'roomsOpen', (select count(*) from public.consultation_rooms where expert_id = p_domain and status = 'open'),
    'auditsDraft', (select count(*) from public.audits where auditor_id = p_domain and status = 'draft'),
    'auditsSubmitted', (select count(*) from public.audits where auditor_id = p_domain and status in ('submitted', 'reviewed')),
    'expertCases', (select count(*) from kb3.documents
                     where corpus = 'kb3_expert' and status = 'active' and v_uid is not null and expert_id = v_uid),
    'sharedCases', (select count(*) from kb3.documents
                     where corpus = 'kb3_expert' and status = 'active' and v_uid is not null and expert_id = v_uid
                       and share_state = 'approved'),
    'ledgerEntries', (select count(*) from public.ledger_entries where auditor_id = p_domain)
  );
end;
$$;
revoke all on function public.admin_expert_revoke_preview(text) from public, anon;
grant execute on function public.admin_expert_revoke_preview(text) to authenticated;

-- ── ③ 승인 취소 ──────────────────────────────────────────────────────────────────
create or replace function public.revoke_expert(p_domain text, p_reason text)
  returns jsonb
  language plpgsql security definer set search_path = public
as $$
declare
  v_me      text := public.current_domain_id();
  v_now     bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_aud     public.auditors;
  v_prof    public.profiles;
  v_name    text;
  v_entry   jsonb;
  v_next    text;
  r_req     public.consultation_requests;
  r_offer   public.consultation_offers;
  r_room    public.consultation_rooms;
  r_task    public.audit_tasks;
  v_pickups jsonb;
  v_cancel  text[];
  n         jsonb := '{}'::jsonb;
  k         integer;
  c_decl    integer := 0;
  c_comp    integer := 0;
  c_offer   integer := 0;
  c_room    integer := 0;
  c_task    integer := 0;
  v_suffix  text := E'\n\nAI 상담 화면에서 다른 세무사에게 다시 상담을 신청할 수 있습니다.';
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if v_reason is null then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'reason too long' using errcode = '22023';
  end if;

  select * into v_aud from public.auditors where id = p_domain for update;
  if not found then
    raise exception 'expert not found' using errcode = 'P0002';
  end if;
  if v_aud.status = 'revoked' then
    raise exception 'expert already revoked' using errcode = '22023';
  end if;
  select * into v_prof from public.profiles where domain_id = p_domain for update;
  if not found or v_prof.role <> 'auditor' then
    raise exception 'only expert accounts can be revoked' using errcode = '22023';
  end if;
  v_name := coalesce(nullif(v_aud.display_name, ''), '담당');
  v_entry := jsonb_build_object('at', v_now, 'actor', v_me, 'note', 'expert_revoked');

  -- 상담 신청: 대기 → declined, 수락(진행 중) → completed. 고객에게는 중립 문구(D1).
  for r_req in
    select * from public.consultation_requests
     where expert_id = p_domain and status in ('pending', 'accepted')
     order by created_at for update
  loop
    v_next := case when r_req.status = 'pending' then 'declined' else 'completed' end;
    update public.consultation_requests
       set status = v_next,
           status_history = status_history || jsonb_build_array(v_entry || jsonb_build_object('status', v_next)),
           updated_at = v_now
     where id = r_req.id;
    if v_next = 'declined' then
      c_decl := c_decl + 1;
      perform public._consultation_mail(r_req.viewer_id, v_me,
        v_name || ' 세무사와 상담을 진행할 수 없게 되었습니다',
        '세무사 사정으로 ' || v_name || ' 세무사에게 보낸 상담 신청을 진행할 수 없게 되었습니다.' || v_suffix,
        r_req.id);
    else
      c_comp := c_comp + 1;
      perform public._consultation_mail(r_req.viewer_id, v_me,
        v_name || ' 세무사와의 상담이 종료되었습니다',
        '세무사 사정으로 ' || v_name || ' 세무사와의 상담이 종료되었습니다. 지금까지의 채팅 기록은 계속 볼 수 있습니다.'
          || v_suffix,
        r_req.id);
    end if;
  end loop;

  -- 연결 제안: 대기 → withdrawn(만료된 대기는 expired 로 확정만, 우편 없음).
  for r_offer in
    select * from public.consultation_offers
     where expert_id = p_domain and status = 'pending'
     order by created_at for update
  loop
    if r_offer.expires_at <= v_now then
      update public.consultation_offers
         set status = 'expired',
             status_history = status_history || jsonb_build_array(
               jsonb_build_object('status', 'expired', 'at', v_now, 'actor', 'system')),
             updated_at = v_now
       where id = r_offer.id;
    else
      update public.consultation_offers
         set status = 'withdrawn',
             status_history = status_history || jsonb_build_array(v_entry || jsonb_build_object('status', 'withdrawn')),
             updated_at = v_now
       where id = r_offer.id;
      c_offer := c_offer + 1;
      perform public._offer_mail(r_offer.viewer_id, v_me,
        v_name || ' 세무사의 연결 요청이 취소되었습니다',
        '세무사 사정으로 ' || v_name || ' 세무사가 보냈던 상담 연결 요청이 취소되었습니다.',
        r_offer.id);
    end if;
  end loop;

  -- 채팅방: 열린 방 닫기(메시지는 보존, 방 AI 도 열린 방에만 답한다).
  for r_room in
    select * from public.consultation_rooms
     where expert_id = p_domain and status = 'open'
     order by created_at for update
  loop
    update public.consultation_rooms set status = 'closed', closed_at = v_now where id = r_room.id;
    c_room := c_room + 1;
    perform public._room_mail(r_room.viewer_id, v_me,
      v_name || ' 세무사와의 채팅방이 종료되었습니다',
      '세무사 사정으로 ' || v_name || ' 세무사와의 채팅방이 종료되었습니다. 지금까지의 대화는 계속 볼 수 있습니다.'
        || v_suffix,
      r_room.id);
  end loop;

  -- 검수: 진행 중(draft) → cancelled. 제출·검토 중인 건은 관리자가 계속 처리한다(확정 시 기여 적립).
  with x as (
    update public.audits set status = 'cancelled'
     where auditor_id = p_domain and status = 'draft'
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_cancel from x;

  -- 이 사람의 audit 이 전부 취소된 일감은 픽업 슬롯을 반납한다(releasePickup 과 같은 상태 재계산).
  for r_task in
    select t.* from public.audit_tasks t
     where t.status <> 'closed'
       and exists (select 1 from jsonb_array_elements(t.pickups) p where p ->> 'auditorId' = p_domain)
       and not exists (select 1 from public.audits a
                        where a.task_id = t.id and a.auditor_id = p_domain and a.status <> 'cancelled')
     for update
  loop
    select coalesce(jsonb_agg(p), '[]'::jsonb) into v_pickups
      from jsonb_array_elements(r_task.pickups) p where p ->> 'auditorId' <> p_domain;
    update public.audit_tasks
       set pickups = v_pickups,
           status = case when jsonb_array_length(v_pickups) = 0 then 'open'
                         when jsonb_array_length(v_pickups) >= capacity then 'full'
                         else 'in_progress' end
     where id = r_task.id;
    c_task := c_task + 1;
  end loop;

  -- 세무사 카드(소개·연락처) 삭제.
  delete from public.expert_profiles where auditor_id = p_domain;

  -- 세무사 사례: 전용 RAG·공용 승인분 모두 archived(D4, 되돌릴 수 있음). 공유 대기는 rejected.
  update kb3.documents
     set share_state = case when share_state = 'pending' then 'rejected' else share_state end,
         share_note = case when share_state = 'pending' then 'expert_revoked' else share_note end,
         share_reviewed_at = case when share_state = 'pending' then v_now else share_reviewed_at end,
         share_reviewed_by = case when share_state = 'pending' then v_me else share_reviewed_by end,
         status = 'archived',
         updated_at = v_now
   where corpus = 'kb3_expert' and status = 'active' and expert_id = v_prof.id;
  get diagnostics k = row_count;

  -- 신청서: 가장 최근 승인 건 → revoked(사유는 신청자에게 보인다). 30일 뒤 파기.
  update public.expert_applications
     set status = 'revoked', reject_reason = v_reason, updated_at = v_now, decided_at = v_now,
         status_history = status_history || jsonb_build_array(
           jsonb_build_object('status', 'revoked', 'at', v_now, 'actor', v_me, 'note', v_reason))
   where id = (select id from public.expert_applications
                where applicant_domain = p_domain and status = 'approved'
                order by created_at desc limit 1);

  -- 레지스트리: 행은 남기고(상담·원장 FK) 연락처 비움. 이름은 과거 기록 표시용으로 유지.
  update public.auditors
     set status = 'revoked', email = '', phone = null,
         note = coalesce(nullif(note, '') || E'\n', '')
                || '[승인 취소 ' || to_char(to_timestamp(v_now / 1000.0) at time zone 'Asia/Seoul', 'YYYY-MM-DD')
                || '] ' || v_reason
   where id = p_domain;

  -- 역할 강등(0047 guard 는 호출자가 admin 이라 통과).
  update public.profiles set role = 'user' where id = v_prof.id;

  n := jsonb_build_object(
    'requestsDeclined', c_decl, 'requestsCompleted', c_comp, 'offersWithdrawn', c_offer,
    'roomsClosed', c_room, 'auditsCancelled', coalesce(array_length(v_cancel, 1), 0),
    'pickupsReleased', c_task, 'expertCasesArchived', k
  );
  return n;
end;
$$;
revoke all on function public.revoke_expert(text, text) from public, anon;
grant execute on function public.revoke_expert(text, text) to authenticated;

-- ── ⑤ 재승인 — revoked 행이면 재활성(0049 본문 + 분기) ─────────────────────────────
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
  v_prev   text;
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
    select status into v_prev from public.auditors where id = v_row.applicant_domain for update;
    if found and v_prev <> 'revoked' then
      raise exception 'an expert record already exists for this account' using errcode = '23505';
    end if;
    update public.profiles
       set role = 'auditor', label = v_row.name, display_name = v_row.name
     where domain_id = v_row.applicant_domain;
    if v_prev = 'revoked' then
      -- 승인 취소됐던 세무사의 재승인: 같은 행을 되살려 원장·검수 이력을 잇는다(D5).
      update public.auditors
         set display_name = v_row.name, email = v_row.email, phone = v_row.phone,
             qualifications = array['세무사'], status = 'active',
             note = coalesce(nullif(note, '') || E'\n', '')
                    || '[재승인 ' || to_char(to_timestamp(v_now / 1000.0) at time zone 'Asia/Seoul', 'YYYY-MM-DD') || ']'
                    || coalesce(' ' || v_note, '')
       where id = v_row.applicant_domain;
    else
      insert into public.auditors (id, display_name, email, phone, qualifications, status, created_at, note)
      values (v_row.applicant_domain, v_row.name, v_row.email, v_row.phone, array['세무사'], 'active', v_now, v_note);
    end if;
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
