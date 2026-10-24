-- 0061 사용 현황 모니터링 M1 — 방문·유입 기록(analytics.events) (2026-10-21)
--
-- 근거: design/관리자_사용현황_모니터링_대시보드_설계_1021.md §2.3 · §3 M1.
-- 목적: 커뮤니티 게시 링크(utm·/r/코드)로 들어온 방문 → 첫 질문 → 세무사 카드 노출·클릭 → 로그인/가입 을
--   방문자(브라우저) 단위로 이어 본다. 지금까지 방문·referrer·UTM 기록은 0 이었다.
--
-- 하는 일:
--   ① analytics 스키마 · events 표(1st-party, IP·UA 원문 없음) · campaigns 표(단축 코드 → 채널 이름, 관리자가 채움)
--   ② public.analytics_track(p_events jsonb) — anon 도 실행(챗이 비로그인). 화이트리스트·길이·크기 검증,
--      한 번에 ≤20건, 방문자당 24시간 ≤500건(넘으면 조용히 버림), user_id 는 클라이언트 값이 아니라 auth.uid().
--   ③ 180일 지난 행 파기(pg_cron 매일 04:00 KST)
--   ④ 회원 탈퇴 시 그 회원의 user_id 를 지운다(_purge_account 는 고치지 않고 FK on delete set null 로)
-- 안 하는 일: 관리자 집계 RPC·화면(M3), chat_turns 보강·질문 원문(M2, 0062).
-- 읽기: 표 정책 0 · anon/authenticated 권한 0 → 관리자도 security definer RPC(M3)로만 읽는다. 지금 확인은 SQL 편집기로.
-- 되돌리기: drop function public.analytics_track(jsonb); drop function public.purge_old_analytics_events();
--   cron.unschedule('purge-old-analytics-events'); drop schema analytics cascade;

-- ── ① 스키마·표 ───────────────────────────────────────────────────────────────
create schema if not exists analytics;
revoke all on schema analytics from public, anon, authenticated;

create table if not exists analytics.events (
  id               bigint generated always as identity primary key,
  ts               timestamptz not null default now(),
  visitor_id       text not null check (char_length(visitor_id) between 8 and 64),
  session_id       text not null check (char_length(session_id) between 8 and 64),
  user_id          uuid references auth.users(id) on delete set null,
  event            text not null check (event in (
                     'visit',            -- 세션(30분 무활동 기준) 시작
                     'chat_started',     -- 대화의 첫 질문 전송 — conversation_id 로 rag.chat_turns 와 잇는다
                     'handoff_shown',    -- 세무사 연결 카드가 화면에 나옴
                     'handoff_open',     -- "세무사 보기"·"세무사와 상담 이어가기" 를 펼침
                     'handoff_click',    -- 연결/신청 버튼(회원) 또는 "로그인하고 연결"(비회원)
                     'auth'              -- 로그인 완료(가입 직후면 props.is_new = true, 서버가 판정)
                   )),
  path             text check (char_length(path) <= 200),
  conversation_id  text check (char_length(conversation_id) <= 100),
  -- 이 방문자의 첫 유입(first-touch). 매 행에 복사해 집계를 단순하게 한다.
  ft_source        text check (char_length(ft_source) <= 80),
  ft_medium        text check (char_length(ft_medium) <= 80),
  ft_campaign      text check (char_length(ft_campaign) <= 80),
  ft_ref           text check (char_length(ft_ref) <= 40),          -- /r/<코드> 의 코드
  ft_referrer_host text check (char_length(ft_referrer_host) <= 120),
  device           text check (device in ('mobile', 'desktop')),
  props            jsonb not null default '{}'::jsonb check (octet_length(props::text) <= 2000)
);
create index if not exists events_ts_idx on analytics.events (ts desc);
create index if not exists events_visitor_ts_idx on analytics.events (visitor_id, ts desc);
create index if not exists events_event_ts_idx on analytics.events (event, ts desc);
create index if not exists events_conversation_idx on analytics.events (conversation_id) where conversation_id is not null;
create index if not exists events_user_idx on analytics.events (user_id) where user_id is not null;
alter table analytics.events enable row level security;
revoke all on analytics.events from public, anon, authenticated;

