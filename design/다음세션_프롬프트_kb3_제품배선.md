# 다음 세션 — kb3(심판례·질의회신)를 v1 챗에 배선 (제품 세션)

**작성 2026-10-05.** 앞 세션 기록 = `history/261005_새RAG_KB3_심판례Solar카드_0042프로덕션적재.md`. 정본 설계 = `design/새RAG_KB3_구축설계.md`(결정 D1~D12, 진행 기록).
이 파일은 새 세션의 출발점이다. 세션이 끝나면 다음 프롬프트를 새로 쓰고 이 파일은 `docs/done/` 으로 옮긴다.

---

## 0. 지금 상태 (10/5 저녁)

| 항목 | 상태 |
|---|---|
| 브랜치 | 작업은 메인 폴더 `C:\Users\user\Neo-Luddite`, `import-credigraph`. origin 에 push 됨(`0e46f88` 까지). **origin `main` 은 이 세션에서 안 맞췄다** — main push = Vercel 프로덕션 배포 |
| 프로덕션 DB | **0042 적용 + kb3 적재 완료**: `kb3.documents`/`kb3.chunks` = 질의회신(kb3_qna) 1,825 + 조세심판원 심판례(kb3_trib) 3,276. 검색 `kb3.match_chunks`(청크로 찾아 사건 단위 카드). DB 검색 = 메모리 검색 158/158 확인, 지연 ≈ 0.37초 |
| 챗 | **무변경.** 서버 `.env` RAG_SOURCE=fusion(kb2·rag·kbdict). kb3 는 `source="v2"` 에서만 쓰이고 v1 fusion 엔 안 붙어 있다 |
| 백엔드 서버 | `158-179-177-51.sslip.io` — 이번 세션 kb3_store/retriever 변경은 **아직 배포 안 됨**(deploy.sh 안 돌림). v2 경로만 쓰는 코드라 지금 배포해도 챗 동작은 같다 |
| 벤치 근거 | run1(strict, 158문항): 기준선(fusion+질의회신) 대비 **+심판례 시민 useful 54.2→62.5, near 77.4→80.6, noise +0.04, 얻음 6·잃음 0** → 합격선(D11) 통과. 원자료 `docs/doing/kb3_측정자료_261005/run1`(로컬) |

## 1. 먼저 읽는다

1. 메모리 `MEMORY.md` — 특히 `project_new_rag_kb3`, `project_korean_track_compliance`(D9 포함), `project_deploy_git_workflow`, `project_kb_three_layer_roadmap`(P4 출처 라벨), `feedback_session_scope_separation`
2. `design/새RAG_KB3_구축설계.md` §0 결정 표 · §2 구조 · 진행 기록 맨 위 3개
3. 코드: `backend/api/rag/retriever.py` `get_retriever`(fusion·v2 분기, `_kb3`) · `backend/api/llm.py` 근거 블록(`_REVIEWED_HEADER` 부근 ~L247–290, `write_advisory` ~L395) · `backend/api/pipeline.py` 자문 경로(~L255–315)

## 2. ⚠️ 함정 — 붙이기만 하면 라벨이 거짓말이 된다

- `llm.py` 는 **corpus 가 kbdict 가 아니면 전부 "검수 선례 — 세무사가 확인한 내용"** 블록에 넣는다(~L279). kb3 를 fusion 에 붙이면 심판례·질의회신이 세무사 검수로 표시된다.
- `pipeline.py` 자문 머리 문구도 `any(p.corpus != "kbdict")` 이면 "세무사들이 남긴 검수 의견을 근거로"라고 박는다(~L298).
- → 근거 블록을 **권위 층별로** 나눠야 한다(D5): `검수 선례(rag·kb2) > 판례(kb3_prec) > 심판례(kb3_trib) > 국세청 해석(kb3_qna) > 참고 사전(kbdict)`. 9/27 에 정한 라벨 문구가 `design/KB3_요지수집_설계.md` §10 "권위 라벨" 줄에 있다(심판례 라벨은 새로 — "조세심판원 결정 · 다른 사건 · 결정유형 포함").
- 규칙 그대로 지킬 것: 다른 사건의 사실관계를 옮기지 말 것 · 문서번호 인용은 content 에 있는 것만 · 판정은 엔진 권위(심판례로 판정 바꾸지 않음).

