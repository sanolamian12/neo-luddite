# 다음 세션 — 새 데이터로 RAG·KB3 구축 (워크플로우)

**작성 2026-10-04.** 앞 세션 기록 = `history/261004_새프론트인수_frontend-v3_게스트챗live연결_main배포.md`.
이 파일은 새 세션의 출발점이다. 세션이 끝나면 다음 프롬프트를 새로 쓰고 이 파일은 `docs/done/` 으로 옮긴다.

---

## 0. 지금 상태 (10/4 기준)

| 항목 | 상태 |
|---|---|
| 브랜치 | origin `main` = `import-credigraph` = `e29982a`. **작업은 메인 폴더 `C:\Users\user\Neo-Luddite`(import-credigraph)에서.** |
| 프론트 | ugnchoi 새 UI 인수·live 배포 완료(`neo-luddite.vercel.app`, Vercel `NEXT_PUBLIC_DATA_MODE=live`) |
| 백엔드 | `158-179-177-51.sslip.io`, 10/4 세션에서 무변경. 챗 = v1 파이프라인 + 기존 RAG(`RAG_SOURCE=fusion`) |
| agentic-v2 | **사실상 폐기**(사용자 10/4). worktree `C:\Users\user\Neo-Luddite-v2` 는 참고용으로만 — merge·push 하지 않는다 |
| 새 데이터 | **팀이 RAG 용 데이터를 대대적으로 새로 만들었다.** 위치·형식·양은 아직 이 저장소에 없다 → §2-1 에서 사용자에게 받는다 |

**이 저장소(import-credigraph)에 이미 있는 KB3 자산** — 새 데이터에 맞는지부터 따진다(그대로 쓸 의무 없음):
- `supabase/migrations/0041_kb3_schema.sql` — `kb3.documents`(case_id unique · corpus · origin · content · source_url · law_articles · embedding vector(4096) · content_hash · status) + `kb3.match_documents`. **프로덕션 미적용.**
- `backend/api/rag/kb3_store.py` · `retriever.py` 의 `Kb3Retriever` · `get_retriever(source="v2")`(rag·kb3·kbdict 갈래, 쿼터 0 이면 갈래 안 붙음). **v1 `fusion` 은 kb3 를 안 씀.**
- `backend/scripts/kb3_ingest.py ingest [--write]`(멱등·dry-run 기본) · `bench_fusion.py --kb3 이름:범위:컷:쿼터[:갈래순서]` · `--judge strict`
- 테스트셋 `backend/testset.json`(병의원) · `backend/data/kb3/testset_citizen.json`(시민 48) · 벡터 캐시 `backend/data/kb3/embeddings.npz`(gitignore, 이 PC 에만)
- 옛 KB3 원천(국세청 판례 요지 487 · 질의회신 1,995 → 적재 대상 2,078) — 새 데이터가 이걸 **대체하는지 · 더하는지** 사용자에게 확인
- 설계 문서: `design/KB3_요지수집_설계.md`(§10 적재 설계) · `design/W5_LLM2_답변단계_설계.md`(v2 답변 단계 — v2 폐기로 **그대로 유효하지 않다**)

---

## 1. 먼저 읽는다

1. 메모리 `MEMORY.md` 전체 — 특히 `project_frontend_v3_takeover`(10/4 결정) · `project_corpus_expansion_rules`(6규칙) · `project_kb_three_layer_roadmap` · `reference_kb3_collection_path` · `project_llm1_pivot` · `project_korean_track_compliance`
2. `history/261004_…main배포.md` §3(재논의 금지 결정)
3. `design/KB3_요지수집_설계.md` §6(수령 검수 기준)·§10(적재 설계) — 새 데이터에도 쓸 수 있는 틀
4. `docs/doing/` 를 훑는다(세션 간 지속 참조 폴더 — 메모리 `reference_docs_folder_convention`)

---

## 2. 워크플로우 (순서대로 · 단계마다 사용자 확인)

### 2-1. 새 데이터 받기 · 실사 (코드 0)
- 사용자에게 묻는다: **파일 위치 · 형식(jsonl/csv/xlsx/pdf…) · 건수 · 만든 방법(누가·무엇에서) · 라이선스 · 옛 KB3 를 대체하나 더하나.**
- 받으면 읽기 전용으로 실사: 스키마·필드 채움률·중복·길이 분포·세목 분포·조문 번호 포함률·출처 URL 유무. 결과를 표로.
- 6규칙 대조(메모리): **계측 먼저 · precision 감시 · 한 번에 한 소스 · 라이선스 · 권위 등급 · 소급 가능(출처 추적)**.

