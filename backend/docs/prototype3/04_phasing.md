# Prototype 3 — 단계별 구현 계획 (B0–B6)

프토 2의 Phase 접두어 `A`를 이어 **Phase `B`** 로 시작한다. 각 단계는
**산출물 / 변경 파일 / 인수 기준 / QA**를 명시한다.

> **사전 조건 (모든 단계 공통)** — `prototype/AGENTS.md`: "This is NOT the Next.js you know."
> 신규/변경 라우트나 file convention 작업 전 `node_modules/next/dist/docs/` 의 관련 가이드를 먼저 확인한다.

---

## B0 — 계정·모드 스캐폴드 (Foundations)

**목표:** 계정 객체와 사이드바 푸터 전환기를 도입한다. 헤더 토글은 제거.

### 산출물
- `lib/account-schema.ts` (NEW) — `Account` (viewer/auditor union), `AccountRole`, zod
- `lib/account-store.ts` (NEW) — Zustand persist (`account-store-v1`), `setActiveAccount`, `setViewerOccupation`, `setReviewerName`, `useAccountHydrated`
- `lib/account-route.ts` (NEW) — `routeForAccount(account)`, `useActiveAccount`
- `components/ui/dropdown-menu.tsx` (NEW — shadcn add)
- `components/ui/avatar.tsx` (NEW — shadcn add)
- `components/layout/account-switcher.tsx` (NEW — 두 셸 공통; 보조 텍스트는 viewer→occupation, auditor→reviewerName)

### 변경 파일
- `components/layout/app-sidebar.tsx` — `SidebarFooter`에 `<AccountSwitcher />` 추가, 기존 "업종 변경" 메뉴는 유지(서브로 이동).
- `components/layout/audit-sidebar.tsx` — 동상.
- `components/layout/audit-shell.tsx` — 헤더의 "챗 모드" 링크 **제거**.
- `components/chat/...` — `FlipToAuditButton` 사용처 제거.
- `components/audit/flip-to-audit-button.tsx` — **삭제**.

### 마이그레이션
- `lib/audit-store.ts`의 `reviewerName` — `account-store` rehydrate 시 1회 복사. `audit-store.reviewerName` 자체는 한 단계 deprecated 표기로 유지(B1 말기 제거).

### 인수 기준
- [ ] 챗·감사 양쪽 사이드바 푸터에 전환기 노출.
- [ ] 전환 클릭 → 적절한 라우트로 이동, 새로고침 후 활성 계정 유지.
- [ ] 평가자 이름 변경 가능(드롭다운 내부 또는 단순 inline input — 우선 inline).
- [ ] 헤더의 토글이 제거되었는지 시각 확인.
- [ ] `npm run build` 통과.

### QA (브라우저)
- [ ] `/chat/clinic` 진입, 푸터에서 "평가자"로 전환 → `/audit/chat-logs`로 이동.
- [ ] 새로고침 → 평가자 유지. 다시 viewer로 전환 → `viewer.occupation` 기준 `/chat/clinic`으로 복귀.
- [ ] `/select`에서 다른 업종 선택 → 푸터 보조 텍스트 즉시 갱신, viewer 상태 영속.

---

## B1 — 감사 모드 IA 재배치 (Sidebar Sections + Routes)

**목표:** 감사 사이드바를 "섹션 내비"로 바꾸고, 세션 목록을 사이드바에서 워크스페이스로 이관할 준비.

### 산출물
- 라우트 분리:
  - `app/audit/page.tsx` — `redirect("/audit/chat-logs")`
  - `app/audit/chat-logs/page.tsx` — 인덱스 (선택 안 됨 상태)
  - `app/audit/chat-logs/[conversationId]/page.tsx` — 기존 `/audit/[conversationId]/page.tsx`에서 이동
  - `app/audit/knowledge/page.tsx` (stub)
- 구 라우트 `app/audit/[conversationId]/...` — 리다이렉트.
- `lib/audit-route.ts` — `useAuditRouteContext()`로 확장 (`section: "chat-logs" | "knowledge"`, `conversationId?`).
- `components/layout/audit-sidebar.tsx` — 섹션 탭 두 개로 단순화 (세션 목록은 일단 stub).

### 인수 기준
- [ ] `/audit` 접근 시 `chat-logs`로 리다이렉트.
- [ ] 사이드바 섹션 탭이 현재 라우트에 따라 active.
- [ ] 기존 `/audit/<key>` URL이 새 위치로 리다이렉트.
- [ ] 빌드 통과, 콘솔 경고 없음.

---

