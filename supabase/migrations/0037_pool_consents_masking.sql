-- ════════════════════════════════════════════════════════════════════════════
-- 인앱 상담사 채팅 (a) — 풀 노출 동의 · 규칙 마스킹 · 비식별 사례 풀
-- ════════════════════════════════════════════════════════════════════════════
-- 설계: design/인앱상담사채팅_상담사풀_설계.md §2 D1·D4, §3.1~3.3
--
-- ① conversation_pool_consents — 동의와 비식별 사본이 한 행에. 대화 1건 · 7일 만료 · 언제든 철회.
--    풀 노출 조건 = revoked_at is null and expires_at > now. 별도 플래그를 두지 않는다.
--    원문(conversations.payload)과 분리 저장 → 풀은 이 테이블만 읽는다.
--    세무사는 이 테이블을 직접 못 읽는다(정책 없음) — list_pool_cases()/open_pool_case() 로만.
-- ② pool_case_views — 풀 사례를 연 세무사 기록(사용자 결정 2026-09-21: 기록만, 고객엔 비공개).
--    쓰기는 open_pool_case() 안에서만, 읽기는 admin 만.
-- ③ mask_conversation_payload(jsonb) — 규칙 마스킹(D1: LLM 없음·결정적). {payload, report}.
-- ④ grant/revoke_pool_consent, preview_pool_mask — 동의·마스킹·등재를 한 트랜잭션에.
--    클라이언트가 마스킹을 건너뛰고 등재할 경로가 없다(0034 list_experts 와 같은 판단).
-- ⑤ list_pool_cases() / open_pool_case(id) — 세무사·admin 전용, 원문 테이블 미조인.
-- ════════════════════════════════════════════════════════════════════════════

-- ── ① 동의 + 비식별 사본 ─────────────────────────────────────────────────────────
create table public.conversation_pool_consents (
  conversation_id  text primary key references public.conversations (id) on delete cascade,
  viewer_id        text not null,                 -- 동의한 사장님 domain_id
  granted_at       bigint not null,
  expires_at       bigint not null,               -- granted_at + 7일
  revoked_at       bigint,                        -- 철회 시각(= 즉시 풀에서 내려감)
  masked_payload   jsonb,                         -- 마스킹된 Conversation — 풀에 보이는 전부. 철회 시 비운다
  mask_report      jsonb not null default '{}'::jsonb,  -- {규칙: 건수}
  masked_at        bigint not null,               -- 마스킹 시각(= 얼린 시점)
  -- 목록 메타 — 원문 테이블을 조인하지 않으려고 동의 시점에 함께 얼린다(제목은 마스킹 후).
  occupation       text,
  tax_category     text,
  title            text
);
create index pool_consents_viewer_idx on public.conversation_pool_consents (viewer_id);
create index pool_consents_active_idx on public.conversation_pool_consents (expires_at)
  where revoked_at is null;

alter table public.conversation_pool_consents enable row level security;

-- 사장님: 본인 동의만 조회. 쓰기는 grant/revoke RPC 로만(insert/update 정책 없음).
create policy pool_consents_viewer_read on public.conversation_pool_consents
  for select using (viewer_id = public.current_domain_id());

create policy pool_consents_admin_all on public.conversation_pool_consents
  for all using (public.is_admin()) with check (public.is_admin());

-- ── ② 풀 열람 기록 ───────────────────────────────────────────────────────────────
create table public.pool_case_views (
  conversation_id  text not null references public.conversations (id) on delete cascade,
  auditor_id       text not null,
  first_viewed_at  bigint not null,
  last_viewed_at   bigint not null,
  view_count       integer not null default 1,
  primary key (conversation_id, auditor_id)
);

alter table public.pool_case_views enable row level security;

create policy pool_case_views_admin_read on public.pool_case_views
  for select using (public.is_admin());

