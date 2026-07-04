-- ════════════════════════════════════════════════════════════════════════════
-- Workstream A/B — 공용 검수 보드 (audit-store localStorage → 서버화)
-- ════════════════════════════════════════════════════════════════════════════
-- 배경: 지금 line_feedback / session_evaluations 는 프론트 audit-store(localStorage)에만
--   있어 브라우저마다 개인 사본이다. 사용자 개념은 "세무사 N명이 한 대화를 함께 보는
--   단체 채팅방(공용 보드)": 같은 대화의 참여자끼리 서로의 코멘트를 실시간으로 보고,
--   틀린 코멘트엔 반박·본인 것 삭제, 최종 검수에서 관리자가 불인정한다.
--   → 두 테이블을 Realtime 공용 소스로 전환하고, RLS 를 "멤버 상호 조회"로 재설계한다.
--
-- 신원 정합성 수정(중요): 기존 RLS 는 owner 를 `reviewer = current_domain_id()` 로 봤으나,
--   프론트는 reviewer 에 표시이름(auditor.reviewerName)을 넣는다 → 서버화 시 소유 판정이
--   깨진다. 그래서 신원 컬럼 `auditor_id`(도메인 id)를 신설하고, reviewer 는 표시이름으로
--   남긴다. RLS·attribution 은 auditor_id 를 신뢰한다.
--
-- 부수 효과: rag.passages.auditor_id 를 함께 열어 "살아있는 RAG 기여도" 정산 연동의
--   선결 부채(passage→auditorId attribution)를 같은 삽으로 해소한다.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. 신원 컬럼: auditor_id (도메인 id). reviewer 는 표시이름으로 유지 ─────────────
alter table public.line_feedback
  add column if not exists auditor_id text;
alter table public.session_evaluations
  add column if not exists auditor_id text;
create index if not exists line_feedback_auditor_idx on public.line_feedback (auditor_id);

-- 기존 행 백필: PoC 는 지금까지 localStorage 라 서버 테이블이 비어 있다(백필 대상 없음).
-- 혹시 남은 행이 있고 reviewer 가 도메인 id 였다면 그대로 승격.
update public.line_feedback       set auditor_id = reviewer where auditor_id is null;
update public.session_evaluations set auditor_id = reviewer where auditor_id is null;

-- ── 2. RAG attribution: rag.passages 에 auditor_id (write-path 가 채운다) ──────────
alter table rag.passages
  add column if not exists auditor_id text;
create index if not exists passages_auditor_idx on rag.passages (auditor_id);

-- ── 3. session_evaluations: 대화당 1개 → (대화, 세무사)당 1개 (세무사별 평가 허용) ──
-- 기존 inline unique(conversation_id) 제약을 (conversation_id, auditor_id) 로 교체.
alter table public.session_evaluations
  drop constraint if exists session_evaluations_conversation_id_key;
-- 공용 보드에선 세무사마다 자기 세션 평가를 남긴다.
create unique index if not exists session_eval_conv_auditor_key
  on public.session_evaluations (conversation_id, auditor_id);

-- ── 4. RLS 재설계 — 작성=본인, 조회=같은 대화 멤버끼리 + admin ──────────────────────
-- line_feedback
drop policy if exists feedback_owner       on public.line_feedback;
drop policy if exists feedback_admin_read  on public.line_feedback;

-- 작성/수정/삭제: 본인(auditor_id = 도메인 id) 것만. (owner 는 자기 것 조회도 포함)
create policy feedback_owner_write on public.line_feedback
  for all using (auditor_id = public.current_domain_id())
  with check (auditor_id = public.current_domain_id());

-- 조회: admin 전체 OR "같은 대화에 audit 이 있는(=그 방의 멤버)" 세무사끼리 상호 열람.
create policy feedback_member_read on public.line_feedback
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.audits a
      where a.conversation_id = line_feedback.conversation_id
        and a.auditor_id = public.current_domain_id()
    )
  );

-- session_evaluations (동일 원칙)
drop policy if exists eval_owner       on public.session_evaluations;
drop policy if exists eval_admin_read  on public.session_evaluations;

create policy eval_owner_write on public.session_evaluations
  for all using (auditor_id = public.current_domain_id())
  with check (auditor_id = public.current_domain_id());

create policy eval_member_read on public.session_evaluations
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.audits a
      where a.conversation_id = session_evaluations.conversation_id
        and a.auditor_id = public.current_domain_id()
    )
  );

-- ── 5. Realtime: 두 테이블을 publication 에 추가 (공용 보드 실시간 반영) ─────────────
-- 0003 주석의 "line_feedback·session_evaluations 는 후속" 을 여기서 이행.
-- (add table 은 비멱등 → 이미 멤버면 건너뛰도록 가드. 재실행 안전.)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'line_feedback'
  ) then
    alter publication supabase_realtime add table public.line_feedback;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'session_evaluations'
  ) then
    alter publication supabase_realtime add table public.session_evaluations;
  end if;
end $$;