## B2 — 3-pane 챗 감사 워크스페이스

**목표:** 큐 스트립 · 전사 · 인스펙터로 분리한 어노테이션 워크스페이스.

### 산출물
- `components/audit/chat-logs/queue-strip.tsx` (NEW)
- `components/audit/chat-logs/inspector.tsx` (NEW — 탭 컨테이너 3종: 피드백 · 평가 · 근거 stub)
- `components/audit/audit-topbar.tsx` (NEW — 제목·메타·내보내기·상태 배지)
- `components/audit/audit-experience.tsx` — **재작성**: 위 셋 + transcript 조합.
- `components/audit/audit-summary.tsx` — Topbar로 흡수 후 삭제(또는 함수 헬퍼만 남김).

### 큐 상태 파생
- `lib/audit-store.ts`에 selector 추가: `conversationStatus(conversationId): "untouched" | "in_progress" | "completed"`.

### 인수 기준
- [ ] 좌측 큐 스트립에 세션 목록·상태 배지 노출, 클릭 시 라우트 변경.
- [ ] 큐 스트립 필터(전체/검토중/완료) 동작.
- [ ] 인스펙터 탭 전환, 선택 문장 컨텍스트 유지.
- [ ] 내보내기 동작(프토 2 기능 유지, JSON 파일 동일 모양).
- [ ] 1024px 이하: 큐 스트립 접힘 토글.

### QA
- [ ] 키보드: 큐 스트립에서 ↑↓로 이동, Enter로 진입.
- [ ] 피드백 저장 직후 큐 스트립 배지 즉시 갱신.
- [ ] 새로고침 후 영속 동일.

---

## B3 — KB 읽기 전용 브라우저

**목표:** 시드 + 사용자 문서를 통합한 인덱스 + 리더.

### 산출물
- `lib/kb-schema.ts` (NEW — `KbDocument`, `KbCategory`, zod)
- `lib/kb-store.ts` (NEW — `kb-store-v1`, user docs only)
- `lib/load-kb-seeds.ts` (NEW — `prototype/data/kb/seeds/**/*.md` raw import + frontmatter parse)
- **시드 파일 (한국어 파일명)** — `prototype/data/kb/seeds/`:
  - `스킬.md`
  - `해석론/{엄격해석,목적론해석,체계적해석,실질과세원칙,신의성실원칙,입증책임,유추해석,문언해석}.md` (8개)
  - `직업군/병의원/{개요,차량유지비,골프회원권,헬스장회원권}.md` (4개)
  - `판례노트/{조심2025구1960,조심2025부4364,조심2025부4055}.md` (3개)
  - `용어집/*.md` (9개)
  - `오류패턴/개요.md` (1개, 안내)
- `components/audit/kb/folder-tree.tsx` (NEW — 사이드바 트리, 폴더/문서 노드)
- `components/audit/kb/document-reader.tsx` (NEW)
- `components/audit/kb/document-meta.tsx` (NEW — frontmatter·인용·관련 링크)
- `components/audit/kb/wiki-link.tsx` (NEW — `[[경로]]` → 내부 Link 변환)
- `app/audit/knowledge/page.tsx` — 인덱스(`스킬.md` 렌더)
- `app/audit/knowledge/[...path]/page.tsx` — 리더 (catch-all로 폴더 경로 처리)

### 의존성
- `react-markdown` 추가 (`package.json`).
- `docs/02_analysis_findings.md`, `docs/04_decision_engines.md`를 raw string으로 import — `next.config.ts` 에 `webpack`/`turbopack`의 `raw-loader`/`asset/source` 설정 필요할 수 있음. **AGENTS.md 지시에 따라 `node_modules/next/dist/docs/`에서 Turbopack asset module 처리 가이드 확인 후 결정**.

### 인수 기준
- [ ] 인덱스 노출, seed/user 문서 합산 목록.
- [ ] 필터(카테고리/프레임워크) 동작.
- [ ] 리더에서 마크다운 렌더, 인용·관련 링크 정상.
- [ ] 시드 문서는 "확장" 버튼만 노출, 편집 진입 차단.

---

## B4 — KB 에디터 (드래프트·확장)

**목표:** user 문서의 CRUD + 시드 확장.

### 산출물
- `components/ui/markdown-editor.tsx` (NEW — textarea + react-markdown 프리뷰 split, 툴바 없음)
- `components/audit/kb/document-editor.tsx` (NEW — 카테고리/path/frontmatter/citations/body)
- `app/audit/knowledge/new/page.tsx`
- `app/audit/knowledge/edit/[...path]/page.tsx` (user 문서만 허용; 시드는 차단)
  - **라우트 변경**: Next.js 의 catch-all 은 마지막 세그먼트에만 둘 수 있음 → 편집 의도를 정적 `edit/` 접두사로 표현 (`/audit/knowledge/edit/<path>`).
