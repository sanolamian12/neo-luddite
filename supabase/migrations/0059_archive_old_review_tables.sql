-- 0059 — 옛 검수 흐름 절단 S6a: 옛 public 테이블·스냅샷 칸을 archive 로 (2026-10-16) — design/옛검수흐름_절단_로드맵_1016.md
--
-- 전제: S2(프론트)·S3(백엔드)·S4(0058 DB 함수·publication) 로 아래 테이블·칸을 읽거나 쓰는 코드·정책·함수가 없다.
-- 운영 DB 읽기 확인(10/16, 이 파일 작성 전): 옮길 10개 테이블에 걸린 FK·뷰·트리거·다른 테이블 정책 0, 본문에서 읽는 함수 =
--   0058 _purge_legacy_review_rows(to_regclass 동적, archive 도 찾음) 하나. publication 에서는 0058 이 이미 뺐다.
--   스냅샷 칸(snapshot_*·excluded_at)에 걸린 객체 = conversations_snapshot_idx 하나(칸과 함께 지워진다). 프론트 upsert 는 이 칸을
--   보내지 않고 조회는 select("*") — 칸이 없어져도 그대로 돈다.
-- 백업: backend/data/old_review_backup_1016/*.csv (supabase/backup_old_review_1016.py, git 제외 — 고객 원문 포함)
--
-- 하는 일:
--   ① archive 스키마 — PostgREST 에 노출되지 않고(public 만 노출), anon·authenticated 는 스키마 사용권부터 없다.
--   ② 옛 public 테이블 10개를 archive 로 옮긴다(행·인덱스·RLS 정책은 따라간다). settlement_rounds 는 D7 로 남긴다.
--   ③ conversations 의 5분 정지 사진 칸 → archive.conversation_snapshots 로 복사한 뒤 칸 삭제(D6).
--   ④ _purge_legacy_review_rows 에 archive.conversation_snapshots 를 더한다 — 칸이 conversations 에 있을 땐 대화 행과 함께
--      지워졌지만, 따로 옮기면 탈퇴해도 대화 원문 사본이 남는다(/privacy §3 "탈퇴 = 즉시 파기").
-- 안 하는 일: rag.passages·passage_edges·passage_edits 와 rag.match_passages(retriever 의 옛 갈래가 아직 운영 코드에 있다 —
--   S5 배포 뒤 S6b) · 실제 DROP(11/5 시연 뒤).
-- 되돌리기: `alter table archive.<t> set schema public` · conversations 에 칸 3개를 다시 만들고
--   `update public.conversations c set snapshot_at = s.snapshot_at, snapshot_payload = s.snapshot_payload, excluded_at = s.excluded_at
--    from archive.conversation_snapshots s where s.conversation_id = c.id` · 0058 의 _purge_legacy_review_rows.

-- ── ① archive 스키마 ────────────────────────────────────────────────────────────
create schema if not exists archive;
revoke all on schema archive from public, anon, authenticated;
comment on schema archive is
  '옛 검수 흐름(하차장·일감·검수·정지 스냅샷) 보관 — 10/16 절단 S6. 읽는 코드 없음, 11/5 시연 뒤 DROP 예정.';

-- ── ② 옛 public 테이블 ───────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['pool_candidates', 'audit_tasks', 'audits', 'line_feedback', 'session_evaluations',
                           'reviews', 'inquiries', 'training_batches', 'model_versions', 'kb_documents'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I set schema archive', t);
    end if;
  end loop;
end $$;

-- ── ③ 정지 사진 칸 ───────────────────────────────────────────────────────────────
create table if not exists archive.conversation_snapshots (
  conversation_id  text primary key,
  snapshot_at      bigint,
  snapshot_payload jsonb,
  excluded_at      bigint
);
comment on table archive.conversation_snapshots is
  'public.conversations 의 옛 5분 정지 사진 칸(0006) 보관본 — 10/16 절단 S6a. 탈퇴 시 _purge_legacy_review_rows 가 지운다.';

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'conversations' and column_name = 'snapshot_payload') then
    insert into archive.conversation_snapshots (conversation_id, snapshot_at, snapshot_payload, excluded_at)
    select id, snapshot_at, snapshot_payload, excluded_at
      from public.conversations
     where snapshot_at is not null or snapshot_payload is not null or excluded_at is not null
    on conflict (conversation_id) do nothing;
  end if;
end $$;

drop index if exists public.conversations_snapshot_idx;
alter table public.conversations
  drop column if exists snapshot_payload,
  drop column if exists snapshot_at,
  drop column if exists excluded_at;

-- archive 안 모든 테이블: API 역할 권한 회수(스키마 사용권이 없어 이미 못 닿지만 이중으로).
revoke all on all tables in schema archive from public, anon, authenticated;

-- ── ④ 탈퇴 파기 범위에 정지 사진 보관본 ───────────────────────────────────────────────
create or replace function public._purge_legacy_review_rows(p_convs text[])
  returns jsonb
  language plpgsql security definer set search_path = public
as $$
declare
  v_total  integer := 0;
  k        integer;
  t        text;
  v_rel    regclass;
  v_audits regclass := coalesce(to_regclass('public.audits'), to_regclass('archive.audits'));
begin
  if coalesce(cardinality(p_convs), 0) = 0 then
    return jsonb_build_object('legacy_review_rows', 0);
  end if;

  -- 검수 결과는 audit_id 로만 대화에 닿으므로 audits 보다 먼저.
  v_rel := coalesce(to_regclass('public.reviews'), to_regclass('archive.reviews'));
  if v_rel is not null and v_audits is not null then
    execute format('delete from %s where audit_id in (select id from %s where conversation_id = any($1))', v_rel, v_audits)
      using p_convs;
    get diagnostics k = row_count; v_total := v_total + k;
  end if;

  foreach t in array array['line_feedback', 'session_evaluations', 'audits', 'pool_candidates'] loop
    v_rel := coalesce(to_regclass('public.' || t), to_regclass('archive.' || t));
    if v_rel is not null then
      execute format('delete from %s where conversation_id = any($1)', v_rel) using p_convs;
      get diagnostics k = row_count; v_total := v_total + k;
    end if;
  end loop;

  -- 옛 KB passage(질문+답변+코멘트 번들). edges·edits 는 cascade.
  v_rel := coalesce(to_regclass('rag.passages'), to_regclass('archive.passages'));
  if v_rel is not null then
    execute format('delete from %s where conversation_id = any($1)', v_rel) using p_convs;
    get diagnostics k = row_count; v_total := v_total + k;
  end if;

  -- 5분 정지 사진 보관본(0059) — 대화 원문 사본.
  v_rel := to_regclass('archive.conversation_snapshots');
  if v_rel is not null then
    execute format('delete from %s where conversation_id = any($1)', v_rel) using p_convs;
    get diagnostics k = row_count; v_total := v_total + k;
  end if;

  -- 일감은 행을 남기고 이 대화 id 만 뺀다.
  v_rel := coalesce(to_regclass('public.audit_tasks'), to_regclass('archive.audit_tasks'));
  if v_rel is not null then
    execute format('update %s set conversation_ids = array(select x from unnest(conversation_ids) x where x <> all($1)) '
                   'where conversation_ids && $1', v_rel) using p_convs;
  end if;

  return jsonb_build_object('legacy_review_rows', v_total);
end;
$$;
revoke all on function public._purge_legacy_review_rows(text[]) from public, anon, authenticated;