-- 단축 코드(/r/<code>) → 채널. 게시 링크를 만들 때 관리자가 넣는다(지금은 SQL, M3 에서 화면).
create table if not exists analytics.campaigns (
  code        text primary key check (code ~ '^[a-z0-9_-]{1,40}$'),
  source      text not null,          -- 예: apsa(아프니까 사장이다) · kyungrinara(경리나라)
  medium      text not null default 'community',
  campaign    text,                   -- 게시글 단위
  label       text,                   -- 사람이 읽는 설명
  created_at  timestamptz not null default now()
);
alter table analytics.campaigns enable row level security;
revoke all on analytics.campaigns from public, anon, authenticated;

-- ── ② 기록 RPC ─────────────────────────────────────────────────────────────────
-- p_events = [{visitor_id, session_id, event, path?, conversation_id?, ft:{source,medium,campaign,ref,referrer_host}?, device?, props?}]
-- 잘못된 항목은 통째로 거르지 않고 그 항목만 버린다(화면에 영향 0 이 원칙 — 클라이언트는 결과를 보지 않는다).
create or replace function public.analytics_track(p_events jsonb)
  returns integer
  language plpgsql volatile security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_ev    jsonb;
  v_vid   text;
  v_name  text;
  v_props jsonb;
  v_ft    jsonb;
  v_n     integer := 0;
  v_recent integer;
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    return 0;
  end if;
  for v_ev in select value from jsonb_array_elements(p_events) with ordinality as e(value, i) where i <= 20 loop
    if jsonb_typeof(v_ev) <> 'object' then continue; end if;
    v_vid  := v_ev->>'visitor_id';
    v_name := v_ev->>'event';
    if v_vid is null or char_length(v_vid) not between 8 and 64
       or coalesce(char_length(v_ev->>'session_id'), 0) not between 8 and 64
       or v_name is null or v_name not in ('visit', 'chat_started', 'handoff_shown', 'handoff_open', 'handoff_click', 'auth') then
      continue;
    end if;
    select count(*) into v_recent from analytics.events
     where visitor_id = v_vid and ts > now() - interval '24 hours';
    if v_recent >= 500 then continue; end if;

    v_props := case when jsonb_typeof(v_ev->'props') = 'object' then v_ev->'props' else '{}'::jsonb end;
    if octet_length(v_props::text) > 2000 then v_props := '{}'::jsonb; end if;
    if v_name = 'auth' then
      -- 가입 여부·경로는 클라이언트 말을 믿지 않고 서버에서 판정한다. 로그인이 아니면 기록하지 않는다.
      if v_uid is null then continue; end if;
      v_props := v_props - 'is_new' - 'provider' - 'role' || jsonb_build_object(
        'is_new', coalesce((select u.created_at > now() - interval '15 minutes' from auth.users u where u.id = v_uid), false),
        'provider', (select i.provider from auth.identities i where i.user_id = v_uid order by i.provider limit 1),
        'role', (select p.role::text from public.profiles p where p.id = v_uid));
    end if;
    v_ft := case when jsonb_typeof(v_ev->'ft') = 'object' then v_ev->'ft' else '{}'::jsonb end;

    insert into analytics.events (visitor_id, session_id, user_id, event, path, conversation_id,
                                  ft_source, ft_medium, ft_campaign, ft_ref, ft_referrer_host, device, props)
    values (v_vid, v_ev->>'session_id', v_uid, v_name,
            left(split_part(v_ev->>'path', '?', 1), 200),
            left(v_ev->>'conversation_id', 100),
            left(v_ft->>'source', 80), left(v_ft->>'medium', 80), left(v_ft->>'campaign', 80),
            case when v_ft->>'ref' ~ '^[a-z0-9_-]{1,40}$' then v_ft->>'ref' end,
            left(v_ft->>'referrer_host', 120),
            case when v_ev->>'device' in ('mobile', 'desktop') then v_ev->>'device' end,
            v_props);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.analytics_track(jsonb) from public;
grant execute on function public.analytics_track(jsonb) to anon, authenticated;

-- ── ③ 보관 180일 ───────────────────────────────────────────────────────────────
create or replace function public.purge_old_analytics_events()
  returns integer
  language plpgsql volatile security definer set search_path = public
as $$
declare
  k integer;
begin
  delete from analytics.events where ts < now() - interval '180 days';
  get diagnostics k = row_count;
  return k;
end;
$$;
revoke all on function public.purge_old_analytics_events() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'purge-old-analytics-events') then
      perform cron.unschedule('purge-old-analytics-events');
    end if;
    -- 매일 04:00 KST
    perform cron.schedule('purge-old-analytics-events', '0 19 * * *',
      $cron$select public.purge_old_analytics_events()$cron$);
  end if;
end $$;
