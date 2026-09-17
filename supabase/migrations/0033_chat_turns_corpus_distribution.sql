-- ════════════════════════════════════════════════════════════════════════════
-- 근거 코퍼스 분포 계측 — rag.chat_turns 확장 (KB통합 로드맵 P7-A, 2026-09-18)
-- ════════════════════════════════════════════════════════════════════════════
-- 0027 은 "어느 **검색기**를 탔나"(rag_source)와 "몇 건 왔나"(rag_hits)만 남겼다. 코퍼스가
-- 셋이 된 지금(kb2 · rag · kbdict, 로드맵 P3) 그 둘로는 답할 수 없는 질문이 생겼다 —
-- **fusion 응답의 근거가 실제로 어느 층에서 왔나.** P3P4 프로덕션 스모크에서 이게 그대로
-- 막혔다(기록 §3: "meta 에 코퍼스가 없어 kbdict 포함 여부는 응답으로 확인 불가" — 로컬에서
-- 같은 질의를 다시 돌려 추정해야 했다). L1 이 이득 미입증 상태로 들어가 있으므로, 실사용에서
-- 얼마나·어떤 점수로 끼어드는지는 숫자로 봐야 한다.
--
-- **왜 개수와 원시 목록을 둘 다 남기는가**(사용자 결정 2026-09-18). 개수만 남기면 집계는
-- 되지만 "왜 그 청크가 들어왔나"를 영영 못 되짚는다. 0027 이 이미 같은 교훈을 적어 뒀다 —
-- 타임아웃 분위수만 남기고 원시 목록을 버려 회차를 하나 더 돌렸다. 지표는 나중에 바뀌지만
-- 원시값은 그대로 쓸 수 있으므로, 원시값 쪽이 선택지보다 오래 산다.
--
-- 두 컬럼은 **중복이 아니라 역할이 다르다**: counts 는 where/group by 가 바로 먹는 집계용,
-- passages 는 한 턴을 손으로 되짚는 감사용이다. counts 를 passages 에서 매번 전개해 세면
-- 집계 질의가 jsonb 전개로 번져 인덱스를 못 쓴다.
--
-- 계측은 곁다리다 — 두 컬럼 모두 nullable 이고, 적재 실패는 store.record_chat_turn 이
-- 삼킨다(답변이 계측 때문에 막히지 않는다). 0027 이전 행과 검색 미도달 갈래(되묻기)는
-- null 로 남는다: "근거가 0건이었다"(= {} )와 "검색 단계에 도달 못 했다"(= null)는
-- 0027 의 rag_searched 와 같은 이유로 다른 사실이다.
-- ════════════════════════════════════════════════════════════════════════════

alter table rag.chat_turns
  -- 코퍼스별 근거 개수. 예: {"kb2": 2, "rag": 2, "kbdict": 1}. 근거 0건이면 {}.
  add column rag_corpus_counts jsonb,
  -- 그 근거들의 원시 목록. 프롬프트에 들어간 **순서대로**:
  --   [{"corpus":"kb2","sourceKind":"kb2","score":0.496,"rank":1,"id":"<uuid>"}, …]
  -- rank 는 융합·정렬이 끝난 최종 자리(1-based) = 프롬프트에 박힌 순서.
  -- id 는 원본 행(rag.passages / kb2.sentences / kbdict.chunks) — content 는 안 남긴다:
  -- 본문은 그 테이블에 있고, 여기 복사하면 같은 지식이 두 곳에서 갈라진다.
  add column rag_passages jsonb;

comment on column rag.chat_turns.rag_corpus_counts is
  '근거의 코퍼스별 개수 {"kb2":n,"rag":n,"kbdict":n} — 집계용. null = 검색 단계 미도달.';
comment on column rag.chat_turns.rag_passages is
  '근거 원시 목록(프롬프트 순서) corpus·sourceKind·score·rank·id — 한 턴을 되짚는 감사용. 본문은 원본 테이블에.';

-- 집계는 "기간 × 코퍼스 포함 여부"로 돈다(예: kbdict 가 낀 턴만). jsonb_path_ops 는
-- 포함(@>) 질의에 특화돼 기본 jsonb_ops 보다 작고 빠르다 — 여기서 쓰는 질의가 딱 그것이다.
create index chat_turns_corpus_counts_idx
  on rag.chat_turns using gin (rag_corpus_counts jsonb_path_ops);
