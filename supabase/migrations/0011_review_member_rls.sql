-- ════════════════════════════════════════════════════════════════════════════
-- reviews/audits RLS: "같은 대화 멤버" 모델로 확장 (공동 평가자가 검수 결과를 못 보던 문제)
-- ════════════════════════════════════════════════════════════════════════════
-- 증상: 한 대화를 auditor2·auditor3 이 공동 평가하면, review 는 대표 audit(먼저 제출한
--   auditor2 의 것) 하나에만 붙는다. 그런데 RLS 가 owner 기준이라
--     ① reviews_auditor_read: "내 audit 의 review" 만 → auditor3 은 review 행 자체가 안 보임
--     ② audits_owner: "내 audit" 만 → auditor3 은 형제 audit 도 못 봐서 폴백 조회도 불가
--   결과: auditor3 의 완료 목록/상세가 인정·거절 없이 텅 빈 채로 뜬다(상태만 '검수저장').
--
-- 0007 이 line_feedback/session_evaluations 를 "같은 대화 멤버 상호 열람" 으로 이미
-- 바꿨는데, audits/reviews 는 owner 모델에 남아 있었다. 그 간극을 메운다.
--
-- 주의: audits 의 SELECT 정책이 audits 를 다시 참조하면 RLS 재귀에 빠진다.
--   → security definer 헬퍼로 RLS 를 우회해 내가 속한 대화 id 를 뽑는다.

-- ── 내가 참여(=audit 보유)한 대화 id 집합 ────────────────────────────────────
create or replace function public.my_conversation_ids()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select a.conversation_id
  from public.audits a
  where a.auditor_id = public.current_domain_id();
$$;

-- ── 이 review(=audit_id)가 내가 참여한 대화의 것인가? ────────────────────────
create or replace function public.is_review_member(p_audit_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.audits a
    where a.id = p_audit_id
      and a.conversation_id in (select public.my_conversation_ids())
  );
$$;

grant execute on function public.my_conversation_ids() to authenticated;
grant execute on function public.is_review_member(text) to authenticated;

-- ── audits: 같은 대화 멤버끼리 상호 열람(쓰기는 여전히 본인 것만) ─────────────
-- 클라이언트가 형제 audit 을 알아야 대화 단위 review 를 찾고 공동 평가자를 표시할 수 있다.
drop policy if exists audits_member_read on public.audits;
create policy audits_member_read on public.audits
  for select using (
    conversation_id in (select public.my_conversation_ids())
  );

-- ── reviews: 내 audit 이 아니라 "내가 참여한 대화" 기준으로 열람·확인표시 ──────
drop policy if exists reviews_auditor_read on public.reviews;
create policy reviews_auditor_read on public.reviews
  for select using (public.is_review_member(reviews.audit_id));

drop policy if exists reviews_auditor_seen on public.reviews;
create policy reviews_auditor_seen on public.reviews
  for update using (public.is_review_member(reviews.audit_id))
  with check (true);
