# 운영자 AI 코어 개편 + RAG 전역토글 + DB 정리 + owner 라이브 세션

날짜: 2026-07-10 · 브랜치: `import-credigraph`(→main fast-forward) · 목적: 데모 전 운영자 콘솔 정보구조 정리 + RAG 관제(조회·on/off) + 테스트 데이터 청소 후 사장님 100문항 실사용 준비.

커밋: `7f26a9b`(AI 코어 개편+RAG토글) → `56ffc39`(목업 제거) → `f6c3dcc`(라이브 세션). 3건 모두 main FF → Vercel 프로덕션 배포.

---

## 1. 운영자 사이드바 개편 — "모델" → "AI 코어"

`components/layout/admin-sidebar.tsx`. 실동작 없는 목업 화면 3개를 실제 정보 화면으로 교체.

| 이전 | 이후 | 화면 내용 |
|---|---|---|
| 카테고리 "모델" | **AI 코어** | — |
| 파이프라인 | **LLM** | Upstage Solar 실측 스펙(`solar-pro3`·`embedding-query/passage`·OpenAI호환·function-calling) + `/health` 라이브 연결/모델 |
| Training Batch | **RAG** | 구성 통계(source_kind 분포·기여 대화/세무사) + **전역 ON/OFF 토글** |
| ModelVersion | **인프라** | Vercel/Oracle도쿄/Supabase 구성 + `/health`·`/rag/health` 라이브 도달 배지 |
| 포장실 (RAG 추적) | **배선실 (RAG 추적)** | 라벨만 변경(라우트 `/admin/packaging` 유지), 관련 UI 문구 통일 |

- 신규 뷰: `components/admin/{llm-info-view,rag-overview-view,infra-info-view}.tsx`. 기존 `/admin/pipeline`·`/pipeline/batches`·`/pipeline/versions` 라우트를 재활용(라우트 URL은 그대로, 렌더 컴포넌트만 교체).
- 대시보드 카드 "모델 파이프라인" → "AI 코어"(3서브시스템).

## 2. RAG 전역 ON/OFF — DB 영속 (env → app_config)

기존엔 백엔드 env `RAG_ENABLED` 하나로만 제어돼 운영자가 못 바꿨다. `app_config.rag_enabled`(1/0)에 영속 → `rag_enabled()`가 **요청 단위로 DB 우선 조회**(키 없거나 DB장애면 env 폴백) → admin RAG 화면 버튼으로 서버 재시작 없이 즉시 반영.

- 마이그레이션 `0009_rag_toggle.sql`(seed rag_enabled=1).
- 백엔드: `store.get/set_app_config`·`store.stats()`, `retriever.rag_enabled()` DB우선, 신규 엔드포인트 `POST /api/rag/toggle`·`GET /api/rag/stats`.
- 프론트: `services/rag.ts`에 `getRagHealth`·`setRagEnabled`·`getRagStats`·`getServiceHealth`.

**라이브 3단계 배포(전부 검증):**
1. Supabase(도쿄) `apply_migration.py 0009` → `rag_enabled=1` 확인.
2. Oracle 백엔드 재배포 — **서버는 git 아님(tar-pipe)**, 변경 `.py` 4개(main/schema/rag.store/rag.retriever) `scp` + `__pycache__` 정리 + `systemctl restart neo-luddite-api`(기동 ~10초). `/api/rag/stats`·`/api/rag/toggle` 외부 HTTPS 검증.
3. 프론트 Vercel 배포(main FF).

## 3. 유휴 목업 제거 (`56ffc39`)

AI 코어 개편으로 라우팅 끊긴 "모델 파이프라인" 목업 일습 정리(9파일 −2308줄): 컴포넌트 6개(batch/version list·detail·new-form, pipeline-dashboard), `lib/pipeline-store.ts`, `services/pipeline.ts`, `poc-schema.ts`의 TrainingBatch/ModelVersion 계열. import 관계로 고아 판정(외부 참조 0) 후 삭제, 빌드 32라우트 정상.