### 2-2. 설계 문서 먼저 (`design/새RAG_KB3_구축설계.md` 신규)
정할 것 — **사용자에게 물어서 확정**(AskUserQuestion), 확정분은 문서 §0 결정 표로:
1. 저장 위치 — 기존 `kb3.*`(0041) 재사용 / 확장 / 새 스키마. ⚠ `rag.passages` 에 섞지 않는다(9/27 결정: 누수).
2. 권위 서열 — 현재 `검수 > 판례 > 해석 > 사전`. 새 데이터가 어디에 서나.
3. 제품 경로 — v1 `fusion` 에 kb3 갈래를 붙이나, 새 경로를 만드나(v2 폐기라 `get_retriever(source="v2")` 를 그대로 살릴지도 결정).
4. 컷·쿼터 — 옛 KB3 값(컷 0.40·쿼터 2)은 **옛 데이터 기준**. 새 데이터로 다시 잰다.
5. **에이전트 스튜디오 자리** — 10/4 결정상 세무사가 가르친 사례가 새 RAG 에 **세무사 출처로** 들어간다. 지금 스키마에 `expert_id`/출처 구분·게시 상태(초안/게시)를 받을 자리를 남길지.

### 2-3. 계측 기준선 (DB 쓰기 0)
- 메모리 경로(벡터 캐시 + 메모리 검색)로 먼저 잰다 — 9/27 4a 방식. 기준 = 현재 프로덕션(`fusion`) 결과.
- `bench_fusion.py --judge strict` · 병의원 testset + 시민 48. 지표: useful · near · 혼입(P4) · 판정형 날조(numeric_guard).
- 합격선은 **재기 전에** 사용자와 숫자로 합의한다(정본 O4 방식).

### 2-4. 적재 (프로덕션 DB 쓰기 — **사용자 확인 후에만**)
- 마이그레이션 `python supabase/apply_migration.py <파일>` → 적재 스크립트 dry-run → `--write` → DB 경로 검색이 메모리 경로와 같은 결과인지 대조.
- 프로덕션 쓰기 API 는 토큰 필수(`AUTH_MODE=required`) → 스크립트는 `scripts.dev_token`.

### 2-5. 제품 배선 · 배포 (별도 세션 권장 — 메모리 `feedback_session_scope_separation`)
- 벤치 통과분만 `.env` `RAG_SOURCE`/쿼터로 켠다. 끄면 원복되는 스위치로.
- 배포 = `import-credigraph` push → `backend/deploy/deploy.sh`. 새 응답 모양이면 **프론트 먼저**(메모리 `project_deploy_git_workflow`).

### 2-6. (그 다음 공사) 에이전트 스튜디오 서버 저장·AI 반영
- 결정은 10/4 에 끝났다(history §3). 새 RAG 스키마가 정해진 뒤 착수. 켜는 스위치 = `frontend/lib/data-mode.ts` 의 `agentStudioEnabled`.

---

## 3. 재논의 금지

- Upstage 단독(`solar-pro3` · `embedding-query/passage`) · 제품 경로에 외산 모델 금지(오프라인 채점은 예외)
- 판정 권위 = LLM2 피벗(9/23)의 방향 · 9/24 D3·D4
- 10/4 결정 전부(history §3): agentic-v2 폐기 · 에이전트 스튜디오 적용 범위/반영 방식/게시/시점
- `kb3.*` 를 `rag.passages` 와 섞지 않는다 · KB 문턱 2 유지(사용자가 꺼낼 때까지 논의 금지)

## 4. 하지 말 것

- 사용자 확인 없이 프로덕션 DB 쓰기 · 밤에 DB 벤치 강행(9/27 연결 끊김) · 벤치 없이 프로덕션 retriever 에 새 갈래 켜기
- 새 데이터를 실사 없이 한 번에 적재 · 여러 소스 동시 투입(6규칙)
- agentic-v2 코드를 main/import-credigraph 로 merge · `../Neo-Luddite-v2` 에서 작업 계속
- 데이터 세션에서 제품 코드 수정(세션 분리)

## 5. 환경 메모

- venv: `backend/.venv`(메인 폴더 하나뿐). 문서 변환 도구(pandoc 등)는 설치 OK, 단 `backend/.venv` 금지.
- 프론트 로컬 실행 시 `frontend/.env.local` 에 `NEXT_PUBLIC_DATA_MODE=live`·`NEXT_PUBLIC_API_BASE` 필요(없으면 샘플 모드). `package-lock` 이 바뀌어 메인 폴더는 `npm ci` 먼저.
- PC 절전 = 장시간 작업 정지(9/27). 긴 수집·임베딩 전 절전 해제.
- main/import-credigraph push 는 `.claude/settings.local.json` allow 규칙으로 허용됨(10/4). main push = Vercel 프로덕션 배포.

## 6. 세션 마무리

1. 설계 문서 § 진행 기록 2. `history/YYMMDD_…md`(이번 세션 분) 3. 메모리 갱신(`project_frontend_v3_takeover` 또는 새 RAG 메모리 + `MEMORY.md` 한 줄)
4. 다음 프롬프트를 새로 쓰고 이 파일은 `docs/done/` 으로 5. import-credigraph 커밋·push(main 도 맞추면 프론트 재배포가 일어남에 유의)
