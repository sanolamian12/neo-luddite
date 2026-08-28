# RAG 로드맵 §4 이어가기 — §3.2/3.3 모니터링 재확인 + §3.5 GraphRAG 재검토

작성일: 2026-08-28

---

## 0. 이 세션이 한 것 — 한 문장

> **§3.2/3.3 확장성은 트리거 미도달 재확인(변화 없음), §3.5 GraphRAG는 "성능 트리거"가 아니라 "가치" 관점으로 다시 물어본 뒤 비채택을 재확인했다 — 코드/배포 변경 없음, 로드맵 문서만 갱신.**

## 1. 배경

이전 세션(2026-08-27)에서 §3.1(소급 중복)·§3.4(승인 워크플로우)·§3.6(배포 파이프라인)을 완료. 이번 세션은 로드맵 §4의 다음 순번인 §3.2/3.3(확장성) → §3.5(GraphRAG)를 순서대로 확인.

## 2. §3.2/3.3 확장성 — 재확인 결과

- `/rag/health` 실측: `kbPassages: 413` — 8/27 정리 직후와 동일, 트리거(5,000~10,000)까지 여유 큼.
- `backend/api/pipeline.py:102,165` 재확인: `occupation="clinic"` 하드코딩 그대로, `run_coming_occupation()`(197행)도 미변경.
- 두 브랜치(`import-credigraph`, `main`) 모두 origin과 push 동기화 상태 확인 — 배포할 변경사항 자체가 없었음.
- **결론**: 개발 항목 없음, 모니터링만 계속.

## 3. §3.5 GraphRAG — 재검토

기존 결정(2026-08-27, `history/260827_인프라의사결정_GPU미신청_스토리지200GB_이관검토.md`)은 "GPU는 불필요하지만 지금 규모에서 flat 구조로 충분하니 비채택"이었다. 이번엔 규모(트리거) 관점이 아니라 **§3.1·§3.4가 끝난 지금, 그래프 구조 자체가 뭔가를 더 잘 풀어주는가**를 재검토.

핵심 발견:
- `Retriever` Protocol(`backend/api/rag/retriever.py:34`)이 이미 인터페이스 경계로 분리돼 있어, 나중에 GraphRAG 리트리버로 교체해도 `pipeline.py`는 안 건드려도 된다 — "지금 안 하면 나중에 힘들다"는 이유가 성립하지 않음.
- 그래프가 풀어줄 뻔했던 실제 문제(§3.1의 오탐 — Q+A+C 통짜 임베딩 때문에 무관 항목이 유사도로 묶임)는 이미 `conversationId`+`segmentId` 일치라는 경량 휴리스틱만으로 해결됨. 영구 그래프 스토어 없이 해결.
- 제품 논지(`project_rag_product_thesis`)가 "답변 품질"이 아니라 "답할 수 있는 범위"로 교정돼 있어, 그래프가 강화하는 다중 홉 추론/품질 축과 핵심 지표가 안 겹침.
- 구현 비용(스키마+리트리버+UI) 대비 413건 규모에서 체감 이득 없음.
- 심사 기준의 약점("성장성/도메인 확장")은 occupation 확장(§3.3) 쪽이 더 직접적인 스토리.

**결론: 비채택 유지.** 재오픈 신호 3가지를 로드맵 §3.5에 명시:
1. §3.2 트리거(5,000~10,000건) 도달.
2. occupation 2개 이상으로 늘어나 직업군 간 교차 참조 요구 발생.
3. 지금의 메타데이터 클러스터+국소 유사도 UI로 못 푸는 구체적 실패 사례 발견.

## 4. 변경 사항

- `docs/doing/RAG_구조분석_및_개선로드맵.md`: §3.2 모니터링 로그 표 추가, §3.3 재확인 기록, §3.5 재검토 섹션 추가, §4 우선순위 갱신.
- 코드/배포 변경 없음 (둘 다 "현상 유지가 맞다"는 결론이라 액션 아이템 없음).

## 5. 다음 세션 (당초 예상과 달랐음)

여기서 세션이 끝나지 않았다 — 사용자가 §3.5의 원래 동기를 정정했다. "GraphRAG로 검색엔진을 바꿀지"가 아니라 **"세무사와 RAG/KB 사이에 KB 구조를 시각적으로(거미줄+줌인/줌아웃) 보고 필요하면 직접 수정할 수 있는 중간층을 만드는 것"**이 이 로드맵 전체를 시작한 이유였다. 위 재검토(§3.5 GraphRAG 비채택)는 잘못 짚은 질문에 대한 올바른 답이었을 뿐.

## 6. §3.5 진짜 목적 구현 (2026-08-28, 이어서 진행)

사용자와 확인한 두 가지 결정:
- edge 확보 방식: **배치로 미리 계산해 저장**(조회 시점 실시간 계산 아님) — KB 전체를 한 화면에 그리고, 덤으로 §3.2 확장성 완화에도 재사용 가능한 구조로.
- 렌더링 방식: **d3-force + 커스텀 SVG**(기존 kb-passage-detail-view.tsx 의 순수 SVG 방사형 그래프와 스타일 통일, 무거운 전용 그래프 라이브러리 신규 도입 안 함).

