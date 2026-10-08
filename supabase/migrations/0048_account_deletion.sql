-- ════════════════════════════════════════════════════════════════════════════
-- 회원 탈퇴 — 계정과 그 계정의 상담 기록을 한 트랜잭션에서 파기 (2026-10-08)
-- ════════════════════════════════════════════════════════════════════════════
-- 개인정보처리방침(/privacy) §3 "회원 탈퇴 시 지체 없이 파기 · KB 에 반영된 질문도 삭제" 의 구현.
--
-- 왜 함수가 필요한가: 상담 데이터는 auth.users 가 아니라 텍스트 domain_id(owner_id·viewer_id…)로
-- 묶여 있어 auth.users 를 지워도 profiles 만 따라 지워지고 나머지는 고아로 남는다.
--
-- ① _purge_account(domain_id) — 내부용. 고객 대화와 거기서 파생된 것(검수 기록·KB passage·
--    상담 신청/방/메시지·풀 동의·우편)을 지우고 마지막에 auth.users 를 지운다(profiles 는 cascade).
--    세무사 정산 원장(ledger_entries)은 고객 내용이 없어 남긴다(세무사 본인의 기록).
-- ② delete_my_account() — 고객(role user) 본인 탈퇴. 세무사·관리자 계정은 관리자 경로로만.
-- ③ admin_delete_account(domain_id) — 관리자가 고객 계정을 파기(이메일 요청 처리용).
-- ════════════════════════════════════════════════════════════════════════════

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

  -- 대화 원문(스냅샷 포함). 풀 동의·열람 기록·제안·방은 cascade.
  delete from public.conversations where owner_id = p_domain;
  get diagnostics k = row_count; n := n || jsonb_build_object('conversations', k);

  -- 계정(auth.identities·profiles cascade).
  delete from auth.users where id = uid;
  return n;
end;
$$;
revoke all on function public._purge_account(text) from public, anon, authenticated;

create or replace function public.delete_my_account()
  returns jsonb
  language plpgsql security definer set search_path = public
as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if me.role <> 'user' then
    raise exception 'staff accounts are removed by an administrator' using errcode = '42501';
  end if;
  return public._purge_account(me.domain_id);
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

create or replace function public.admin_delete_account(p_domain text)
  returns jsonb
  language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if exists (select 1 from public.profiles where domain_id = p_domain and role = 'admin') then
    raise exception 'admin accounts cannot be removed here' using errcode = '42501';
  end if;
  return public._purge_account(p_domain);
end;
$$;
revoke all on function public.admin_delete_account(text) from public, anon;
grant execute on function public.admin_delete_account(text) to authenticated;
