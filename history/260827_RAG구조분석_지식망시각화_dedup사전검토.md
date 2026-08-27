# 260827 · RAG 구조 분석 + 지식망 시각화 UI + dedup 사전검토

## 요약

세무사가 KB(rag.passages)를 직접 보고 이해할 수 있는 UI를 만들어 달라는 요청에서 출발해, **먼저 RAG/KB 구조를 코드로 분석**한 뒤(그래프가 아니라 flat 벡터 리스트, 매 질문마다 exact scan) 그 구조에 맞는 시각화를 auditor/admin 양쪽에 구현·배포했다. 이어서 "질문→답변" 전체 경로를 다이어그램 아티팩트로 정리하다가, **KB에 중복 적재가 실제로 벌어져 있는 것**(같은 Q&A에 세무사 코멘트 3건이 중복)을 발견했고, 검수실 단계에서 이를 사전 경고하는 dedup-check 기능을 구현·배포·검증했다. 부수적으로 프로덕션 서버의 `git pull`이 지난 7/18 이후 계속 깨져 있던 것을 발견해 복구했다.

커밋 `2aaa17a`(지식망 시각화), `77a39ef`(dedup 사전검토). 둘 다 프론트(Vercel)·백엔드(Oracle 도쿄) 배포·검증 완료.

---

## 1. RAG/KB 구조 분석 — 그래프가 아니라 flat 벡터 리스트

`rag.passages` 단일 테이블, 항목 간 저장된 연결(edge) 없음. "관계"는 두 가지뿐:
- 메타데이터 공유 (tax_category, occupation, source_kind, auditor_id 등)
- 조회 시점에 계산되는 코사인 유사도 (저장 안 됨)

핵심 사실:
- **임베딩 단위 = 문장이 아니라 Q+A+C 번들 전체** (`ingest.py: build_bundle_text`). 질문+AI답변(세그먼트)+세무사코멘트+태그를 하나로 합쳐 통째로 임베딩.
- **비대칭 임베딩**: 저장은 `embedding-passage`, 질의는 `embedding-query`(둘 다 4096d, Upstage).
- **검색 = exact scan**: `rag.match_passages` SQL이 `status='active' AND occupation=? AND tax_category=?`로 필터링한 뒤 남은 행 **전체**에 대해 pgvector 코사인 거리(`<=>`)를 계산·정렬·`LIMIT k`. 4096차원은 pgvector ANN 인덱스 상한(2000)을 넘어서 **인덱스를 못 타고 매번 순차 스캔**한다(`0004_rag_schema.sql:64`, "벡터는 exact scan 이므로 ANN 인덱스 없음"이라고 이미 주석에 명시돼 있었다).
- 챗 파이프라인에서 `occupation="clinic"`이 하드코딩(`pipeline.py:102,165`)이라, **오늘은 필터가 사실상 전체를 통과**시킨다 — 활성 526개 거의 전부를 매 질문마다 다시 잰다.
- top-k 기본 5(`RAG_TOP_K`), 유사도 컷 0.50(`RAG_MIN_SCORE`, 프로덕션 실측).
- 기여도=존속기간(`store.contribution_counts`)은 `status='active'` passage 수를 auditor_id로 집계. 삭제가 아니라 status 토글(retired)로 구현.

## 2. auditor/admin 시각화 UI 구현

구조 분석 결과에 맞춰 순수 force-graph(거미줄 전체) 대신, 저장된 메타데이터 클러스터를 기본 축으로 하고 유사도는 조회 시점 계산으로만 국소적으로 보여주는 방식을 채택.

- **`/audit/kb-map`** (사이드바 "지식 베이스" 아래 "RAG 지식망") — 세목/직업군/유형 축 클러스터 그리드. 전체 KB(다른 세무사 기여분 포함) 노출, 읽기 전용.
- **`/audit/kb-map/[passageId]`** — passage 하나를 중심에 두고, 그 시점의 코사인 유사도 이웃을 방사형(거미줄)으로 펼치는 상세뷰. 이웃 클릭 시 그 이웃을 중심으로 재탐색(탐색형).
- **`/admin/pipeline/timeline`** (사이드바 "AI 코어" → "지식망 추이") — 기여도 순위 바 차트 + auditor별 존속기간 간트 타임라인. "기여=RAG 존속기간" 개념을 시간축으로 직접 시각화.

백엔드: `GET /api/rag/passages/{id}/neighbors` 신설 (`store.neighbors()` — pgvector 코사인 거리로 조회 시점에 유사도 이웃 계산).

## 3. 프로덕션 서버 git 상태 복구 (부수 발견)

