-- ════════════════════════════════════════════════════════════════════════════
-- Workstream A — Auth 역할 + RLS 정책 + Realtime
-- ════════════════════════════════════════════════════════════════════════════
-- 마스터설계 §4-A(역할: admin / 세무사(auditor) / user), §3-2(브라우저=anon+RLS).
--
-- 역할 매핑: 구 account-store → app_role
--   viewer(사장님)  → 'user'
--   auditor(평가자) → 'auditor'   (= 세무사)
--   admin(운영자)   → 'admin'
--
-- 도메인 조인키: profiles.domain_id (text) ↔ audits.auditor_id / mail.recipient_id …
--   auth.uid()(uuid) 와 도메인 텍스트 id 의 임피던스 차를 흡수.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 역할 헬퍼 (SECURITY DEFINER: profiles RLS 재귀 회피) ────────────────────────
create or replace function public.current_role()
  returns public.app_role
  language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.current_domain_id()
  returns text
  language sql stable security definer set search_path = public
as $$
  select domain_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin()
  returns boolean
  language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_role() = 'admin', false)
$$;

-- ── 신규 가입 시 profiles 자동 생성 트리거 ─────────────────────────────────────
-- Auth 사용자 생성 시 user_metadata 의 domain_id/role/label 로 프로필 시딩.
-- (seed.sql 은 이 경로를 재사용하거나 직접 insert.)
create or replace function public.handle_new_user()
  returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, domain_id, role, label, avatar_color, occupation, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'domain_id', new.id::text),
    coalesce((new.raw_user_meta_data ->> 'role')::public.app_role, 'user'),
    coalesce(new.raw_user_meta_data ->> 'label', 'User'),
    new.raw_user_meta_data ->> 'avatar_color',
    new.raw_user_meta_data ->> 'occupation',
    new.raw_user_meta_data ->> 'display_name'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── RLS 활성화 ─────────────────────────────────────────────────────────────────
alter table public.profiles            enable row level security;
alter table public.auditors            enable row level security;
alter table public.pool_candidates     enable row level security;
alter table public.audit_tasks         enable row level security;
alter table public.audits              enable row level security;
alter table public.line_feedback       enable row level security;
alter table public.session_evaluations enable row level security;
alter table public.reviews             enable row level security;
alter table public.inquiries           enable row level security;
alter table public.ledger_entries      enable row level security;
alter table public.settlement_rounds   enable row level security;
alter table public.training_batches    enable row level security;
alter table public.model_versions      enable row level security;
alter table public.mail                enable row level security;
alter table public.kb_documents        enable row level security;

-- ── profiles ───────────────────────────────────────────────────────────────
create policy profiles_self_select on public.profiles
  for select using (id = auth.uid() or public.is_admin());
create policy profiles_self_update on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_all on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

-- ── auditors: admin 관리, 인증자 열람 ──────────────────────────────────────────
create policy auditors_read on public.auditors
  for select using (auth.uid() is not null);
create policy auditors_admin_write on public.auditors
  for all using (public.is_admin()) with check (public.is_admin());

-- ── pool_candidates: admin 관리, auditor 열람 ──────────────────────────────────
create policy pool_read on public.pool_candidates
  for select using (public.current_role() in ('admin', 'auditor'));
create policy pool_admin_write on public.pool_candidates
  for all using (public.is_admin()) with check (public.is_admin());

-- ── audit_tasks: 인증자 열람, admin 관리, auditor 픽업 갱신 ─────────────────────
create policy tasks_read on public.audit_tasks
  for select using (auth.uid() is not null);
create policy tasks_admin_write on public.audit_tasks
  for all using (public.is_admin()) with check (public.is_admin());
-- 픽업/해제는 pickups(jsonb) 의 read-modify-write → auditor UPDATE 허용(PoC 수준).
create policy tasks_auditor_pickup on public.audit_tasks
  for update using (public.current_role() = 'auditor')
  with check (public.current_role() = 'auditor');

-- ── audits: auditor 는 본인 것 CRUD, admin 은 전체 + 검수 갱신 ──────────────────
create policy audits_owner on public.audits
  for all using (auditor_id = public.current_domain_id())
  with check (auditor_id = public.current_domain_id());
