-- ════════════════════════════════════════════════════════════════════════════
-- app_config.rag_enabled: 전역 RAG on/off 를 서버 단일 소스로 영속
-- ════════════════════════════════════════════════════════════════════════════
-- 지금까지 RAG on/off 는 백엔드 env RAG_ENABLED 하나로만 제어됐고 admin 이 바꿀 수
-- 없었다. 이 키를 두면 admin 'RAG' 화면의 ON/OFF 버튼이 여기(1/0)에 쓰고,
-- 백엔드 rag_enabled() 가 요청 단위로 읽어 서버 재시작 없이 즉시 반영한다.
-- (키가 없으면 rag_enabled() 는 env RAG_ENABLED 로 폴백하므로 이 seed 는 선택적이지만,
--  기본 'on(1)'을 명시해 상태를 분명히 한다.)
--
-- 값은 bigint(app_config.value) — 1=ON, 0=OFF. 백엔드는 직결(service role)이라 RLS 무관,
-- 프론트 쓰기는 0006 의 app_config_admin_all(관리자만) 정책으로 보호된다.
insert into public.app_config (key, value) values ('rag_enabled', 1)
  on conflict (key) do nothing;
