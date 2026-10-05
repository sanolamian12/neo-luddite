-- ════════════════════════════════════════════════════════════════════════════
-- kb3.* schema v2 — 문서(사례 카드) + 청크(검색 단위) · 세무사 사례 자리
-- (design/새RAG_KB3_구축설계.md D4·D5·D7·D9·D12, 2026-10-05)
-- ════════════════════════════════════════════════════════════════════════════
-- **0041 을 대체한다.** 0041(한 건 = 한 행 = 검색 단위)은 프로덕션에 적용된 적이 없다(2026-10-05 조회:
-- kb3 스키마 없음, 마지막 적용 0040). 심판례 전문은 중앙 11,400자라 한 행에 못 담고, "사실관계로 찾고
-- 요지로 답한다"(설계 §2)를 하려면 검색 단위와 주입 단위를 나눠야 한다 → kbdict.* 와 같은 2단 구조.
-- 0041 이 먼저 적용된 환경이라도 **비어 있으면** 지우고 다시 만든다. 행이 하나라도 있으면 멈춘다.
--
-- LLM2 답변 근거. 권위 서열(D5) = 검수 선례(rag) > 판례 kb3_prec > 심판례 kb3_trib > 국세청 해석
-- kb3_qna > 참고 사전(kbdict). 세무사 사례 kb3_expert 는 에이전트 스튜디오에서 세무사가 게시한
-- 사례(D7, 10/4 결정 — 연결된 세무사 대화에만 적용, 게시는 본인). 층은 corpus 값으로 가른다.
--
-- 내용 출처 규칙(D9, 국내 AI 트랙): 이 테이블의 문장은 원문 그대로(요지·결정문 구간·질의회신)이거나
-- Upstage(solar-pro3)가 만든 것(카드 필드)이거나 세무사가 쓴 것뿐이다. formatted_by 로 남긴다.
--
-- 청크(section):
--   situation   Solar 가 정리한 사실관계(카드의 situation) — 심판례·판례
--   fact_base   결정문 원문의 사실관계 구간(코드 절단, char_start/end = 원문 오프셋) — 심판례
--   qna         질의회신 요지+회신 — 문서 1개 = 청크 1개(검색 경로를 하나로)
--   expert      세무사 사례 본문
-- 어느 청크를 실제로 적재·검색할지는 벤치(설계 §4)가 정한다. 스키마는 둘 다 받는다.
--
-- kbdict.* 와 대칭: 시각 epoch-ms bigint, vector(4096) exact scan(ANN 2000차원 상한 초과 —
-- 청크 ~1만 개라 전수 스캔으로 충분), 방어적 RLS(enable + 정책 없음 = service role 만 통과),
-- 삭제 대신 status='archived'(origin 단위로 되돌린다 — 6규칙 ⑥).
--
-- 이 마이그레이션 뒤에 고칠 코드: backend/api/rag/kb3_store.py(match_documents → match_chunks,
-- upsert 2단), retriever.Kb3Retriever, scripts/kb3_ingest.py. 적용은 사용자 확인 후.
-- ════════════════════════════════════════════════════════════════════════════

do $$
begin
  if to_regclass('kb3.documents') is not null then
    if exists (select 1 from kb3.documents limit 1) then
      raise exception '0042: kb3.documents 에 행이 있다 — 0041 데이터를 옮기는 계획 없이 덮어쓰지 않는다';
    end if;
  end if;
end $$;

drop schema if exists kb3 cascade;
create schema kb3;

