-- ════════════════════════════════════════════════════════════════════════════
-- kb2 재구조화 — 야간 배치 예약 + 카테고리 레이블 정리 (2026-09-10)
-- ════════════════════════════════════════════════════════════════════════════
-- 배경(사용자 지적, 2026-09-09): "세무사가 버튼 한 번으로 큰 작업에 들어가면 안 된다."
-- 재구조화는 실측 413개 활성 passage 를 전부 LLM 에 태우는 작업이라(분류 단계만 순차
-- 호출 기준 ~35분) 근무 시간 중 즉시 실행은 부적절하다. 그래서 job 을 "지금 실행"이
-- 아니라 "예약(scheduled)" 상태로도 만들 수 있게 한다.
--
-- pg_cron 을 쓰지 않은 이유: 이 레포의 pg_cron 선례(0006 하차장 스냅샷)는 순수 SQL
-- 함수를 도는 작업이라 DB 안에서 완결된다. 반면 재구조화는 Upstage API 호출(Python)이
-- 본체라 DB 가 스스로 수행할 수 없다 — pg_cron 이 할 수 있는 건 pg_net 으로 백엔드를
-- 깨우는 것뿐인데, 그건 백엔드 폴러 한 개보다 부품이 늘어난다. 대신 백엔드가
-- (uvicorn --workers 1, always-on) 이 테이블을 1분마다 폴링해 만기된 예약을 집어간다
-- (backend/api/rag/kb2_scheduler.py). 예약 시각은 이 테이블이 유일한 진실이라 백엔드가
-- 재시작·크래시해도 예약이 사라지지 않는다.
-- ════════════════════════════════════════════════════════════════════════════

alter table kb2.synthesis_jobs
  drop constraint synthesis_jobs_status_check,
  add constraint synthesis_jobs_status_check
    check (status in ('scheduled', 'running', 'done', 'error', 'cancelled'));

-- 실행 예정 시각(epoch ms). null 이면 즉시 실행 job(기존 동작 그대로).
-- 시각은 프론트(브라우저 로컬 시간=KST)가 계산해 epoch ms 로 보낸다 — 서버가 도쿄
-- 박스라 서버 로컬 시간으로 "새벽 3시"를 해석하면 의도와 어긋날 수 있다.
alter table kb2.synthesis_jobs
  add column scheduled_at bigint;

alter table kb2.synthesis_jobs
  add column trigger_source text not null default 'manual'
    check (trigger_source in ('manual', 'scheduled'));

comment on column kb2.synthesis_jobs.scheduled_at is
  '예약 실행 시각(epoch ms). 백엔드 폴러가 이 시각이 지난 scheduled job 을 집어 running 으로 전환한다.';

-- 만기 예약 조회용 — 폴러가 1분마다 때리는 쿼리.
create index if not exists synthesis_jobs_due_idx
  on kb2.synthesis_jobs (scheduled_at)
  where status = 'scheduled';

-- ── kb2.categories 정리 ─────────────────────────────────────────────────────
-- 재구조화는 이전 활성 "문서"만 archive 하고 "카테고리 레이블"은 그대로 뒀다. 그래서
-- 재실행할 때마다 레이블이 계속 쌓였다(실측 2026-09-10: 활성 카테고리 31개 vs 활성
-- 문서 17개 — 14개가 지난 회차의 잔해). 기능엔 영향이 없지만 카테고리 목록을 보여주는
-- 화면에서 존재하지 않는 세목이 섞여 보인다.
--
-- 이후로는 백엔드가 재구조화 시작 시 문서와 함께 카테고리도 archive 한다
-- (kb2_store.archive_all_active_categories). 여기서는 이미 쌓인 잔해만 소급 정리:
-- "활성인데 활성 문서가 하나도 안 달린 카테고리" = 지난 회차 잔해. 삭제가 아니라
-- archived 전환이라 되돌릴 수 있고, documents.category_id 참조도 그대로 유지된다.
update kb2.categories c
   set status = 'archived'
 where c.status = 'active'
   and not exists (
     select 1 from kb2.documents d
      where d.category_id = c.id and d.status = 'active'
   );
