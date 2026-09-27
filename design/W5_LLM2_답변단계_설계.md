# W5 — LLM2 답변 단계 설계 (v0)

> 정본: `docs/doing/BEFORE_AFTER_기능명세.md` A2·§1(판정 권위 → LLM2)·M1~M4.
> 자리: `design/LLM1v2_역할축소_구현설계.md` §4 "답변 단계(임시)" — `pipeline_agentic._answer` 의 `llm.write_advisory` 를 이것으로 바꾼다.
> KB3 적재: `design/KB3_요지수집_설계.md` §10(범위·라벨·컷 확정). 이 문서는 그 KB3 를 **LLM2 가 어떤 모양으로 부르는지**를 정한다.

## 0. 결정 (2026-09-27 사용자)

| # | 질문 | 결정 |
|---|---|---|
| **W5-1** | v0 부터 판정을 내나 | **근거 있을 때만 판정.** 결론 문장은 인용이 검색 근거의 문서번호·조문과 맞을 때만 나간다. 안 맞으면 코드가 자문으로 강등(M1 을 코드로 강제). 빈 사실(gap)이 있으면 판정하지 않고 조건부 갈래 |
| **W5-2** | 검색 갈래 | **KB2 빼고 3갈래** `rag, kb3, kbdict`(피벗의 KB2 폐기와 맞춘다). 판례를 따로 부르지 않는다. ⚠️ 확정 수치(시민 useful 54%)는 KB2 가 든 4갈래 값 → **3갈래로 다시 잰다** |
| **W5-3** | 법령 KB(A8) | **v0 는 법령 KB 없이 — KB3 본문에 적힌 조문만 인용.** 실측: 조문 번호(`…법 제N조`)를 담은 비율 판례 요지 92%(446/487) · 질의회신 99%(1,969/1,995). 조문 원문 KB 는 새 소스 → 코퍼스 확장 6규칙, 별도 트랙 |
| **W5-4** | 엔진 대조(M4) | **v0 에 같이 넣는다.** 답에는 영향 없음, meta 로만 |

재논의 금지(상위 문서): KB3 컷 0.40 · 쿼터 2 · `kb3.*` 스키마 · 권위 서열 검수 > 판례 > 해석 > 사전 · D3·D4 · solar-pro3.

## 1. 코드 자리 (격리 규칙 `v2격리_원복설계.md` §1~§2)

| 파일 | 브랜치 | 내용 |
|---|---|---|
| `backend/api/llm2.py` **새** | agentic-v2 | `write_answer()` — 라벨 블록·규칙·시스템 프롬프트·도구·M1 검사. `llm.py` 의 `bounded_client`·`_history_to_messages` 재사용 |
| `backend/api/pipeline_agentic.py` | agentic-v2 | `_answer` 가 `llm2.write_answer` 호출 + 엔진 대조 병렬 |
| `backend/api/rag/kb3_store.py` **새** · `retriever.py`(`Kb3Retriever`, `source="v2"` 분기) | import-credigraph → merge | 공유 `rag/*` 는 **추가만**. v1 fusion 은 한 줄도 안 바뀐다(`source="v2"` 를 명시해야만 탄다) |
| `supabase/migrations/0041_kb3.sql` **새** | import-credigraph | `kb3.documents` + `kb3.match_documents`. **적용은 사용자 확인 후** |
| `scripts/kb3_ingest.py ingest` | import-credigraph | 캐시 벡터 재사용, `case_id` 멱등 |

`llm.py`·`pipeline.py` 는 고치지 않는다. **v1 라벨(`_grounding_block`)도 안 바꾼다** — KB3 라벨은 `llm2.py` 에만 산다.

## 2. 검색 (W5-2)

- `get_retriever(source="v2")` = `FusionRetriever([("rag", …), ("kb3", …), ("kbdict", …)])`.
  갈래 순서 = 동률 타이브레이크 = 권위 서열(확정 순서 `kb2, rag, kb3, kbdict` 에서 kb2 만 뺀 것).
  컷·쿼터는 기존 env 그대로: `RAG_MIN_SCORE`/`FUSION_QUOTA_RAG=3` · `KB3_MIN_SCORE=0.40`/`FUSION_QUOTA_KB3=2` · `KBDICT_MIN_SCORE=0.45`/`FUSION_QUOTA_KBDICT=2`.
- `pipeline_agentic` 은 `source=rag_source_override or "v2"` — `?ragSource=` 로 벤치·비교만 덮어쓴다.
- 질의 = 원 질문 + 되묻기 답(지금 그대로).
- **합격선(3갈래 재측정, 메모리 경로)**: run2 4갈래 대비 시민 useful −2pp 이내(채점 흔들림 ±2pp) · 병의원 near 는 −1문항 이내.
  못 넘으면 kb2 를 빼는 결정을 수치와 함께 사용자에게 다시 가져간다(내가 kb2 를 되살리지 않는다).