-- ── kb3.documents — 사례 카드(프롬프트 주입 단위) ─────────────────────────────
create table kb3.documents (
  id             uuid primary key default gen_random_uuid(),
  case_id        text not null unique,              -- 수집기 식별자(tribunal_조심_2025서1241 · ntstDcmId · 스튜디오 id) — 멱등 키
  corpus         text not null check (corpus in ('kb3_prec', 'kb3_trib', 'kb3_qna', 'kb3_expert')),
  origin         text not null,                     -- 소스 단위 되돌리기 축: 'tt_tribunal_v3' | 'nts_qna' | 'nts_taxlaw' | 'agent_studio'
  case_number    text,                              -- 문서번호(조심 2025서1241 등) — 인용 대조 대상. 세무사 사례는 없음
  title          text not null,
  tax_law        text,                              -- 세법 이름
  tax_category   text,                              -- 세목(원문 [세목] 기준)
  decision_date  text,                              -- 원문 표기 그대로
  decision_type  text,                              -- 기각·취소·경정·재조사(원문 [결정유형]) — 질의회신·세무사 사례는 null
  source_url     text,                              -- 원문 링크. 세무사 사례 외에는 필수(아래 check)
  law_articles   jsonb not null default '[]',       -- 원문 조문 목록(수집기) — 카드의 조문은 card 안에

  -- 카드(LLM2 근거) — 원문 요지 + Solar 구조화 필드
  summary        text,                              -- 원문 결정요지·질의 요지(원문 그대로)
  card           jsonb not null default '{}',       -- {situation, issue, claimant, authority, judgment, law_articles,
                                                    --  situation_quotes, judgment_quotes} — 인용은 원문 구간
  content        text not null,                     -- 프롬프트에 그대로 들어가는 카드 텍스트(머리표 포함)
  formatted_by   text not null,                     -- 'solar-pro3' | 'source'(원문 그대로) | 'expert' — D9 출처 기록
  format_checks  jsonb,                             -- 기계 검사 결과(kb3_trib_format.check) — 적재분은 전부 합격

  -- 세무사 사례 자리(D7) — kb3_expert 에서만 채운다
  expert_id      uuid references auth.users(id) on delete set null,
  publish_state  text check (publish_state in ('draft', 'published')),

  content_hash   text not null,                     -- sha1(content) — 같으면 재기록 생략
  status         text not null default 'active' check (status in ('active', 'archived')),
  created_at     bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at     bigint not null default (extract(epoch from now()) * 1000)::bigint,

  constraint kb3_documents_source_url_required
    check (corpus = 'kb3_expert' or source_url is not null),
  constraint kb3_documents_expert_fields
    check ((corpus = 'kb3_expert') = (publish_state is not null))
);
create index kb3_documents_corpus_idx on kb3.documents (corpus);
create index kb3_documents_origin_idx on kb3.documents (origin);
create index kb3_documents_expert_idx on kb3.documents (expert_id) where expert_id is not null;
comment on table kb3.documents is
  'KB3 v2 — 판례·심판례·질의회신·세무사 사례의 카드. 1건 = 1행 = 주입 단위. 검색은 kb3.chunks.';

-- ── kb3.chunks — 검색 단위 ───────────────────────────────────────────────────
create table kb3.chunks (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references kb3.documents(id) on delete cascade,
  chunk_index  int not null,
  section      text not null check (section in ('situation', 'fact_base', 'qna', 'expert')),
  content      text not null,                     -- 임베딩한 텍스트(embedding-passage 입력 그대로)
  char_start   int,                               -- fact_base: 원문 full_text 오프셋(Python 코드포인트)
  char_end     int,
  embedding    vector(4096) not null,
  content_hash text not null,                     -- sha1(content) = 벡터 캐시 키
  status       text not null default 'active' check (status in ('active', 'archived')),
  created_at   bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at   bigint not null default (extract(epoch from now()) * 1000)::bigint,
  unique (document_id, chunk_index)
);
create index kb3_chunks_document_idx on kb3.chunks (document_id);
comment on table kb3.chunks is
  'KB3 v2 검색 단위 — 사실관계(Solar 정리·원문 구간)·질의회신·세무사 사례. 검색 결과는 문서 단위로 접는다.';

-- ── 검색 헬퍼 — 청크로 찾고 문서(카드)로 돌려준다 ─────────────────────────────
-- 같은 문서의 청크가 여럿 걸리면 최고점 하나로 접는다(사건 단위 중복 제거).
-- 세무사 사례: 게시된 것만. 단 preview_expert_id 를 주면 그 세무사의 초안도 포함(스튜디오 미리보기).
-- filter_corpora: null = 전부. 벤치에서 갈래별로 잴 때 쓴다.
create or replace function kb3.match_chunks(
  query_embedding    vector(4096),
  match_count        int    default 5,
  filter_corpora     text[] default null,
  preview_expert_id  uuid   default null
)
returns table (
  document_id   uuid,
  case_id       text,
  corpus        text,
  case_number   text,
  title         text,
  content       text,
  law_articles  jsonb,
  tax_category  text,
  decision_type text,
  source_url    text,
  expert_id     uuid,
  section       text,
  score         float
)
language sql stable
as $$
  with hits as (
    select c.document_id, c.section, 1 - (c.embedding <=> query_embedding) as score
    from kb3.chunks c
    join kb3.documents d on d.id = c.document_id
    where c.status = 'active' and d.status = 'active'
      and (filter_corpora is null or d.corpus = any(filter_corpora))
      and (d.corpus <> 'kb3_expert'
           or d.publish_state = 'published'
           or (preview_expert_id is not null and d.expert_id = preview_expert_id))
    order by c.embedding <=> query_embedding
    limit greatest(match_count, 1) * 4
  ),
  best as (
    select distinct on (document_id) document_id, section, score
    from hits
    order by document_id, score desc
  )
  select d.id, d.case_id, d.corpus, d.case_number, d.title, d.content, d.law_articles, d.tax_category,
         d.decision_type, d.source_url, d.expert_id, b.section, b.score
  from best b
  join kb3.documents d on d.id = b.document_id
  order by b.score desc
  limit match_count
$$;

-- ── 방어적 RLS: 정책 없음 → service role(직결)만 통과 ──────────────────────────
-- 스튜디오의 세무사 쓰기도 백엔드 API(service role)를 거친다 — 화면에서 직접 쓰지 않는다.
alter table kb3.documents enable row level security;
alter table kb3.chunks enable row level security;
