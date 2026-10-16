-- 0058 — 옛 검수 흐름 절단 S4: 남길 DB 함수 고치기 + 실시간 정리 (2026-10-16) — design/옛검수흐름_절단_로드맵_1016.md
--
-- 전제: S2(d1a791c) 로 프론트는 옛 테이블을 구독·조회하지 않는다(Realtime 바인딩 9개, 운영 번들 grep 0).
--       S3(86fc41e) 로 백엔드에 옛 테이블을 쓰는 API 가 없다. 0057 로 옛 cron 두 개는 이미 멈췄다.
-- 운영 DB 읽기 확인(10/16, 이 파일 작성 전):
--   · publication supabase_realtime = 19개 — 옛 10개 + 남길 9개(auditors·consultation_messages·offers·requests·rooms·
--     conversations·ledger_entries·mail·room_agent_runs, 프론트 바인딩과 같다)
--   · 아래 지울 보조 함수를 참조하는 정책은 옛 테이블 위 9개뿐(②), 옛 테이블 밖 정책·뷰가 옛 테이블을 읽는 곳 0
--   · 옛 테이블을 본문에서 읽는 함수 = 이 파일이 고치는 5개 + 지우는 보조 함수 + rag.match_passages
--   · 옛 테이블 ↔ 남길 테이블 FK 0(rag.passage_edges/edits → rag.passages cascade 만)
--   · 사용자 트리거 중 옛 것 = conversations_snapshot_immutable 하나(ledger 0056 트리거·우편·방 트리거는 무관)
--
-- 하는 일:
--   ① 남길 함수 다시 정의 — list_experts · can_staff_read_conversation · _purge_account · admin_expert_revoke_preview ·
--      revoke_expert 에서 옛 테이블 참조를 뺀다(plpgsql/sql 본문은 의존성 추적이 안 돼 S6 에서 테이블을 옮기면 호출 때 터진다)
--   ② 옛 테이블 위 정책 9개 삭제(③의 보조 함수에 걸려 있다). 옛 테이블은 RLS 가 켜진 채 쓰기 정책이 사라져
--      세무사 쓰기가 막힌다(쓰는 화면 없음). 읽기·관리자 정책은 그대로 둔다 — 테이블과 함께 S6 에서 정리
--   ③ 스냅샷 트리거·함수, 옛 RLS 보조 함수, rag.rebuild_passage_edges 삭제(CASCADE 없음 — 예상 못 한 의존이 있으면
--      이 파일 전체가 실패하고 아무것도 안 바뀐다)
--   ④ Realtime publication 에서 옛 테이블 10개 제거
-- 안 하는 일: 테이블·칸(snapshot_*)·인덱스 삭제(S6 archive) · rag.match_passages(retriever 의 rag/fusion 갈래가 아직
--   부른다 — 운영 RAG_SOURCE=kb3 라 호출 0 이지만 .env 되돌리기 값이 fusion. 답변 경로라 S5 에서 갈래와 함께 지운다)
-- 되돌리기: 0040·0050·0051·0054 의 함수 본문, 0011·0012·0013·0050 의 정책, 0006 의 트리거·함수, 0018 의 함수,
--   `alter publication supabase_realtime add table ...`

-- ── ① 남길 함수 ──────────────────────────────────────────────────────────────────

-- list_experts(0054): 시그니처·반환 열 그대로(프론트 ExpertCard Zod 가 두 칸을 요구), 검수 이력은 0 / false.
--   카드의 '상담 검수 N건'·'이 상담 검수' 표시는 값이 0/false 라 저절로 사라진다.
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
    0,
    false,
    b.instant_connect
  from base b
$$;
revoke all on function public.list_experts(text) from public;
grant execute on function public.list_experts(text) to anon, authenticated;

-- can_staff_read_conversation(0040): 갈래 ① 내 검수 ② 열린 일감 을 뺀다. ③ 방 ④ 상담 신청만.
-- ★ conversations_staff_read 정책이 이 함수 하나로 판정한다. 여기서 오류가 나면 conversations Realtime 이벤트가
--   **모든 구독자에게서** 사라진다(0040 ★). 그래서 남는 두 테이블만 읽고, anon 실행권·로그인 전 false 를 그대로 둔다.
create or replace function public.can_staff_read_conversation(p_conversation_id text)
  returns boolean
  language plpgsql stable security definer set search_path = public