## 4. DB 정리 — 테스트 데이터 청소, 계정·RAG뼈대·설정 보존

사장님 100문항 실사용 전 백지화. **백업(scratchpad JSON) 후** 한 트랜잭션 실행.

- **보존**: `auth.users`(8)·`profiles`(8)·`auditors`(3) 계정 · `rag.passages` source_kind='case_seed'(8, RAG 뼈대) · `app_config`(freeze_ms=60000, **rag_enabled=0** — 사용자 결정으로 OFF 유지).
- **삭제(TRUNCATE)**: conversations(13)·line_feedback(7)·audits(6)·audit_tasks·pool_candidates(4)·reviews·session_evaluations·ledger_entries(2)·나머지 빈 테이블. RAG feedback passage(4)는 `delete ... where source_kind not in ('case_seed','kb_document')`.
- **안전성 근거**: public/rag 스키마에 FK가 사실상 없음(유일 FK `profiles→auth.users`, 둘 다 보존). `rag.passages`는 `conversations`를 FK로 안 물어 세션 삭제가 RAG 뼈대를 안 건드림 → CASCADE 무관.
- 검증: 삭제대상 전부 0, 라이브 `/api/rag/stats` = active 8(case_seed only)·conversations 0·auditors 0.

## 5. owner 챗 — 라이브 상담 세션 실제화 (`f6c3dcc`)

증상: owner 사이드바가 **정적 데모 3개**(리스 차량/골프/헬스장)를 세션으로 보여주고 "새 상담"이 replay 스토어만 리셋(라이브에선 무동작). 라이브 경로는 이미 Supabase 영속+제목생성이 되는데 **사이드바가 그걸 안 읽는 게** 근본원인.

- **사이드바(`app-sidebar.tsx`)를 모드 인지형으로**: remote 모드면 `useConversationStore`(사장님 본인 대화, Realtime, RLS owner 스코프)를 세션 목록으로 렌더. 재생 모드는 기존 정적 동작 유지.
- **"새 상담"**: 새 `conversationId` 발급 + 빈 세션 → 첫 질문 시 `deriveTitle`이 질문으로 제목 자동생성 + `persistLive` 저장 → 목록 등장.
- **기존 세션 클릭**: 그 대화를 remote store로 복원(메시지 포함)해 이어서 질문. `remote-chat-store.init`에 `messages` 복원 인자 추가.
- **모드 공유**: 본문 토글과 사이드바가 어긋나지 않게 챗 모드를 `lib/chat-mode-store.ts`(신규)로 승격.
- **즉시성**: `persistLive` 성공 후 로컬 캐시 낙관적 upsert(Realtime 왕복 없이 목록 즉시 갱신, 스냅샷 필드 보존).
- 근거: `conversations` RLS `conversations_owner`(owner_id=current_domain_id() for all) + `supabase_realtime` publication 등록 확인.

## 남은 것 / 확인 포인트

- **브라우저 육안 E2E**(owner 로그인): ①데모 3개 사라짐 ②첫 질문 → 제목 세션 등장 ③"새 상담" → 새 세션 ④기존 세션 클릭 복원.
- **RAG 현재 OFF** — 사장님 문항 상담 시 case_seed 뼈대를 근거로 쓰려면 admin RAG 화면에서 ON.
- 챗 본문 **예시 질문 칩**(리스/골프/헬스장)은 예시 질문으로 존치(온보딩용). 제거는 `occupations.ts conversationIds` 비우면 됨.
- DB 백업 JSON은 세션 scratchpad(임시) — 필요 시 durable 위치로 이동.

관련: 메모리 `project_deployment_plan`·`project_rag_product_thesis`·`project_operational_flow` · `260709_SeamC_배포_라이브_Vercel_Oracle도쿄.md`
