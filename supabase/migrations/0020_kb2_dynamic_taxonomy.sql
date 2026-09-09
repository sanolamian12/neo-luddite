-- ════════════════════════════════════════════════════════════════════════════
-- kb2 동적 카테고리 재구조화 — 로드맵 4.5단계
-- ════════════════════════════════════════════════════════════════════════════
-- 지금까지 kb2.documents 는 backend/api/rag/taxonomy.TAX_CATEGORIES(17개 하드코딩
-- 세목)와 1:1이었다. 이번부터 admin이 "AI로 카테고리 재구조화"를 실행하면 Solar Pro가
-- 그 시점 rag.passages 전체를 분석해 카테고리 자체를 새로 제안한다(map-reduce, 국내
-- AI 트랙 취지 — 구조 자체가 Upstage 산출물이어야 함).
--
-- 재구조화를 다시 돌리면 카테고리 레이블/개수가 매번 달라질 수 있어, kb2.documents.
-- tax_category 문자열을 기본키로 쓰던 방식(unique 제약)을 버리고 kb2.categories(id
-- 안정적 UUID)로 정체성을 분리한다. tax_category 컬럼은 이제 표시용 레이블일 뿐이다.
--
-- 연속성 정책(사용자 결정, 2026-09-09): 재구조화는 매번 전체 재생성 — 이전 활성
-- kb2.documents 는 전부 status='archived'로 보관(삭제 아님, locked_by_auditor 문장도
-- 그대로 보존되지만 검색·auditor 화면 노출에서는 빠진다). kb2.match_sentences() 가
-- 이미 status='active'만 검색하므로 SQL 함수 변경 불필요.
-- ════════════════════════════════════════════════════════════════════════════

create table kb2.categories (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  description text not null default '',
  status      text not null default 'active' check (status in ('active', 'archived')),
  created_at  bigint not null default (extract(epoch from now()) * 1000)::bigint
);
comment on table kb2.categories is
  'AI(Solar Pro)가 RAG 전체를 분석해 매번 새로 제안하는 카테고리 — 안정적 정체성(id)을 표시용 레이블(label)과 분리.';

alter table kb2.documents
  add column category_id uuid references kb2.categories(id);

-- tax_category 는 이제 "정체성"이 아니라 표시용 레이블 — 기본키 제약 제거.
-- 레거시 고정 세목 문서(category_id is null)는 그대로 남아있어도 무방.
alter table kb2.documents drop constraint documents_tax_category_key;

create table kb2.synthesis_jobs (
  id                   uuid primary key default gen_random_uuid(),
  status               text not null default 'running'
                         check (status in ('running', 'done', 'error')),
  stage                text not null default 'discovering_categories',
  total_categories     int not null default 0,
  completed_categories int not null default 0,
  result               jsonb,
  error                text,
  created_at           bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at           bigint not null default (extract(epoch from now()) * 1000)::bigint
);
comment on table kb2.synthesis_jobs is
  '재구조화 진행상황(job) — map-reduce가 수 분 걸릴 수 있어 프론트가 폴링으로 stage/진행률을 읽는다.';

alter table kb2.categories enable row level security;
alter table kb2.synthesis_jobs enable row level security;
