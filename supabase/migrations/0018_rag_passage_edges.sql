-- ════════════════════════════════════════════════════════════════════════════
-- RAG 지식망 — 미리 계산된 유사도 그래프 (rag.passage_edges)
-- ════════════════════════════════════════════════════════════════════════════
-- 배경(docs/doing/RAG_구조분석_및_개선로드맵.md §4, 2026-08-28): auditor 가 KB 전체를
-- 거미줄 그래프(줌인/줌아웃)로 훑어보고 필요하면 직접 수정할 수 있는 중간층 UI를 만들기
-- 위한 데이터 기반. 기존 neighbors()/find_similar() 는 "조회 시점에" 코사인 거리를 매번
-- 다시 재는 방식이라(§1.2) 화면을 열 때마다 KB 전체를 실시간으로 스캔해야 전체 그래프를
-- 그릴 수 있다 — 노드 수가 늘면 화면 자체가 §3.2의 exact-scan 부담을 그대로 지게 된다.
--
-- 그래서 passage 당 top-k 유사도 이웃을 **배치로 미리 계산해 저장**한다(사용자 결정,
-- 2026-08-28) — 화면은 이 저장된 edge 만 읽어서 그린다. RAG 검색 자체(match_passages)는
-- 손대지 않는다 — 이 테이블은 auditor 시각화 전용이고, 챗 파이프라인은 여전히 exact scan.
-- 부수 효과: 이 배치가 나중에 §3.2(exact-scan 완화) 검토 시 재사용 가능한 구조가 된다.
-- ════════════════════════════════════════════════════════════════════════════

create table rag.passage_edges (
  source_id   uuid not null references rag.passages(id) on delete cascade,
  target_id   uuid not null references rag.passages(id) on delete cascade,
  score       float not null,                    -- 코사인 유사도, 1에 가까울수록 유사
  computed_at bigint not null,
  primary key (source_id, target_id)
);
comment on table rag.passage_edges is
  '배치로 미리 계산된 passage 간 top-k 유사도 그래프. auditor KB 전체 그래프 시각화 전용 — RAG 검색(match_passages)은 여전히 조회 시점 exact scan을 쓴다.';

-- 역방향 조회(target 기준 "나를 이웃으로 둔 passage")도 필요할 수 있어 인덱스.
create index passage_edges_target_idx on rag.passage_edges (target_id);

alter table rag.passage_edges enable row level security;
-- 방어적 RLS: 정책 없음 → service role(직결)만 통과, anon/authenticated 전면 차단. (passages 와 동일)

-- ── 재계산 함수: 전체 재빌드 ───────────────────────────────────────────────────
-- retired passage 는 edge 대상에서 빠지므로(연결끊기 즉시 그래프에서도 사라져야 함),
-- 매번 전체 삭제 후 재계산한다. 지금 규모(수백 건)에서 O(n²) self-join 은 1회성으로
-- 문제없다(§3.1 find_duplicate_pairs 와 같은 비용 구조 — 재검토 트리거도 동일하게 적용).
create or replace function rag.rebuild_passage_edges(k int default 8)
  returns integer
  language plpgsql
  security definer set search_path = rag, public
as $$
declare
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  n integer;
begin
  delete from rag.passage_edges;

  insert into rag.passage_edges (source_id, target_id, score, computed_at)
  select source_id, target_id, score, now_ms
  from (
    select a.id as source_id, b.id as target_id,
           1 - (a.embedding <=> b.embedding) as score,
           row_number() over (
             partition by a.id order by (a.embedding <=> b.embedding)
           ) as rn
    from rag.passages a
    join rag.passages b on a.id <> b.id
    where a.status = 'active' and b.status = 'active'
  ) ranked
  where rn <= k;

  get diagnostics n = row_count;
  return n;
end;
$$;

-- ── pg_cron: 5분마다 그래프 재계산 (0006 스냅샷 캡처와 같은 패턴) ────────────────
-- 신규 코멘트 적재/수정 승인/소급 정리(retract) 후 최대 5분 안에 그래프에 반영된다.
-- admin 화면에서 즉시 반영이 필요하면 수동 트리거 엔드포인트(POST /api/rag/edges/rebuild)도 둔다.
create extension if not exists pg_cron;

do $$
begin
  if exists (
    select 1 from cron.job where jobname = 'rebuild-passage-edges'
  ) then
    perform cron.unschedule('rebuild-passage-edges');
  end if;
end $$;

select cron.schedule(
  'rebuild-passage-edges',
  '*/5 * * * *',
  $cron$select rag.rebuild_passage_edges(8)$cron$
);