-- ── ③ 규칙 마스킹 ────────────────────────────────────────────────────────────────
-- 문자열 하나를 마스킹. 규칙 순서가 중요하다: 이메일(숫자 포함) → 주민 → 카드 → 사업자 →
-- 계좌 → 전화 → 주소 → 상호 → 이름. 앞 규칙이 치환한 자리는 뒤 규칙이 다시 못 잡는다.
--
-- 음성(지우면 안 되는 것)을 지키는 장치:
--   · 숫자 규칙은 앞뒤에 숫자·쉼표·점이 붙으면 잡지 않는다 → `1,000-2,000`·`0.010` 보호
--   · 계좌는 은행명·계좌·통장이 12자 안에 앞설 때만, 날짜(YYYY-MM-DD) 모양은 제외
--   · 상호·이름은 후보를 찾은 뒤 일반명사 목록(종합병원·국회의원·공동대표·여러분…)으로 거른다
--   · 세법 조문(제33조 제1항)·연도·판례번호(2019두12345)는 어떤 규칙에도 안 걸리는 모양이다
create or replace function public._pool_mask_text(p_text text)
  returns table (masked text, report jsonb)
  language plpgsql immutable set search_path = public
as $$
declare
  t   text := p_text;
  r   jsonb := '{}'::jsonb;
  n   integer;
  m   text[];
  cand text;
  cands text[];
  rule record;
  shop_stop text[] := array[
    '종합','대학','대학교','요양','개인','동물','한방','양방','국회','치과','일반','동네','전문',
    '해당','기존','신규','소형','대형','지역','근처','인근','다른','같은','공공','국립','시립',
    '도립','구립','군립','보건','협력','상급','상급종합','한','의','치','병','약','세무','동일',
    '각','타','본','모','그','이','저','새','첫','큰','소아','어린이','여성','재활','정신','노인',
    '한의','의과','수의','개원','폐업','신설','인수','문전','시','도','구','군','동물','주변',
    '가까운','유명','대표','전국','여러','모든','어느','무슨','우리','우리동네','1차','2차','3차'
  ];
  name_stop text[] := array[
    '여러분','한동안','이번엔','공동체','구체적','전체적','정기적','전반적','이사회'
  ];
