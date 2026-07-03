-- ════════════════════════════════════════════════════════════════════════════
-- Workstream A/Seam A — public.conversations (라이브 대화 영속화)
-- ════════════════════════════════════════════════════════════════════════════
-- 배경: 챗이 결정적 재생(정적 JSON)에서 실제 Upstage 추론(Seam A `/api/chat`)으로
-- 전환되면, 사장님이 생성한 라이브 대화가 저장될 곳이 필요하다. 이 테이블이
-- 프로세스 전체의 linchpin —
--   ① 관리자 하차장 목록(생성시간·종류·소유자 정렬, 제목 검색)의 데이터 원천
--   ② 세무사 코멘트 워크스페이스가 읽는 대화 원문(질문A/답변B)
--   ③ 검수 확정 → RAG write-path(질문A+답변B+코멘트C) 의 A/B 원문 공급
--
-- 설계: 목록·정렬용 컬럼을 1급으로 두고(빠른 admin 조회), 전체 대화는 payload(jsonb)
-- 에 conversation-schema 그대로 보존(세무사/검수 화면이 통째로 로드).
-- ════════════════════════════════════════════════════════════════════════════

create table public.conversations (
  id            text primary key,                 -- live-{occupation}-{ts} 등
  occupation    text not null,                    -- 종류(대화 개설 시 선택) — general|clinic|…
  tax_category  text,                             -- 세목(판정 후 채워질 수 있음)
  title         text,                             -- 첫 질문에서 자동 생성
  owner_id      text not null,                    -- 사장님 domain_id (profiles.domain_id)
  owner_label   text,                             -- 표시용 라벨(예: "사장님")
  source        text not null default 'live',     -- live | replay | upload
  status        text not null default 'live',     -- live | complete
  turn_count    integer not null default 0,
  created_at    bigint not null,                  -- 대화 생성 시각(ms) — 하차장 정렬 키
  updated_at    bigint not null,
  payload       jsonb not null                    -- 전체 Conversation (conversation-schema)
);

-- 하차장 정렬/필터 인덱스
create index conversations_created_idx on public.conversations (created_at desc);
create index conversations_occ_idx     on public.conversations (occupation);
create index conversations_owner_idx   on public.conversations (owner_id);
create index conversations_status_idx  on public.conversations (status);

-- ── RLS (0002 컨벤션 재사용: current_domain_id / current_role / is_admin) ────────
alter table public.conversations enable row level security;

-- 소유자(사장님)는 본인 대화 전체 CRUD
create policy conversations_owner on public.conversations
  for all using (owner_id = public.current_domain_id())
  with check (owner_id = public.current_domain_id());

-- admin·auditor(세무사)는 열람(하차장 목록·코멘트 워크스페이스·검수)
create policy conversations_staff_read on public.conversations
  for select using (public.current_role() in ('admin', 'auditor'));

-- admin 은 전체 관리(상태 전이·정리)
create policy conversations_admin_all on public.conversations
  for all using (public.is_admin()) with check (public.is_admin());

-- ── Realtime: 하차장 목록이 새 대화를 실시간 반영 ──────────────────────────────
alter publication supabase_realtime add table public.conversations;
