-- ════════════════════════════════════════════════════════════════════════════
-- 제출된 일감 잠금 — 제출 뒤엔 자기 코멘트를 추가·수정·삭제할 수 없다
-- ════════════════════════════════════════════════════════════════════════════
-- 0012 는 "검수 확정(finalized)" 뒤의 쓰기를 막았다. 그런데 그 앞 단계인 **제출**
-- 뒤에도 세무사가 코멘트를 계속 고칠 수 있었다. 제출 화면은 이미 "제출 후에는 수정할
-- 수 없습니다"라고 약속하고 있었지만 강제하는 곳이 없었다.
--
-- 왜 막아야 하나: 제출은 "이 내용으로 검수받겠다"는 확정 행위다. 제출 뒤 코멘트가
-- 바뀌면 관리자가 검수 화면에서 본 것과 결정 대상이 어긋나고(이미 인정/거절한 코멘트의
-- 본문이 바뀌는 것까지 가능), 검수 큐에 결정 없는 '보류'가 뒤늦게 끼어든다.
--
-- 잠금 단위는 **평가자별**이다(0012 의 확정 잠금은 대화 전체). 공용 보드라 한 대화를
-- 여럿이 보는데, 내가 제출했다고 아직 작성 중(draft)인 공동 평가자까지 막으면 안 된다.
-- cancelled(포기)는 제출로 치지 않는다.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 내가 이 대화의 일감을 이미 제출했나? (audits RLS 우회용 SECURITY DEFINER) ──
create or replace function public.my_audit_submitted(p_conversation_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.audits a
    where a.conversation_id = p_conversation_id
      and a.auditor_id = public.current_domain_id()
      and a.status not in ('draft', 'cancelled')
  );
$$;

grant execute on function public.my_audit_submitted(text) to authenticated;

-- ── line_feedback 쓰기 정책에 제출 잠금을 얹는다 (0012 정책 재정의) ───────────
-- 조건: 본인 코멘트 + 대화 미확정 + 내 일감 미제출.
drop policy if exists feedback_owner_insert on public.line_feedback;
create policy feedback_owner_insert on public.line_feedback
  for insert with check (
    auditor_id = public.current_domain_id()
    and not public.conversation_finalized(conversation_id)
    and not public.my_audit_submitted(conversation_id)
  );

drop policy if exists feedback_owner_update on public.line_feedback;
create policy feedback_owner_update on public.line_feedback
  for update using (
    auditor_id = public.current_domain_id()
    and not public.conversation_finalized(conversation_id)
    and not public.my_audit_submitted(conversation_id)
  ) with check (
    auditor_id = public.current_domain_id()
    and not public.conversation_finalized(conversation_id)
    and not public.my_audit_submitted(conversation_id)
  );

drop policy if exists feedback_owner_delete on public.line_feedback;
create policy feedback_owner_delete on public.line_feedback
  for delete using (
    auditor_id = public.current_domain_id()
    and not public.conversation_finalized(conversation_id)
    and not public.my_audit_submitted(conversation_id)
  );
-- 조회(feedback_owner_read / feedback_member_read)는 그대로 — 제출해도 볼 수는 있다.

-- ── session_evaluations 도 같은 규칙 (세션 평가 역시 일감의 일부) ─────────────
-- 0007 의 eval_owner_write(for all) 를 행위별로 쪼갠다. for all 은 SELECT 까지 묶여
-- 있어 잠금 조건을 얹으면 본인 평가 조회까지 막힌다 → 읽기는 분리(0012 와 같은 이유).
drop policy if exists eval_owner_write on public.session_evaluations;

create policy eval_owner_read on public.session_evaluations
  for select using (auditor_id = public.current_domain_id());

create policy eval_owner_insert on public.session_evaluations
  for insert with check (
    auditor_id = public.current_domain_id()
    and not public.conversation_finalized(conversation_id)
    and not public.my_audit_submitted(conversation_id)
  );

create policy eval_owner_update on public.session_evaluations
  for update using (
    auditor_id = public.current_domain_id()
    and not public.conversation_finalized(conversation_id)
    and not public.my_audit_submitted(conversation_id)
  ) with check (
    auditor_id = public.current_domain_id()
    and not public.conversation_finalized(conversation_id)
    and not public.my_audit_submitted(conversation_id)
  );

create policy eval_owner_delete on public.session_evaluations
  for delete using (
    auditor_id = public.current_domain_id()
    and not public.conversation_finalized(conversation_id)
    and not public.my_audit_submitted(conversation_id)
  );
