# B write-path 자동 트리거 — 검수 확정 → 코멘트 C → RAG 적재

날짜: 2026-07-04 · 브랜치: `import-credigraph` · 지휘문서: [260702_마스터설계_ABC_워크스트림_분리실행.md](260702_마스터설계_ABC_워크스트림_분리실행.md)

## 한 줄 요약
세무사 검수가 **확정(`review.finalize`)** 되는 순간, accepted 라인 피드백(코멘트 C)이 정지 스냅샷의 **질문 A + 답변 B** 와 묶여 백엔드 `POST /api/rag/ingest` 로 흘러 `rag.passages` 에 적재된다. 하차장→일감→문장코멘트→검사실→**RAG** 루프가 처음으로 끝까지 닫혔다(운영 흐름 6단계의 마지막 삽). 빈-KB 논지는 유지 — 자동 인덱싱이 아니라 **사람이 인정한 코멘트만** 들어간다.

## 핵심 정책
- **트리거 지점 = 검수 확정.** admin 이 audit 을 검수해 `finalize()` 를 부르는 그 순간, accepted 결정(결정 없으면 기본 인정)인 line_feedback 만 적재 대상. reject 는 KB 에 안 들어감 = 검사실이 필터.
- **A/B 는 정지 스냅샷에서 해소.** `getStoredConversation(convId)`(snapshot_payload 우선)에서 `segmentId` 로 답변 B 세그먼트를 찾고, 그 직전 사용자 메시지를 질문 A 로 잡는다. 라이브가 계속 흘러도 감사가 본 그 시점 문답으로 고정(하차장 재편의 5분 정지 스냅샷을 그대로 소비).
- **컴플라이언스.** 임베딩·upsert 는 백엔드(Upstage 국산)에서만. 프론트는 텍스트만 넘긴다. `rag.*` 는 RLS 로 프론트 직접 쓰기 차단 → 반드시 HTTP 경계(`/api/rag/ingest`)를 지난다(마스터 §1·§3-3).
- **비차단·멱등.** RAG/백엔드 장애가 검수 확정을 되돌리지 않는다(finalize 는 try/catch 로 삼킴, DB 미설정이면 `skipped` 로 응답). 재확정/재적재는 `dedupe_key=feedback:<id>` 로 멱등(재임베딩 반영).

## 산출물

**백엔드:**
- `api/schema.py` — `IngestFeedbackItem`(feedbackId·conversationId·segmentId·question·answerSegment·comment·reviewer·tags·occupation·taxCategory·caseRefs) / `IngestFeedbackRequest`(items[]) / `IngestedPassage` / `IngestFeedbackResponse`(ingested[]·skipped·dbConfigured).
- `api/main.py` — `POST /api/rag/ingest`. items 를 순회하며 `rag.ingest.ingest_feedback(...)` 호출 → passage id 반환. DB 미설정이면 `skipped=len(items), dbConfigured=false` 로 graceful. (기존 `rag.ingest.ingest_feedback` 파이썬 함수는 그대로 재사용 — 신규 배선은 HTTP 경계뿐.)

**프론트(신규):**
- `services/rag.ts` — `apiBase()`(chat.ts 패턴 재사용) · `resolveBundle`(스냅샷 segmentId→A/B) · `buildIngestItems`(accepted LineFeedback[]→ingest item[], 스냅샷 없거나 세그먼트 못 찾으면 조용히 제외) · `ingestFeedback`(POST) · `ingestAcceptedFeedback`(편의 래퍼, 태울 것 없으면 네트워크 미접촉).

**프론트(배선):**
- `services/review.ts` `finalize()` — accepted 부분집합을 배열(`acceptedFeedback`)로 뽑아 ledger 기록 뒤 `ragService.ingestAcceptedFeedback(...)` 를 **비차단** 호출(실패/skip 은 console.warn).

## 검증 (라이브 Tokyo credigraph · Upstage 실호출)
- **컴파일**: 프론트 `tsc --noEmit` 0 · 백엔드 import OK, 라우트 `['/api/rag/ingest','/api/chat']` 등록 확인.
- **HTTP E2E**: uvicorn 기동 → `/rag/health` baseline `kbPassages=8` → `POST /api/rag/ingest`(골프 회원권 코멘트 1건) → `{ingested:[{feedbackId,passageId}], skipped:0}` · 재조회 **9**.
- **멱등**: 같은 feedbackId 재적재 → count **9 유지**(갱신).
- **검색 도달**: `get_retriever().retrieve('골프 회원권 경비 처리', occupation='clinic')` → 방금 적재한 passage 가 **top hit(score 0.537, source_kind=feedback, reviewer=auditor)**, 기존 case_seed 위로 랭크.
- **정리**: 스모크 passage 삭제 → `kbPassages=8` 원복(빈-KB 논지 보존). 서버 종료. 워킹트리 외 DB 부작용 없음.

## ⚠️ 알아둘 한계(선행 부채, 이번 배선이 새로 만든 게 아님)
- **line_feedback 은 아직 localStorage(`lib/audit-store.ts`).** `public.line_feedback` 테이블은 0001 에 있으나 프론트 어디서도 참조하지 않음(P2 미마이그레이션). 따라서 `finalize()` 는 **코멘트가 finalize 하는 브라우저 localStorage 에 있을 때만** 적재한다 — 세무사/admin 이 다른 브라우저면 admin 쪽엔 코멘트가 없다. 기존 finalize(ledger 집계)도 이미 이 전제였고, ingest 배선은 그 전제를 그대로 상속(더 악화시키지 않음). 정식 해결 = **audit-store → Supabase 마이그레이션(별도 과제)**.
- amend(이의 후 accept→reject 뒤집힘) 시 **retract(적재 취소)** 는 미배선. 현재는 accept 방향만 적재. 필요 시 store 에 soft-delete + `/api/rag/retract` 추가.

## 남은 일 (다음 세션)
1. **브라우저 육안 워크스루**: 검수 확정 UI → console `[rag]` 로그 확인 → `/rag/health` count 증가. (두 서버 기동 필요.)
2. **audit-store → Supabase 마이그레이션(P2)**: line_feedback 서버 영속 → 크로스 브라우저 검수 확정 + 코멘트 원천 단일화. 위 한계 해소의 정공법.
3. **amend retract**: 이의로 뒤집힌 코멘트를 KB 에서 내리는 경로.
4. **정산 수익%(플로우 6)**: 관리자 수익 입력 + % 배분.
5. 데모 전 `freeze_ms` 300000(5분) 복원 결정(현재 1분).

## 참고 메모리
- [[project_operational_flow]] — 6단계(검사실→RAG직행 이번 세션 반영)
- [[project_rag_product_thesis]] — 실행 순서: 하차장 재편(완) → **B write-path(이번 완)** → C 배포
- [[project_snapshot_pool]] — A/B 원천인 정지 스냅샷
- [[reference_upstage_api]] · [[project_backend_architecture_decision]]
