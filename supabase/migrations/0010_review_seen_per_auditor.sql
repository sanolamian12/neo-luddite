-- ════════════════════════════════════════════════════════════════════════════
-- reviews: "결과를 봤다" 표시를 평가자별로 분리
-- ════════════════════════════════════════════════════════════════════════════
-- 배경: 검수는 대화 단위다. 한 대화를 여러 평가자가 평가하면 review 는 대표 audit
--   하나에만 붙고 참여자 전원이 그 결과를 공유한다. 그런데 seen_by_auditor_at 은
--   review 당 하나뿐이라, 공동 평가자 중 한 명이 결과를 열면 나머지 사람의
--   "새 결과" 도트까지 함께 꺼졌다.
-- 해결: auditor_id → 본 시각(ms) 맵으로 바꾼다.
alter table public.reviews
  add column if not exists seen_by_auditors jsonb not null default '{}'::jsonb;

-- 기존 값 백필: 그 review 가 붙은 audit 의 평가자가 본 것으로 귀속.
update public.reviews r
set seen_by_auditors = jsonb_build_object(a.auditor_id, r.seen_by_auditor_at)
from public.audits a
where a.id = r.audit_id
  and r.seen_by_auditor_at is not null
  and r.seen_by_auditors = '{}'::jsonb;

-- seen_by_auditor_at 은 더 이상 쓰지 않는다(앱은 seen_by_auditors 만 읽고 쓴다).
-- 롤백 여지를 위해 컬럼 자체는 남겨 둔다.