`git pull` 재시도 중 `frontend/e2e/` 파일이 root 소유(2026-07-18 이후 다른 세션이 sudo로 건드린 흔적)라 실패 → 소유권 정리(`chown -R ubuntu:ubuntu`) 후 재시도했더니 이번엔 **로컬 미커밋 변경사항 다수**(main.py, store.py, schema.py, 프론트 다수 파일, history 문서 11개, migration 0016 등)와 충돌.

원인 규명: 서버의 이전 `git pull` 시도가 root 소유권 문제로 중간에 실패하면서, **git이 HEAD를 못 옮긴 채 파일 내용만 이미 새 버전으로 다 받아놓은 상태**였다(부분 체크아웃). 모든 "수정됨/추적안됨" 파일을 origin 최신 커밋과 diff 떠서 **전부 완전히 동일함**을 확인 → `git stash -u` → `git pull`(clean fast-forward) → `git stash pop`(이미 존재해 충돌 없이 확인만) 순서로 안전하게 복구. 서버 전용 history 메모 11개(7/15~8/27 로컬 전용 작성분)는 origin에 없는 untracked 파일이라 보존됐고, 이번 pull로 정식 저장소에 편입됐다(로컬 저장소는 아직 `git pull` 안 해서 못 받은 상태).

## 4. "질문→답변" 파이프라인 다이어그램

사용자가 "코사인 유사도로 순차 계산해서 근접한 걸 가져오는 거냐"고 물어, 코드 근거로 **맞다**고 확인하고 시각 문서로 정리:

https://claude.ai/code/artifact/5c2adebc-94ac-4ee5-bce3-d721e1f42250

- 규칙엔진 판정 가능 유형(9종)이면 엔진이 먼저 확정 판정 → RAG는 근거만 보강.
- 그 외(실측 질문의 55%)는 판정 없이 RAG 선례만으로 자문.
- 두 경로 모두 같은 RAG 검색(exact scan)을 공유해서 호출.

## 5. dedup 부재 발견 + 사전검토 기능

**발견**: `ingest.py`의 `dedupe_key`는 원본 엔티티 ID 기준(`feedback:<id>`)일 뿐 콘텐츠 기준이 아니다 — 같은/유사 질문에 다른 세무사가 단 코멘트는 각각 별도 passage로 무조건 적재된다. 실제로 KB에서 **같은 Q&A("병원 명의 종신보험/배우자 수익자")에 세무사 코멘트 3건이 중복 적재**된 사례를 확인(`51f80d4c`, `a570f3b6`, `ec2779de` — 상호 유사도 94~95%).

**결정**: 자동 병합/거절이 아니라 **검수 단계(인정/거절 전)에서 admin에게 경고**하는 방식 채택 — 기여 정책이 아직 없어 자동 처리는 위험하다는 판단.

**구현**:
- `store.find_similar(embedding, k)` — 저장 전 후보 벡터로 기존 active passage와 비교.
- `ingest.session_eval_bundle_text()` 분리 — 실제 적재와 사전검토가 같은 번들 조립 함수 공유(텍스트 드리프트 방지).
- `POST /api/rag/dedup-check-feedback`, `POST /api/rag/dedup-check-session-eval` 신설.
- 검수실 두 화면(`inspection-workspace.tsx` 문장 단위, `inspection-eval-workspace.tsx` 정성 평가) 모두에 배선 — 유사도 85% 이상이면 전사 칩에 ⚠, 결정 패널에 주황 경고 카드(기존 코멘트 내용·작성자·적재일). 85%는 검색 컷(0.50)과 별개로, "사실상 같은 것"을 가리는 더 엄격한 임계값으로 설정.
- graceful: 사전검토 API 실패해도 검수 자체는 막지 않음.

**배포 후 스모크 테스트**: 위 3중복 사례의 질문+답변 텍스트로 실제 엔드포인트를 호출해 3건 모두 94%대 유사도로 정확히 잡히는 것을 확인.

**소급 미정리**: 이미 KB에 들어간 위 3중복은 이번 기능으로 자동 정리되지 않는다 — 필요 시 포장실에서 수동 연결끊기, 또는 KB 전체를 훑는 별도 배치 작업 필요(다음 세션 후보).

## 6. 다음 세션 후보

- 기존 KB 중복 클러스터 일괄 탐지/정리 배치.
- auditor가 KB 콘텐츠를 직접 수정 → admin 승인/반려 워크플로우 (이번 세션 초반에 스코프 결정: 지금은 읽기 전용, 기여 정책 수립 후 진행).
- KB 규모 증가 시 exact scan 비용 대응(임베딩 차원/인덱스 전략) — 지금(526건)은 문제없음, 확장 조건 모니터링 필요.

향후 여러 세션에 걸친 RAG 개선 작업의 지휘 문서는 `docs/doing/RAG_구조분석_및_개선로드맵.md`에 별도 정리했다(이 문서보다 그쪽이 최신 기준).
