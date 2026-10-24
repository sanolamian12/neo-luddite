-- 0064 사용 현황 M3 — 관리자 대시보드 읽기 RPC · 게시 코드 등록 (2026-10-24)
--
-- 근거: design/관리자_사용현황_모니터링_대시보드_설계_1021.md §2.6 · §3 M3.
-- 하는 일: 0061 analytics.events · 0063 rag.chat_turns 새 칸 · analytics.questions · consultation_requests 를
--   방문자(브라우저) → 첫 유입 경로로 묶어 관리자 화면 /admin/usage 2판이 읽는다. 표·데이터는 바꾸지 않는다(읽기 + campaigns 쓰기만).
--
-- 집계 규칙(모든 RPC 공통 — analytics._visitors 등 내부 함수 한 곳):
--   · 제외 방문자 = 세무사·관리자로 로그인한 적이 있는 브라우저(auth 이벤트 role 또는 profiles.role),
--     데모 사장님(domain_id viewer·owner2·owner3·owner4)으로 로그인한 적이 있는 브라우저. 그 브라우저의 로그인 **전** 행까지 뺀다.
--   · 경로 = ft_ref 가 campaigns 에 있으면 그 source → ft_source(utm) → 직전 사이트 호스트 묶음 → direct.
--     등록 안 된 코드만 있으면 'unregistered'(코드를 나중에 등록하면 지난 방문도 그 경로로 바뀐다 — 조회 때 분류).
--     방문자의 경로 = 경로 정보가 있는 첫 행(직접 방문으로 시작해 나중에 링크로 들어오면 그 링크).
--   · 챗 = rag.chat_turns 중 channel='chat' 이고 방문 기록(conversation_id)과 이어진 턴만. 잇지 못한 턴은 따로 센다(unattributedTurns).
--   · 날짜는 KST. 기간 = 오늘 포함 p_days 일(1~180), 직전 기간 = 그 앞 같은 길이.
--   · 세무사 카드 퍼널은 화면 쪽 이벤트(handoff_shown·open·click) 기준 — chat_turns.handoff_reason 은 10/24 부터만 있다.
--   · 연결 성립 = consultation_requests 행(신청·즉시 연결 모두. 즉시 = status_history 첫 항목 note '즉시 연결').
--
-- 권한: 내부 함수(analytics._*)는 실행 권한 0. 공개 RPC 는 security definer + is_admin() 검사, authenticated 에만 실행 권한.
-- admin_usage_overview(0049)는 그대로 둔다.
-- 되돌리기: drop function public.admin_traffic_overview(integer, text), public.admin_question_stats(integer, text),
--   public.admin_question_feed(integer, text, text, text[], integer, integer), public.admin_handoff_demand(integer, text),
--   public.admin_list_campaigns(), public.admin_save_campaign(text, text, text, text),
--   analytics._requests(), analytics._conv_visitor(), analytics._visitors(), analytics._excluded_visitors(),
--   analytics.source_of(text, text, text), analytics.host_group(text), analytics._since(integer);

-- ── 경로 분류 ─────────────────────────────────────────────────────────────────
-- 직전 사이트 호스트 → 묶음 이름. 모르는 곳은 www./m. 을 뗀 호스트 그대로.
create or replace function analytics.host_group(p_host text)
  returns text
  language sql immutable
as $$
  select case
    when h is null or h = '' then null
    when h in ('cafe.naver.com', 'm.cafe.naver.com') then 'naver_cafe'
    when h like '%search.naver.com' then 'naver_search'
    when h like 'blog.naver.com' or h like 'm.blog.naver.com' then 'naver_blog'
    when h = 'naver.com' or h like '%.naver.com' or h like '%naver.me' then 'naver'
    when h in ('cafe.daum.net', 'm.cafe.daum.net') then 'daum_cafe'
    when h = 'daum.net' or h like '%.daum.net' then 'daum'
    when h like '%kakao.com' or h like '%kakao.co.kr' then 'kakao'
    when h like '%band.us' then 'band'
    when h ~ '(^|\.)google\.[a-z.]+$' or h like 'com.google.%' then 'google'
    when h ~ '(^|\.)(facebook\.com|fb\.com|fb\.me)$' then 'facebook'
    when h ~ '(^|\.)instagram\.com$' then 'instagram'
    when h ~ '(^|\.)(youtube\.com|youtu\.be)$' then 'youtube'
    when h ~ '(^|\.)threads\.(net|com)$' then 'threads'
    when h ~ '(^|\.)(t\.co|x\.com|twitter\.com)$' then 'x'
    when h ~ '(^|\.)bing\.com$' then 'bing'
    else regexp_replace(h, '^(www|m)\.', '')
  end
  from (select lower(btrim(p_host)) as h) x
