-- 0056 — 공용 승격 ↔ 기여 원장 (A9, 2026-10-16)
--
-- 지침 A9: "공용 승격 → 기여 원장 기록, 철회 시 검색 제외 + 기여 취소".
-- 0043 은 승인 때 백엔드가 0원 bonus 행 하나만 썼고, 철회(게시 내리기·내용 수정·강등 보관·계정 삭제)는
-- 원장에 아무것도 남기지 않았다 → 원장과 '지금 공용에 살아 있는 사례'가 어긋났다.
--
-- 원칙: 기여 = 공용 KB 에 살아 있는 세무사 사례. 원장은 그 상태가 바뀐 사건의 기록이다.
--   공용 노출 = corpus 'kb3_expert' · status 'active' · publish_state 'published' · share_state 'approved'
--              (= kb3.match_chunks 가 모든 챗에 내보내는 조건, 0043)
--   거짓 → 참 : +1  kind contribution_accepted · source_ref {kind:'kb3_share', event:'approved'}
--   참 → 거짓 : −1  kind adjustment            · source_ref {kind:'kb3_share', event:'withdrawn', reason}
-- 어느 경로로 바뀌든(API·0050 강등·0051 계정 삭제·수동 SQL) 이 트리거 하나가 쓴다 — 백엔드는 원장을 쓰지 않는다.
-- 사례별 순합(sum amount where source_ref->>'docId')은 0 또는 1 만 된다(+1 은 순합 0 일 때만, −1 은 1 일 때만).
-- 단위: 사례 1건 = 1 크레딧(금액 기획 미정 — 정산은 회차 때 기여 비율로, 운영 흐름 6단계).
--
-- 관리자 철회: share_state 'withdrawn' 추가 — 공용 검색에서만 빠지고 세무사 전용 RAG(게시)에는 남는다.
-- 세무사는 다시 '공용 KB 로 보내기'를 할 수 있다(거부와 같은 취급).

alter table kb3.documents drop constraint if exists documents_share_state_check;
alter table kb3.documents add constraint documents_share_state_check
  check (share_state in ('pending', 'approved', 'rejected', 'withdrawn'));

create or replace function kb3._is_public_expert(d kb3.documents)
returns boolean language sql immutable as $$
  -- coalesce: share_state 가 null(초안·공유 전)이면 비교가 null 이 돼 '바뀜'으로 오판한다(로컬 검증에서 잡힘)
  select coalesce(d.corpus = 'kb3_expert' and d.status = 'active'
                  and d.publish_state = 'published' and d.share_state = 'approved', false)
$$;

create or replace function kb3._share_ledger_sync()
returns trigger
language plpgsql
security definer
set search_path = public, kb3
as $$
declare
  v_doc     kb3.documents;
  v_was     boolean;
  v_is      boolean;
  v_auditor text;
  v_net     integer;
  v_last    integer;
  v_last_ts bigint;
  v_now     bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  v_reason  text;
  v_amount  integer;
  v_note    text;
begin
  if tg_op = 'DELETE' then
    v_doc := old; v_was := kb3._is_public_expert(old); v_is := false; v_reason := 'deleted';
  else
    v_doc := new;
    v_was := case when tg_op = 'UPDATE' then kb3._is_public_expert(old) else false end;
    v_is := kb3._is_public_expert(new);
    if v_was and not v_is then
      v_reason := case
        when new.content_hash is distinct from old.content_hash then 'edited'   -- 내용 수정 → 초안(save_expert_case)
        when new.status <> 'active' then 'archived'                 -- 0050 강등 등
        when new.publish_state <> 'published' then 'unpublished'    -- 세무사 '내리기'
        when new.share_state = 'withdrawn' then 'admin_withdrawn'   -- 관리자 철회
        else coalesce(new.share_state, 'changed') end;
    end if;
  end if;
  if v_was = v_is then
    return null;
  end if;

  -- 원장 주인: −1 은 그 사례의 +1 을 받은 사람(계정 삭제 뒤에도 원장은 auditors 와 같이 남는다, 0048),
  -- +1 은 지금 작성자의 domain_id.
  select l.auditor_id into v_auditor from public.ledger_entries l
   where l.source_ref->>'kind' = 'kb3_share' and l.source_ref->>'docId' = v_doc.id::text
   order by l.timestamp desc limit 1;
  if v_auditor is null and v_doc.expert_id is not null then
    select p.domain_id into v_auditor from public.profiles p where p.id = v_doc.expert_id;
  end if;
  if v_auditor is null then
    return null;   -- 원장 주인을 알 수 없음(작성자 프로필 없음) — 기록하지 않는다
  end if;

  perform pg_advisory_xact_lock(hashtext('ledger:' || v_auditor));
  select coalesce(sum(l.amount), 0) into v_net from public.ledger_entries l
   where l.source_ref->>'kind' = 'kb3_share' and l.source_ref->>'docId' = v_doc.id::text;
  if v_is and v_net <> 0 then return null; end if;   -- 이미 적립됨
  if not v_is and v_net <> 1 then return null; end if; -- 적립된 적 없음(0056 이전 승인분은 아래 이행 행으로 맞춘다)

  v_amount := case when v_is then 1 else -1 end;
  v_note := case when v_is then '공용 KB 반영: ' else '공용 KB 철회(' || v_reason || '): ' end || v_doc.title;
  select l.balance_after, l.timestamp into v_last, v_last_ts from public.ledger_entries l
   where l.auditor_id = v_auditor order by l.timestamp desc limit 1;
  -- 잔액은 '마지막 행' 기준(ledger.ts 와 같은 규약) — 같은 밀리초 두 행이면 순서가 뒤집히니 시각을 앞 행 뒤로 민다.
  v_now := greatest(v_now, coalesce(v_last_ts, 0) + 1);

  insert into public.ledger_entries (id, auditor_id, kind, amount, source_ref, balance_after, timestamp, note)
  values (
    'ledger-kb3share-' || v_doc.id::text || '-' || v_now::text || case when v_is then '-p' else '-m' end,
    v_auditor,
    case when v_is then 'contribution_accepted' else 'adjustment' end,
    v_amount,
    jsonb_build_object('kind', 'kb3_share', 'docId', v_doc.id::text, 'caseNumber', v_doc.case_number,
                       'title', v_doc.title, 'event', case when v_is then 'approved' else 'withdrawn' end,
                       'reason', v_reason),
    coalesce(v_last, 0) + v_amount,
    v_now,
    v_note);
  return null;
