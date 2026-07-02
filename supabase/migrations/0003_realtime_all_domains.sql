-- ════════════════════════════════════════════════════════════════════════════
-- Workstream A — Realtime publication 확장 (services/*.ts 전면 컷오버 대응)
-- ════════════════════════════════════════════════════════════════════════════
-- 0002 는 협업 핵심 5테이블만 publication 에 넣었으나, 프론트 스토어 컷오버가
-- 10개 도메인을 모두 Realtime 구독하도록 바뀌었다(§4-A "완전 동작").
-- 나머지 6개 비즈니스 테이블도 두 브라우저 간 실시간 반영되도록 추가한다:
--   pool_candidates  — admin 배정 → 풀 상태 실시간
--   auditors         — 평가자 등록/정지 실시간
--   ledger_entries   — 검수 확정 → 평가자 크레딧 실시간
--   settlement_rounds— 정산 공표 실시간
--   training_batches / model_versions — 파이프라인 상태 실시간
-- (line_feedback·session_evaluations·kb_documents 는 A 서비스 컷오버 범위 밖 — 후속.)
-- ════════════════════════════════════════════════════════════════════════════

alter publication supabase_realtime add table public.pool_candidates;
alter publication supabase_realtime add table public.auditors;
alter publication supabase_realtime add table public.ledger_entries;
alter publication supabase_realtime add table public.settlement_rounds;
alter publication supabase_realtime add table public.training_batches;
alter publication supabase_realtime add table public.model_versions;
