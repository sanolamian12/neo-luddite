# 작업 요약 — credigraph 수령 · 백엔드 연동 설계 · 하차장 intake 구현

날짜: 2026-07-01 · 브랜치: `import-credigraph` · 작업: 프론트 프로토타입 수령 → 구조 파악 → 연동 설계 확정 → 첫 기능 구현

---

## 개요
credigraph(팀원 `ugnchoi`) 프론트엔드 프로토타입을 Neo-Luddite로 받아와, 백엔드(세무 판례·규칙엔진)를 붙이기 위한 설계를 확정하고, 첫 실질 기능(하차장 엑셀 화물 업로드)을 구현·검증했다.

## 1. credigraph 프론트 수령 & 저장소 구조
- `github.com/ugnchoi/credigraph` → `C:\Users\user\credigraph` 독립 클론(원본 참조본으로 보존).
- **Neo-Luddite = credigraph의 production fork(모노레포)** 로 결정. 원 개발자는 대회 데모용, 우리는 실사용 제품으로 분기(diverge).
- 클린 복사(robocopy)로 이식:
  - `frontend/` ← credigraph `prototype/` (Next.js 16 + React 19 + Tailwind 4 + shadcn/ui + @assistant-ui + zustand)
  - `backend/` ← credigraph 루트 Python 엔진 + `data/`(~32MB) + 설계 docs
- `credigraph` git remote 등록(선별 cherry-pick용). 커밋 `1bfb144`.

## 2. 프론트 ↔ 백엔드 구조 매핑 (3개 이음새)
- 두 코드베이스는 같은 제품을 향하나 직접 1:1 아님. **3개 seam에서 연결**:
  - **A. AI 추론** `/api/chat` → Upstage Solar + 판례 RAG + 규칙엔진. 제품의 심장, LLM은 여기만.
  - **B. 플랫폼 영속** ~28개 REST(감사/정산/파이프라인). 현재 Zustand 목업 → fetch 교체 예정.
  - **C. 지식베이스** `backend/data` 판례 → `/audit/knowledge` KB.
- 핵심 발견: 프론트 채팅 스키마(`segments`/`uiBlocks`)가 백엔드 `clinic_expense_engine` 출력과 **거의 1:1**(verdict enum 완전 동일). 백엔드엔 LLM 호출 0개 → 트랙 위반 소지 없음.

## 3. API 계약서 확정 (로컬: `docs/doing/260701_백엔드_연동_설계_및_API계약.md`, v0.3)
- **A-1 동기 단발**, **A-2 LLM function-calling으로 엔진입력 추출**, **A-3 segment id 규칙** 확정.
- `/api/chat` 요청/응답 JSON 예시 + 내부 생성 파이프라인 6단계(엔진=결정적 uiBlocks, LLM=segments 작문) 고정.
- 직업 라우팅 실측: active는 `clinic` 하나 → **MVP는 clinic 단일 경로**. 백엔드 `creator_tax_engine`은 대응 직업 없는 미연결 자산.
- Seam B 40여 엔드포인트 부록 + RAG 코퍼스 순환(하차장→검수→포장실→RAG→챗) 반영.

## 4. PPT 갭분석 & 제품방향 결정 (로컬: `docs/doing/260701_PPT대비_프론트_기능_갭분석.md`)
- PPT(`네오 러다이트 전체 서비스 구상안`, 49슬라이드) = **CrediGraph Hub**(창고 메타포 관리자/작업자 데이터생산·검수·정산 플랫폼, 30+화면).
- 프론트 `/admin`+`/audit`가 이 Hub. **기능 구조 ~80% 존재**, 용어만 다름(하차장/화물/일감/검수/포장 ↔ pool/task/audit/review/pipeline).
- **제품방향 3건 확정**:
  1. **하차장 = 엑셀 업로드**(A열 질문·B열 Upstage 답변 ~100행, 행별 화물→일감화).
  2. **포장실 = RAG 번들**(검수완료분 묶어 RAG 코퍼스 생성; 정확한 형태는 Upstage RAG 설계 의존).
  3. **내 정보 화면 생략** → 대시보드 환영 배너(이름/ID/역할 라벨)로 대체.

## 5. 하차장 엑셀 화물 업로드 intake 구현 (커밋 `443bcfe`)
- 화면: `/admin/pool` → "엑셀 화물 업로드" → `/admin/pool/upload`
  - `.xlsx/.csv` 업로드(A열 질문·B열 답변) → 클라 파싱, 헤더행 자동 제거
  - 미리보기 테이블 + 행별 분류 지정 → **화물 등록**(각 행 = Conversation[질문+답변, 답변 문장단위 절단] + PoolCandidate)
  - 등록 후 `/admin/tasks/new?conversationIds=...` 프리셀렉트로 일감화(기존 흐름 재사용)
- 신규 파일:
  - `frontend/lib/uploaded-conversation-store.ts` — 런타임 업로드 대화 store(localStorage)
  - `frontend/lib/xlsx-intake.ts` — SheetJS 파싱 + 문장분리 + Conversation 빌드(zod 검증)
  - `frontend/components/admin/pool-upload.tsx`, `frontend/app/admin/pool/upload/page.tsx`
  - `frontend/lib/load-conversation.ts` 수정(정적+업로드 store 병합 조회)
- deps: `xlsx@0.18.5`
- 검증: `tsc --noEmit` ✓, `next build` ✓(라우트 등록), 엑셀 파싱 스모크 ✓
- 후속: segment `type`은 `context` 기본값 → framework/citation/정확한 type은 작업자 검수 단계에서 부여. **브라우저 실동작 스모크는 미실시**.

## 6. git 추적 정책 (커밋 `90d37eb`)
- 루트 `.gitignore`: `/*` 무시 후 `backend/`·`frontend/`·`.gitignore`(+ `history/`)만 추적.
- `docs/` 추적 해제(디스크 유지, 로컬 전용). 의도: 페어링 공유 저장소엔 코드만.
- ⚠️ 설계 문서들은 `docs/doing/`에 **로컬로만** 존재(git 미추적). 새 clone 시 따라오지 않음.

---

## 커밋 이력 (이 세션)
- `1bfb144` credigraph frontend/backend 이식
- `443bcfe` 하차장 엑셀 화물 업로드 intake
- `90d37eb` git 추적을 backend/·frontend/로 제한
- (본 요약 커밋) history/ 추가

## 다음 할 일 / 미결
- [ ] dev 서버 스모크 — 샘플 엑셀로 업로드→화물→일감화 end-to-end 눈으로 확인
- [ ] `import-credigraph` 브랜치 → main 병합 검토
- [ ] **Upstage API 사용 안내(주최측)** 수령 후: Seam A 챗 + 포장실 RAG 착수 (모델명·임베딩·쿼터 확정 필요)
- [ ] P2 보완: 기여통계 그래프, 대시보드 환영배너, 우편작성 화면
- 참고 로컬 설계문서: `docs/doing/260701_백엔드_연동_설계_및_API계약.md`, `docs/doing/260701_PPT대비_프론트_기능_갭분석.md`
