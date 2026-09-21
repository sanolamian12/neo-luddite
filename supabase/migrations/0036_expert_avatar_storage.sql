-- ════════════════════════════════════════════════════════════════════════════
-- 세무사 프로필 사진 업로드 — Storage 버킷 `expert-avatars`
-- ════════════════════════════════════════════════════════════════════════════
-- 0034 의 expert_profiles.avatar_url 은 그동안 프리셋 경로(/experts/preset-N.webp)만
-- 담았다. 세무사가 자기 사진을 올릴 수 있게 버킷 하나를 열되, 경로 규약과 RLS 로
-- "남의 자리에 못 쓴다"를 DB 에서 강제한다.
--
-- 경로 규약: <auditor_id>/<epoch>.webp  (첫 폴더 = 세무사 도메인 id)
--   → 정책이 storage.foldername(name)[1] 로 소유자를 판정한다. 파일명에 시각을 넣어
--     교체할 때마다 URL 이 바뀌므로 CDN 캐시가 옛 사진을 물고 있는 일이 없다.
--
-- 공개 범위: 이 사진은 **사장님 채팅 카드에 뜨는 그림**이다. 챗은 비로그인도 쓰므로
--   (메모리 project_chat_no_auth_exhibition) 읽기는 공개다. 연락처와 달리 공개 범위
--   선택지를 두지 않는다 — 카드에 실릴 목적으로만 올리는 자료다.
-- 업로드 상한 1MB · 이미지 3종. 프런트가 256px webp(~10KB)로 줄여 올리지만,
--   상한은 프런트를 믿지 않고 버킷에서도 건다.
-- ════════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'expert-avatars', 'expert-avatars', true, 1048576,
  array['image/webp', 'image/png', 'image/jpeg']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 읽기: 누구나(비로그인 방문자의 채팅 카드 포함).
drop policy if exists expert_avatars_read on storage.objects;
create policy expert_avatars_read on storage.objects
  for select using (bucket_id = 'expert-avatars');

-- 쓰기: 세무사 본인 폴더에만. insert/update/delete 각각 건다(for all 은 storage
-- 클라이언트의 upsert 경로에서 with check 만 걸려 update 가 막히는 일이 있다).
drop policy if exists expert_avatars_insert on storage.objects;
create policy expert_avatars_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'expert-avatars'
    and public.current_role() = 'auditor'
    and (storage.foldername(name))[1] = public.current_domain_id()
  );

drop policy if exists expert_avatars_update on storage.objects;
create policy expert_avatars_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'expert-avatars'
    and public.current_role() = 'auditor'
    and (storage.foldername(name))[1] = public.current_domain_id()
  )
  with check (
    bucket_id = 'expert-avatars'
    and public.current_role() = 'auditor'
    and (storage.foldername(name))[1] = public.current_domain_id()
  );

drop policy if exists expert_avatars_delete on storage.objects;
create policy expert_avatars_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'expert-avatars'
    and public.current_role() = 'auditor'
    and (storage.foldername(name))[1] = public.current_domain_id()
  );

-- 관리자: 부적절한 사진 내리기(운영 브레이크).
drop policy if exists expert_avatars_admin on storage.objects;
create policy expert_avatars_admin on storage.objects
  for all to authenticated
  using (bucket_id = 'expert-avatars' and public.is_admin())
  with check (bucket_id = 'expert-avatars' and public.is_admin());
