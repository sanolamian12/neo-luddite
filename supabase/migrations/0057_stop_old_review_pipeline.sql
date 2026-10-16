-- 0057 — 옛 검수 흐름 멈춤 (S0, 2026-10-16) — design/옛검수흐름_절단_로드맵_1016.md
--
-- 10/5 결정(하차장·일감·검수실·배선실·RAG 지식망은 쓰지 않음) · 10/16 사용자 "5분 얼려서 하차장으로 보내는
-- 프로세스는 확실하게 끊어내자". 이 마이그레이션은 **돌고 있는 작업만 멈춘다**(되돌릴 수 있음):
--   ① snapshot-settled-conversations (매분, 0006) — 사장님 대화를 5분 뒤 정지 사진으로 찍던 작업
--   ② rebuild-passage-edges (5분마다, 0018) — RAG 지식망 그래프(rag.passage_edges) 재계산(시각화 전용, 검색 무관)
--   ③ app_config.freeze_ms 행 — ①만 읽던 값. rag_enabled(검색 전체 스위치)는 남긴다.
-- 남기는 것: cron-history-cleanup(0052) · purge-stale-expert-applications(0049) · 스냅샷 칸·트리거·함수(S4·S6 에서)
--   · conversations 행 자체(사장님 대화 목록·상담 신청·방·상담사 풀이 쓴다).
-- 효과: 새 대화에 snapshot_at 이 안 찍힌다 → 3자 방 원문은 snapshotPayload ?? payload 라 현재 대화로 보인다(D6, 의도).
-- 되돌리기: 0006:103 · 0018:80 의 cron.schedule 문 그대로, freeze_ms = 300000 행 다시 넣기.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'snapshot-settled-conversations') then
    perform cron.unschedule('snapshot-settled-conversations');
  end if;
  if exists (select 1 from cron.job where jobname = 'rebuild-passage-edges') then
    perform cron.unschedule('rebuild-passage-edges');
  end if;
end $$;

delete from public.app_config where key = 'freeze_ms';
