-- ════════════════════════════════════════════════════════════════════════════
-- Workstream B — rag.* schema (pgvector 벡터 KB, 뼈대)
-- ════════════════════════════════════════════════════════════════════════════
-- 마스터설계 §5 · §3-1(네임스페이스: 비즈니스=public.*, RAG=rag.*).
--
-- 제품 논지(메모리 project_rag_product_thesis): KB 는 **비어서 출발**하고
--   세무사 코멘트(질문 A + Upstage 답변 B + 코멘트 C)로 자란다. 임팩트 측정을
--   위해 전량 사전 인덱싱하지 않는다. 이 마이그레이션은 그 성장 그릇(뼈대)만 만든다.
--
-- 설계 규칙:
--   • 시각 필드는 public.* 와 동일하게 epoch-ms bigint.
--   • 임베딩 차원 = 4096 (Upstage embedding-passage/query 실측, 2026-07-03).
--       pgvector ANN 인덱스(ivfflat/hnsw)는 2000차원 상한이라 4096 은 인덱스 불가.
--       → **정확 코사인 검색(exact scan)**. KB 가 작게 출발하므로 충분·정확.
--         (대규모화 시 차원축소 또는 tax_category 파티션으로 후속 대응.)
--   • provenance 를 1급 컬럼으로: "누가(reviewer) 어느 검수(feedback/conversation)에서
--     만든 지식인가" 가 제품 서사 자체. citations·case_refs 로 챗 근거를 채운다.
--   • rag.* 는 Python 백엔드(service role, 직결)만 접근. 프론트는 /api/chat 경유.
--     방어적으로 RLS enable + 정책 없음(= service role 만 통과, anon/authenticated 차단).
-- ════════════════════════════════════════════════════════════════════════════

create schema if not exists rag;

-- pgvector. Supabase 프로젝트엔 사용 가능. public 에 설치되면 `vector` 타입이
-- search_path 로 해석된다.
create extension if not exists vector;

-- ── rag.passages ─────────────────────────────────────────────────────────────
-- 검색 단위 = 질문 A + 답변 B + 코멘트 C 번들(=content). 이 텍스트를 임베딩한다.
create table rag.passages (
  id             uuid primary key default gen_random_uuid(),
  -- 멱등 업서트 키. 예: 'feedback:<id>' · 'case:<case_id>' · 'kb:<doc_id>' · 'seed:<slug>'
  dedupe_key     text not null unique,
  content        text not null,                 -- 임베딩된 Q+A+C 번들 원문
  embedding      vector(4096) not null,

  -- 출처 종류: 세무사 코멘트 / KB 문서 / 판례 시드 / 원대화
  source_kind    text not null
                   check (source_kind in ('feedback', 'kb_document', 'case_seed', 'conversation')),

  -- provenance (모두 nullable — 출처에 따라 채워짐)
  conversation_id text,
  segment_id      text,
  feedback_id     text,                          -- public.line_feedback.id
  kb_document_id  text,                          -- public.kb_documents.id
  case_id         text,                          -- backend/data 판례 case_id / case_number
  reviewer        text,                          -- 이 지식을 만든 세무사 domain_id (핵심 서사)

  -- 검색 필터·근거 태깅
  tax_category    text,                          -- 소득세 · 부가가치세 …
  occupation      text,                          -- clinic …
  case_refs       text[] not null default '{}',  -- 인용 사건번호 → 챗 citations 로 승격
  law_articles    text[] not null default '{}',
  feedback_tags   text[] not null default '{}',  -- legal_error | grammar_error | suggestion
  metadata        jsonb  not null default '{}',

  status          text not null default 'active' check (status in ('active', 'retired')),
  created_at      bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at      bigint not null default (extract(epoch from now()) * 1000)::bigint
);
comment on table rag.passages is
  'RAG KB 성장 그릇: 질문A+답변B+세무사코멘트C 번들 + 4096d 임베딩 + provenance. 비어서 출발.';

-- 필터 인덱스(벡터는 exact scan 이므로 ANN 인덱스 없음).
create index passages_source_kind_idx on rag.passages (source_kind);
create index passages_tax_category_idx on rag.passages (tax_category);
create index passages_occupation_idx  on rag.passages (occupation);
create index passages_status_idx      on rag.passages (status);

-- ── 방어적 RLS: 정책 없음 → service role(직결)만 통과, anon/authenticated 전면 차단 ──
alter table rag.passages enable row level security;

-- ── 검색 헬퍼: 코사인 거리 top-k (service role 이 psycopg 로 직접 호출도 가능) ──────
-- query_embedding 과의 코사인 거리(<=>) 오름차순. score = 1 - distance (코사인 유사도).
create or replace function rag.match_passages(
  query_embedding vector(4096),
  match_count     int    default 5,
  filter_occupation text default null,
  filter_tax_category text default null
)
returns table (
  id            uuid,
  content       text,
  source_kind   text,
  reviewer      text,
  case_refs     text[],
  law_articles  text[],
  tax_category  text,
  occupation    text,
  metadata      jsonb,
  score         float
)
language sql stable
as $$
  select p.id, p.content, p.source_kind, p.reviewer, p.case_refs, p.law_articles,
         p.tax_category, p.occupation, p.metadata,
         1 - (p.embedding <=> query_embedding) as score
  from rag.passages p
  where p.status = 'active'
    and (filter_occupation   is null or p.occupation   = filter_occupation)
    and (filter_tax_category is null or p.tax_category = filter_tax_category)
  order by p.embedding <=> query_embedding
  limit match_count
$$;
