-- ════════════════════════════════════════════════════════════════════════════
-- 회원 탈퇴 보강 — 세무사 에이전트 설정·세무사 사례 삭제 (2026-10-09, 승인 취소 설계 D6)
-- ════════════════════════════════════════════════════════════════════════════
-- 설계: design/세무사_승인취소_강등_설계.md §0 부수 발견 · §7 D6
-- _purge_account 를 0049 본문 그대로 두고 두 줄만 더한다:
--   expert_agents.expert_id 는 auth.users FK 가 없어 탈퇴 뒤 고아 행이 남았고,
--   kb3.documents.expert_id 는 on delete set null 이라 공용 승인된 세무사 사례가 "[세무사 사례 · 이름]"
--   머리줄째 공용 KB 에 남았다. 회원 탈퇴 = 즉시 파기(/privacy §3)에 맞춰 함께 지운다.
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

  -- 세무사 에이전트 설정(0044)과 세무사 사례(kb3_expert, 0042·0043) — 둘 다 auth uid 키라 계정 삭제로
  -- 따라 지워지지 않는다(expert_agents 는 FK 없음 → 고아 행, kb3.documents 는 set null → 작성자 이름이 박힌
  -- 카드가 공용 KB 에 남음). 계정과 함께 지운다. chunks 는 cascade. 원장 행(크레딧)은 auditors 와 같이 남긴다.
  delete from public.expert_agents where expert_id = uid;
  delete from kb3.documents where corpus = 'kb3_expert' and expert_id = uid;
  get diagnostics k = row_count; n := n || jsonb_build_object('expert_cases', k);

  -- 대화 원문(스냅샷 포함). 풀 동의·열람 기록·제안·방은 cascade.
  delete from public.conversations where owner_id = p_domain;
  get diagnostics k = row_count; n := n || jsonb_build_object('conversations', k);

  -- 계정(auth.identities·profiles cascade).
  delete from auth.users where id = uid;
  return n;
end;
$$;
revoke all on function public._purge_account(text) from public, anon, authenticated;
