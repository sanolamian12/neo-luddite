-- ════════════════════════════════════════════════════════════════════════════
-- 정산 회차 — 총수익 × 분배비율로 pool 산정
-- ════════════════════════════════════════════════════════════════════════════
-- 종전 pool 은 관리자가 임의로 타이핑하는 추상 숫자였다(실제 수익과 무관).
-- 이제 관리자가 "이번 회차 소프트웨어 활동으로 벌어들인 총수익"과 "그중 세무사
-- 에게 나눌 비율(%)"을 입력하면 pool = floor(revenue * distribution_ratio / 100)
-- 로 계산된다. pool 컬럼은 계산 결과를 그대로 저장(발행 시점 스냅샷, 감사 추적용).

alter table public.settlement_rounds
  add column revenue           bigint  not null default 0,
  add column distribution_ratio numeric not null default 0;

comment on column public.settlement_rounds.revenue is
  '이번 회차 소프트웨어 활동 총수익(원). 관리자 수동 입력.';
comment on column public.settlement_rounds.distribution_ratio is
  '총수익 중 세무사에게 분배할 비율(0~100, %). pool = floor(revenue * distribution_ratio / 100).';