begin
  if t is null or t = '' then
    masked := t; report := r; return next; return;
  end if;

  -- 모양이 고정된 규칙(정규식 한 번). 계좌는 은행명 앞말(\1)을 살려 둔다.
  for rule in
    select * from (values
      (1, '이메일',
          '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}',
          '[이메일]'),
      (2, '주민번호',
          '(?<![0-9])[0-9]{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])\s?-?\s?[1-4][0-9]{6}(?![0-9])',
          '[주민번호]'),
      (3, '카드',
          '(?<![0-9])[0-9]{4}[- ][0-9]{4}[- ][0-9]{4}[- ][0-9]{4}(?![0-9])',
          '[카드]'),
      (4, '사업자번호',
          '(?<![0-9.]|[0-9],)[0-9]{3}-[0-9]{2}-[0-9]{5}(?![0-9]|,[0-9])',
          '[사업자번호]'),
      (5, '계좌',
          '((은행|뱅크|농협|신협|새마을금고|우체국|수협|계좌|통장|국민|신한|우리|하나|기업|카카오|토스|씨티|SC제일)[^0-9\n]{0,12})'
          || '(?!(19|20)[0-9]{2}-[0-9]{1,2}-[0-9]{1,2}(?![0-9]))'
          || '[0-9]{2,6}-[0-9]{2,6}-[0-9]{2,8}(-[0-9]{1,3})?(?![0-9])',
          '\1[계좌]'),
      (6, '전화',
          '(?<![0-9.]|[0-9],)01[016-9][-. ]?[0-9]{3,4}[-. ]?[0-9]{4}(?![0-9]|,[0-9])',
          '[전화]'),
      (7, '전화',
          '(?<![0-9.]|[0-9],)\(?0(2|[3-6][1-5]|70)\)?[-. )]\s?[0-9]{3,4}[-. ][0-9]{4}(?![0-9]|,[0-9])',
          '[전화]'),
      (8, '주소',
          '(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[가-힣]*\s+'
          || '([가-힣]+(시|군|구)\s+){1,2}[가-힣0-9]+(?<!으)(로|길)\s?[0-9]+(-[0-9]+)?(번길\s?[0-9]+(-[0-9]+)?)?',
          '[주소]'),
      (9, '주소',
          '[가-힣]+(시|군|구)\s+[가-힣0-9]+(?<!으)(로|길)\s?[0-9]+(-[0-9]+)?(번길\s?[0-9]+(-[0-9]+)?)?'
          || '(?![0-9]|\s?(%|년|개|곳|명|억|만|원|천|배|차|회|위|등|세|월|일|분))',
          '[주소]'),
      (10, '주소',
          '[가-힣]+(동|읍|면|리)\s?[0-9]+(-[0-9]+)?\s?번지',
          '[주소]')
    ) as v(ord, name, pat, rep)
    order by ord
  loop
    n := regexp_count(t, rule.pat);
    if n > 0 then
      t := regexp_replace(t, rule.pat, rule.rep, 'g');
      r := r || jsonb_build_object(rule.name, coalesce((r ->> rule.name)::int, 0) + n);
    end if;
  end loop;

  -- 상호·병원명: 이름 + 업종 접미. 후보를 모은 뒤 일반명사 앞말은 거른다.
  cands := '{}';
  for m in
    select regexp_matches(t,
      '(^|[^가-힣A-Za-z0-9])([가-힣A-Za-z0-9]{1,12})(한의원|치과의원|치과병원|의원|병원|치과|약국|세무사무소|세무회계|세무법인|회계법인)'
      || '(?=$|[^가-힣A-Za-z0-9]|에서|에게|에|의|은|는|이|가|을|를|과|와|도|으로|로|만|이나|이라|이고|인데|입니다|이에요|예요|이며|처럼|까지|부터|원장|대표|측|쪽)',
      'g')
  loop
    if not (m[2] = any(shop_stop)) and m[2] !~ '^[0-9]+$' then
      cands := array_append(cands, m[2] || m[3]);
    end if;
  end loop;
  for cand in select c from (select distinct x as c from unnest(cands) x) d order by length(c) desc, c loop
    n := (length(t) - length(replace(t, cand, ''))) / length(cand);
    if n > 0 then
      t := replace(t, cand, '[상호]');
      r := r || jsonb_build_object('상호', coalesce((r ->> '상호')::int, 0) + n);
    end if;
  end loop;

  -- 사람 이름: 성 + 두 글자 + 직함/씨. 이름 자체를 [이름]으로(직함은 남긴다 — 읽히게).
  -- 같은 이름이 직함 없이 다시 나와도 함께 가려진다(전역 치환).
  cands := '{}';
  for m in
    select regexp_matches(t,
      '(^|[^가-힣])(남궁|황보|제갈|선우|독고|서문|사공|[김이박최정강조윤장임한오서신권황안송류유전홍고문양손배백허남심노하곽성차주우구민진나엄원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예경봉사부가복태목형피두감음빈동온호범좌팽승간상시갈])'
      || '([가-힣]{2})(\s?)(원장|대표|실장|사장|과장|부장|팀장|차장|이사|씨)'
      || '(?=$|[^가-힣]|님|께|이|가|은|는|을|를|의|과|와|도|에게|한테|로|으로|만)',
      'g')
  loop
    -- 띄어 쓴 경우 끝 글자가 조사면 명사+조사다("공간이 원장", "명의가 원장님").
    -- '은'은 빼지 않는다: 이름 끝(지은·하은)에 흔해서, 빼면 실명이 샌다("인정은 원장" 과잉 마스킹은 감수).
    if not ((m[2] || m[3]) = any(name_stop))
       and m[3] !~ '[의적는를을에들께로분]$'
       and not (m[4] <> '' and m[3] ~ '[이가는과와도만]$') then
      cands := array_append(cands, m[2] || m[3]);
    end if;
  end loop;
  -- 반대 방향: 직함 + 띄움 + 이름("원장 김철수입니다"). 자기소개에 흔하다.
  -- 오탐이 더 쉬운 방향이라 조건을 좁힌다: 이름 바로 뒤에 서술어·호칭·문장부호가 와야 하고
  -- (띄움만으로는 안 됨 — "세무사 연결해 주세요"), 끝 글자가 조사·용언 어미면 버린다("원장 소득이").
  for m in
    select regexp_matches(t,
      '(원장|대표|실장|사장|과장|부장|팀장|차장|이사)\s'
      || '(남궁|황보|제갈|선우|독고|서문|사공|[김이박최정강조윤장임한오서신권황안송류유전홍고문양손배백허남심노하곽성차주우구민진나엄원천방공현함변염여추도소석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예경봉사부가복태목형피두감음빈동온호범좌팽승간상시갈])'
      || '([가-힣]{2})'
      || '(?=$|[^가-힣\s]|입니다|이고|이며|이에요|예요|이라고|님|씨|께서|에게|한테)',
      'g')
  loop
    if not ((m[2] || m[3]) = any(name_stop))
       and m[3] !~ '[의적는를을에들께로분이가과와도만해했하한할함히]$' then
      cands := array_append(cands, m[2] || m[3]);
    end if;
  end loop;
  for cand in select c from (select distinct x as c from unnest(cands) x) d order by length(c) desc, c loop
    n := (length(t) - length(replace(t, cand, ''))) / length(cand);
    if n > 0 then
      t := replace(t, cand, '[이름]');
      r := r || jsonb_build_object('이름', coalesce((r ->> '이름')::int, 0) + n);
    end if;
  end loop;

  masked := t; report := r; return next;
