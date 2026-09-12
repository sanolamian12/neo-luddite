-- ════════════════════════════════════════════════════════════════════════════
-- G3 임팩트 계측 — 챗 턴 단위 이벤트 (rag.chat_turns)
-- ════════════════════════════════════════════════════════════════════════════
-- 배경(로드맵 §7 완성목표 G3, 2026-09-12): 제품 논지는 "RAG 는 답변 품질이 아니라
-- **답할 수 있는 범위**를 넓힌다"(판정은 엔진 권위라 안 바뀐다)인데, kb2 경로에서 이게
-- 숫자로 보인 적이 한 번도 없다. 지금까지의 KB2 작업(커버리지·축적성)이 전부 이걸 위한
-- 준비였다.
--
-- **왜 새 테이블인가.** 지표에 필요한 값(ragSource/ragHits/followUp)은 이미 ChatMeta 에
-- 다 있는데 **아무데도 안 남는다** — 백엔드 /api/chat 은 무상태고, 프론트는 meta 를
-- 파싱만 하고 버린다(conversations.payload 에도 없다). 그래서 필드를 더하는 일이 아니라
-- 남길 자리를 만드는 일이다. 백엔드 적재를 고른 이유는 **프론트를 안 거치는 호출도
-- 남기 때문**이다 — 논문 세션의 3방향 벤치마크(?rag= on/off × ?ragSource=rag|kb2|hybrid)
-- 는 curl 로 도는데, 프론트 payload 에 얹으면 그게 통째로 유실된다.
--
-- **분모를 스키마에 박지 않았다**(사용자 결정 2026-09-12). 되묻기는 두 종류이고 섞으면
-- 지표가 오염된다 — '선례 없음'(RAG 가 답할 범위의 문제)과 '결정변수 부족'(판정형 ①-b,
-- RAG 와 무관). 어느 쪽을 분모로 삼을지는 아직 안 정했으므로, 여기서는 **모든 턴을
-- 남기고 경로 종류를 outcome 컬럼으로 구분**한다. 분모는 집계 시점에 where 절로 고른다.
-- 지표를 고쳐 숫자를 좋게 만드는 자기기만을 피하려면, 원시값 쪽이 선택지보다 오래 살아야
-- 한다(이번 세션의 교훈: 타임아웃 분위수만 남기고 원시 목록을 버려 회차를 하나 더 돌렸다).
-- ════════════════════════════════════════════════════════════════════════════

create table rag.chat_turns (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  text not null,
  message_id       text not null,          -- asst_{conversationId}_{order} — 턴 식별
  created_at       bigint not null,        -- epoch ms (이 레포 컨벤션)
  occupation       text not null,

  -- 파이프라인이 실제로 탄 갈래. G3 의 분자·분모가 전부 여기서 나온다.
  --   'missing_inputs'  필수정보 부족 되묻기 (pipeline.py ①)        — RAG 무관
  --   'no_precedent'    선례 없음 되묻기     (pipeline.py 자문경로)  — **G3 의 분자**
  --   'advisory'        선례 있음 → 자문 답변(판정 없음)             — G3 분모의 나머지
  --   'undecided'       결정변수 부족 되묻기 (pipeline.py ①-b)       — RAG 무관. 섞지 말 것
  --   'verdict'         엔진 판정 + RAG 근거
  --   'unsupported_occupation'  병의원 외 직업군 안내
  -- 자문 경로 되묻기율 = no_precedent / (no_precedent + advisory).
  outcome          text not null,

  -- 검색 축 — 논문 세션의 3방향 벤치마크가 이 두 컬럼으로 갈린다(직교).
  rag_requested    text,                   -- ?ragSource= 요청값 (미지정이면 null = env 기본)
  rag_source       text,                   -- 실제 쓰인 코퍼스: 'kb2' | 'rag' | 'none'
  -- "이 턴에 검색기가 실제로 살아 있었나". **nullable 인 것이 의미가 있다** — 되묻기
  -- 갈래(missing_inputs/undecided)는 검색 단계에 도달조차 못 하므로 null 이고, 그걸
  -- false 로 뭉개면 "RAG 를 껐다"와 구별이 안 된다. off 인지 미도달인지는 지표를 읽을
  -- 때 갈라야 한다. false 는 RAG off 이거나 DB 미설정(NullRetriever) 이라는 뜻이다.
  rag_searched     boolean,
  rag_hits         integer not null default 0,

  follow_up        boolean not null default false,
  advisory         boolean not null default false,
  etype            text                    -- 추출된 지출유형(자문 경로 진입 사유 추적용)
);
comment on table rag.chat_turns is
  'G3 임팩트 계측 — 챗 턴마다 어느 갈래로 답했는지와 검색 축을 남긴다. 분모는 박지 않았다: outcome 으로 집계 시점에 고른다. 되묻기율 = no_precedent / (no_precedent + advisory).';

-- 집계는 "기간 × 검색축 × 갈래"로만 한다.
create index chat_turns_created_idx on rag.chat_turns (created_at desc);
create index chat_turns_outcome_idx on rag.chat_turns (outcome, rag_source);
create index chat_turns_conv_idx    on rag.chat_turns (conversation_id);

alter table rag.chat_turns enable row level security;
-- 방어적 RLS: 정책 없음 → service role(백엔드 직결)만 통과, anon/authenticated 전면 차단.
-- passages·passage_edges 와 같은 방침. 화면 노출은 이번 세션 범위 밖이다.
