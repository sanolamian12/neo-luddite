-- ════════════════════════════════════════════════════════════════════════════
-- 인앱 상담사 채팅 (d) — conversations_staff_read 축소 (설계 D2 · §3.7)
-- ════════════════════════════════════════════════════════════════════════════
-- 배경: 0005 의 conversations_staff_read 는 current_role() in ('admin','auditor') 로
-- 세무사에게 전체 대화를 payload 째 열었다(2026-09-21 실측: 세무사 토큰 → 218건 전부).
-- 비식별 상담사 풀(0037)이 화면 관행이 아니라 강제가 되려면 원문 열람을 좁혀야 한다.
--
-- 교체 후 세무사는 다음 중 하나에 해당하는 대화만 읽는다.
--   ① 내가 픽업한 검수 건           audits.auditor_id = me (상태 무관)
--   ② 열린 일감에 실린 대화          audit_tasks.status in ('open','full','in_progress')
--                                    — /audit/queue 상세의 픽업 전 미리보기 (2026-09-22 유지 결정)
--   ③ 나와 채팅방이 있는 대화        consultation_rooms.expert_id = me (열림·닫힘 무관)
--   ④ 내 앞으로 온 경로 A 신청       consultation_requests.expert_id = me (상태 무관, 2026-09-22 결정)
-- 0039 consultation_offers 는 조건에 없다 — 제안만으로는 원문을 열지 않고, 승인되면 방이 생겨 ③으로 열린다.
-- admin 은 전체 그대로(conversations_admin_all 도 있음). 사장님 정책 conversations_owner 는 건드리지 않는다.
--
-- ★ 판정은 security definer 함수 하나로 한다. 정책 안에서 다른 테이블을 서브쿼리로 읽으면
--   Realtime 이 anon 구독자에게 정책을 평가할 때 권한 오류가 나고, 그 이벤트가 **모든 구독자에게서**
--   사라진다(사장님 사이드바의 새 대화 포함 — 설계 §7, (b) is_room_member 에서 실제로 겪음).
--   그래서 함수는 anon 실행을 허용하고, 로그인 전(current_domain_id() null)이면 false 를 돌려준다.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.can_staff_read_conversation(p_conversation_id text)
  returns boolean
  language plpgsql stable security definer set search_path = public
as $$
declare
  v_me   text := public.current_domain_id();
  v_role public.app_role;
begin
  if v_me is null or p_conversation_id is null then
    return false;
  end if;
  v_role := public.current_role();
  if v_role = 'admin' then
    return true;
  end if;
  -- 사장님은 본인 정책(conversations_owner)으로만 읽는다 — ②가 사장님에게 새지 않게 역할로 막는다.
  if v_role is distinct from 'auditor' then
    return false;
  end if;
  return exists (select 1 from public.audits a
                  where a.conversation_id = p_conversation_id and a.auditor_id = v_me)
      or exists (select 1 from public.audit_tasks t
                  where t.status in ('open', 'full', 'in_progress')
                    and p_conversation_id = any (t.conversation_ids))
      or exists (select 1 from public.consultation_rooms r
                  where r.conversation_id = p_conversation_id and r.expert_id = v_me)
      or exists (select 1 from public.consultation_requests q
                  where q.conversation_id = p_conversation_id and q.expert_id = v_me);
end;
$$;
revoke all on function public.can_staff_read_conversation(text) from public;
-- anon 실행을 빼면 안 된다(위 ★). 로그인 전엔 false 라 여는 것이 없다.
grant execute on function public.can_staff_read_conversation(text) to anon, authenticated;

drop policy if exists conversations_staff_read on public.conversations;
create policy conversations_staff_read on public.conversations
  for select using (public.can_staff_read_conversation(id));

-- 판정 서브쿼리용 인덱스(audits_auditor_idx·consultation_requests_expert_idx 는 이미 있다)
create index if not exists audits_conversation_idx on public.audits (conversation_id);
create index if not exists consultation_requests_conversation_idx on public.consultation_requests (conversation_id);
