-- 0065 사용 현황 M3 고침 — 대화의 질문은 그 대화가 방문 기록에 처음 나온 뒤 것만 센다 (2026-10-24)
--
-- 근거: 0064 운영 확인(check_0064) — 직전 7일 칸이 방문자 0·세션 0 인데 질문 1.
--   0064 는 대화 → 방문자를 "그 대화가 처음 나온 이벤트" 로 잇고 그 대화의 턴을 기간 제한 없이 귀속했다.
--   회원이 방문 기록 시작(10/21) 전 옛 대화를 다시 열어 카드 이벤트가 찍히면 옛 턴까지 그 방문자 몫이 됐다.
-- 고침: analytics._conv_visitor 에 first_ts(그 대화가 이벤트에 처음 나온 시각)를 더하고, 질문(chat_turns·analytics.questions)은
--   first_ts - 1분 이후 것만 센다(chat_started 는 첫 질문 전송 때 나가고 턴은 답 뒤에 기록되므로 새 대화는 빠지지 않는다).
--   admin_traffic_overview · admin_question_stats · admin_question_feed · admin_handoff_demand 를 그 조건으로 다시 만든다(본문은 0064 + 조건만).
--   권한은 create or replace 라 0064 그대로(authenticated 실행 · is_admin 검사).
-- 되돌리기: 0064 의 ①~④ 함수 본문과 _conv_visitor 를 다시 실행.

-- 반환 칸이 바뀌어 다시 만든다(_requests 는 SQL 본문이라 의존 기록이 없다 — 칸 이름 그대로 쓴다).
drop function if exists analytics._conv_visitor();
create function analytics._conv_visitor()
  returns table (conversation_id text, visitor_id text, first_ts timestamptz)
  language sql stable
as $$
  select distinct on (e.conversation_id) e.conversation_id, e.visitor_id, e.ts
    from analytics.events e
   where e.conversation_id is not null
   order by e.conversation_id, e.ts, e.id
$$;
revoke all on function analytics._conv_visitor() from public, anon, authenticated;

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
    select cv.conversation_id, cv.visitor_id, cv.first_ts
      from analytics._conv_visitor() cv join vis on vis.visitor_id = cv.visitor_id
  ),
  turns as (
    select to_timestamp(t.created_at / 1000.0) as ts, conv.visitor_id, t.conversation_id
      from rag.chat_turns t join conv on conv.conversation_id = t.conversation_id
                                   and t.created_at >= (extract(epoch from conv.first_ts) * 1000)::bigint - 60000
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
                                        and ct.created_at >= (extract(epoch from cv.first_ts) * 1000)::bigint - 60000
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
                                        and qu.created_at >= cv.first_ts - interval '1 minute'
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
                                        and ct.created_at >= (extract(epoch from cv.first_ts) * 1000)::bigint - 60000
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