end;
$$;
revoke all on function kb3._share_ledger_sync() from public, anon, authenticated;

-- 판례·질의회신 재적재(수천 행)에는 돌지 않게 세무사 사례 행에만 건다.
drop trigger if exists kb3_documents_share_ledger_ins on kb3.documents;
drop trigger if exists kb3_documents_share_ledger_upd on kb3.documents;
drop trigger if exists kb3_documents_share_ledger_del on kb3.documents;
create trigger kb3_documents_share_ledger_ins after insert on kb3.documents
  for each row when (new.corpus = 'kb3_expert') execute function kb3._share_ledger_sync();
create trigger kb3_documents_share_ledger_upd after update on kb3.documents
  for each row when (old.corpus = 'kb3_expert' or new.corpus = 'kb3_expert') execute function kb3._share_ledger_sync();
create trigger kb3_documents_share_ledger_del after delete on kb3.documents
  for each row when (old.corpus = 'kb3_expert') execute function kb3._share_ledger_sync();

-- 이행: 0056 이전에 승인돼 지금 공용에 살아 있는 사례 = +1 한 번(0043 의 0원 bonus 행은 그대로 둔다 — append-only).
insert into public.ledger_entries (id, auditor_id, kind, amount, source_ref, balance_after, timestamp, note)
select 'ledger-kb3share-' || d.id::text || '-0056-p', p.domain_id, 'contribution_accepted', 1,
       jsonb_build_object('kind', 'kb3_share', 'docId', d.id::text, 'caseNumber', d.case_number, 'title', d.title,
                          'event', 'approved', 'reason', 'migration_0056'),
       coalesce((select l.balance_after from public.ledger_entries l where l.auditor_id = p.domain_id
                  order by l.timestamp desc limit 1), 0)
         + row_number() over (partition by p.domain_id order by d.share_reviewed_at, d.id),
       (extract(epoch from clock_timestamp()) * 1000)::bigint,
       '공용 KB 반영(0056 이행): ' || d.title
  from kb3.documents d join public.profiles p on p.id = d.expert_id
 where kb3._is_public_expert(d) and p.domain_id is not null
   and not exists (select 1 from public.ledger_entries l
                    where l.source_ref->>'kind' = 'kb3_share' and l.source_ref->>'docId' = d.id::text);

-- 기여 = 살아 있는 지식의 파생 조회 — 원장 순합과 실제 공용 노출이 같은지 보는 대조 뷰(관리자·스크립트용).
create or replace view kb3.expert_contribution_check as
select d.id as doc_id, d.title, p.domain_id as auditor_id, kb3._is_public_expert(d) as is_public,
       coalesce((select sum(l.amount) from public.ledger_entries l
                  where l.source_ref->>'kind' = 'kb3_share' and l.source_ref->>'docId' = d.id::text), 0) as ledger_net
  from kb3.documents d left join public.profiles p on p.id = d.expert_id
 where d.corpus = 'kb3_expert';
revoke all on kb3.expert_contribution_check from public, anon, authenticated;