$$;

-- 한 행의 첫 유입 칸 → 경로. campaigns 를 보므로 stable.
create or replace function analytics.source_of(p_ref text, p_source text, p_host text)
  returns text
  language sql stable
as $$
  select coalesce(
    (select c.source from analytics.campaigns c where c.code = p_ref),
    nullif(lower(btrim(p_source)), ''),
    analytics.host_group(p_host),
    case when p_ref is not null then 'unregistered' end,
    'direct')
$$;

-- 기간 시작(KST 자정). p_days = 1 이면 오늘 0시.
create or replace function analytics._since(p_days integer)
  returns timestamptz
  language sql stable
as $$
  select ((now() at time zone 'Asia/Seoul')::date - (p_days - 1))::timestamp at time zone 'Asia/Seoul'
$$;

-- ── 방문자·대화·연결 ─────────────────────────────────────────────────────────────
create or replace function analytics._excluded_visitors()
  returns table (visitor_id text)
  language sql stable
as $$
  select distinct e.visitor_id
    from analytics.events e
    left join public.profiles p on p.id = e.user_id
   where (e.event = 'auth' and e.props->>'role' in ('auditor', 'admin'))
      or p.role in ('auditor', 'admin')
      or p.domain_id in ('viewer', 'owner2', 'owner3', 'owner4')
$$;

-- 집계에 넣는 방문자와 그 경로. campaign = 등록 코드의 campaign → utm_campaign → 코드.
create or replace function analytics._visitors()
  returns table (visitor_id text, source text, campaign text, first_ts timestamptz)
  language sql stable
as $$
  with excluded as (select * from analytics._excluded_visitors()),
  firsts as (
    select e.visitor_id, min(e.ts) as first_ts
      from analytics.events e
      left join excluded x on x.visitor_id = e.visitor_id
     where x.visitor_id is null
     group by e.visitor_id
  ),
  touch as (
    select distinct on (e.visitor_id) e.visitor_id, e.ft_ref, e.ft_source, e.ft_campaign, e.ft_referrer_host
      from analytics.events e
     where e.ft_ref is not null or e.ft_source is not null or e.ft_referrer_host is not null
     order by e.visitor_id, e.ts, e.id
  )
  select f.visitor_id,
         analytics.source_of(t.ft_ref, t.ft_source, t.ft_referrer_host),
         coalesce((select c.campaign from analytics.campaigns c where c.code = t.ft_ref), t.ft_campaign, t.ft_ref),
         f.first_ts
    from firsts f
    left join touch t on t.visitor_id = f.visitor_id
$$;

-- 대화 → 방문자(그 대화가 처음 나온 이벤트의 방문자). 제외 방문자 대화도 남긴다 — 걸러 내는 건 _visitors 조인.
create or replace function analytics._conv_visitor()
  returns table (conversation_id text, visitor_id text)
  language sql stable
as $$
  select distinct on (e.conversation_id) e.conversation_id, e.visitor_id
    from analytics.events e
   where e.conversation_id is not null
   order by e.conversation_id, e.ts, e.id
$$;

-- 연결(상담 요청). 방문자 = 대화로 찾고, 못 찾으면 신청한 회원이 로그인했던 첫 브라우저.
-- 데모 사장님·직원 계정의 요청은 뺀다.
create or replace function analytics._requests()
  returns table (id text, created_ts timestamptz, conversation_id text, visitor_id text, status text, instant boolean, expert_id text)
  language sql stable