as $$
declare
  v_me   text := public.current_domain_id();
  v_role public.app_role;
begin
  if v_me is null or p_conversation_id is null then
    return false;
  end if;
  v_role := public.current_role();
  if v_role = 'admin' then
    return true;
  end if;
  -- 사장님은 본인 정책(conversations_owner)으로만 읽는다.
  if v_role is distinct from 'auditor' then
    return false;
  end if;
  return exists (select 1 from public.consultation_rooms r
                  where r.conversation_id = p_conversation_id and r.expert_id = v_me)
      or exists (select 1 from public.consultation_requests q
                  where q.conversation_id = p_conversation_id and q.expert_id = v_me);
end;
$$;
revoke all on function public.can_staff_read_conversation(text) from public;
grant execute on function public.can_staff_read_conversation(text) to anon, authenticated;

-- _purge_legacy_review_rows — 회원 탈퇴 때 옛 검수 테이블에 남은 이 고객 대화 유래 행을 지운다.
--   옛 테이블에는 고객 질문·답변 원문(rag.passages 번들·pool_candidates 첫 질문)과 그 대화에 단 코멘트가 남아 있어,
--   _purge_account 에서 줄만 빼면 "탈퇴 = 즉시 파기"(/privacy §3)가 깨진다. 그래서 정적 참조 대신 이 함수가
--   테이블이 있는 자리(제자리 또는 S6 의 archive 스키마)를 to_regclass 로 찾아 동적으로 지운다 —
--   테이블을 옮기거나 지워도(S6·11/5 DROP) 오류 없이 남은 곳만 지우고, 다 없어지면 아무 일도 안 한다.
--   S6 에서 archive 안 이름을 바꾸면 이 함수의 후보 이름도 같이 고친다.
create or replace function public._purge_legacy_review_rows(p_convs text[])
  returns jsonb
  language plpgsql security definer set search_path = public
as $$
declare
  v_total  integer := 0;
  k        integer;
  t        text;
  v_rel    regclass;
  v_audits regclass := coalesce(to_regclass('public.audits'), to_regclass('archive.audits'));
begin
  if coalesce(cardinality(p_convs), 0) = 0 then
    return jsonb_build_object('legacy_review_rows', 0);
  end if;

  -- 검수 결과는 audit_id 로만 대화에 닿으므로 audits 보다 먼저.
  v_rel := coalesce(to_regclass('public.reviews'), to_regclass('archive.reviews'));
  if v_rel is not null and v_audits is not null then
    execute format('delete from %s where audit_id in (select id from %s where conversation_id = any($1))', v_rel, v_audits)
      using p_convs;
    get diagnostics k = row_count; v_total := v_total + k;
  end if;

  foreach t in array array['line_feedback', 'session_evaluations', 'audits', 'pool_candidates'] loop
    v_rel := coalesce(to_regclass('public.' || t), to_regclass('archive.' || t));
    if v_rel is not null then
      execute format('delete from %s where conversation_id = any($1)', v_rel) using p_convs;
      get diagnostics k = row_count; v_total := v_total + k;
    end if;
  end loop;

  -- 옛 KB passage(질문+답변+코멘트 번들). edges·edits 는 cascade.
  v_rel := coalesce(to_regclass('rag.passages'), to_regclass('archive.passages'));
  if v_rel is not null then
    execute format('delete from %s where conversation_id = any($1)', v_rel) using p_convs;
    get diagnostics k = row_count; v_total := v_total + k;
  end if;

  -- 일감은 행을 남기고 이 대화 id 만 뺀다.
  v_rel := coalesce(to_regclass('public.audit_tasks'), to_regclass('archive.audit_tasks'));
  if v_rel is not null then
    execute format('update %s set conversation_ids = array(select x from unnest(conversation_ids) x where x <> all($1)) '
                   'where conversation_ids && $1', v_rel) using p_convs;
  end if;

  return jsonb_build_object('legacy_review_rows', v_total);
end;
$$;
revoke all on function public._purge_legacy_review_rows(text[]) from public, anon, authenticated;

