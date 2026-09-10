-- ════════════════════════════════════════════════════════════════════════════
-- kb2 세목 연결 끊기/재연결 + 대목 삭제 (로드맵 §7 "다음 세션 후보" 4번, 2026-09-10)
-- ════════════════════════════════════════════════════════════════════════════
-- 지금까지 대목/세목에는 "자동으로 안 지운다"만 있고 사람이 정리할 수단이 없었다.
-- 두 계층의 성격이 달라 다른 수단을 준다(사용자 결정, 2026-09-10):
--
--   세목(kb2.documents) = 지식이 들어있는 그릇 → 삭제가 아니라 연결 끊기.
--     문장 단위(0022)·배선실(rag.passages)과 같은 철학. 사유(reason) 필수.
--   대목(kb2.groups)    = 지식이 없는 순수 정리 계층 → 삭제 허용.
--     삭제해도 속한 세목은 안 지우고 "미분류"로 풀려난다(group_id = null).
--
-- 세목 상태를 'archived' 가 아니라 새 값 'retired' 로 둔 이유: 'archived' 는 이미
-- "재구조화로 세대교체됨"이라는 뜻으로 쓰이고 있다(0020). 사람이 의도적으로 끊은 것과
-- 재구조화가 갈아엎은 것은 구분돼야 화면에서도 이력에서도 헷갈리지 않는다.
--
-- kb2.match_sentences 는 이미 d.status = 'active' 만 검색하므로 retired 세목의 문장은
-- 자동으로 검색에서 빠진다 — SQL 함수 변경 불필요(0022와 같은 이유).
-- ════════════════════════════════════════════════════════════════════════════

alter table kb2.documents
  drop constraint documents_status_check,
  add constraint documents_status_check
    check (status in ('active', 'archived', 'retired'));

alter table kb2.groups
  drop constraint groups_status_check,
  add constraint groups_status_check
    check (status in ('active', 'archived', 'deleted'));

-- ── 누가 왜 끊었는지 ────────────────────────────────────────────────────────
-- 문장은 kb2.sentence_versions 에 사유를 남기지만(0022) 세목엔 버전 테이블이 없다.
-- 문서 수준 사건만 담는 가벼운 이력 테이블을 따로 둔다 — 문서 row 에 사유 컬럼을
-- 붙이면 마지막 사유만 남아 "왜 끊었다 다시 연결했나"를 못 따라간다.
create table kb2.document_events (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references kb2.documents(id) on delete cascade,
  event_type  text not null
                check (event_type in ('retired', 'reconnected', 'group_detached')),
  reason      text not null default '',
  actor_id    text not null default '',
  created_at  bigint not null default (extract(epoch from now()) * 1000)::bigint
);
comment on table kb2.document_events is
  '세목(문서) 수준 사건 이력 — 연결 끊기/재연결 사유와 행위자, 대목 삭제로 인한 미분류 전환.';

create index document_events_document_idx
  on kb2.document_events (document_id, created_at desc);

alter table kb2.document_events enable row level security;
