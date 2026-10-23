-- 0063 사용 현황 M2 — 챗 턴 기록 보강 + 질문 원문(가림·90일) (2026-10-23, 결선보고서 제출 뒤)
--
-- 근거: design/관리자_사용현황_모니터링_대시보드_설계_1021.md §2.4·§2.5(D1=B) · §3 M2.
-- 하는 일:
--   ① rag.chat_turns 에 channel·tax_topic·question_type·handoff_reason·latency_ms 컬럼.
--      매 턴 이미 계산하던 값(meta.extracted·meta.handoff)을 저장만 한다 — 답변 내용·경로 불변.
--      channel 은 conversation_id 접두로 소급(room_ / studio_ / eval- / 그 외 chat). 나머지는 소급 불가(null = 수집 전).
--   ② analytics.questions — 고객 챗(channel=chat)의 사용자 발화 원문. 백엔드가 식별정보를 가린 뒤 넣고(api/turn_record.py),
--      DB 도 한 번 더 가린다(analytics.mask_pii, 트리거). 500자 상한 · 90일 뒤 파기(pg_cron 매일 04:10 KST).
--      읽기 = 정책 0 · anon/authenticated 권한 0 → 관리자 RPC(M3)로만.
-- 되돌리기: alter table rag.chat_turns drop column channel, drop column tax_topic, drop column question_type,
--   drop column handoff_reason, drop column latency_ms; drop table analytics.questions;
--   drop function analytics.mask_pii(text); drop function public.purge_old_analytics_questions();
--   cron.unschedule('purge-old-analytics-questions');

-- ── ① chat_turns 보강 ─────────────────────────────────────────────────────────
alter table rag.chat_turns
  add column if not exists channel        text,
  add column if not exists tax_topic      text,
  add column if not exists question_type  text,
  add column if not exists handoff_reason text,
  add column if not exists latency_ms     integer;

update rag.chat_turns
   set channel = case
         when conversation_id like 'room\_%'   then 'room'
         when conversation_id like 'studio\_%' then 'studio'
         when conversation_id like 'eval-%'    then 'eval'
         else 'chat' end
 where channel is null;

create index if not exists chat_turns_channel_created_idx on rag.chat_turns (channel, created_at desc);

-- ── ② 질문 원문 ───────────────────────────────────────────────────────────────
-- 식별정보 꼴을 [가림] 으로. 백엔드 가림(api/turn_record.py MASKS)과 같은 규칙 — 어느 한쪽이 놓쳐도 다른 쪽이 잡는다.
create or replace function analytics.mask_pii(p text)
  returns text
  language sql immutable
as $$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(p,
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[가림]', 'g'),                  -- 이메일
    '\d{6}\s*-\s*[1-8]\d{6}', '[가림]', 'g'),                                         -- 주민·외국인등록번호
    '\d{3}\s*-\s*\d{2}\s*-\s*\d{5}', '[가림]', 'g'),                                  -- 사업자등록번호
    '01[016789][\s.-]?\d{3,4}[\s.-]?\d{4}', '[가림]', 'g'),                            -- 휴대폰
    '0\d{1,2}[\s.)-]\s?\d{3,4}[\s.-]\d{4}', '[가림]', 'g'),                            -- 유선 전화
    '\d{3,6}-\d{2,6}-\d{4,8}(-\d{1,6})?', '[가림]', 'g')                               -- 계좌번호 꼴(끝 묶음 4자리 이상 — 날짜 2024-10-23 은 안 걸림)
$$;

create table if not exists analytics.questions (
  id               bigint generated always as identity primary key,
  created_at       timestamptz not null default now(),
  conversation_id  text not null check (char_length(conversation_id) <= 100),
  message_id       text check (char_length(message_id) <= 160),   -- rag.chat_turns.message_id 와 잇는다
  text_masked      text not null check (char_length(text_masked) <= 500)
);
create index if not exists questions_created_idx on analytics.questions (created_at desc);
create index if not exists questions_conversation_idx on analytics.questions (conversation_id);
alter table analytics.questions enable row level security;
revoke all on analytics.questions from public, anon, authenticated;

create or replace function analytics.questions_mask()
  returns trigger
  language plpgsql
as $$
begin
  new.text_masked := left(analytics.mask_pii(new.text_masked), 500);
  return new;
end;
$$;
drop trigger if exists questions_mask on analytics.questions;
create trigger questions_mask before insert or update on analytics.questions
  for each row execute function analytics.questions_mask();

create or replace function public.purge_old_analytics_questions()
  returns integer
  language plpgsql volatile security definer set search_path = public
as $$
declare
  k integer;
begin
  delete from analytics.questions where created_at < now() - interval '90 days';
  get diagnostics k = row_count;
  return k;
end;
$$;
revoke all on function public.purge_old_analytics_questions() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'purge-old-analytics-questions') then
      perform cron.unschedule('purge-old-analytics-questions');
    end if;
    -- 매일 04:10 KST
    perform cron.schedule('purge-old-analytics-questions', '10 19 * * *',
      $cron$select public.purge_old_analytics_questions()$cron$);
  end if;
end $$;