- `lib/kb-store.ts` 확장: `extendFromSeed`, path 생성·충돌 처리

### 카테고리별 path 규칙
- `interpretation-framework` → `해석론/<title>`
- `occupation` → `직업군/<occupation>/<title>`
- `case-precedent` → `판례노트/<caseId | title>`
- `glossary` → `용어집/<title>`
- `pitfall` → `오류패턴/<title>`
- `skill-master` → `스킬` (단일, 신규 생성 불가)

### 인수 기준
- [ ] 빈 폼에서 신규 작성 → 폴더 트리에 노출.
- [ ] 카테고리 → path 자동 생성 + 충돌 처리(suffix).
- [ ] 시드 "확장" → user 사본 + 에디터 진입, 본문 prefill.
- [ ] draft/publish 토글, 트리 배지 일치.
- [ ] 한글 경로 라우트 (`/audit/knowledge/해석론/엄격해석`) 정상.
- [ ] 새로고침 후 영속, JSON export 정상.

---

## B5 — 라인 피드백 ↔ KB 교차 링크

**목표:** 라인 피드백에서 KB 문서를 첨부; KB 리더에서 역방향 인용 목록.

### 산출물
- `lib/audit-schema.ts` — `LineFeedback.relatedKbIds: string[]` 추가 (default `[]`).
- `lib/audit-store.ts` — 마이그레이션: 기존 객체에 빈 배열 채움.
- `components/audit/line-feedback-panel.tsx` — KB 첨부 UI (검색 자동완성).
- `components/audit/kb/article-reader.tsx` — "이 문서를 인용한 피드백" 섹션.
- 파생 selector: `feedbackByKbId(kbId)`.

### 인수 기준
- [ ] 피드백에 KB 첨부/해제 동작.
- [ ] 참조된 KB가 삭제되어도 피드백 안전(orphan "삭제된 문서").
- [ ] KB 리더에 역방향 인용 노출(대화별 그룹화).

---

## B6 — (선택) 케이스 피커

**목표:** KB·라인 피드백 모두에서 1,301건 케이스 코퍼스를 인용할 때, 자유 텍스트가 아닌 피커로 선택.

### 산출물
- `scripts/build-kb-case-index.ts` (NEW) — `data/processed/all_cases.jsonl`을 슬림 인덱스로 변환 (`{ case_id, case_number, title, agency, tax_category }`만).
- 빌드 산출물 → `prototype/data/case-index.json` (≤ ~수백 KB 목표; 풀텍스트 제외).
- `components/audit/kb/case-picker.tsx` (NEW — 키워드 검색 + 페이지네이션).
- KB 에디터 / 라인 피드백 패널에서 사용.

### 인수 기준
- [ ] 인덱스 빌드 산출물 200–600KB 이내.
- [ ] 키워드 검색 < 100ms (메모리 필터).
- [ ] 선택한 케이스는 `KbCitation { kind: "case", caseId }` 형태로 저장.

### 위험
- 인덱스 크기. 너무 크면 lazy chunk로 분리(다이나믹 import).
- 검색 정확도. v1은 단순 contains; v2는 `tax_category`·`agency` 필터.

---

## 의존성 추가 요약

| Phase | 패키지 |
|---|---|
| B0 | shadcn `dropdown-menu`, `avatar` |
| B3 | `react-markdown` (+ 필요 시 `remark-gfm`) |
| B6 | (없음 — 인덱스는 빌드 스크립트로) |

## 전체 인수 — 최종 데모 시나리오

1. 챗 사용자(viewer-clinic)로 진입 → 차량유지비 상담 재생.
2. 푸터에서 평가자(auditor-default)로 전환 → 자동으로 `/audit/chat-logs`로 이동.
3. 큐 스트립에서 동일 대화 선택 → 3-pane 전사 표시.
4. 문장 클릭 → 피드백 작성(코멘트·태그·**관련 KB 첨부**).
5. 좌측 섹션 탭에서 "지식 베이스"로 이동 → 차량유지비 시드 확장 → 본문 보강 → 발행.
6. 피드백 패널에서 새 KB가 첨부 가능함을 확인. 라이더에서 역방향 인용 확인.
7. 새로고침 → 모든 상태 영속. 챗 사용자로 되돌리면 자동으로 `/chat/clinic` 복귀.
