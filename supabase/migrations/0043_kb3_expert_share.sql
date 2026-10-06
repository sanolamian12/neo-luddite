-- 0043 — 세무사 사례(kb3_expert) 전용 RAG · 공용 KB3 공유 승인 (2026-10-06)
--
-- 사용자 결정(10/6):
--   · 세무사마다 전용 RAG — 본인이 가르쳐 '게시'한 사례는 **그 세무사에게 연결된 대화에만** 쓰인다.
--   · '공용 KB 로 보내기' → 관리자 승인 대기(pending) → 승인(approved) 시 공용 KB3(모든 챗) + 크레딧(ledger).
--   · KB3 공용(심판례·질의회신 + 승인된 세무사 사례)은 모든 세무사 에이전트의 바닐라 RAG.
--
-- 0042 의 match_chunks 는 '게시된 세무사 사례 = 모든 챗'이었다 → 범위를 셋으로 가른다:
--   공용     corpus <> kb3_expert  또는  (게시 + 공유 승인)
--   에이전트 agent_expert_id 의 게시분(공유 여부 무관)
--   미리보기 preview_expert_id 의 초안 포함 전부
-- 적용 전 kb3_expert 행은 0건(10/6 확인 예정) — 기존 게시분이 공용에서 빠지는 일은 없다.

alter table kb3.documents
  add column if not exists share_state        text check (share_state in ('pending', 'approved', 'rejected')),
  add column if not exists share_requested_at bigint,
  add column if not exists share_reviewed_at  bigint,
  add column if not exists share_reviewed_by  text,       -- 관리자 domain_id
  add column if not exists share_note         text;

alter table kb3.documents drop constraint if exists kb3_documents_share_expert_only;
alter table kb3.documents add constraint kb3_documents_share_expert_only
  check (share_state is null or corpus = 'kb3_expert');

create index if not exists kb3_documents_share_pending_idx
  on kb3.documents (share_requested_at) where share_state = 'pending';

-- 시그니처가 바뀌므로(인자 추가) 옛 함수를 지우고 만든다 — create or replace 는 오버로드를 남겨 호출이 모호해진다.
drop function if exists kb3.match_chunks(vector, int, text[], uuid);

create or replace function kb3.match_chunks(
  query_embedding    vector(4096),
  match_count        int    default 5,
  filter_corpora     text[] default null,
  preview_expert_id  uuid   default null,
  agent_expert_id    uuid   default null
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
           or (d.publish_state = 'published' and d.share_state = 'approved')
           or (agent_expert_id is not null and d.expert_id = agent_expert_id and d.publish_state = 'published')
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
