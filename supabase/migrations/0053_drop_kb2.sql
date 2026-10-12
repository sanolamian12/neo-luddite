-- 0053 — KB2 스키마 삭제 (10/12, 사용자 결정 "kb2 날려버리자")
-- 이유: Supabase Free DB 한도 0.5GB 중 0.42GB 사용 — kb2.sentences 81MB(대부분 4096차원 임베딩)가 셋째로 큰 테이블.
--       KB2 는 9/23 설계 피벗으로 폐기됐고(판정 권위 = LLM2, 운영 RAG_SOURCE=kb3), 코드는 KB2=on 일 때만 kb2 를 본다(기본 off).
-- 사전 점검(10/12, 읽기 전용): kb2 밖 객체의 의존 없음 — 뷰·FK·함수 본문·트리거·cron·Realtime publication 모두 0.
-- 백업: backend/data/kb2_backup_1012/*.csv (임베딩 제외 텍스트 7개 테이블, 5.66MB, git 제외).
-- 되돌리기: 0029~0031 계열 kb2 마이그레이션으로 스키마를 다시 만들고 CSV 를 넣은 뒤 재임베딩(복구할 일은 없을 것으로 본다).

drop schema if exists kb2 cascade;