## 3. 워크플로우 (순서대로 · 단계마다 사용자 확인)

1. **설계 확인(코드 0)** — 배선 방식 두 안 중 사용자에게 고르게 한다: (a) `fusion` 분기에 kb3 갈래 추가(`FUSION_QUOTA_KB3`, 0 이면 안 붙음 = 즉시 원복 스위치) (b) 새 source 값(예: `fusion_kb3`)으로 따로 두고 `.env` RAG_SOURCE 를 바꿔 켬. 추천 = (a) + 기본값 0(배포 후 `.env` 로 켬). 갈래 순서 `kb2, rag, kb3, kbdict`, 컷 `KB3_MIN_SCORE=0.40`, 쿼터 2.
2. **라벨 분리** — `llm.py` 근거 블록을 corpus 별로. `pipeline.py` 머리 문구를 근거 구성에 맞게(검수 선례가 하나도 없으면 "세무사 검수 의견" 금지). `meta.ragCorpora` 계측은 그대로 흐르는지 확인.
3. **로컬 검증** — `?ragSource=fusion` 로컬 서버로 시민 질문 몇 개(C16 중고거래 · C30 차명예금 · C41 사업용계좌 · C48 세무조사 연기 = run1 에서 얻은 문항)와 병의원 판정형 몇 개. 확인: 심판례가 심판례 라벨로 나오나 · 판정형 경로 판정 불변 · **판정형 날조(numeric_guard)** 0 — P8 C 의 192턴 방식 축소판이면 충분.
4. **배포** — 응답 모양이 안 바뀌면 백엔드만: `import-credigraph` push → `backend/deploy/deploy.sh`. 서버 `.env` 에 `FUSION_QUOTA_KB3=2`·`KB3_MIN_SCORE=0.40` 추가(사용자 확인 후). 끄기 = `FUSION_QUOTA_KB3=0`.
5. **프로덕션 확인** — 같은 질문으로 실제 응답, `rag.chat_turns` 의 ragCorpora 에 kb3 가 찍히는지.

## 4. 재논의 금지

- Upstage 단독 · **D9: 제품에 들어가는 텍스트 = 원문 또는 Upstage 생성**(Claude 가 쓴 문장 금지) · 범위 국세만(D12)
- 10/4·10/5 결정 전부(설계 문서 §0) · `kb3` ≠ `rag.passages` · KB 문턱 2
- 컷 0.40·쿼터 2(run1 에서 쿼터 3 = 2와 동일)

## 5. 하지 말 것

- 라벨 분리 없이 kb3 갈래만 켜기(§2) · 벤치·논문성 실험을 이 세션에 섞기(세션 분리)
- 밤에 프로덕션 DB 벤치 강행 · 사용자 확인 없이 서버 `.env` 변경·배포
- origin `main` push 는 Vercel 배포다 — 프론트 변경이 없으면 사용자에게 맞출지 묻는다

## 6. 이 세션 뒤로 남은 큰 일 (참고)

- 판례 재수집(요지 + 상세내용, 사용자가 별도 세션) → 같은 포맷팅(`kb3_trib_format.py` 방식, 국세만) → 따로 계측 → `kb3_prec` 적재
- LLM1(되묻기) 공사 — 팀 되묻기 세트 725·엑셀 25원형은 **작성 모델 확인 전 제품 투입 금지**, 우리 `derived/` 는 Claude 작성이라 금지(D10)
- 에이전트 스튜디오 서버 저장 — kb3 에 `kb3_expert`·`expert_id`·`publish_state` 자리 있음(0042), 미리보기 = `match_chunks(..., preview_expert_id)`

## 7. 환경 메모

- venv `backend/.venv`. 벤치는 `KBDICT_MIN_SCORE=0.45` 를 **명시**해야 프로덕션과 같다(로컬 `.env` 에 없음).
- 프로덕션 DB 적재는 분당 ~47건(도쿄 왕복). Docker Desktop 은 구버전 안내가 뜨지만 로컬 검증 외엔 안 쓴다.
