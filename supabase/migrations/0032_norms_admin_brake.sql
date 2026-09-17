-- ════════════════════════════════════════════════════════════════════════════
-- norms 확정 거버넌스 ③ — admin 사후 브레이크 (KB통합 3층검색 로드맵 P6, 2026-09-17)
-- ════════════════════════════════════════════════════════════════════════════
-- admin 은 확정 경로 밖에 있다(반영은 세무사 승인·이의 기간이 한다). admin 이 할 수 있는 건 두 가지뿐
-- (사용자 결정 2026-09-17 — 긴급 단독 확정은 두지 않는다):
--   거부     공개 중(pending) 제안을 반영 전에 막는다 → status 'rejected'.
--            누가·언제는 discarded_by/at 을 그대로 쓰고, 사유는 admin_reason(필수).
--   롤백     지금 확정본을 직전 확정본 내용으로 즉시 되돌린다. 이력을 지우지 않고 **직전 내용을 복사한 새 확정본**
--            (version_no 다음 번호, applied_via 'rollback', note = 사유)을 만든다 — 번호는 계속 증가한다.
-- 둘 다 사유 필수이고 versions 행 자체가 이력이다.
-- ════════════════════════════════════════════════════════════════════════════

alter table norms.versions drop constraint versions_status_check;
alter table norms.versions add constraint versions_status_check
  check (status in ('draft', 'pending', 'confirmed', 'discarded', 'rejected'));

alter table norms.versions drop constraint versions_applied_via_check;
alter table norms.versions add constraint versions_applied_via_check
  check (applied_via in ('direct', 'approvals', 'deadline', 'rollback'));

alter table norms.versions add column admin_reason text;  -- 거부·롤백 사유(admin 브레이크)
