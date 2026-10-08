-- Public OAuth/password signups must never choose a role or another user's domain id.
-- Only Admin API / SQL provisioning can set raw_app_meta_data. Existing profiles
-- and their domain references remain unchanged.
create or replace function public.handle_new_user()
  returns trigger
  language plpgsql security definer set search_path = public
as $$
declare
  provisioned_role public.app_role := 'user';
  profile_name text;
begin
  if new.raw_app_meta_data ->> 'app_role' in ('user', 'auditor', 'admin') then
    provisioned_role := (new.raw_app_meta_data ->> 'app_role')::public.app_role;
  end if;
  profile_name := left(coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'label'), ''),
    '사장님'
  ), 100);
  insert into public.profiles (id, domain_id, role, label, display_name, occupation)
  values (
    new.id,
    coalesce(nullif(new.raw_app_meta_data ->> 'domain_id', ''), new.id::text),
    provisioned_role,
    profile_name,
    profile_name,
    nullif(new.raw_user_meta_data ->> 'occupation', '')
  ) on conflict (id) do nothing;
  return new;
end;
$$;

-- RLS limits rows, not columns. Prevent self-service privilege escalation while
-- preserving ordinary profile edits and the existing administrator policy.
create or replace function public.guard_profile_identity()
  returns trigger
  language plpgsql set search_path = public
as $$
begin
  if (current_user in ('anon', 'authenticated') or auth.role() in ('anon', 'authenticated'))
     and not public.is_admin()
     and (new.id is distinct from old.id
       or new.domain_id is distinct from old.domain_id
       or new.role is distinct from old.role
       or new.created_at is distinct from old.created_at) then
    raise exception 'Profile identity and role are protected' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_profile_identity on public.profiles;
create trigger protect_profile_identity
  before update on public.profiles
  for each row execute function public.guard_profile_identity();
