-- ════════════════════════════════════════════════════════════════════════════
-- kb2.* schema — 지식베이스2(응축형 정책 사전), 로드맵 1단계
-- ════════════════════════════════════════════════════════════════════════════
-- 설계 아티팩트(2026-09-03, "지식베이스2: RAG 응축형 사전 설계") §01.
--
-- rag.passages(질문+답변+코멘트 번들, 문서 전체 단위 임베딩)를 원재료로, Solar Pro 가
-- 세목(tax_category)별로 조항형 단문으로 응축·재구성한 별도 사전. 검색 단위를
-- "문서 전체"에서 "문장" 으로 낮춰 정보 희석 문제를 피한다(§00).
--
-- MVP 범위: kb2.documents 는 tax_category 1:1(17개 세목당 1건). 유사도 클러스터
-- 기반 그룹핑(rag.passage_edges)은 후속 개선 과제 — 지금은 세목 그룹핑만.
--
-- rag.* 와 동일 컨벤션: 시각 필드 epoch-ms bigint, vector(4096) exact scan(ANN
-- 인덱스 2000차원 상한 초과), 방어적 RLS(enable + 정책 없음 = service role 만 통과).
-- ════════════════════════════════════════════════════════════════════════════

create schema if not exists kb2;

-- ── kb2.documents ────────────────────────────────────────────────────────────
create table kb2.documents (
  id           uuid primary key default gen_random_uuid(),
  tax_category text not null unique,             -- api/rag/taxonomy.TAX_CATEGORIES 중 하나
  title        text not null,
  status       text not null default 'active' check (status in ('active', 'archived')),
  created_at   bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at   bigint not null default (extract(epoch from now()) * 1000)::bigint
);
comment on table kb2.documents is
  '지식베이스2 세목별 정책 사전 컨테이너. MVP: tax_category 1:1.';

-- ── kb2.sentences ────────────────────────────────────────────────────────────
-- 검색·크레딧·수정의 최소 단위. 각 문장은 대명사 없이 독립 완결되도록 합성한다
-- (Solar Pro 프롬프트 요구사항, backend/api/llm.py synthesize_kb2_sentences).
create table kb2.sentences (
  id                 uuid primary key default gen_random_uuid(),
  document_id        uuid not null references kb2.documents(id) on delete cascade,
  order_index        int not null,
  content            text not null,
  embedding          vector(4096) not null,
  source_passage_ids uuid[] not null default '{}',   -- 합성 재료가 된 rag.passages.id — 출처 추적
  attribution        jsonb not null default '[]',    -- 현재 크레딧 보유자 [{auditorId, weight}]
  locked_by_auditor  boolean not null default false, -- true면 재합성이 건드리지 않는다
  version            int not null default 1,
  created_at         bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at         bigint not null default (extract(epoch from now()) * 1000)::bigint
);
create index kb2_sentences_document_idx on kb2.sentences (document_id);
comment on table kb2.sentences is
  '지식베이스2 문장(조항) — 검색 단위이자 크레딧·수정이력의 최소 단위.';

-- ── kb2.sentence_versions ────────────────────────────────────────────────────
-- 문장별 전체 이력 — 세무사 수정을 관리자가 나중에 번복할 근거(로드맵 5단계에서 사용).
create table kb2.sentence_versions (
  id                   uuid primary key default gen_random_uuid(),
  sentence_id          uuid not null references kb2.sentences(id) on delete cascade,
  version_no           int not null,
  content              text not null,
  attribution_snapshot jsonb not null default '[]',
  editor_type          text not null
                         check (editor_type in ('system_synthesis', 'auditor_edit', 'admin_revert')),
  editor_id            text not null,
  created_at           bigint not null default (extract(epoch from now()) * 1000)::bigint
);
create index kb2_sentence_versions_sentence_idx on kb2.sentence_versions (sentence_id);

-- ── 검색 헬퍼: rag.match_passages 와 대칭 ────────────────────────────────────
create or replace function kb2.match_sentences(
  query_embedding vector(4096),
  match_count     int  default 5,
  filter_category text default null
)
returns table (
  id          uuid,
  document_id uuid,
  content     text,
  score       float
)
language sql stable
as $$
  select s.id, s.document_id, s.content,
         1 - (s.embedding <=> query_embedding) as score
  from kb2.sentences s
  join kb2.documents d on d.id = s.document_id
  where d.status = 'active'
    and (filter_category is null or d.tax_category = filter_category)
  order by s.embedding <=> query_embedding
  limit match_count
$$;

-- ── 방어적 RLS: 정책 없음 → service role(직결)만 통과 ──────────────────────────
alter table kb2.documents enable row level security;
alter table kb2.sentences enable row level security;
alter table kb2.sentence_versions enable row level security;
