# 작업 요약 — Upstage API 키 검증 · Seam A `/api/chat` 백엔드 E2E 구현

날짜: 2026-07-02 · 브랜치: `import-credigraph` · 작업: 주최측 Upstage 키 실검증 → 설계 미결 해소 → Seam A 하이브리드 챗 백엔드 신설·E2E 검증

이전 세션: [260701_credigraph연동_설계_하차장intake_작업요약.md]

---

## 개요
주최측이 발급한 Upstage Solar Pro API 키가 유효한지 실호출로 검증하고, 그 결과로 **Seam A(`/api/chat`) 구현을 막던 유일한 블로커를 해제**했다. 이어서 설계 v0.3 §2.5의 하이브리드 파이프라인(엔진=결정적 판정 + Solar=자연어 작문)을 `backend/api/` FastAPI 서비스로 구현하고, 실제 Upstage 호출로 clinic 판정 경로 + follow-up 분기를 E2E 검증했다.

## 1. Upstage API 키 검증 (실호출)
받은 키 `up_1gR4...`(Solar Pro, `console.upstage.ai/api-keys`)를 4가지 엔드포인트로 검증 — **전부 HTTP 200**:
- `GET /v1/models` — 인증 OK. 모델: `solar-pro3`(최신, 2026-01-26), `solar-pro2`, `solar-mini`, `syn-pro`
- `POST /v1/chat/completions` — `solar-pro3` 응답 정상
- `POST /v1/embeddings` — `embedding-query` 벡터 반환 (RAG용)
- **function-calling**(tools/tool_choice) — 지출 추출 tool_call 정상 → A-2 설계 성립
- **베이스 `https://api.upstage.ai/v1` = OpenAI 완전 호환** → `openai` SDK에 base_url만 교체

→ 국내 트랙 컴플라이언스: Upstage 국산 단독이라 100% 충족.

## 2. 메모리·설계문서 갱신
- 🆕 메모리 `reference_upstage_api.md` — 검증된 베이스URL·모델명·임베딩·function-calling. (키 값 자체는 시크릿이라 미저장) + `MEMORY.md` 인덱스 1줄 추가.
- 📝 `docs/doing/260701_백엔드_연동_설계_및_API계약.md` §6 — "Upstage 미결"(모델명/임베딩/function-calling) → **확정**으로 이동. 남은 미결은 쿼터·rate limit뿐.

## 3. Seam A `/api/chat` 백엔드 신설 (설계 §5 3~4단계)
신규 `backend/api/` FastAPI 서비스. 설계 §2.5 하이브리드 파이프라인을 그대로 구현.

**파일**
- `api/schema.py` — 프론트 `lib/conversation-schema.ts`와 **1:1 pydantic**(Segment/UiBlock/Message + ChatRequest/Response). 프론트 Zod가 진실의 원천.
- `api/engine_adapter.py` — ① function-calling 도구 스키마(`extract_clinic_expense`, ExpenseInput/ClinicProfile 필드 1:1) ② 추출dict→엔진입력 매핑 ③ `ExpenseResult`→verdict_card+evidence_checklist **결정적** 매핑. **핵심: verdict enum은 멤버 `.name`으로 브릿지**(엔진 `Verdict.전부인정.name` == 프론트 `"전부인정"`; `.value`는 공백 있는 라벨이라 불일치).
- `api/llm.py` — Upstage Solar 클라이언트(openai SDK, `base_url` override). ① `extract_engine_inputs`(function-calling 추출) ④ `write_segments`(엔진 결과에 근거해 segment 작문, `emit_segments` 도구 강제) + `write_followup`(정보부족 시 되물음).
- `api/pipeline.py` — 6단계 오케스트레이션(추출→[부족? follow-up 반환]→엔진 evaluate→근거서 판례번호 추출→segments 작문→uiBlocks 매핑→조립). **A-3 id 규칙**: `message.id=asst_{convId}_{order}`, `segment.id={message.id}_s{index}`.
- `api/main.py` — FastAPI `POST /api/chat` + `/health` + dev CORS(localhost:3000). clinic만 판정 경로, 나머지 직업군은 "준비중" graceful 응답.
- 부속: `requirements-api.txt`(fastapi/uvicorn/openai/pydantic/python-dotenv), `.env.example`, `backend/.gitignore`(**.env·.venv 제외 — 키 보호**).

**설계 준수 핵심**: verdict는 **항상 규칙엔진이 권위 원천**(할루시네이션 방지), LLM은 입력추출·작문만 담당.

## 4. E2E 검증 (venv + 실제 Upstage 호출)
- 의존성 설치: `backend/.venv` (fastapi 0.139, openai 2.44, pydantic 2.13, Python 3.14.3)
- **판정 경로**: "거래처 골프 300만원 접대비(거래처·기록·증빙 보유)" → 엔진 `조건부`(리스크55) verdict_card + 증빙 3건 checklist + Solar 6개 segment(결론→법리→적용→증빙요구→단서) + 추출 정확(`접대성지출`/300만/거래처=true). id=`asst_conv_clinic_golf_001_1`, order=1 ✓
- **follow-up 경로**: 모호한 질문 → 판정·uiBlocks 없이 `follow_up` segment로 부족정보 되물음 ✓

## git
- `.env`(실제 키) gitignore 확인 — `git check-ignore` 통과, 커밋 대상 아님.
- 커밋: `backend/api/*` + requirements-api + .env.example + .gitignore + 본 요약.

---

## 다음 할 일 / 미결
- [ ] **RAG 구현(설계 §5 4단계)** — 현재는 엔진 근거에서 판례번호 정규식 추출하는 **스텁**. Upstage 임베딩(`embedding-passage/query`)으로 `backend/data` 판례 코퍼스 인덱싱 → 실제 그라운딩으로 교체.
- [ ] **프론트 런타임 교체** — `frontend/lib/runtime/use-replay-runtime.ts` → `use-remote-runtime.ts`(`/api/chat` 호출). 백엔드는 준비 완료. 프록시(rewrite vs NEXT_PUBLIC_API_BASE) 결정 필요.
- [ ] **판정 경로 segment 품질** — framework/citations 태깅이 비어 나옴(작문 프롬프트 보강 여지).
- [ ] Upstage 계정 **쿼터·rate limit** 실사용 한도 확인.
- [ ] (이전 세션 이월) 하차장 엑셀 intent dev 서버 브라우저 스모크, `import-credigraph`→main 병합 검토.
- 참고: 로컬 설계문서 `docs/doing/260701_백엔드_연동_설계_및_API계약.md`(git 미추적).