as $$
  with cv as (select * from analytics._conv_visitor()),
  uv as (
    select distinct on (e.user_id) e.user_id, e.visitor_id
      from analytics.events e where e.user_id is not null
     order by e.user_id, e.ts, e.id
  )
  select r.id,
         to_timestamp(r.created_at / 1000.0),
         r.conversation_id,
         coalesce(cv.visitor_id, uv.visitor_id),
         r.status,
         coalesce(r.status_history->0->>'note' = '즉시 연결', false),
         r.expert_id
    from public.consultation_requests r
    left join public.profiles p on p.domain_id = r.viewer_id
    left join cv on cv.conversation_id = r.conversation_id
    left join uv on uv.user_id = p.id
   where r.viewer_id not in ('viewer', 'owner2', 'owner3', 'owner4')
     and coalesce(p.role::text, 'user') = 'user'
$$;

revoke all on function analytics.host_group(text), analytics.source_of(text, text, text), analytics._since(integer),
  analytics._excluded_visitors(), analytics._visitors(), analytics._conv_visitor(), analytics._requests()
  from public, anon, authenticated;

-- ── ① 방문·퍼널·경로 ────────────────────────────────────────────────────────────
-- KPI(이번·직전 기간) · 퍼널(방문자 단위) · 경로표(경로·campaign) · 일별 · 지금 접속 중(10분).
create or replace function public.admin_traffic_overview(p_days integer default 30, p_source text default null)
  returns jsonb
  language plpgsql stable security definer set search_path = public
