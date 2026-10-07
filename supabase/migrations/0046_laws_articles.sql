-- ════════════════════════════════════════════════════════════════════════════
-- laws.* — 자체 법령 DB(현행 조문 원문) · LLM3 관련 법령 선택의 원천 (design/LLM3_법령DB_설계.md, 2026-10-08)
-- ════════════════════════════════════════════════════════════════════════════
-- 원천: 법제처 PDF(현행본) → scripts/law_pdf_parse.py(조 단위, 원문 그대로) → scripts/law_ingest.py
--       (Solar 쟁점 한 줄 + Upstage embedding-passage) → 이 테이블. 적재는 law_ingest.py ingest 만 한다.
-- 1행 = 1조(한 버전). 시행 예정본은 version='future' 로 별도 행, 삭제 조문은 deleted=true(임베딩 없음).
-- 키 = (law_name, article_no, version). article_no = "81의7" 꼴(api/law_cite.py 와 같은 규약).
--
-- kb3.* 와 대칭: vector(4096) exact scan(ANN 2000차원 상한 초과), 방어적 RLS(정책 없음 = service role 만),
-- 시각 epoch-ms bigint. rag.passages·kb3 에 넣지 않는 이유: 사례가 아니라 규범(조문)이고, 검색이 아니라
-- 키 조회가 주 용도다(LLM3 는 후보 중 고르기만, 정확성은 키 조회가 맡는다 — 설계 D2).
-- ════════════════════════════════════════════════════════════════════════════

create schema if not exists laws;

create table laws.articles (
  id             text primary key,                 -- "법령명|조번호|version" (재적재 멱등 키)
  law_name       text not null,                    -- 공식 명칭(시행령·시행규칙 포함) 예 '상속세 및 증여세법 시행령'
  parent_law     text not null,                    -- 법률 이름(시행령·시행규칙 떼어 낸 것) — 세목·주체 필터 축
  kind           text not null,                    -- 법률 / 대통령령 / 재정경제부령 / 행정안전부령
  law_no         text,                             -- 법령 번호(제21987호 등)
  law_effective  text,                             -- 원천 PDF 의 시행일
  article_no     text not null,                    -- "81의7"
  article_num    int  not null,
  article_sub    int  not null default 0,
  title          text,
  heading        text,                             -- 편 > 장 > 절
  deleted        boolean not null default false,
  version        text not null check (version in ('current', 'future')),
  effective_from text,                             -- future 행의 시행일
  note           text,                             -- 일부 항만 시행일 미도래 등
  text           text not null,                    -- 조문 원문(개정 이력 표시 걷어낸 판) — 프롬프트 [관련 법령] 블록
  paragraphs     jsonb not null default '[]',      -- [{no, text}] 항 단위 — "법령명+조+항" 조회
  issue          text,                             -- Solar 쟁점 한 줄(LLM3 후보 목록에 보이는 것)
  keywords       jsonb not null default '[]',      -- Solar 사용자 표현 키워드
  source_file    text not null,
  embedding      vector(4096),                     -- 현행·비삭제만. 텍스트 = 머리(법령명 제N조(제목)) + 쟁점 + 표현 + 원문 앞 2,500자
  content_hash   text not null,                    -- sha1(text) — 바뀌지 않은 행은 재기록 생략
  status         text not null default 'active' check (status in ('active', 'archived')),
  created_at     bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at     bigint not null default (extract(epoch from now()) * 1000)::bigint,
  unique (law_name, article_no, version)
);
create index laws_articles_parent_idx on laws.articles (parent_law);
comment on table laws.articles is
  '자체 법령 DB — 조 단위 현행 원문(+시행 예정본). LLM3 관련 법령 선택의 후보·[관련 법령] 블록 원천.';

-- ── 검색: 현행·비삭제 조문 코사인 top-k, 법률 단위 제외(개인 질문의 법인세법 · 국세 질문의 지방세 3법) ──
create or replace function laws.match_articles(
  query_embedding vector(4096),
  match_count     int default 6,
  exclude_parents text[] default '{}'
)
returns table (law_name text, article_no text, score float)
language sql stable
as $$
  select a.law_name, a.article_no, 1 - (a.embedding <=> query_embedding) as score
  from laws.articles a
  where a.status = 'active' and a.version = 'current' and not a.deleted
    and a.embedding is not null
    and not (a.parent_law = any(coalesce(exclude_parents, '{}')))
  order by a.embedding <=> query_embedding
  limit match_count
$$;

-- ── 방어적 RLS: 정책 없음 → service role(직결)만 통과 ──────────────────────────
alter table laws.articles enable row level security;
