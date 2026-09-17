-- ════════════════════════════════════════════════════════════════════════════
-- kbdict.* schema — L1 사전층 (KB통합 3층검색 로드맵 P3, 2026-09-17)
-- ════════════════════════════════════════════════════════════════════════════
-- 3층 배치: L0 규범(master·frameworks·pitfalls, 상시 주입 — backend/api/prompts/*.md)
--           L1 사전(glossary·cases·occupations, 검색) ← 이 스키마
--           L2 경험(kb2.*, 세무사 코멘트 응축 문장)
-- 권위 서열에서 L1 은 최하위다(엔진 판정 > L0 > L2 > L1). 세무사가 사안별로 확인한 내용이
-- 아니므로 프롬프트에서는 '참고 사전 — 미확인' 블록으로만 주입한다(P4).
--
-- 검색 단위는 문서가 아니라 **청크**(헤딩 단위)다 — rag.passages 의 문서 통째 번들이 겪는
-- 정보 희석을 피한다(KB2 와 같은 이유). 각 청크는 doc2query(청크마다 이 문단이 답이 되는
-- 질문 3~5개, solar-pro3) 로 증강한 뒤 [질문 + 본문] 을 embedding-passage 로 임베딩한다.
-- 질문은 적재 시점 1회 생성·파일 보관(backend/data/kbdict/doc2query.json) — 재적재 때 재사용.
--
-- kb2.* 와 대칭 컨벤션: 시각 epoch-ms bigint, vector(4096) exact scan(ANN 2000차원 상한 초과),
-- 방어적 RLS(enable + 정책 없음 = service role 만 통과), 삭제 대신 status='archived'.
--
-- 나란히 설 자리(로드맵 P5): L0 규범을 DB 로 올릴 때는 같은 관례(스키마 분리 · documents/
-- 하위 단위 2단 · origin · status · epoch-ms · 방어적 RLS)로 옆에 둔다. 그래서 여기 컬럼
-- 이름을 층 특유의 말(glossary 등)이 아니라 일반어(corpus/origin/source_path)로 잡았다.
-- ════════════════════════════════════════════════════════════════════════════

create schema if not exists kbdict;

-- ── kbdict.documents ─────────────────────────────────────────────────────────
create table kbdict.documents (
  id           uuid primary key default gen_random_uuid(),
  source_path  text not null unique,             -- 원본 안의 위치. 시드: frontend KbDocument.path
  corpus       text not null check (corpus in ('glossary', 'case', 'occupation')),
  origin       text not null default 'seed',     -- 소스 단위 되돌리기 축(로드맵 §6-6). 외부 소스는 새 값
  title        text not null,
  summary      text,
  occupation   text,                             -- null = 업종 무관. 'clinic' 등
  content_hash text not null,                    -- 원문 변경 감지(재적재 멱등)
  status       text not null default 'active' check (status in ('active', 'archived')),
  created_at   bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at   bigint not null default (extract(epoch from now()) * 1000)::bigint
);
comment on table kbdict.documents is
  'L1 사전층 문서 — 시드(glossary/cases/occupations) 1건 = 1행. 검색 단위는 kbdict.chunks.';

-- ── kbdict.chunks ────────────────────────────────────────────────────────────
create table kbdict.chunks (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references kbdict.documents(id) on delete cascade,
  chunk_index  int not null,
  heading      text not null,
  content      text not null,                    -- 프롬프트에 주입되는 본문('[제목] 헤딩' 머리 포함)
  questions    jsonb not null default '[]',      -- doc2query 산출(문자열 배열)
  embedding    vector(4096) not null,            -- embedding-passage([질문들 + content])
  content_hash text not null,                    -- sha1(content + questions) — 같으면 재임베딩 생략
  status       text not null default 'active' check (status in ('active', 'archived')),
  created_at   bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at   bigint not null default (extract(epoch from now()) * 1000)::bigint,
  unique (document_id, chunk_index)
);
create index kbdict_chunks_document_idx on kbdict.chunks (document_id);
comment on table kbdict.chunks is
  'L1 사전층 청크 — 검색 단위. doc2query 질문과 본문을 함께 임베딩.';

-- ── 검색 헬퍼: kb2.match_sentences 와 대칭 ───────────────────────────────────
-- filter_occupation: 업종 무관 문서(null)는 항상 통과, 업종 문서는 일치할 때만.
create or replace function kbdict.match_chunks(
  query_embedding   vector(4096),
  match_count       int  default 5,
  filter_occupation text default null
)
returns table (
  id          uuid,
  document_id uuid,
  source_path text,
  corpus      text,
  title       text,
  content     text,
  score       float
)
language sql stable
as $$
  select c.id, c.document_id, d.source_path, d.corpus, d.title, c.content,
         1 - (c.embedding <=> query_embedding) as score
  from kbdict.chunks c
  join kbdict.documents d on d.id = c.document_id
  where c.status = 'active' and d.status = 'active'
    and (d.occupation is null or filter_occupation is null or d.occupation = filter_occupation)
  order by c.embedding <=> query_embedding
  limit match_count
$$;

-- ── 방어적 RLS: 정책 없음 → service role(직결)만 통과 ──────────────────────────
alter table kbdict.documents enable row level security;
alter table kbdict.chunks enable row level security;