as $$
declare
  v_days  integer := greatest(1, least(coalesce(p_days, 30), 180));
  v_from  timestamptz;
  v_prev  timestamptz;
  v_out   jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  v_from := analytics._since(v_days);
  v_prev := v_from - make_interval(days => v_days);

  with vis as (
    select * from analytics._visitors() v where p_source is null or v.source = p_source
  ),
  ev as (
    select e.ts, e.event, e.visitor_id, e.session_id, e.conversation_id, e.props, e.user_id
      from analytics.events e join vis on vis.visitor_id = e.visitor_id
     where e.ts >= v_prev
  ),
  conv as (
    select cv.conversation_id, cv.visitor_id
      from analytics._conv_visitor() cv join vis on vis.visitor_id = cv.visitor_id
  ),
  turns as (
    select to_timestamp(t.created_at / 1000.0) as ts, conv.visitor_id, t.conversation_id
      from rag.chat_turns t join conv on conv.conversation_id = t.conversation_id
     where t.channel = 'chat' and t.created_at >= (extract(epoch from v_prev) * 1000)::bigint
  ),
  req as (
    select r.* from analytics._requests() r join vis on vis.visitor_id = r.visitor_id
     where r.created_ts >= v_prev
  ),
  -- 방문자 × 기간(cur/prev) 사실표
  facts as (
    select vis.visitor_id, vis.source, vis.campaign, w.period,
      exists (select 1 from ev where ev.visitor_id = vis.visitor_id and ev.ts >= w.f and ev.ts < w.t) as visited,
      (select count(distinct ev.conversation_id) from ev where ev.visitor_id = vis.visitor_id and ev.event = 'chat_started' and ev.ts >= w.f and ev.ts < w.t) as sessions,
      (select count(*) from turns where turns.visitor_id = vis.visitor_id and turns.ts >= w.f and turns.ts < w.t) as questions,
      exists (select 1 from ev where ev.visitor_id = vis.visitor_id and ev.event = 'handoff_shown' and ev.ts >= w.f and ev.ts < w.t) as shown,
      (select count(distinct coalesce(ev.conversation_id, ev.session_id)) from ev where ev.visitor_id = vis.visitor_id and ev.event = 'handoff_click' and ev.ts >= w.f and ev.ts < w.t) as clicks,
      (select count(distinct ev.user_id) from ev where ev.visitor_id = vis.visitor_id and ev.event = 'auth' and (ev.props->>'is_new')::boolean
         and coalesce(ev.props->>'role', 'user') = 'user' and ev.ts >= w.f and ev.ts < w.t) as signups,
      (select count(*) from req where req.visitor_id = vis.visitor_id and req.created_ts >= w.f and req.created_ts < w.t) as connections
    from vis
    cross join (values ('cur', v_from, now() + interval '1 minute'), ('prev', v_prev, v_from)) as w(period, f, t)
  ),
  kpi as (
    select period,
      jsonb_build_object(
        'visitors', count(*) filter (where visited),
        'sessions', coalesce(sum(sessions), 0),
        'questions', coalesce(sum(questions), 0),
        'signups', coalesce(sum(signups), 0),
        'handoffClicks', coalesce(sum(clicks), 0),
        'connections', coalesce(sum(connections), 0)) as j
      from facts group by period
  ),
  cur as (select * from facts where period = 'cur' and (visited or sessions > 0 or questions > 0 or connections > 0)),
  src as (
    select source, campaign,
           grouping(campaign) as is_total,
           count(*) filter (where visited) as visitors,
           count(*) filter (where sessions > 0) as asked,
           sum(sessions) as sessions, sum(questions) as questions, sum(signups) as signups,
           count(*) filter (where clicks > 0) as clicked, sum(connections) as connections
      from cur group by grouping sets ((source), (source, campaign))
  ),
  days as (
    select d::date as day from generate_series((now() at time zone 'Asia/Seoul')::date - (v_days - 1),
                                                (now() at time zone 'Asia/Seoul')::date, interval '1 day') d
  ),
  daily_ev as (
    select (ev.ts at time zone 'Asia/Seoul')::date as day,
           count(distinct ev.visitor_id) as visitors,
           count(distinct ev.conversation_id) filter (where ev.event = 'chat_started') as sessions,
           count(distinct ev.user_id) filter (where ev.event = 'auth' and (ev.props->>'is_new')::boolean and coalesce(ev.props->>'role', 'user') = 'user') as signups,
           count(distinct coalesce(ev.conversation_id, ev.session_id)) filter (where ev.event = 'handoff_click') as clicks
      from ev where ev.ts >= v_from group by 1
  ),
  daily_t as (select (ts at time zone 'Asia/Seoul')::date as day, count(*) as questions from turns where ts >= v_from group by 1),
  daily_r as (select (created_ts at time zone 'Asia/Seoul')::date as day, count(*) as connections from req where created_ts >= v_from group by 1)
  select jsonb_build_object(
    'days', v_days,
    'source', p_source,
    'from', (extract(epoch from v_from) * 1000)::bigint,
    'generatedAt', (extract(epoch from now()) * 1000)::bigint,
    'trackingSince', (select (extract(epoch from min(ts)) * 1000)::bigint from analytics.events),
    'liveNow', (select count(distinct e.visitor_id) from analytics.events e join vis on vis.visitor_id = e.visitor_id
                 where e.ts >= now() - interval '10 minutes'),
    'kpi', coalesce((select j from kpi where period = 'cur'), '{}'::jsonb),
    'prev', coalesce((select j from kpi where period = 'prev'), '{}'::jsonb),
    'funnel', jsonb_build_object(
      'visitors', (select count(*) from cur where visited),
      'asked', (select count(*) from cur where sessions > 0),
      'shown', (select count(*) from cur where shown),
      'clicked', (select count(*) from cur where clicks > 0),
      'connected', (select count(*) from cur where connections > 0),
      'signedUp', (select count(*) from cur where signups > 0)),
    'sources', (select coalesce(jsonb_agg(jsonb_build_object(
                  'source', s.source,
                  'visitors', s.visitors, 'asked', s.asked, 'sessions', s.sessions, 'questions', s.questions,
                  'signups', s.signups, 'clicked', s.clicked, 'connections', s.connections,
                  'campaigns', (select coalesce(jsonb_agg(jsonb_build_object(
                                  'campaign', c.campaign,
                                  'visitors', c.visitors, 'asked', c.asked, 'sessions', c.sessions, 'questions', c.questions,
                                  'signups', c.signups, 'clicked', c.clicked, 'connections', c.connections
                                ) order by c.visitors desc, c.campaign), '[]'::jsonb)
                                  from src c where c.is_total = 0 and c.source = s.source and c.campaign is not null)
                ) order by s.visitors desc, s.source), '[]'::jsonb)
                  from src s where s.is_total = 1),
    'daily', (select jsonb_agg(jsonb_build_object(
                'day', to_char(days.day, 'YYYY-MM-DD'),
                'visitors', coalesce(de.visitors, 0), 'sessions', coalesce(de.sessions, 0),
                'questions', coalesce(dt.questions, 0), 'signups', coalesce(de.signups, 0),
                'clicks', coalesce(de.clicks, 0), 'connections', coalesce(dr.connections, 0)
              ) order by days.day)
                from days left join daily_ev de on de.day = days.day
                          left join daily_t dt on dt.day = days.day
                          left join daily_r dr on dr.day = days.day),
    -- 방문 기록과 잇지 못한 고객 챗 턴(경로 필터와 무관하게 전체) — 팀 브라우저·자동 러너·기록 시작 전 대화.
    'unattributedTurns', (select count(*) from rag.chat_turns t
                            left join (select distinct e.conversation_id from analytics.events e where e.conversation_id is not null) k
                              on k.conversation_id = t.conversation_id
                           where t.channel = 'chat' and t.created_at >= (extract(epoch from v_from) * 1000)::bigint
                             and k.conversation_id is null)
  ) into v_out;
  return v_out;
