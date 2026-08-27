-- ════════════════════════════════════════════════════════════════════════════
-- RAG passage 수정 제안 큐 (§3.4 admin 승인/반려 워크플로우)
-- ════════════════════════════════════════════════════════════════════════════
-- 기여 정책 확정(2026-08-27): 세무사가 기존 passage 내용을 수정해도 **원작성자의
-- 존속기간 기여는 그대로 유지**하고, 수정은 이력으로만 남긴다(별도 크레딧 없음).
-- 그래서 이 테이블은 rag.passages.reviewer/auditor_id 를 절대 바꾸지 않는다 —
-- 승인 시 content/embedding 만 갱신하고 귀속(attribution)은 원본 그대로 둔다.
--
-- pending 동안은 rag.passages 를 건드리지 않는다(검색·정산 집계에 영향 없음).
-- approve 시점에 한해 content 재임베딩 후 passages 를 갱신 → 승인 게이트가 실질적.

create table rag.passage_edits (
  id                uuid primary key default gen_random_uuid(),
  passage_id        uuid not null references rag.passages(id) on delete cascade,

  original_content  text not null,   -- 제안 시점의 passages.content 스냅샷(diff 표시용)
  proposed_content  text not null,

  editor_auditor_id text not null,   -- 수정을 제안한 세무사(신원) — 크레딧과 무관, 이력용
  editor_reviewer   text,            -- 표시이름

  status            text not null default 'pending'
                       check (status in ('pending', 'approved', 'rejected')),
  admin_id          text,            -- 승인/반려한 admin
  admin_note        text,            -- 반려 사유 등

  created_at        bigint not null default (extract(epoch from now()) * 1000)::bigint,
  reviewed_at        bigint
);
comment on table rag.passage_edits is
  'passage 내용 수정 제안 큐. 승인 전엔 rag.passages 불변 — 승인 시점에만 content/embedding 갱신, 귀속(reviewer/auditor_id)은 원작성자 유지(수정은 이력만).';

create index passage_edits_passage_id_idx on rag.passage_edits (passage_id);
create index passage_edits_status_idx     on rag.passage_edits (status);

-- 같은 passage 에 대기 중인 제안이 동시에 여러 개 쌓이지 않도록(한 번에 하나만 검토).
create unique index passage_edits_one_pending_per_passage
  on rag.passage_edits (passage_id)
  where status = 'pending';

alter table rag.passage_edits enable row level security;
-- 방어적 RLS: 정책 없음 → service role(백엔드 직결)만 통과, anon/authenticated 차단.
