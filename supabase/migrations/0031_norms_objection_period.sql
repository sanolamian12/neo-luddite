-- ════════════════════════════════════════════════════════════════════════════
-- norms 확정 거버넌스 ② — 이의 기간 (KB통합 3층검색 로드맵 P6, 2026-09-17)
-- ════════════════════════════════════════════════════════════════════════════
-- 이전(0030): 초안 → 세무사 1명 확정 = 즉시 전역 반영.
-- 이후: 초안 → **공개(pending)** → 반영(confirmed). 공개 순간 이의 기간(기본 1일)이 시작된다.
--
--   draft     초안 — admin·세무사 누구나 작성·수정·폐기. 답변 영향 없음.
--   pending   공개 중 — 세무사가 승인·이의를 남긴다. 답변 영향 없음.
--             · 빠른 길: 작성자·공개자를 뺀 세무사 승인이 문턱(기본 2명, 백엔드 NORMS_FAST_APPROVALS)
--               이상이고 유효 이의가 0이면 즉시 반영.
--             · 디폴트 승인: 기한(deadline_at)이 지났고 유효 이의가 0이면 자동 반영(침묵 = 동의).
--             · 이의가 하나라도 살아 있으면 보류 — 이의 철회 또는 수정(→ draft 로 복귀, 승인·이의 전부
--               무효, 재공개 시 기한 새로 시작)으로만 풀린다. 승인 수는 이의를 이기지 못한다.
--   confirmed 반영됨. applied_via = 'approvals' | 'deadline' ('direct' = 0030 시절의 1인 확정).
--   discarded 폐기.
--
-- 자동 반영은 pg_cron 이 아니라 백엔드 폴러(api/prompts/governance 스케줄러, 60초)가 한다 —
-- 반영 전 예산 검사(build_norms)가 Python 에 있기 때문(kb2_scheduler 와 같은 판단). 진실은 이 테이블이라
-- 서버가 내려가 있어도 기한 지난 제안은 기동 직후 반영된다.
-- ════════════════════════════════════════════════════════════════════════════

alter table norms.versions drop constraint versions_status_check;
alter table norms.versions add constraint versions_status_check
  check (status in ('draft', 'pending', 'confirmed', 'discarded'));

-- 문서당 "열린 제안"(초안 또는 공개 중)은 하나.
drop index norms.norms_versions_one_draft;
create unique index norms_versions_one_open on norms.versions (document_id)
  where status in ('draft', 'pending');

alter table norms.versions
  add column published_by text,     -- 공개한 사람 도메인 id (승인 집계에서 제외)
  add column published_at bigint,
  add column deadline_at  bigint,   -- 이 시각이 지나고 유효 이의가 없으면 자동 반영
  add column applied_via  text check (applied_via in ('direct', 'approvals', 'deadline'));

update norms.versions set applied_via = 'direct' where status = 'confirmed';

create index norms_versions_pending_deadline_idx on norms.versions (deadline_at) where status = 'pending';

-- ── norms.decisions — 공개 중 제안에 대한 세무사 승인·이의 ─────────────────────────
-- 삭제 없음: 철회·수정 리셋은 withdrawn_at 으로 남긴다(누가 언제 무엇을 했는지 이력).
create table norms.decisions (
  id              uuid primary key default gen_random_uuid(),
  version_id      uuid not null references norms.versions(id) on delete cascade,
  auditor_id      text not null,                                   -- profiles.domain_id (토큰 신원)
  decision        text not null check (decision in ('approve', 'object')),
  reason          text,                                            -- 이의는 필수(백엔드 검사)
  created_at      bigint not null default (extract(epoch from now()) * 1000)::bigint,
  withdrawn_at    bigint,
  withdrawn_by    text,                                            -- 본인 철회면 본인, 수정 리셋이면 수정자
  withdraw_reason text                                             -- 'withdrawn' | 'changed' | 'reset:edited'
);
-- 한 세무사의 유효 결정은 제안당 하나(승인→이의로 바꾸면 이전 것을 철회 처리 후 새로 기록).
create unique index norms_decisions_one_live on norms.decisions (version_id, auditor_id)
  where withdrawn_at is null;
create index norms_decisions_version_idx on norms.decisions (version_id, created_at);

alter table norms.decisions enable row level security;

comment on table norms.decisions is
  'L0 규범 공개 제안에 대한 세무사 승인·이의 — 철회는 withdrawn_at(삭제 없음).';