end;
$$;

-- ── ② 질문 분포 ─────────────────────────────────────────────────────────────────
-- 세목·질문유형·답변 결과(outcome 원값 — 묶음은 화면 lib/outcome-groups.ts 한 곳).
create or replace function public.admin_question_stats(p_days integer default 30, p_source text default null)
  returns jsonb
  language plpgsql stable security definer set search_path = public
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 30), 180));
  v_from timestamptz;
  v_out  jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  v_from := analytics._since(v_days);
  with vis as (
    select * from analytics._visitors() v where p_source is null or v.source = p_source
  ),
  t as (
    select ct.conversation_id, ct.outcome, ct.tax_topic, ct.question_type, ct.handoff_reason
      from rag.chat_turns ct
      join analytics._conv_visitor() cv on cv.conversation_id = ct.conversation_id
      join vis on vis.visitor_id = cv.visitor_id
     where ct.channel = 'chat' and ct.created_at >= (extract(epoch from v_from) * 1000)::bigint
  )
  select jsonb_build_object(
    'days', v_days,
    'total', (select count(*) from t),
    'sessions', (select count(distinct conversation_id) from t),
    'unclassified', (select count(*) from t where tax_topic is null and question_type is null),
    'byTopic', (select coalesce(jsonb_object_agg(k, n), '{}') from (select coalesce(tax_topic, '') k, count(*) n from t group by 1) x),
    'byType', (select coalesce(jsonb_object_agg(k, n), '{}') from (select coalesce(question_type, '') k, count(*) n from t group by 1) x),
    'byOutcome', (select coalesce(jsonb_object_agg(k, n), '{}') from (select coalesce(outcome, 'unknown') k, count(*) n from t group by 1) x),
    -- 대화당 질문 수 분포(1·2·3·4·5+)
    'perSession', (select coalesce(jsonb_object_agg(b, n), '{}') from (
                     select least(c, 5)::text b, count(*) n from (select count(*) c from t group by conversation_id) s group by 1) x)
  ) into v_out;
  return v_out;
end;
$$;

