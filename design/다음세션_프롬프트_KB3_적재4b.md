✅ **9/27 밤 — W5 설계 확정 + 4b 코드 작성(DB 쓰기 0).** 설계 마스터 = `design/W5_LLM2_답변단계_설계.md`(§0 결정 W5-1~4 · §8 순서 · 진행 기록).
- import-credigraph: `supabase/migrations/0041_kb3_schema.sql`(**미적용**) · `api/rag/kb3_store.py` · `Kb3Retriever` · `get_retriever(source="v2")`(rag·kb3·kbdict, v1 fusion 무변경) · `scripts/kb3_ingest.py ingest [--write]` · `bench_fusion.py --kb3 이름:범위:컷:쿼터:갈래순서`
- agentic-v2: `api/llm2.py`(판정 + M1 강등 + 조문 가드) · `api/engine_contrast.py`(M4) · `pipeline_agentic._answer` 배선 · `ChatMeta.llm2`. 로컬 스모크 2문항 통과(DB 없음, 메모리 KB3)
- 벡터 캐시 `backend/data/kb3/embeddings.npz`(gitignore, **이 PC 에만**)

═══ 이번 세션 할 일 (순서) ═══
1. **3갈래 재측정(낮에)** — 9/27 밤엔 프로덕션 DB 가 벡터 스캔 중 연결을 끊었다(2문항 545초). `--workers 2` 정도로 시작, 끊김이 보이면 즉시 멈춘다.
   ```
   cd backend; $env:RAG_MIN_SCORE="0.50"; $env:KBDICT_MIN_SCORE="0.45"
   .\.venv\Scripts\python.exe bench_fusion.py --testset testset.json,data/kb3/testset_citizen.json --out ../docs/doing/kb3_측정자료_260927/run3_order --judge strict `
     --kb3 "fk3_last:prec_tax+qna_core:0.40:2" --kb3 "fk3_ord:prec_tax+qna_core:0.40:2:kb2,rag,kb3,kbdict" --kb3 "v2_3arm:prec_tax+qna_core:0.40:2:rag,kb3,kbdict"
   ```
   합격선(설계 §2): `v2_3arm` 이 run2 4갈래 대비 시민 useful −2pp 이내 · 병의원 near −1문항 이내. **못 넘으면 수치를 들고 사용자에게**(kb2 를 내 판단으로 되살리지 않는다).
2. **W5 하니스**(오프라인, 설계 §6): `llm2.write_answer` 제품 원문을 메모리 검색 결과로 → 판정 분포 · M1 강등률 · 조문 가드 삭제 수 · 엔진 대조 일치율. O-W5-4(개인/법인 혼입) 빈도도 센다.
3. **프로덕션 DB 쓰기 → 사용자 확인 후**: 0041 적용(`apply_migration.py`) → `kb3_ingest.py ingest`(dry-run 먼저) → `--write` → DB 경로 검색이 메모리 경로와 같은 결과인지.
4. v2 유닛 기동은 LLM1v2 단계 5(`design/다음세션_프롬프트_LLM1v2_단계4와5.md`) 몫.

═══ 재논의 금지 ═══
KB3 컷 0.40 · 쿼터 2 · 범위 2,078 · `kb3.*` 스키마 · 권위 검수 > 판례 > 해석 > 사전 · W5-1~4(9/27 사용자) · D3·D4 · solar-pro3.

═══ 하지 말 것 ═══
- 사용자 확인 없이 프로덕션 DB 쓰기 · 밤에 DB 벤치 강행 · 벤치 없이 v1 디폴트 retriever 에 kb3 켜기
- `llm.py`·`pipeline.py`·`handoff.py` 수정(격리) · agentic-v2 코드를 import-credigraph·main 에 push
- 새 소스(법령 KB·`moef_qna`) 수집 — 6규칙, 사용자 제안부터

═══ 세션 마무리 ═══
1. W5 설계 § 진행 기록 · KB3 설계 §10 진행 기록 2. `history/` 3. 메모리 `reference_kb3_collection_path`·`project_llm1_pivot`
4. 다음 프롬프트 새로 쓰고 이 파일 지움 5. 문서는 import-credigraph 커밋 → agentic-v2 로 merge(반대 금지)
