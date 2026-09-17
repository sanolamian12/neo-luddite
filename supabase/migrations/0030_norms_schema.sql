-- ════════════════════════════════════════════════════════════════════════════
-- norms.* schema — L0 규범층 DB 승격 + 검토·편집 이력 (KB통합 3층검색 로드맵 P5, 2026-09-17)
-- ════════════════════════════════════════════════════════════════════════════
-- 3층 배치: L0 규범(master·frameworks·pitfalls, 상시 주입) ← 이 스키마
--           L1 사전(kbdict.*, 검색) / L2 경험(kb2.*, 검색)
--
-- 원본 이동: P1 에서 규범 원본은 backend/api/prompts/*.md 였다. P5 부터 **원본은 이 스키마**이고
-- md 는 DB 장애 시 폴백으로만 남는다(갱신 의무 없음). 로더 경계는 그대로 —
-- api/prompts/_read_sources() 만 DB 를 먼저 읽는다. 프롬프트 빌더(llm.py)는 불변.
--
-- 두 게이트 (2026-09-17 사용자 결정):
--   draft      초안 — admin·auditor 누구나 작성·수정·폐기. 답변에 영향 없음. 문서당 1개.
--   confirmed  확정 — **세무사(auditor) 계정만**. 확정 순간 documents.active_version_id 가 바뀌고
--              백엔드가 다음 확인 주기(기본 60초, 확정 API 는 즉시)에 새 규범을 주입한다.
--   discarded  폐기 — 삭제 대신 상태 전환(이력 보존).
-- 되돌리기 = 과거 확정본 내용으로 새 초안을 만들어 같은 게이트로 다시 확정한다(별도 경로 없음).
-- version_no 는 확정 시점에 매긴다(초안·폐기본은 null) — 확정 이력에 번호 구멍이 안 생긴다.
--
-- 예산(NORMS_MAX_CHARS=2800, 주석 제거 후 세 문서 합계)은 백엔드가 초안 저장·확정 때 검사한다 —
-- 예산 초과 상태는 저장조차 되지 않는다(런타임 폴백이 확정본에서 일어나지 않게).
--
-- kbdict.* 관례 그대로: 스키마 분리 · documents/하위 단위 2단 · origin · status · epoch-ms bigint ·
-- 방어적 RLS(enable + 정책 없음 = service role 직결만 통과 → 프론트는 백엔드 API 경유).
-- ════════════════════════════════════════════════════════════════════════════

create schema if not exists norms;

-- ── norms.documents ──────────────────────────────────────────────────────────
create table norms.documents (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique,          -- 'master' | 'frameworks' | 'pitfalls' (md 파일명과 같음)
  title             text not null,
  order_index       int not null,                  -- 주입 순서 = 로드맵 §2.0 (절차 → 해석 원칙 → 오류 패턴)
  origin            text not null default 'seed',  -- 'seed' = P1 md 에서 옮겨온 문서
  active_version_id uuid,                          -- 지금 주입되는 확정본. FK 는 versions 생성 뒤에 건다
  status            text not null default 'active' check (status in ('active', 'archived')),
  created_at        bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at        bigint not null default (extract(epoch from now()) * 1000)::bigint
);
comment on table norms.documents is
  'L0 규범 문서 3종. 주입 내용은 active_version_id 가 가리키는 확정본.';

-- ── norms.versions ───────────────────────────────────────────────────────────
create table norms.versions (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references norms.documents(id) on delete cascade,
  version_no      int,                              -- 확정 시점에 부여. 초안·폐기본은 null
  content         text not null,                    -- 주입 본문(관리 주석 없이)
  status          text not null check (status in ('draft', 'confirmed', 'discarded')),
  base_version_id uuid references norms.versions(id), -- 초안을 만들 때의 확정본(되돌리기면 그 과거본)
  note            text,                             -- 변경 사유 · 항목 번호(M-1 등). 확정 시 필수
  author_id       text not null,                    -- 초안 작성자 도메인 id (profiles.domain_id)
  updated_by      text not null,
  confirmed_by    text,                             -- 세무사 도메인 id
  confirmed_at    bigint,
  discarded_by    text,
  discarded_at    bigint,
  created_at      bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at      bigint not null default (extract(epoch from now()) * 1000)::bigint,
  unique (document_id, version_no)
);
-- 문서당 초안은 하나 — 두 초안이 서로 덮어쓰는 확정 경쟁을 원천 차단(rag.passage_edits 와 같은 발상).
create unique index norms_versions_one_draft on norms.versions (document_id) where status = 'draft';
create index norms_versions_document_idx on norms.versions (document_id, created_at desc);
comment on table norms.versions is
  'L0 규범 버전 이력 — draft(누구나) → confirmed(세무사). 삭제 없음, 폐기는 discarded.';

alter table norms.documents
  add constraint norms_documents_active_version_fk
  foreign key (active_version_id) references norms.versions(id);

-- ── 방어적 RLS: 정책 없음 → service role(직결)만 통과 ──────────────────────────
alter table norms.documents enable row level security;
alter table norms.versions enable row level security;

-- ── 시드: P1 md 3종(2026-09-16 세무사 검토 — 수정 없이 확정) = v1 확정본 ─────────────
-- 본문은 md 에서 관리 주석을 뺀 그대로(주입 블록 1,314자와 글자 단위 일치).
-- 2026-09-16 00:00 UTC = 1789516800000. 데이터 변경 CTE 는 같은 문장의 본 쿼리에 안 보이므로 문장을 나눈다.
insert into norms.documents (name, title, order_index) values
  ('master', '답변 절차·거절 규칙', 1),
  ('frameworks', '해석 원칙 결정 트리', 2),
  ('pitfalls', '오류 패턴', 3);

insert into norms.versions (document_id, version_no, content, status, note, author_id, updated_by, confirmed_by, confirmed_at)
select id, 1, $norm$## 답변 절차
- 보수적인 한국 세무 상담사로 답하라. 결론만 던지지 말고 근거(법령 조문·판례 번호·해석 원칙)를 함께 대라.
- 사실관계가 부족하면 가정을 밝히고 "~인 경우"로 조건을 나눠 답하라.
- 법리·해석 문장에는 적용한 해석 원칙을 이름과 이유로 밝혀라.
- 인용은 조문 번호·사건 번호를 정확히 적어라. 확신이 없으면 불확실하다고 밝혀라.
- 사용자 말에서 아래 오류 패턴이 보이면 답보다 먼저 경고하라.
- 끝에는 추가로 챙길 증빙·신고 시점을 짚어라.

## 거절·금지
- 탈세·세금 회피 전략, 증빙 위조·은닉 방법은 거절하라.
- 특정 사건의 승소·패소를 예측하지 마라.
- 형사 책임 등 세무 밖 전문 영역을 판단하지 마라.
- 근거 없는 사실·법령·판례를 지어내지 마라.$norm$, 'confirmed',
       'P1 md 이관 — 2026-09-16 세무사 검토본(M-1~10·F-1~11·P-1~4) 수정 없이 확정', 'seed', 'seed', 'seed', 1789516800000
from norms.documents where name = 'master';

insert into norms.versions (document_id, version_no, content, status, note, author_id, updated_by, confirmed_by, confirmed_at)
select id, 1, $norm$## 해석 원칙 선택
1. 형식과 실질이 같으면 문언해석·엄격해석. 명의와 실사용자, 계약과 실제 거래가 다르면 실질과세원칙(국세기본법 §14)을 먼저 본다.
2. 법문이 명확하면 문언해석으로 끝낸다. 모호하면 체계적해석·목적론해석을 검토한다. 명시 규정이 없는 사안의 유추해석은 원칙적으로 금지다.
3. 입증책임: 과세요건 사실과 거래의 가공 여부는 과세관청이, 비과세·감면·필요경비·손금 요건(업무관련성·통상성·증빙)은 납세자가 입증한다.
4. 과세관청이 종전 공적 견해와 달리 과세하면 신의성실원칙(국세기본법 §15)을 검토한다. 견해표명·정당한 신뢰·그에 따른 행위·불이익 네 요소가 모두 있어야 한다.

## 우선순위
- 감면·특혜 규정은 엄격해석이 목적론해석보다 앞선다. 확장 해석하지 마라.
- 명백한 법문 위반은 어떤 원칙으로도 뒤집지 마라.
- 실질과세원칙을 확장 해석의 도구로 쓰지 마라. 엄격해석과 부딪히면 사실관계 입증부터 따져라.
- 과세를 넓히는 유추는 금지다. 납세자에게 유리한 유추도 단정하지 말고 "다툼의 여지가 있다"고 써라.

## 자주 쓰는 조합
- 비용 인정(차량·접대·복리후생 등): 엄격해석 + 입증책임
- 가족·특수관계인 거래, 명의신탁: 실질과세원칙 + 입증책임
- 감면·특례 적용 여부: 엄격해석 + 문언해석$norm$, 'confirmed',
       'P1 md 이관 — 2026-09-16 세무사 검토본(M-1~10·F-1~11·P-1~4) 수정 없이 확정', 'seed', 'seed', 'seed', 1789516800000
from norms.documents where name = 'frameworks';

insert into norms.versions (document_id, version_no, content, status, note, author_id, updated_by, confirmed_by, confirmed_at)
select id, 1, $norm$## 오류 패턴 — 보이면 먼저 경고
- 차량 비용을 전부 처리하려 하는데 운행기록부·업무전용자동차보험이 없다 → 일부만 인정될 수 있다고 경고하라.
- 사업자 명의·법인카드로 결제했으니 당연히 인정된다고 여긴다 → 명의와 무관하게 실제 사용 목적이 업무 관련이어야 한다고 경고하라.
- 원장 혼자 쓰는 것을 직원 복리후생으로 처리하려 한다 → 전 직원 대상이어야 하고 실제 사용을 입증해야 한다고 경고하라.
- 경고는 거절이 아니다. "다음에 유의하세요" 어조로 짚은 뒤 답을 이어가라.$norm$, 'confirmed',
       'P1 md 이관 — 2026-09-16 세무사 검토본(M-1~10·F-1~11·P-1~4) 수정 없이 확정', 'seed', 'seed', 'seed', 1789516800000
from norms.documents where name = 'pitfalls';

update norms.documents d set active_version_id = v.id
from norms.versions v where v.document_id = d.id and v.version_no = 1;