end;
$$;
revoke all on function public._pool_mask_text(text) from public, anon, authenticated;

-- {규칙: 건수} 두 개를 더한다.
create or replace function public._pool_report_add(a jsonb, b jsonb)
  returns jsonb
  language sql immutable set search_path = public
as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
  from (
    select k, sum(v)::int as v
    from (
      select key as k, value::int as v from jsonb_each_text(coalesce(a, '{}'::jsonb))
      union all
      select key, value::int from jsonb_each_text(coalesce(b, '{}'::jsonb))
    ) x group by k
  ) y
$$;
revoke all on function public._pool_report_add(jsonb, jsonb) from public, anon, authenticated;

-- jsonb 를 재귀로 돌며 문자열 잎을 마스킹. 구조 키(id·type·kind·role…)는 건드리지 않는다
-- (세그먼트 id 는 앵커 키, enum 값은 스키마 검증 대상).
create or replace function public._pool_mask_jsonb(p jsonb, p_key text default null)
  returns table (value jsonb, report jsonb)
  language plpgsql immutable set search_path = public
as $$
declare
  k   text;
  v   jsonb;
  acc jsonb;
  rep jsonb := '{}'::jsonb;
  sub record;
  mt  record;
begin
  if p is null then
    value := p; report := rep; return next; return;
  end if;
  case jsonb_typeof(p)
    when 'object' then
      acc := '{}'::jsonb;
      for k, v in select e.key, e.value from jsonb_each(p) e loop
        select * into sub from public._pool_mask_jsonb(v, k);
        acc := acc || jsonb_build_object(k, sub.value);
        rep := public._pool_report_add(rep, sub.report);
      end loop;
      value := acc;
    when 'array' then
      acc := '[]'::jsonb;
      for v in select e from jsonb_array_elements(p) e loop
        select * into sub from public._pool_mask_jsonb(v, p_key);
        acc := acc || jsonb_build_array(sub.value);
        rep := public._pool_report_add(rep, sub.report);
      end loop;
      value := acc;
    when 'string' then
      if p_key in ('id', 'schemaVersion', 'type', 'framework', 'frameworks', 'kind',
                   'verdict', 'role', 'occupation', 'taxCategory') then
        value := p;
      else
        select * into mt from public._pool_mask_text(p #>> '{}');
        value := to_jsonb(mt.masked);
        rep := mt.report;
      end if;
    else
      value := p;
  end case;
  report := rep;
  return next;
end;
$$;
revoke all on function public._pool_mask_jsonb(jsonb, text) from public, anon, authenticated;

-- 공개 진입점: {payload: 마스킹된 Conversation, report: {규칙: 건수}}.
-- 마스킹은 모든 문자열 잎에, 리포트는 messages 안에서만 센다 — 제목(topic.title)·대화 제목은
-- 첫 질문의 사본이라 같이 세면 번호 하나가 "전화 3건"으로 부풀어 사장님이 오해한다.
-- persona.label·businessType 은 계정 표시명(“사장님2”, 실가입자라면 이름일 수 있다)이라 규칙과 무관하게
-- 통째로 '[고객]'으로 바꾼다 — 어느 계정의 사례인지가 드러나면 비식별이 아니다.
-- 순수 함수(테이블 미접근)지만 실행은 내부 함수와 서버 관리자만 — 사용자 경로는 아래 RPC 로.
create or replace function public.mask_conversation_payload(p_payload jsonb)
  returns jsonb
  language sql immutable set search_path = public
as $$
  select jsonb_build_object(
    'payload',
    case when jsonb_typeof(m.value -> 'persona') = 'object'
         then jsonb_set(jsonb_set(m.value, '{persona,label}', '"[고객]"'), '{persona,businessType}', '"[고객]"')
         else m.value end,
    'report', coalesce((select r.report from public._pool_mask_jsonb(p_payload -> 'messages', 'messages') r), '{}'::jsonb)
  )
  from public._pool_mask_jsonb(p_payload) m
$$;
revoke all on function public.mask_conversation_payload(jsonb) from public, anon, authenticated;

-- ── ④ 동의 ──────────────────────────────────────────────────────────────────────
-- 미리보기: 본인 대화의 "지금" payload 를 마스킹해 보여 준다(저장 안 함).
-- 동의 시트는 이걸 먼저 보여 주고 동의를 받는다 — 안 보여 주고 받는 동의는 동의가 아니다.
create or replace function public.preview_pool_mask(p_conversation_id text)
  returns jsonb
  language plpgsql stable security definer set search_path = public
as $$
declare
  v_me   text := public.current_domain_id();
  v_conv public.conversations;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  select * into v_conv from public.conversations where id = p_conversation_id;
  if not found or v_conv.owner_id <> v_me then
    raise exception 'conversation not found: %', p_conversation_id;
  end if;
  return public.mask_conversation_payload(v_conv.payload);
end;
$$;
revoke all on function public.preview_pool_mask(text) from public, anon;
grant execute on function public.preview_pool_mask(text) to authenticated;

-- 동의(재동의 포함): 그 시점의 대화를 마스킹해 얼리고 7일 만료로 등재.
-- 재동의는 사본·만료를 새로 쓰고 철회 표시를 지운다.
create or replace function public.grant_pool_consent(p_conversation_id text)
  returns public.conversation_pool_consents
  language plpgsql security definer set search_path = public
as $$
declare
  v_me   text := public.current_domain_id();
  v_conv public.conversations;
  v_mask jsonb;
  v_now  bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_row  public.conversation_pool_consents;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  if public.current_role()::text <> 'user' then
    raise exception 'only the conversation owner can consent';
  end if;
  select * into v_conv from public.conversations where id = p_conversation_id for update;
  if not found or v_conv.owner_id <> v_me then
    raise exception 'conversation not found: %', p_conversation_id;
  end if;

  v_mask := public.mask_conversation_payload(v_conv.payload);

  insert into public.conversation_pool_consents as c (
    conversation_id, viewer_id, granted_at, expires_at, revoked_at,
    masked_payload, mask_report, masked_at, occupation, tax_category, title
  ) values (
    v_conv.id, v_me, v_now, v_now + 7 * 24 * 3600 * 1000, null,
    v_mask -> 'payload', v_mask -> 'report', v_now,
    v_conv.occupation, v_conv.tax_category,
    (select masked from public._pool_mask_text(v_conv.title))
  )
  on conflict (conversation_id) do update set
    viewer_id      = excluded.viewer_id,
    granted_at     = excluded.granted_at,
    expires_at     = excluded.expires_at,
    revoked_at     = null,
    masked_payload = excluded.masked_payload,
    mask_report    = excluded.mask_report,
    masked_at      = excluded.masked_at,
    occupation     = excluded.occupation,
    tax_category   = excluded.tax_category,
    title          = excluded.title
  returning * into v_row;

  return v_row;
end;
$$;
revoke all on function public.grant_pool_consent(text) from public, anon;
grant execute on function public.grant_pool_consent(text) to authenticated;

-- 철회: 본인 또는 admin(강제 철회 브레이크). 즉시 풀에서 내려가고 사본을 비운다.
-- 이미 열린 방은 건드리지 않는다(D4 — 방은 (b) 이후).
create or replace function public.revoke_pool_consent(p_conversation_id text)
  returns public.conversation_pool_consents
  language plpgsql security definer set search_path = public
as $$
declare
  v_me  text := public.current_domain_id();
  v_row public.conversation_pool_consents;
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if v_me is null then
    raise exception 'not authenticated';
  end if;
  select * into v_row from public.conversation_pool_consents
   where conversation_id = p_conversation_id for update;
  if not found or (v_row.viewer_id <> v_me and not public.is_admin()) then
    raise exception 'consent not found: %', p_conversation_id;
  end if;

  update public.conversation_pool_consents
     set revoked_at = coalesce(revoked_at, v_now),
         masked_payload = null
   where conversation_id = p_conversation_id
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.revoke_pool_consent(text) from public, anon;
grant execute on function public.revoke_pool_consent(text) to authenticated;

-- ── ⑤ 풀 조회 (세무사·admin) ───────────────────────────────────────────────────
-- 목록: 유효 동의만. 대화 본문은 싣지 않는다(상세는 open_pool_case 로 — 열람 기록이 남는다).
create or replace function public.list_pool_cases()
  returns table (
    conversation_id  text,
    occupation       text,
    tax_category     text,
    title            text,
    first_question   text,
    turn_count       integer,
    granted_at       bigint,
    expires_at       bigint,
    mask_report      jsonb,
    viewed_by_me     boolean
  )
  language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_me  text := public.current_domain_id();
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if v_me is null or public.current_role()::text not in ('auditor', 'admin') then
    raise exception 'pool is for experts only';
  end if;
  return query
    select
      c.conversation_id,
      c.occupation,
      c.tax_category,
      c.title,
      (select string_agg(s ->> 'text', ' ')
         from jsonb_array_elements(
                (select m from jsonb_array_elements(c.masked_payload -> 'messages') m
                  where m ->> 'role' = 'user' order by (m ->> 'order')::int limit 1) -> 'segments') s),
      (select count(*)::int from jsonb_array_elements(c.masked_payload -> 'messages') m
        where m ->> 'role' = 'user'),
      c.granted_at,
      c.expires_at,
      c.mask_report,
      exists (select 1 from public.pool_case_views v
               where v.conversation_id = c.conversation_id and v.auditor_id = v_me)
    from public.conversation_pool_consents c
    where c.revoked_at is null and c.expires_at > v_now and c.masked_payload is not null
    order by c.granted_at desc;
end;
$$;
revoke all on function public.list_pool_cases() from public, anon;
grant execute on function public.list_pool_cases() to authenticated;

-- 상세: 마스킹된 대화 전문 + 열람 기록 1건(같은 세무사는 횟수·마지막 시각만 갱신).
create or replace function public.open_pool_case(p_conversation_id text)
  returns table (
    conversation_id  text,
    occupation       text,
    tax_category     text,
    title            text,
    granted_at       bigint,
    expires_at       bigint,
    mask_report      jsonb,
    masked_payload   jsonb
  )
  language plpgsql security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_me  text := public.current_domain_id();
  v_now bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if v_me is null or public.current_role()::text not in ('auditor', 'admin') then
    raise exception 'pool is for experts only';
  end if;
  if not exists (
    select 1 from public.conversation_pool_consents c
     where c.conversation_id = p_conversation_id
       and c.revoked_at is null and c.expires_at > v_now and c.masked_payload is not null
  ) then
    raise exception 'pool case not available: %', p_conversation_id;
  end if;

  insert into public.pool_case_views as v (conversation_id, auditor_id, first_viewed_at, last_viewed_at)
  values (p_conversation_id, v_me, v_now, v_now)
  on conflict on constraint pool_case_views_pkey do update
    set last_viewed_at = excluded.last_viewed_at, view_count = v.view_count + 1;

  return query
    select c.conversation_id, c.occupation, c.tax_category, c.title,
           c.granted_at, c.expires_at, c.mask_report, c.masked_payload
    from public.conversation_pool_consents c
    where c.conversation_id = p_conversation_id;
end;
$$;
revoke all on function public.open_pool_case(text) from public, anon;
grant execute on function public.open_pool_case(text) to authenticated;
