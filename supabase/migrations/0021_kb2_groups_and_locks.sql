-- ════════════════════════════════════════════════════════════════════════════
-- kb2 2단 트리(대목/세목) + 문장 이동 + 편집 락
-- ════════════════════════════════════════════════════════════════════════════
-- 20개를 넘어가는 세목(kb2.documents)을 auditor가 수동으로 대목(kb2.groups)으로 묶어
-- 정리할 수 있게 한다 — AI 합성과는 무관한 순수 UI 정리 계층. 동시에 여러 세무사가
-- 같은 문장을 편집하는 상황(git merge 개념 없음, 나중 저장이 덮어씀)을 막기 위해
-- kb2.sentences 에 문장 단위 비관적 락(잠깐 열었다 스스로 닫히는 편집 락, TTL 5분
-- 자동회수 — 0012/0013의 finalized/submitted 락과는 다른 성격이라 새로 설계)을 둔다.
-- ════════════════════════════════════════════════════════════════════════════

create table kb2.groups (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  status      text not null default 'active' check (status in ('active', 'archived')),
  created_at  bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at  bigint not null default (extract(epoch from now()) * 1000)::bigint
);
comment on table kb2.groups is
  '대목 — 세목(kb2.documents)을 auditor가 수동으로 묶는 상위 그룹. AI 합성과 무관, 순수 UI 정리용.';

alter table kb2.documents
  add column group_id uuid references kb2.groups(id);
comment on column kb2.documents.group_id is
  'null = "미분류"(트리에서 가상 그룹으로 표시, DB row 아님).';

alter table kb2.sentences
  add column locked_by        text,     -- 현재 편집 중인 auditor id (null = 안 잠김)
  add column lock_acquired_at bigint;   -- epoch ms, TTL(5분) 계산용 — backend/api/rag/kb2_store.LOCK_TTL_MS

alter table kb2.sentence_versions
  drop constraint sentence_versions_editor_type_check,
  add constraint sentence_versions_editor_type_check
    check (editor_type in ('system_synthesis', 'auditor_edit', 'admin_revert', 'moved')),
  add column meta jsonb;
comment on column kb2.sentence_versions.meta is
  '이동 등 부가 메타(예: {"fromDocumentId":..,"toDocumentId":..}) — attribution_snapshot은 크레딧 전용으로 유지.';

alter table kb2.groups enable row level security;