create policy audits_admin on public.audits
  for all using (public.is_admin()) with check (public.is_admin());

-- ── line_feedback / session_evaluations: 작성자(auditor) 소유, admin 열람 ───────
create policy feedback_owner on public.line_feedback
  for all using (reviewer = public.current_domain_id())
  with check (reviewer = public.current_domain_id());
create policy feedback_admin_read on public.line_feedback
  for select using (public.is_admin());

create policy eval_owner on public.session_evaluations
  for all using (reviewer = public.current_domain_id())
  with check (reviewer = public.current_domain_id());
create policy eval_admin_read on public.session_evaluations
  for select using (public.is_admin());

-- ── reviews: admin 전체, auditor 는 본인 audit 의 리뷰 열람 + 확인표시 갱신 ──────
create policy reviews_admin on public.reviews
  for all using (public.is_admin()) with check (public.is_admin());
create policy reviews_auditor_read on public.reviews
  for select using (
    exists (
      select 1 from public.audits a
      where a.id = reviews.audit_id and a.auditor_id = public.current_domain_id()
    )
  );
create policy reviews_auditor_seen on public.reviews
  for update using (
    exists (
      select 1 from public.audits a
      where a.id = reviews.audit_id and a.auditor_id = public.current_domain_id()
    )
  ) with check (true);

-- ── inquiries: 제기자(auditor) 소유, admin 전체 ────────────────────────────────
create policy inquiries_owner on public.inquiries
  for all using (raised_by = public.current_domain_id())
  with check (raised_by = public.current_domain_id());
create policy inquiries_admin on public.inquiries
  for all using (public.is_admin()) with check (public.is_admin());

-- ── ledger_entries: auditor 본인 열람, admin 전체 ──────────────────────────────
create policy ledger_owner_read on public.ledger_entries
  for select using (auditor_id = public.current_domain_id());
create policy ledger_admin on public.ledger_entries
  for all using (public.is_admin()) with check (public.is_admin());

-- ── settlement_rounds: 인증자 열람, admin 관리 ─────────────────────────────────
create policy settlement_read on public.settlement_rounds
  for select using (auth.uid() is not null);
create policy settlement_admin on public.settlement_rounds
  for all using (public.is_admin()) with check (public.is_admin());

-- ── training_batches / model_versions: 인증자 열람, admin 관리 ─────────────────
create policy batches_read on public.training_batches
  for select using (auth.uid() is not null);
create policy batches_admin on public.training_batches
  for all using (public.is_admin()) with check (public.is_admin());

create policy versions_read on public.model_versions
  for select using (auth.uid() is not null);
create policy versions_admin on public.model_versions
  for all using (public.is_admin()) with check (public.is_admin());

-- ── mail: 발신/수신 당사자 열람, 발신자 발송, admin 전체 ───────────────────────
create policy mail_party_read on public.mail
  for select using (
    recipient_id = public.current_domain_id()
    or sender_id = public.current_domain_id()
    or public.is_admin()
  );
create policy mail_send on public.mail
  for insert with check (
    sender_id = public.current_domain_id() or public.is_admin()
  );
create policy mail_recipient_update on public.mail   -- read_at 표시
  for update using (recipient_id = public.current_domain_id() or public.is_admin())
  with check (true);

-- ── kb_documents: 인증자 열람, auditor/admin 작성, admin 삭제 ──────────────────
create policy kb_read on public.kb_documents
  for select using (auth.uid() is not null);
create policy kb_write on public.kb_documents
  for insert with check (public.current_role() in ('auditor', 'admin'));
create policy kb_update on public.kb_documents
  for update using (public.current_role() in ('auditor', 'admin'))
  with check (public.current_role() in ('auditor', 'admin'));
create policy kb_admin_delete on public.kb_documents
  for delete using (public.is_admin());

-- ── Realtime: 협업 알림이 필요한 테이블만 publication 에 추가 ───────────────────
-- (일감 이관/검수결과/이의답변/우편 도착을 두 브라우저 간 실시간 반영 — §4-A 완료정의)
alter publication supabase_realtime add table public.audit_tasks;
alter publication supabase_realtime add table public.audits;
alter publication supabase_realtime add table public.reviews;
alter publication supabase_realtime add table public.inquiries;
alter publication supabase_realtime add table public.mail;
