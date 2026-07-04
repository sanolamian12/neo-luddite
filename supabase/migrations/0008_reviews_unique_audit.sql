-- ════════════════════════════════════════════════════════════════════════════
-- reviews: audit 당 review 1개 불변식 강제 (중복 review 버그 봉쇄)
-- ════════════════════════════════════════════════════════════════════════════
-- 증상: 검수 진입 이펙트(services/review.startOrGet)가 스토어 반영 전에 경쟁적으로
--   두 번 실행되어 같은 audit_id 로 review 행이 2개 생겼다. 재진입 시
--   reviews.find(auditId) 가 빈 draft 를 먼저 집어 "결정이 저장 안 된 것처럼" 보였다.
-- 모델 불변식: 한 audit ↔ review 하나. 이를 DB 레벨에서 강제한다.
--
-- 1) 기존 중복 정리: audit_id 별로 (finalized 우선 → decisions 많은 순 → 최신순) 하나만 남김.
delete from public.reviews r
using (
  select id,
         row_number() over (
           partition by audit_id
           order by (status = 'finalized') desc,
                    jsonb_array_length(decisions) desc,
                    created_at desc
         ) as rn
  from public.reviews
) ranked
where r.id = ranked.id and ranked.rn > 1;

-- 2) 유니크 제약 — 이후 중복 insert 는 DB 가 거부(앱은 on-conflict 로 기존본 조회).
create unique index if not exists reviews_audit_id_key on public.reviews (audit_id);
