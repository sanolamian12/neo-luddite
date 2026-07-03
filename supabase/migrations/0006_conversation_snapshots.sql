-- ════════════════════════════════════════════════════════════════════════════
-- Workstream A / 하차장 재편 — 라이브 대화의 "5분 후 정지 스냅샷"
-- ════════════════════════════════════════════════════════════════════════════
-- 정책(사용자 확정): 사장님이 만든 채팅방은 5분이 지난 시점에 "사진"을 한 장 찍는다.
--   · 채팅방 자체는 얼리지 않는다 — 사장님은 5분 후에도 계속 대화 가능(라이브
--     `conversations.payload` 는 매 턴 계속 갱신).
--   · 하차장/일감/RAG 가 소비하는 것은 그 5분 시점의 **정지 스냅샷**(snapshot_payload).
--     정지 데이터라 라이브 진행 상황과 싱크가 어긋나지 않는다.
--
-- 브라우저가 닫혀도 5분 시점에 사진이 찍혀야 하므로 캡처는 **서버(pg_cron)** 가 수행.
-- 라이브 행은 건드리지 않고 snapshot_* 컬럼만 1회 채운다(불변 트리거로 재봉인).
--
-- 하차장 노출 조건: snapshot_at IS NOT NULL AND excluded_at IS NULL.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 동결 시간 설정(서버 단일 소스) ────────────────────────────────────────────
-- freeze_ms: 채팅방 생성 후 스냅샷까지 대기(ms). 기본 5분. 데모/E2E 시 낮춰 단축.
create table if not exists public.app_config (
  key   text primary key,
  value bigint not null
);
insert into public.app_config (key, value) values ('freeze_ms', 300000)
  on conflict (key) do nothing;

alter table public.app_config enable row level security;
-- 설정은 관리자만(스냅샷 함수는 security definer 라 RLS 무관하게 읽음).
create policy app_config_admin_all on public.app_config
  for all using (public.is_admin()) with check (public.is_admin());

-- ── 스냅샷 컬럼(conversations 확장) ───────────────────────────────────────────
-- 별도 테이블 대신 컬럼 확장 → 라이브↔스냅샷 1:1 자연 보장 + 0005 Realtime 재사용.
alter table public.conversations
  add column if not exists snapshot_at      bigint,   -- 사진 찍은 시각(ms). null=아직 라이브
  add column if not exists snapshot_payload jsonb,     -- 5분 시점 정지 사본(Conversation)
  add column if not exists excluded_at      bigint;    -- 관리자 제외 시각(ms). null=활성

-- 하차장 목록 정렬(사진 찍힌 것만)
create index if not exists conversations_snapshot_idx
  on public.conversations (snapshot_at desc) where snapshot_at is not null;

-- ── 스냅샷 캡처 함수 ──────────────────────────────────────────────────────────
-- age ≥ freeze_ms 이고 아직 사진이 없는 라이브 대화의 현재 payload 를 복사(사진 1장).
-- 라이브 payload/turn_count 는 건드리지 않는다.
create or replace function public.snapshot_settled_conversations()
  returns integer
  language plpgsql
  security definer set search_path = public
as $$
declare
  now_ms    bigint := (extract(epoch from now()) * 1000)::bigint;
  freeze_ms bigint := coalesce(
    (select value from public.app_config where key = 'freeze_ms'), 300000);
  n integer;
begin
  update public.conversations c
     set snapshot_at      = now_ms,
         snapshot_payload = c.payload
   where c.snapshot_at is null
     and (now_ms - c.created_at) >= freeze_ms;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ── 스냅샷 불변 트리거 ────────────────────────────────────────────────────────
-- 사진은 한 번 찍히면 바뀌지 않는다. 사장님의 라이브 upsert 가 snapshot_* 를
-- 덮어쓰려 해도(오작동/악의) 조용히 기존값으로 되돌린다(라이브 챗은 절대 안 막음).
create or replace function public.enforce_snapshot_immutable()
  returns trigger
  language plpgsql
as $$
begin
  if old.snapshot_at is not null
     and new.snapshot_at is distinct from old.snapshot_at then
    new.snapshot_at := old.snapshot_at;
  end if;
  if old.snapshot_payload is not null
     and new.snapshot_payload is distinct from old.snapshot_payload then
    new.snapshot_payload := old.snapshot_payload;
  end if;
  return new;
end;
$$;

drop trigger if exists conversations_snapshot_immutable on public.conversations;
create trigger conversations_snapshot_immutable
  before update on public.conversations
  for each row execute function public.enforce_snapshot_immutable();

-- ── pg_cron: 매분 스냅샷 캡처 스케줄 ──────────────────────────────────────────
create extension if not exists pg_cron;

-- 재적용 안전: 기존 동일 job 있으면 해제 후 재등록.
do $$
begin
  if exists (
    select 1 from cron.job where jobname = 'snapshot-settled-conversations'
  ) then
    perform cron.unschedule('snapshot-settled-conversations');
  end if;
end $$;

select cron.schedule(
  'snapshot-settled-conversations',
  '* * * * *',
  $cron$select public.snapshot_settled_conversations()$cron$
);
