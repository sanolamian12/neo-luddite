-- 0062 가상 세무사(auditor·auditor2·auditor3) 이름 뒤에 "(AI)" (2026-10-21)
--
-- 근거: 사용자 요청(10/21) — 커뮤니티 공개(사용 현황 M1) 전에 실존 세무사로 오인되지 않게 표시.
-- 대상: public.auditors.display_name 만(세무사 카드·연결 화면·3자 방 헤더에 쓰이는 이름). 0055 와 같은 데이터 마이그레이션.
--   profiles.label·display_name("평가자"·"평가자2·3") 은 로그인 계정 라벨이라 그대로 둔다.
-- 이미 "(AI)" 로 끝나면 건드리지 않는다(재실행 안전).
-- 되돌리기: update public.auditors set display_name = left(display_name, -4)
--            where id in ('auditor','auditor2','auditor3') and display_name like '%(AI)';

update public.auditors
   set display_name = display_name || '(AI)'
 where id in ('auditor', 'auditor2', 'auditor3')
   and display_name not like '%(AI)';
