-- ════════════════════════════════════════════════════════════════════════════
-- 확정된 대화의 draft audit 정리 — "[검수확정] 했는데 세무사 진행중에 그대로 남던" 문제
-- ════════════════════════════════════════════════════════════════════════════
-- 증상: admin 이 [최종 승인]한 대화가 아직 제출하지 않은 평가자의 '진행중' 목록에 계속 떴다.
--   확정은 그 대화의 리뷰·기여를 **참여자 전원에 대해** 종료한다는 뜻이므로 남으면 안 된다.
--   (게다가 확정 대화는 0012 RLS 가 코멘트 쓰기를 막으므로, 열어도 할 수 있는 일이 없다.)
--
-- 원인: services/review.ts 의 siblingAudits() 가 submitted 이상만 형제로 봤다 → finalize()
--   가 draft 형제를 건드리지 않고 지나갔다. 코드는 함께 고쳤고(draft 포함), 이 마이그레이션은
--   그 사이에 쌓인 기존 행을 같은 규칙으로 소급 정리한다.
--
-- 규칙(코드와 동일):
--   기여 있음(코멘트 또는 세션평가) → finalized : 그 코멘트도 관리자의 인정/거절 대상이었다.
--                                                 완료 목록에서 결과를 볼 자격이 있다.
--   기여 없음                      → cancelled  : 보여 줄 결과가 없다. 진행중·완료 어디에도 안 뜸.
--
-- ledger 는 소급 적립하지 않는다 — append-only 통장이라 과거를 정정하지 않는다(0012 와 동일 원칙).
-- 앞으로 확정되는 건은 finalize() 가 기여한 draft 형제까지 적립한다.
-- ════════════════════════════════════════════════════════════════════════════

with finalized_convs as (
  select distinct a.conversation_id
  from public.reviews r
  join public.audits a on a.id = r.audit_id
  where r.status = 'finalized'
),
stuck as (
  select a.id,
         (
           exists (
             select 1 from public.line_feedback f
             where f.conversation_id = a.conversation_id
               and f.auditor_id = a.auditor_id
           )
           or exists (
             select 1 from public.session_evaluations e
             where e.conversation_id = a.conversation_id
               and e.auditor_id = a.auditor_id
           )
         ) as contributed
  from public.audits a
  join finalized_convs c on c.conversation_id = a.conversation_id
  where a.status = 'draft'
)
update public.audits a
set status = case when s.contributed then 'finalized' else 'cancelled' end
from stuck s
where a.id = s.id;