-- _purge_account(0051): 옛 테이블 정적 참조를 위 함수 한 줄로. rag.chat_turns 삭제(답변 계측)는 그대로.
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

  -- 매 턴 답변 계측(0027).
  delete from rag.chat_turns where conversation_id = any(convs);

  -- 옛 검수 흐름(하차장·검수·KB passage)에 남은 이 고객 대화 유래 행 — 0058 _purge_legacy_review_rows.
  n := n || public._purge_legacy_review_rows(convs);

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

  -- 세무사 에이전트 설정(0044)과 세무사 사례(kb3_expert) — 0051. 원장 행(크레딧)은 auditors 와 같이 남긴다.
  delete from public.expert_agents where expert_id = uid;
  delete from kb3.documents where corpus = 'kb3_expert' and expert_id = uid;
  get diagnostics k = row_count; n := n || jsonb_build_object('expert_cases', k);

  -- 대화 원문. 풀 동의·열람 기록·제안·방은 cascade.
  delete from public.conversations where owner_id = p_domain;
  get diagnostics k = row_count; n := n || jsonb_build_object('conversations', k);

  -- 계정(auth.identities·profiles cascade).
  delete from auth.users where id = uid;
  return n;
end;
$$;
revoke all on function public._purge_account(text) from public, anon, authenticated;

-- admin_expert_revoke_preview(0050): auditsDraft·auditsSubmitted 칸 제거(화면은 S1 에서 이미 숨김).
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

-- revoke_expert(0050): 검수 draft 취소·일감 슬롯 반납 단계와 `r_task public.audit_tasks` 행 타입 선언 제거.
--   반환에서 auditsCancelled·pickupsReleased 제거. 나머지 전이(신청·제안·방·카드·사례·신청서·레지스트리·역할)는 그대로.
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
  k         integer;
  c_decl    integer := 0;
  c_comp    integer := 0;
  c_offer   integer := 0;
  c_room    integer := 0;
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

  return jsonb_build_object(
    'requestsDeclined', c_decl, 'requestsCompleted', c_comp, 'offersWithdrawn', c_offer,
    'roomsClosed', c_room, 'expertCasesArchived', k
  );
end;
$$;
revoke all on function public.revoke_expert(text, text) from public, anon;
grant execute on function public.revoke_expert(text, text) to authenticated;

-- ── ② 옛 테이블 위 정책 중 ③의 보조 함수에 걸린 9개 ──────────────────────────────────
drop policy if exists audits_member_read      on public.audits;              -- my_conversation_ids (0011)
drop policy if exists reviews_auditor_read    on public.reviews;             -- is_review_member (0011)
drop policy if exists reviews_auditor_seen    on public.reviews;
drop policy if exists feedback_owner_insert   on public.line_feedback;       -- conversation_finalized·my_audit_submitted (0050)
drop policy if exists feedback_owner_update   on public.line_feedback;
drop policy if exists feedback_owner_delete   on public.line_feedback;
drop policy if exists eval_owner_insert       on public.session_evaluations;
drop policy if exists eval_owner_update       on public.session_evaluations;
drop policy if exists eval_owner_delete       on public.session_evaluations;

-- ── ③ 스냅샷 트리거·함수, 옛 보조 함수 (CASCADE 없음) ─────────────────────────────────
drop trigger if exists conversations_snapshot_immutable on public.conversations;
drop function if exists public.enforce_snapshot_immutable();
drop function if exists public.snapshot_settled_conversations();
drop function if exists public.is_review_member(text);       -- 본문이 my_conversation_ids 를 부르므로 먼저
drop function if exists public.my_conversation_ids();
drop function if exists public.conversation_finalized(text);
drop function if exists public.my_audit_submitted(text);
drop function if exists rag.rebuild_passage_edges(integer);

-- ── ④ Realtime publication 에서 옛 테이블 10개 ─────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['audit_tasks', 'audits', 'inquiries', 'line_feedback', 'model_versions',
                           'pool_candidates', 'reviews', 'session_evaluations', 'settlement_rounds',
                           'training_batches'] loop
    if exists (select 1 from pg_publication_tables
                where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime drop table public.%I', t);
    end if;
  end loop;
end $$;
