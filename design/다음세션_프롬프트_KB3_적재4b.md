✅ **KB3 단계 4a 완료(9/27)** — 범위·라벨·컷 확정, 메모리 안 계측으로 효과 확인. **DB 쓰기는 아직 0.**
- 적재 대상 **2,078건** = 판례 `prec_tax` 253 + 국세청 질의회신 `qna_core` 1,825 (`scripts/kb3_ingest.py` `LOAD_SCOPES`)
- 벡터 이미 있음: `backend/data/kb3/embeddings.npz`(gitignore, **이 PC 에만** — 없으면 `kb3_ingest.py embed` 로 ~8분)
- 효과(strict): 시민 useful 25 → 54% · 병의원 far 32 → 41% · near 81 → 77%(−1문항)

이 프롬프트는 **단계 4b: 제품 배선 + 프로덕션 적재**다. **W5(LLM2) 설계가 먼저다** — W5 가 KB3 를 어떤 모양으로 부르는지(판례를 따로 부르나, 해석-판례 충돌을 보나)에 따라 갈래 구조가 바뀐다.
W5 설계 문서가 아직 없으면 **이 세션은 W5 설계부터**(사용자와) 하거나, 사용자가 "v1 fusion 에 먼저 붙인다"고 하면 그 경로로.

**먼저 읽는다**
1. `design/KB3_요지수집_설계.md` **§10**(확정 표·계측) · `history/260927_KB3_단계4a_…md`
2. `design/LLM1v2_역할축소_구현설계.md` §4(답변 단계 임시 자문 — W5 자리) · 격리 규칙
3. `backend/api/rag/kbdict_store.py`·`scripts/kbdict_ingest.py`(따라 할 모양) · `retriever.py` `get_retriever` fusion 분기 · `api/llm.py` `_grounding_block`(P4)

═══ 정해진 것 (재논의 금지, 9/27 사용자) ═══
- 저장 = **별도 `kb3.*` 스키마**(rag.passages 금지 — KB2 합성·검수 선례 갈래·kb-map 으로 샌다)
- 권위 = 검수 선례 > 판례 요지 > 국세청 해석 > 참고 사전 · corpus 값 `kb3_prec` / `kb3_qna`
- 컷 `KB3_MIN_SCORE=0.40` · 쿼터 `FUSION_QUOTA_KB3=2` · 갈래 순서 `kb2, rag, kb3, kbdict`
- 한 건 = 한 passage · content 머리표 = 출처 종류·세법·문서번호·일자 (`Kb3Doc.content`) · 출처 링크 필수
- 브랜치: 적재 스크립트 = import-credigraph, 제품 배선 = **agentic-v2**
- 라벨 문안·규칙 초안은 §10 표

═══ 할 일 (순서) ═══
1. 마이그레이션 `kb3.documents`(case_id unique, corpus, 메타, content, embedding vector(4096), content_hash, status) + `kb3.match_documents(vec, k)` — 번호는 마지막 번호 확인 후(`0040` 다음, agentic-v2 와 겹침 주의)
2. `api/rag/kb3_store.py` · `Kb3Retriever` · fusion 배선(env 로 끌 수 있게 — `FUSION_QUOTA_KB3=0` 이면 갈래 없음 = 지금과 동일)
3. `_grounding_block` 에 두 라벨 블록 + 규칙
4. `kb3_ingest.py ingest`(캐시 벡터 재사용, case_id 멱등)
5. **로컬 DB 없이** 먼저: 메모리 경로 벤치를 갈래 순서 `kb2, rag, kb3, kbdict` 로 재측정(run2 는 kb3 를 맨 뒤에 붙였다)
6. **프로덕션 DB 쓰기(마이그레이션·적재) → 사용자 확인 후** → DB 경로 벤치가 메모리 경로와 같은 수치인지

═══ 하지 말 것 ═══
- 사용자 확인 없이 프로덕션 DB 쓰기 · 벤치 없이 디폴트 retriever 에 kb3 켜기 · v1 `llm.py` 라벨을 agentic-v2 밖에서 바꾸기
- 새 소스(기재부 `moef_qna`) 수집 — 6규칙, 사용자 제안부터
- 컷·범위 재논의(바꾸려면 새 벤치 근거로 사용자에게)

═══ 세션 마무리 ═══
1. 설계 마스터 § 진행 기록 2. `history/` 3. 메모리 `reference_kb3_collection_path`·`project_kb_three_layer_roadmap`
4. 다음 프롬프트 새로 쓰고 이 파일 지움 5. 배포는 `project_deploy_git_workflow`(agentic-v2 는 서버 v2 worktree 에 손으로 pull)