-- ── ③ 최근 질문 목록 ────────────────────────────────────────────────────────────
-- p_topic: 세목('' = 분류 없음) · p_outcomes: outcome 원값 목록(화면이 묶음을 풀어 넘긴다). null = 거르지 않음.
create or replace function public.admin_question_feed(
  p_days integer default 30, p_source text default null, p_topic text default null,
  p_outcomes text[] default null, p_limit integer default 30, p_offset integer default 0
)
  returns jsonb
  language plpgsql stable security definer set search_path = public
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 30), 180));
  v_from timestamptz;
  v_out  jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  v_from := analytics._since(v_days);
  with vis as (
    select * from analytics._visitors() v where p_source is null or v.source = p_source
  ),
  q as (
    select qu.id, qu.created_at, qu.conversation_id, qu.text_masked, vis.source, vis.campaign,
           ct.tax_topic, ct.question_type, ct.outcome,
           exists (select 1 from analytics.events e where e.event = 'handoff_click' and e.conversation_id = qu.conversation_id) as clicked
      from analytics.questions qu
      join analytics._conv_visitor() cv on cv.conversation_id = qu.conversation_id
      join vis on vis.visitor_id = cv.visitor_id
      left join lateral (select t.tax_topic, t.question_type, t.outcome from rag.chat_turns t
                          where t.message_id = qu.message_id limit 1) ct on true
     where qu.created_at >= v_from
       and (p_topic is null or coalesce(ct.tax_topic, '') = p_topic)
       and (p_outcomes is null or coalesce(ct.outcome, 'unknown') = any (p_outcomes))
  )
  select jsonb_build_object(
    'total', (select count(*) from q),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
               'id', x.id, 'at', (extract(epoch from x.created_at) * 1000)::bigint,
               'conversationId', x.conversation_id, 'source', x.source, 'campaign', x.campaign,
               'taxTopic', x.tax_topic, 'questionType', x.question_type, 'outcome', x.outcome,
               'text', x.text_masked, 'clicked', x.clicked) order by x.created_at desc, x.id desc), '[]'::jsonb)
               from (select * from q order by created_at desc, id desc
                      limit greatest(1, least(coalesce(p_limit, 30), 100)) offset greatest(0, coalesce(p_offset, 0))) x)
  ) into v_out;
  return v_out;
end;
$$;

-- ── ④ 세무사 연결 수요 ────────────────────────────────────────────────────────────
-- 화면 이벤트 퍼널(AI 제안 카드 / 직접 펼침 · 회원 / 비회원) + 서버 기록 사유별 노출→클릭(10/24~) + 최근 요청 목록.
create or replace function public.admin_handoff_demand(p_days integer default 30, p_source text default null)
  returns jsonb
  language plpgsql stable security definer set search_path = public
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 30), 180));
  v_from timestamptz;
  v_out  jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  v_from := analytics._since(v_days);
  with vis as (
    select * from analytics._visitors() v where p_source is null or v.source = p_source
  ),
  ev as (
    select e.* from analytics.events e join vis on vis.visitor_id = e.visitor_id
     where e.ts >= v_from and e.event in ('handoff_shown', 'handoff_open', 'handoff_click')
  ),
  -- 대화 단위: AI 제안 카드가 떴나 · 펼쳤나 · 클릭했나(회원 여부는 클릭 시점)
  c as (
    select coalesce(conversation_id, session_id) as k,
           bool_or(event = 'handoff_shown' and (props->>'ai')::boolean) as shown_ai,
           bool_or(event = 'handoff_shown') as shown,
           bool_or(event = 'handoff_open') as opened,
           bool_or(event = 'handoff_click') as clicked,
           bool_or(event = 'handoff_click' and (props->>'member')::boolean) as clicked_member,
           bool_or(event = 'handoff_click' and (props->>'instant')::boolean) as clicked_instant
      from ev group by 1
  ),
  req as (
    select r.* from analytics._requests() r join vis on vis.visitor_id = r.visitor_id where r.created_ts >= v_from
  ),
  rs as (
    select ct.handoff_reason as reason, ct.conversation_id
      from rag.chat_turns ct
      join analytics._conv_visitor() cv on cv.conversation_id = ct.conversation_id
      join vis on vis.visitor_id = cv.visitor_id
     where ct.channel = 'chat' and ct.handoff_reason is not null
       and ct.created_at >= (extract(epoch from v_from) * 1000)::bigint
     group by 1, 2
  )
  select jsonb_build_object(
    'days', v_days,
    'funnel', jsonb_build_object(
      'shown', (select count(*) from c where shown),
      'shownAi', (select count(*) from c where shown_ai),
      'opened', (select count(*) from c where opened),
      'clicked', (select count(*) from c where clicked),
      'clickedMember', (select count(*) from c where clicked_member),
      'clickedGuest', (select count(*) from c where clicked and not coalesce(clicked_member, false)),
      'clickedInstant', (select count(*) from c where clicked_instant),
      'requests', (select count(*) from req),
      'requestsInstant', (select count(*) from req where instant)),
    'byReason', (select coalesce(jsonb_agg(jsonb_build_object(
                   'reason', x.reason, 'conversations', x.n, 'clicked', x.clicked) order by x.n desc, x.reason), '[]'::jsonb)
                   from (select rs.reason, count(*) n,
                                count(*) filter (where exists (select 1 from analytics.events e
                                                                where e.event = 'handoff_click' and e.conversation_id = rs.conversation_id)) clicked
                           from rs group by rs.reason) x),
    'byStatus', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from req group by 1) x),
    'recent', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', r.id, 'at', (extract(epoch from r.created_ts) * 1000)::bigint,
                 'source', vis.source, 'campaign', vis.campaign,
                 'taxTopic', (select t.tax_topic from rag.chat_turns t where t.conversation_id = r.conversation_id and t.tax_topic is not null
                               order by t.created_at desc limit 1),
                 'instant', r.instant, 'status', r.status,
                 'expertName', a.display_name,
                 'virtualExpert', r.expert_id in ('auditor', 'auditor2', 'auditor3') or coalesce(a.display_name like '%(AI)', false)
               ) order by r.created_ts desc), '[]'::jsonb)
                 from (select * from req order by created_ts desc limit 20) r
                 join vis on vis.visitor_id = r.visitor_id
                 left join public.auditors a on a.id = r.expert_id)
  ) into v_out;
  return v_out;
