-- ════════════════════════════════════════════════════════════════════════════
-- kb2 문장 연결/연결 끊기 (배선실 재연결 패턴을 KB2 문장에 적용, 2026-09-09)
-- ════════════════════════════════════════════════════════════════════════════
-- rag.passages 의 연결끊기/재연결(status active/retired, backend/api/rag/store.py
-- set_status)과 같은 개념을 kb2.sentences 에도 둔다 — 삭제가 아니라 상태 전환,
-- retired 는 kb2.match_sentences 검색에서 제외. rag 쪽과 다른 점: 여기는 끊거나
-- 다시 연결할 때 사유(reason)를 필수로 받아 kb2.sentence_versions 에 남긴다(누가
-- 왜 이 지식의 연결을 끊었는지 추적 가능해야 한다는 요구사항, 2026-09-09).
-- ════════════════════════════════════════════════════════════════════════════

alter table kb2.sentences
  add column status text not null default 'active' check (status in ('active', 'retired'));

alter table kb2.sentence_versions
  drop constraint sentence_versions_editor_type_check,
  add constraint sentence_versions_editor_type_check
    check (editor_type in (
      'system_synthesis', 'auditor_edit', 'admin_revert', 'moved', 'retired', 'reconnected'
    ));

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
    and s.status = 'active'
    and (filter_category is null or d.tax_category = filter_category)
  order by s.embedding <=> query_embedding
  limit match_count
$$;
