-- 0055 — 가상 세무사 이름을 이름만으로 (0054 보정, 10/12)
-- 화면 관례: auditors.display_name 은 이름만 두고, 화면이 " 세무사"를 붙인다(방 헤더 "○○ 세무사", 말풍선 "○○ 세무사 AI").
-- 0054 가 '윤서진 세무사'로 넣어 운영 방 헤더가 "윤서진 세무사 세무사"로 보였다(R3 운영 E2E).
update public.auditors set display_name = '윤서진' where id = 'auditor'  and display_name = '윤서진 세무사';
update public.auditors set display_name = '김도현' where id = 'auditor2' and display_name = '김도현 세무사';
update public.auditors set display_name = '이수민' where id = 'auditor3' and display_name = '이수민 세무사';
