-- ════════════════════════════════════════════════════════════════════════════
-- 정성 평가(세션 평가) 검수 — 문장 단위와 나란한 두 번째 검수 갈래
-- ════════════════════════════════════════════════════════════════════════════
-- 배경: 지금까지 검수는 line_feedback(문장 단위 코멘트)만 대상으로 했다.
-- session_evaluations(문장력·법률정확성 점수 + 총평 qualitative)는 세무사가 쓰기만 하고
-- 아무도 결정하지 않았고, RAG 에도 전혀 흘러들지 않았다(0004 의 source_kind CHECK 에
-- 자리 자체가 없었다). 그런데 "이 답변이 왜 부족한가"를 문장이 아니라 세션 전체 수준에서
-- 설명하는 이 총평이 실제로는 가장 밀도 높은 개선 신호다.
--
-- 이 마이그레이션이 여는 것:
--   1. session_evaluations 에 검수 결정(인정/거절)과 두 게이트 상태를 얹는다.
--   2. admin 이 그 결정을 **쓸 수 있게** 한다 (아래 3번 주석 참고 — 지금은 못 쓴다).
--   3. rag.passages 가 'session_eval' 출처를 받아들이게 한다.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. 검수 결정 컬럼 ────────────────────────────────────────────────────────
-- line_feedback 의 결정은 reviews.decisions(jsonb, feedbackId 키)에 모여 있지만,
-- 정성 평가는 (대화, 세무사)당 정확히 한 건이라 행에 직접 다는 편이 조회가 단순하다
-- (0007 의 unique(conversation_id, auditor_id) 가 그 1:1 을 이미 보장한다).
alter table public.session_evaluations
  add column if not exists decision      text,
  add column if not exists decided_at    bigint,
  add column if not exists decided_by    text,
  add column if not exists review_status text not null default 'pending';

-- null = 미결정. 검수 저장은 결정이 있어야만 가능하다(앱에서 버튼 비활성 + 아래 CHECK).
alter table public.session_evaluations
  drop constraint if exists session_eval_decision_check;
alter table public.session_evaluations
  add constraint session_eval_decision_check
  check (decision is null or decision in ('accepted', 'rejected'));

-- 두 게이트 — 문장 단위 검수(reviews.status draft→saved→finalized)와 같은 리듬.
--   pending   : 아직 검수 안 함(결정이 있어도 저장 전)
--   saved     : [검수 저장] 완료 — 세무사에게 열리고 이의 가능 구간
--   finalized : [최종 승인] 완료 — ledger 적립 + RAG 적재. 이후 불변.
alter table public.session_evaluations
  drop constraint if exists session_eval_review_status_check;
alter table public.session_evaluations
  add constraint session_eval_review_status_check
  check (review_status in ('pending', 'saved', 'finalized'));

-- 저장·확정된 건은 반드시 결정을 갖는다(앱 가드의 DB 백스톱).
alter table public.session_evaluations
  drop constraint if exists session_eval_decided_before_save;
alter table public.session_evaluations
  add constraint session_eval_decided_before_save
  check (review_status = 'pending' or decision is not null);

create index if not exists session_eval_review_status_idx
  on public.session_evaluations (review_status);

comment on column public.session_evaluations.decision is
  '관리자 검수 결정: accepted(인정) | rejected(거절) | null(미결정)';
comment on column public.session_evaluations.review_status is
  '검수 두 게이트: pending → saved(검수 저장) → finalized(최종 승인, RAG 적재)';

-- ── 2. admin 쓰기 정책 ───────────────────────────────────────────────────────
-- 지금 session_evaluations 의 쓰기 정책은 전부 소유자 한정이다:
--   eval_owner_insert/update/delete (0013) 은 `auditor_id = current_domain_id()` 를 요구.
-- admin 은 SELECT 만 가능하다(eval_member_read, 0007 의 `public.is_admin()` 갈래).
-- → 이 정책이 없으면 관리자의 결정 UPDATE 가 에러 없이 **0행 갱신**으로 조용히 통과한다
--   (RLS 가 막은 UPDATE 는 실패가 아니라 "대상 없음"이다 — audit-store.ts:230 의
--    deleteFeedback 주석이 같은 함정을 기록해 두었다). 반드시 열어 준다.
drop policy if exists eval_admin_write on public.session_evaluations;
create policy eval_admin_write on public.session_evaluations
  for update using (public.is_admin()) with check (public.is_admin());

-- ── 3. rag.passages: 'session_eval' 출처 허용 ────────────────────────────────
-- 0004 의 인라인 CHECK 는 ('feedback','kb_document','case_seed','conversation') 4종만
-- 받았다. 정성 평가는 특정 문장(segment_id)이 아니라 세션 전체에 걸린 지식이라
-- feedback 으로 위장시킬 수 없다 — 별도 출처로 세운다.
-- (dedupe_key 는 'session_eval:<evaluation id>' 로 멱등. 점수는 metadata 에 싣는다.)
alter table rag.passages drop constraint if exists passages_source_kind_check;
alter table rag.passages
  add constraint passages_source_kind_check
  check (source_kind in ('feedback', 'kb_document', 'case_seed', 'conversation', 'session_eval'));
