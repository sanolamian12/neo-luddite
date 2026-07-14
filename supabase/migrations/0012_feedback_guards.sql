-- ════════════════════════════════════════════════════════════════════════════
-- 코멘트(line_feedback) 3대 방어 — 확정 잠금 · 분류 필수 · 중복 차단
-- ════════════════════════════════════════════════════════════════════════════
-- 팀 테스트에서 드러난 구멍 3개. 쓰기 경로가 브라우저 → Supabase 직접 insert 라서
-- 클라이언트 가드만으로는 (다른 탭·경쟁 삽입·직접 호출) 우회된다 → DB 를 최종 방어선으로.
--
-- ① 확정 잠금: admin 이 [최종 승인]한 대화에 세무사가 코멘트를 계속 달 수 있었다.
--    확정 뒤엔 setDecision 이 거부되므로(services/review.ts) 그 코멘트는 인정도 거절도
--    못 받는 '보류'로 영영 남아 검수 큐를 오염시킨다. → 확정 대화는 쓰기 자체를 막는다.
-- ② 분류 필수: tags 가 비어도 저장됐다. 분류 없는 코멘트는 RAG 적재 시 어느 갈래로
--    넣을지 판단할 근거가 없다. → cardinality(tags) >= 1 강제.
-- ③ 중복 차단: 같은 문장에 글자까지 같은 코멘트가 반복 저장됐다. → 유니크 인덱스.
--
-- 사전 조사(적용 시점 실측): 코멘트 584건 중 무태그 217건 · 정확중복 37건.
--   둘 다 rag.passages 적재분 0건, 무태그에 붙은 reviews.decisions 0건 →
--   삭제해도 RAG 고아 passage·고아 결정이 생기지 않는다(그래서 지금 정리한다).
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. 무태그 코멘트 정리 (분류 없이 저장된 217건) ────────────────────────────
-- RAG 에 들어간 적 없고 관리자 결정도 안 붙은 행들이라 안전하게 제거한다.
-- (확정 대화 소속 17건 포함 — ledger 는 append-only 통장이라 소급 정정하지 않는다.)
delete from public.line_feedback where cardinality(tags) = 0;

-- ── 2. 중복 코멘트 정리 (같은 대화·문장·문자열 중 2번째 이후) ────────────────
-- 남기는 기준: 가장 먼저 쓴 1건(created_at, 동률이면 id).
with ranked as (
  select id,
         row_number() over (
           partition by conversation_id, segment_id,
                        lower(regexp_replace(btrim(body), '\s+', ' ', 'g'))
           order by created_at, id
         ) as rn
  from public.line_feedback
)
delete from public.line_feedback f
using ranked r
where f.id = r.id and r.rn > 1;

-- ── 3. 분류 필수 CHECK (앞의 정리로 기존 행도 전부 통과 → 즉시 검증) ──────────
alter table public.line_feedback
  drop constraint if exists line_feedback_tags_required;
alter table public.line_feedback
  add constraint line_feedback_tags_required
  check (
    cardinality(tags) >= 1
    and tags <@ array['legal_error', 'grammar_error', 'suggestion']::text[]
  );

-- ── 4. 중복 차단 유니크 인덱스 ────────────────────────────────────────────────
-- 스코프: 대화 × 문장 × 정규화 본문 (작성자 불문 — 공용 보드에선 남이 쓴 같은 말도 중복).
-- 정규화 규칙은 프론트 feedbackDedupeKey() 와 동일: 앞뒤/중복 공백 축약 + 소문자화.
create unique index if not exists line_feedback_no_dup_per_segment
  on public.line_feedback (
    conversation_id,
    segment_id,
    (lower(regexp_replace(btrim(body), '\s+', ' ', 'g')))
  );

-- ── 5. "이 대화의 검수가 확정됐나?" (RLS 에서 쓸 SECURITY DEFINER 헬퍼) ────────
-- reviews/audits 의 RLS 를 우회해야 세무사 세션에서도 확정 여부를 정확히 판정한다.
-- 검수는 대화 단위 → 형제 audit 중 하나라도 확정이면 대화 전체가 확정.
create or replace function public.conversation_finalized(p_conversation_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.reviews r
    join public.audits a on a.id = r.audit_id
    where a.conversation_id = p_conversation_id
      and r.status = 'finalized'
  );
$$;

grant execute on function public.conversation_finalized(text) to authenticated;

-- ── 6. RLS: 확정된 대화엔 코멘트 쓰기(추가·수정·삭제) 금지 ────────────────────
-- 0007 의 feedback_owner_write(for all) 를 행위별로 쪼갠다. for all 은 SELECT 까지
-- 묶여 있어 잠금 조건을 얹으면 본인 코멘트 조회까지 막힐 수 있다 → 읽기는 분리.
drop policy if exists feedback_owner_write on public.line_feedback;

create policy feedback_owner_read on public.line_feedback
  for select using (auditor_id = public.current_domain_id());

create policy feedback_owner_insert on public.line_feedback
  for insert with check (
    auditor_id = public.current_domain_id()
    and not public.conversation_finalized(conversation_id)
  );

create policy feedback_owner_update on public.line_feedback
  for update using (
    auditor_id = public.current_domain_id()
    and not public.conversation_finalized(conversation_id)
  ) with check (
    auditor_id = public.current_domain_id()
    and not public.conversation_finalized(conversation_id)
  );

create policy feedback_owner_delete on public.line_feedback
  for delete using (
    auditor_id = public.current_domain_id()
    and not public.conversation_finalized(conversation_id)
  );
-- 조회는 0007 의 feedback_member_read(같은 대화 멤버 + admin)가 그대로 유지된다.