### 구현
- `supabase/migrations/0018_rag_passage_edges.sql`: `rag.passage_edges` 테이블 + `rag.rebuild_passage_edges(k)` 함수(전체 삭제 후 self-join top-k 재계산) + pg_cron 5분 주기 스케줄(0006 스냅샷 캡처와 같은 패턴). 프로덕션 적용 완료, 수동 실행으로 413 active passage → 3,304 edge 확인.
- `backend/api/rag/store.py`: `PassageEdge` dataclass, `list_passage_edges()`, `rebuild_passage_edges(k)`.
- `backend/api/schema.py` / `backend/api/main.py`: `GET /api/rag/edges`(전체 edge 조회), `POST /api/rag/edges/rebuild`(수동 즉시 재계산).
- `frontend/services/rag.ts`: `listPassageEdges()`, `rebuildPassageEdges()`.
- `frontend/components/audit/kb/kb-graph-view.tsx`(신규): d3-force(`forceSimulation`+`forceLink`+`forceManyBody`+`forceCollide`)로 레이아웃을 300틱 수렴시킨 뒤 정적 SVG로 렌더. 휠 줌(줌인 시 라벨 노출), 드래그 팬, 노드 크기=연결수(degree), 색=세목/직업군 해시. 호버 시 하단에 내용 미리보기, 클릭 시 기존 `/audit/kb-map/[id]` 상세뷰(유사도 이웃+§3.4 수정 제안)로 이동.
- `frontend/components/audit/kb/kb-map-view.tsx`: "클러스터"/"전체 그래프" 탭 토글 추가, 상단 안내문에서 "지금은 읽기 전용" 문구 제거(더 이상 사실이 아님 — §3.4로 이미 수정 가능).
- `frontend/package.json`: `d3-force`, `@types/d3-force` 추가(다른 그래프 전용 라이브러리 새로 안 들임).

### 검증 및 배포
- `npx tsc --noEmit`, `npm run build` 클린 통과.
- `git push origin import-credigraph` + `git push origin import-credigraph:main` 둘 다 완료 → `backend/deploy/deploy.sh` 실행 → `/health`, `/rag/health`(`kbPassages:413`) 정상.
- 프로덕션에서 `GET /api/rag/edges`, `POST /api/rag/edges/rebuild`(`edgeCount:3304`) 실제 응답 확인.
- **미실시**: 브라우저에서 실제 그래프 화면(줌/팬/클릭 조작감)을 열어보는 스모크 테스트 — 다음 세션 우선 항목.

### 로드맵 문서 갱신
`docs/doing/RAG_구조분석_및_개선로드맵.md` §3.5를 "검색엔진 교체는 비채택 유지 / 진짜 목적(시각화+직접수정)은 구현 완료"로 재작성, §4·§5(파일지도)도 갱신.

## 7. 브라우저 스모크 테스트 (2026-08-28, 이어서)

로컬 백엔드(uvicorn, `backend/.env`가 프로덕션과 같은 Supabase를 가리켜 실 데이터로 테스트) + 프론트를 띄워 Playwright로 auditor 계정(`auditor`/`demo1234`) 로그인 후 `/audit/kb-map` "전체 그래프" 탭을 구동.

**환경 이슈**: `next dev`(Turbopack)가 이 Windows 환경에서 `app/globals.css` 처리 워커 프로세스를 띄우다 `0xc0000142`(DLL 초기화 실패)로 죽어 매 요청 500 — 세션과 무관한 로컬 환경 문제. `npm run build` + `npm start`(프로덕션 서빙)로 우회해 테스트 진행.

**확인된 것**:
- 그래프 렌더: 407개 노드 + edge 정상 표시. 대부분 같은 색인 이유는 세목/직업군 메타데이터가 거의 다 비어있어서(「미분류」 단일 클러스터) — 데이터 특성이지 버그 아님.
- 줌인 시 라벨 노출 정상.
- 노드 클릭 → 기존 상세뷰(`/audit/kb-map/[id]`) 이동 → 유사도 방사형 + 원문 렌더까지 확인(전체 "그래프 탐색→상세→수정 제안 진입" 플로우 검증 완료).

**발견한 버그와 수정**:
- 콘솔에 "Unable to preventDefault inside passive event listener invocation." 경고 — React가 `onWheel`을 passive 리스너로 등록해 `e.preventDefault()`가 무시됨(줌 자체는 됐지만 페이지 스크롤 억제가 안 먹힘). `useEffect`로 `{ passive: false }` 네이티브 리스너를 직접 붙이는 방식으로 교체, `vbRef`로 최신 viewBox 값을 참조하도록 정리.
- 수정 후 tsc+build 재확인 → 두 브랜치 push → `deploy.sh` 재배포 완료.

## 8. edge 신선도 — 사용자 지적 (2026-08-28, 이어서)

사용자 질문: "기존 루트(질문-AI답변-세무사코멘트)로 새 지식이 배선될 때마다 재계산이 필요하지 않겠냐." 맞는 지적 — pg_cron 5분 주기만으로는 배선 직후 최대 5분간 그래프가 최신 상태를 못 보여준다.

**수정**: KB의 active 상태나 embedding을 바꾸는 4개 경로 전부에서 응답 직전에 `rebuild_passage_edges()`를 동기 호출하도록 배선(`backend/api/main.py: _rebuild_edges_best_effort`):
1. `/api/rag/ingest`(문장 코멘트 배선)
2. `/api/rag/ingest-session-eval`(세션 총평 배선)
3. `/api/rag/retract`(소급 정리 — active↔retired 전환)
4. `/api/rag/edits/{id}/approve`(수정 승인 — embedding 갱신)

지금 규모(수백 건)에서 전체 재계산이 1초 미만이라 요청 경로에 넣어도 부담 없음. best-effort로 설계(실패해도 원래 동작은 안 막힘) — pg_cron 5분 주기는 이 경로를 안 타는 변경(수동 DB 조작 등)에 대한 안전망으로 그대로 유지.

## 9. 다음 세션

로드맵 §3~4 전 항목이 완료 또는 재검토완료 상태. 새 트리거(KB 규모, 신규 occupation)나 새 요구사항이 생겼을 때 재개.