## 3. 근거 블록 · 규칙 (`llm2._grounding_block`)

corpus 로 네 블록을 가른다(P4 관례 — `source_kind` 는 층 식별자 아님).

| corpus | 머리표 |
|---|---|
| `rag` (corpus 없음 포함) | `[검수 선례 — 세무사가 확인한 내용 · 다른 질문자의 사안]` |
| `kb3_prec` | `[판례 요지 — 법원·심판 결정 · 다른 사건]` |
| `kb3_qna` | `[국세청 해석 — 질의회신 · 행정 해석이며 법원 판단과 다를 수 있음]` |
| `kbdict` | `[참고 사전 — 일반 법리·용어, 본 사안에 대한 확인이 아님]` |

규칙(코드 문자열, 규범 md 아님):
1. 우선순위 검수 선례 > 판례 요지 > 국세청 해석 > 참고 사전.
2. **판례 요지와 국세청 해석이 엇갈리면** 둘 다 밝히고 판례 쪽을 앞세우며, 판정은 `조건부` 또는 `판정 보류`.
3. 선례·판례·질의회신의 인원·금액·연도·업종·명의를 사용자 사실로 옮기지 말 것.
4. 문서번호·조문 인용은 **근거 블록에 적힌 것만**. 참고 사전만으로 판정·단정 금지(기존 `_DICTIONARY_RULE` 취지).

**공통 규범(L0)**: `load_norms()` 본문은 쓰되 머리말은 `llm2` 것으로 — `llm._with_norms` 의 "판정은 어떤 경우에도 규칙엔진의 권위다"는
v2 에서 거짓이다(§1 피벗). 규범 md 자체는 안 건드린다.

## 4. 출력 · M1 검사

도구 `emit_answer`:
```
verdict        enum  인정 | 일부 인정 | 부인 | 조건부 | 판정 보류
verdict_basis  [str] 판정을 떠받치는 문서번호·조문 (근거 블록에 있는 것만)
segments       [{text, type, framework?, citations?}]  — type 에 conclusion·application 허용
```

**M1 — 코드가 판정을 강등한다**(`판정 보류` 로):
- `verdict_basis` 중 **하나 이상이 kb3·rag 근거의 content 에 실제로 있어야** 한다(공백 제거 후 부분문자열 일치; 조문은 `법명 제N조` 까지).
  사전(kbdict)에만 있는 인용은 판정 근거로 안 친다.
- gap 이 있는데 `인정/일부 인정/부인` → `조건부` 로 내린다(W5-1 조건부 갈래).
- 강등되면 `conclusion`·`application` 세그먼트를 **뺀다**(판정처럼 읽히는 문장을 남기지 않는다) — 남은 게 없으면 폴백 문안.
- `verdict_basis` 는 **숫자가 든 인용(문서번호·조문)만** 센다 — "소득세법" 같은 이름은 어느 근거에나 부분일치해 M1 을 공짜로 통과한다.
- 세그먼트 `citations` 도 근거에 없는 항목은 지운다.
- **조문 가드**: 문장 속 `제N조(의M)` 가 근거 어디에도 없으면 그 문장을 뺀다. ~~numeric_guard 가 잡는다~~ — numeric_guard 는
  조문 번호를 수치 토큰에서 **설계상 제외**한다(모듈 docstring). 조까지만 본다(항·호·법명은 안 봄 — 느슨한 쪽).
- 센다: `meta.llm2 = {verdict, verdictRaw, downgraded: "no_basis"|"gap"|null, basisMatched, citationsDropped}`.

**선두 caveat(결정적)**: 판정이 살아남으면 "아래 판단은 AI 가 {출처}를 근거로 낸 것이며, 세무사가 이 사안을 확인한 것은 아닙니다. 판단: {verdict}." ·
`판정 보류`면 "판정이 아니라 참고 의견입니다. {출처}를 참고했습니다." · gap 이면 그 앞에 지금의 조건부 머리말. 근거 0건이면 지금의 "선례 없음 + 세무사 연결".
{출처}는 **corpus 별로 조립**한다(검수 의견 · 판례 요지·국세청 질의회신 · 일반 법리 자료). ⚠️ 임시 자문의 "세무사들이 남긴 검수 의견을 근거로"는
kbdict 만 아니면 무조건 붙었다 — KB3 를 세무사 검수라 부르는 거짓 출처가 되므로 v2 에서 교체했다.

**UI**: v0 는 새 uiBlock(판정 카드) 없음 — 판정은 세그먼트 문장 + meta. 새 응답 모양을 안 만들어 프론트 Zod 함정을 피한다(카드는 v1 로).

## 5. 엔진 대조 (M4, W5-4)

`_answer` 안에서 **검색+LLM2 와 병렬 스레드**로:
`llm.extract_engine_inputs` → `adapter.normalize_etype` → 지원 9유형·필수값 있나 → `llm.verify_decisive` → `adapter.missing_decisive` 빈가 → `eng.evaluate`.

