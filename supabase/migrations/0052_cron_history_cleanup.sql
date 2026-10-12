-- 0052 — pg_cron 실행 이력 정리 (10/12, Supabase DB 크기 0.432/0.5GB = 86% 대응)
-- docs/doing/261012_Supabase_egress초과_진단_및_대응.md §4-4 후보 ①.
-- cron.job_run_details 는 매분·매시 잡(스냅샷 정지·폴러·엣지 재계산 등)의 실행 기록이 쌓이기만 한다(15.7만 행 이상).
-- ① 7일보다 오래된 이력을 지우고 ② 매일 같은 정리를 건다.
--
-- ⚠️ DELETE 만으로는 디스크(=Supabase Database Size)가 바로 줄지 않는다(죽은 튜플은 autovacuum 이 재사용 표시만).
--    적용 뒤 별도로 한 번:  vacuum full cron.job_run_details;   (트랜잭션 밖에서 — 마이그레이션 파일에 넣지 않는다)

delete from cron.job_run_details where end_time < now() - interval '7 days';

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'cron-history-cleanup') then
      perform cron.unschedule('cron-history-cleanup');
    end if;
    -- 매일 04:10 KST
    perform cron.schedule('cron-history-cleanup', '10 19 * * *',
      $cron$delete from cron.job_run_details where end_time < now() - interval '7 days'$cron$);
  end if;
end $$;
