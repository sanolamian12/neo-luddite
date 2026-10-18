-- 0060 옛 검수 흐름 절단 S6b — rag 옛 KB(passages·passage_edges·passage_edits)·kbdict → archive (2026-10-19)
--
-- 근거: design/옛검수흐름_절단_로드맵_1016.md S6b. 전제 = S5(검색 갈래 KB3 하나) 운영 배포 — 10/19 28ee788.
-- 운영 읽기 확인(작성 전, 10/19): rag.match_passages·kbdict.match_chunks 를 부르는 DB 객체 0 · rag/kbdict 에 걸린 트리거·뷰·
--   정책·publication·cron 0 · API 역할(anon·authenticated·service_role) 테이블 사용권 0 · FK = rag 안 3개(edits·edges → passages)
--   와 kbdict 안 1개(chunks → documents)뿐 · 본문에서 rag.passages 를 읽는 함수 = _purge_legacy_review_rows 하나(0059 판이 이미
--   to_regclass('archive.passages') 를 찾는다 — 함수는 고치지 않는다). 저장소 코드: 백엔드는 주석만, kbdict 는 적재 스크립트뿐(같은 커밋에서 삭제).
-- 백업: backend/data/old_review_backup_1016/s6b/*.csv (supabase/backup_old_review_s6b_1019.py, 임베딩 칸 제외, git 제외)
--   passages 534 · passage_edges 3,344 · passage_edits 3 · kbdict.documents 16 · kbdict.chunks 27
--
-- 하는 일:
--   ① 검색 함수 삭제 — rag.match_passages · kbdict.match_chunks (테이블을 옮기면 함수 본문이 깨진 채 남는다)
--   ② rag 세 테이블 → archive (이름 그대로 — _purge_legacy_review_rows 의 archive.passages 후보와 맞춘다. FK·cascade·인덱스 따라감)
--      rag.chat_turns(계측, G3)는 남긴다 — rag 스키마도 남는다.
--   ③ kbdict 두 테이블 → archive.kbdict_documents · archive.kbdict_chunks (archive 안 이름 충돌 방지) · 빈 kbdict 스키마 삭제
-- 안 하는 일: 실제 DROP(11/5 시연 뒤 0061 — drop schema archive cascade · _purge_legacy_review_rows 정리 · settlement_rounds 처분).
-- 되돌리기: `alter table archive.passages set schema rag`(edges·edits 도) · kbdict 는 schema 를 다시 만들고
--   `alter table archive.kbdict_documents set schema kbdict` 뒤 `rename to documents`(chunks 도) · 함수는 0004·0029 원문.

-- ── ① 검색 함수 ───────────────────────────────────────────────────────────────
-- 인자 타입(vector)이 어느 스키마에 있든 지워지게 oid 로 찾는다.
do $$
declare
  f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname = 'rag' and p.proname = 'match_passages')
               or (n.nspname = 'kbdict' and p.proname = 'match_chunks') loop
    execute format('drop function %s', f);
  end loop;
end $$;

-- ── ② rag 옛 KB ───────────────────────────────────────────────────────────────
create schema if not exists archive;

do $$
declare
  t text;
begin
  foreach t in array array['passages', 'passage_edges', 'passage_edits'] loop
    if to_regclass('rag.' || t) is not null and to_regclass('archive.' || t) is null then
      execute format('alter table rag.%I set schema archive', t);
    end if;
  end loop;
end $$;

-- ── ③ kbdict ─────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('kbdict.documents') is not null and to_regclass('archive.kbdict_documents') is null then
    alter table kbdict.documents rename to kbdict_documents;
    alter table kbdict.kbdict_documents set schema archive;
  end if;
  if to_regclass('kbdict.chunks') is not null and to_regclass('archive.kbdict_chunks') is null then
    alter table kbdict.chunks rename to kbdict_chunks;
    alter table kbdict.kbdict_chunks set schema archive;
  end if;
end $$;

drop schema if exists kbdict;   -- restrict: 남은 객체가 있으면 여기서 멈춘다(그럴 일 없음 — 위 확인)

-- archive 안 모든 테이블: API 역할 권한 회수(0059 와 같이 이중으로).
revoke all on all tables in schema archive from public, anon, authenticated;

comment on schema archive is
  '옛 검수 흐름(하차장·일감·검수·정지 스냅샷·rag 옛 KB·kbdict) 보관 — 10/16 절단 S6a·10/19 S6b. 읽는 코드 없음, 11/5 시연 뒤 DROP 예정.';