| `meta.llm2.engine.status` | 뜻 |
|---|---|
| `compared` | 엔진이 판정함 → `engineVerdict`, `agree`(대응: 전부 인정→인정 · 안분 인정→일부 인정 · 부인→부인 · 조건부→조건부) |
| `out_of_scope` | etype 이 9유형 밖 — 대조 불가(대다수일 것) |
| `undecided` | 9유형이나 결정변수 부족 |
| `failed` | 호출 실패·혼잡 — **답변을 막지 않는다**(`UpstageCongested` 도 삼킨다) |

- 답·화면에 영향 0. 스위치 `V2_ENGINE_CONTRAST=on|off`(기본 on). 답이 나온 뒤 더 기다리는 상한 `V2_ENGINE_CONTRAST_WAIT=5`초 → 넘으면 `timeout`.
- ⚠️ **함정(9/27 로컬 스모크)**: openai SDK 가 `client.chat`/`client.embeddings` 를 처음 건드릴 때 지연 import 한다 → 대조 스레드와 본 스레드가
  동시에 처음 건드리면 `_DeadlockError`. `pipeline_agentic` 모듈 로드 때 `openai.resources.chat`·`.embeddings` 를 미리 import 한다.
- 비용: Upstage 호출 +2(추출·검증). FIFO 게이트(k=3)를 같이 쓰므로 전시 부하 때 끄는 스위치가 필요한 이유.
- **불일치율 저장 자리 = 열린 문제 O-W5-1**(아래).

## 6. 계측 · 벤치

- **오프라인 W5 하니스**(제품 원문 `llm2.write_answer` 를 메모리 검색 결과로 호출): 판정 분포 · M1 강등률 · 인용 삭제 수 · 엔진 대조 일치율(병의원 testset 중 `compared` 인 것).
- outcome 은 v2 값 그대로(`v2_proceed` 등) — 판정 여부로 outcome 을 쪼개지 않는다(재해석 금지 §5).

## 7. 열린 문제

| # | 질문 | 기본안 |
|---|---|---|
| **O-W5-1** | 엔진 대조·판정 분포를 DB 에 남기나 | v0 는 서버 로그 + 오프라인 하니스. 운영 수치가 필요해지면 `rag.chat_turns` 에 nullable 컬럼(추가만) — **마이그레이션이라 사용자 확인** |
| **O-W5-2** | 판정 카드 UI | v0 없음. 판정 품질이 하니스로 확인된 뒤 |
| **O-W5-3** | 법령 KB(A8) | 별도 트랙 — 소스 제안부터(6규칙) |
| **O-W5-4** | 개인/법인 혼입 — 스모크에서 병원 원장(개인사업자일 공산) 승용차 질문에 **법인세법 시행령** 질의회신 5건만 떠 법인 규정으로 답했다(엔진은 같은 '인정') | LLM1 누락 사실 후보("개인/법인")인지, 검색 필터(세법)인지 — W5 하니스에서 빈도 먼저 |
| **O-W5-5** | numeric_guard 는 `N월` 기간을 수치로 안 본다 — "연말정산 시점(다음 해 2월~5월)" 날조가 통과 | 가드 확장은 v1 공유 파일이라 별도 결정 |

## 8. 순서

1. (import-credigraph) `0041_kb3.sql` 파일 · `kb3_store.py` · `Kb3Retriever` · `source="v2"` · `kb3_ingest.py ingest` — **DB 쓰기 0**
2. 메모리 경로 벤치: 3갈래 `rag, kb3, kbdict` vs run2 → §2 합격선
3. (agentic-v2, merge 후) `llm2.py` · `_answer` 배선 · 엔진 대조 · W5 하니스
4. **프로덕션 DB 쓰기(마이그레이션·적재) → 사용자 확인 후** → DB 경로 벤치가 메모리 경로와 같은 수치인지
5. v2 유닛 기동은 LLM1v2 단계 5 몫(이 문서 밖)

## 진행 기록

- **2026-09-27** — 설계 작성. W5-1~4 사용자 결정.
- **2026-09-27 (같은 세션)** — 코드(커밋 전): import-credigraph = `0041_kb3_schema.sql`(미적용) · `kb3_store.py` · `Kb3Retriever` · `get_retriever(source="v2")` ·
  `kb3_ingest.py ingest [--write]` · `bench_fusion.py --kb3 …:갈래순서`. agentic-v2(worktree `../Neo-Luddite-v2`) = `llm2.py` · `engine_contrast.py` ·
  `pipeline_agentic._answer` 배선 · `ChatMeta.llm2`. 로컬 스모크(DB 없음, 메모리 KB3) 2문항 통과: 시민 월세 → 조건부(basis 3/3 대조 통과) ·
  병의원 승용차 → 인정, 엔진 `compared·agree`. 드러난 것: import 교착(§5 함정) · 선두 문구 거짓 출처(§4) · O-W5-4·5.