end;
$$;

-- ── ⑤ 게시 코드(/r/<code>) ─────────────────────────────────────────────────────
create or replace function public.admin_list_campaigns()
  returns jsonb
  language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return (
    with vis as (
      select v.visitor_id, t.ft_ref
        from analytics._visitors() v
        join lateral (select e.ft_ref from analytics.events e where e.visitor_id = v.visitor_id and e.ft_ref is not null
                       order by e.ts limit 1) t on true
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'code', c.code, 'source', c.source, 'medium', c.medium, 'campaign', c.campaign, 'label', c.label,
             'createdAt', (extract(epoch from c.created_at) * 1000)::bigint,
             'visitors', (select count(*) from vis where vis.ft_ref = c.code)
           ) order by c.created_at desc, c.code), '[]'::jsonb)
      from analytics.campaigns c
  );
end;
$$;

-- 추가 또는 고침(같은 코드면 채널·글 이름을 바꾼다 — 지난 방문도 조회 때 새 이름으로 분류된다).
create or replace function public.admin_save_campaign(p_code text, p_source text, p_campaign text default null, p_label text default null)
  returns jsonb
  language plpgsql volatile security definer set search_path = public
as $$
declare
  v_code   text := lower(btrim(coalesce(p_code, '')));
  v_source text := lower(btrim(coalesce(p_source, '')));
  v_row    analytics.campaigns;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if v_code !~ '^[a-z0-9_-]{1,40}$' then raise exception 'invalid code' using errcode = '22023'; end if;
  if v_source !~ '^[a-z0-9_-]{1,40}$' then raise exception 'invalid source' using errcode = '22023'; end if;
  insert into analytics.campaigns (code, source, campaign, label)
  values (v_code, v_source, nullif(left(btrim(p_campaign), 80), ''), nullif(left(btrim(p_label), 120), ''))
  on conflict (code) do update set source = excluded.source, campaign = excluded.campaign, label = excluded.label
  returning * into v_row;
  return jsonb_build_object('code', v_row.code, 'source', v_row.source, 'campaign', v_row.campaign, 'label', v_row.label);
end;
$$;

revoke all on function public.admin_traffic_overview(integer, text), public.admin_question_stats(integer, text),
  public.admin_question_feed(integer, text, text, text[], integer, integer), public.admin_handoff_demand(integer, text),
  public.admin_list_campaigns(), public.admin_save_campaign(text, text, text, text)
  from public, anon;
grant execute on function public.admin_traffic_overview(integer, text), public.admin_question_stats(integer, text),
  public.admin_question_feed(integer, text, text, text[], integer, integer), public.admin_handoff_demand(integer, text),
  public.admin_list_campaigns(), public.admin_save_campaign(text, text, text, text)
  to authenticated;
