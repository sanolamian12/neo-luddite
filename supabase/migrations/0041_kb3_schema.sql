-- ════════════════════════════════════════════════════════════════════════════
-- kb3.* schema — 판례 요지 · 국세청 질의회신 (KB3 요지수집 설계 §10, W5 설계 §2, 2026-09-27)
-- ════════════════════════════════════════════════════════════════════════════
-- LLM2(W5) 답변 단계의 근거. 권위 서열 검수 선례(rag) > 판례 요지(kb3_prec) > 국세청 해석(kb3_qna)
-- > 참고 사전(kbdict). 층은 corpus 값으로 가른다 — 프롬프트 블록이 이 값을 본다(llm2.py).
--
-- rag.passages 에 넣지 않는 이유: corpus 칸이 없어 KB2 합성 원재료·'검수 선례' 갈래·KB 거미줄
-- 그래프(rag.passage_edges)로 전부 샌다(설계 §10, 사용자 확정).
--
-- 한 건 = 한 행(청크 없음 — 본문 중앙 334자·최대 1,361자). embedding = embedding-passage(제목 + 본문),
-- content = 머리표([출처 종류 · 세법 · 문서번호 · 일자]) + 제목 + 본문 = 프롬프트에 그대로 들어가는 모양.
-- 적재는 scripts/kb3_ingest.py ingest 만 한다(case_id 멱등, 캐시 벡터 재사용).
--
-- kbdict.* 와 대칭: 시각 epoch-ms bigint, vector(4096) exact scan(ANN 2000차원 상한 초과),
-- 방어적 RLS(enable + 정책 없음 = service role 만 통과), 삭제 대신 status='archived'.
-- ════════════════════════════════════════════════════════════════════════════

create schema if not exists kb3;

-- ── kb3.documents ────────────────────────────────────────────────────────────
create table kb3.documents (
  id            uuid primary key default gen_random_uuid(),
  case_id       text not null unique,              -- 수집기 식별자(ntstDcmId 등) — 재적재 멱등 키
  corpus        text not null check (corpus in ('kb3_prec', 'kb3_qna')),
  origin        text not null,                     -- 소스 단위 되돌리기 축: 'nts_taxlaw' | 'nts_qna'
  case_number   text not null,                     -- 문서번호(사건번호·질의회신 번호) — 인용 대조(M1) 대상
  title         text not null,
  content       text not null,                     -- 프롬프트 주입 본문(머리표 포함)
  tax_law       text,                              -- 세법 이름(머리표에도 들어 있다)
  tax_category  text,                              -- 17개 세목(필드로만 — 병의원 관점이라 머리표엔 안 씀)
  decision_date text,                              -- 원문 표기 그대로(YYYY-MM-DD 등)
  source_url    text not null,                     -- 출처 링크 필수
  law_articles  jsonb not null default '[]',       -- 수집기가 뽑은 조문 목록(문자열 배열)
  embedding     vector(4096) not null,
  content_hash  text not null,                     -- sha1(제목 + 본문) = 벡터 캐시 키. 같으면 재임베딩 생략
  status        text not null default 'active' check (status in ('active', 'archived')),
  created_at    bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at    bigint not null default (extract(epoch from now()) * 1000)::bigint
);
create index kb3_documents_corpus_idx on kb3.documents (corpus);
comment on table kb3.documents is
  'KB3 — 판례 요지(kb3_prec)·국세청 질의회신(kb3_qna). 1건 = 1행 = 검색 단위. LLM2 근거.';

-- ── 검색 헬퍼: kbdict.match_chunks 와 대칭 ────────────────────────────────────
create or replace function kb3.match_documents(
  query_embedding vector(4096),
  match_count     int default 5
)
returns table (
  id           uuid,
  case_id      text,
  corpus       text,
  case_number  text,
  content      text,
  law_articles jsonb,
  tax_category text,
  source_url   text,
  score        float
)
language sql stable
as $$
  select d.id, d.case_id, d.corpus, d.case_number, d.content, d.law_articles, d.tax_category,
         d.source_url, 1 - (d.embedding <=> query_embedding) as score
  from kb3.documents d
  where d.status = 'active'
  order by d.embedding <=> query_embedding
  limit match_count
$$;

-- ── 방어적 RLS: 정책 없음 → service role(직결)만 통과 ──────────────────────────
alter table kb3.documents enable row level security;
