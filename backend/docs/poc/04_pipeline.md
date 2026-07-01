# 모델 파이프라인 — Training Batch → PR → Version / Rollback

> **읽기 전제:** [00_concept.md](00_concept.md), [03_admin.md](03_admin.md).
> 본 문서는 admin 셸의 "모델" 그룹 (`/admin/pipeline`, `/admin/pipeline/...`) 의 상세.

## 0. 한 줄 정의

검수 + 이의 기간 종료된 **인정 피드백**을 **Training Batch** 로 묶고, **PR / 학습 / 머지 / 배포 / 롤백** 의 mock 흐름으로 모델 버전을 관리한다.

본 PoC 에서 실제 모델은 학습되지 않는다 — 모든 외부 시스템(GitHub PR, CI, eval, deploy)은 **시뮬레이션**.
단, 인터페이스는 **실 백엔드 / GitHub 연동을 그대로 받을 수 있도록** 설계한다.

---

## 1. 상태 머신

```
                     ┌─────────────────────────────────────────┐
                     │           Accepted Feedback              │
                     │  (검수 인정 + 이의 기간 종료 + 미배치)    │
                     └──────────────┬──────────────────────────┘
                                    │ (admin 이 묶음)
                                    ▼
        ┌─────────────────────────────────────────────────────────┐
        │                    TrainingBatch                          │
        │                                                            │
        │   queued ─► in_pipeline ─► merged ─► deployed              │
        │     │            │            │           │                │
        │     │            │            │           │                │
        │     ▼            ▼            ▼           ▼                │
        │  cancelled  pipeline_failed (rollback ◄──┘)                │
        └─────────────────────────────────────────────────────────┘

        ┌─────────────────────────────────────────────────────────┐
        │                    ModelVersion                           │
        │   candidate ─► production ─► rolled_back / superseded     │
        └─────────────────────────────────────────────────────────┘
```

### Batch 상태
| 상태 | 의미 | 진입 방법 |
|---|---|---|
| `queued` | 묶임, 아직 파이프라인 미진입 | `services/pipeline.createBatch` |
| `in_pipeline` | PR 생성됨, CI/eval 진행 중 | `services/pipeline.submitBatch` |
| `merged` | PR 머지됨, 새 ModelVersion 생성 | `services/pipeline.markMerged(prMeta)` |
| `deployed` | ModelVersion 이 production 으로 승격 | `services/pipeline.promoteVersion(versionId)` |
| `cancelled` | 게시 전 admin 이 취소 | `services/pipeline.cancelBatch` |
| `pipeline_failed` | 시뮬 실패 (CI red) | mock 토글 |
| (rollback) | Version 이 rolled_back 되면 Batch 도 deployed 해제 | `services/pipeline.rollback` |

### Version 상태
| 상태 | 의미 |
|---|---|
| `candidate` | 새 모델, 평가 중 (production 아님) |
| `production` | 현재 운영 중 (1개만 가능) |
| `rolled_back` | 운영 중이었으나 롤백됨 |
| `superseded` | 새 버전이 production 으로 승격되면서 자연 종료 |

---

## 2. 라우트 & 화면

```
/admin/pipeline                                 파이프라인 대시보드
/admin/pipeline/batches                         Batch 목록
/admin/pipeline/batches/new                     새 Batch 생성 (Accepted feedback picker)
/admin/pipeline/batches/[batchId]               Batch 상세
/admin/pipeline/versions                        Model Version 목록
/admin/pipeline/versions/[versionId]            Version 상세
```

### 2.1 파이프라인 대시보드 — `/admin/pipeline`
```
┌─ 현재 production ──────────────────────────────────────┐
│ v0.4.1  ·  배포 2026-06-20  ·  PR #142                 │
│ source batches: Batch-6, Batch-5                       │
│ eval metrics (mock):  acc 84.2%  ·  cov 91%            │
│                                       [롤백]            │
└────────────────────────────────────────────────────────┘
┌─ 진행 중 ──────────────────────────────────────────────┐
│ Batch-7  in_pipeline  ·  PR #145  (CI: green 3/4)      │
│ ETA: 약 2시간                                           │
└────────────────────────────────────────────────────────┘
┌─ 묶을 수 있는 피드백 ──────────────────────────────────┐
│ Accepted & 이의 기간 종료 & 미배치: 184건                │
│                              [새 Batch 만들기]          │
└────────────────────────────────────────────────────────┘
┌─ 최근 버전 (5개) ──────────────────────────────────────┐
│ v0.4.1  production    2026-06-20                       │
│ v0.4.0  superseded    2026-06-10                       │
│ v0.3.9  rolled_back   2026-05-30                       │
│ ...                                                    │
└────────────────────────────────────────────────────────┘
```

### 2.2 Batch 목록 — `/admin/pipeline/batches`
| 컬럼 | 비고 |
|---|---|
| Batch ID | clickable |
| 생성일 | createdAt |
| 포함 피드백 수 | acceptedFeedbacks.length |
| 참여 평가자 수 | distinct auditorId |
| 상태 | queued / in_pipeline / merged / deployed / ... |
| ModelVersion | (있으면) |
| PR | (있으면) link |
| 액션 | 상태별 transition 버튼 |

### 2.3 새 Batch — `/admin/pipeline/batches/new`

```
┌─ Accepted Feedback Picker ──────────────────────────────┐
│ 필터:                                                    │
│  · 카테고리 [전체 ▾]  · 평가자 [전체 ▾]                  │
│  · 이의 기간 종료 ☑                                      │
│  · 미배치 ☑                                              │
│ 검색: ……                                                  │
│                                                          │
│ ┌─ 결과 (184건) ─────────────────────────────────────┐   │
│ │ ☑ [Feedback-103]  Audit-42  병의원  "..."           │   │
│ │ ☑ [Feedback-104]  Audit-42  병의원  "..."           │   │
│ │ ☐ [Feedback-110]  Audit-44  소상공  "..."           │   │
│ │ ... (page)                                          │   │
│ └─────────────────────────────────────────────────────┘   │
│                                                          │
│ 선택: 132 건 ·  평가자 4명                               │
│                                                          │
│ Batch 라벨  [Batch-7]                                    │
│ 메모        [선택]                                        │
│                                              [Batch 생성] │
└──────────────────────────────────────────────────────────┘
```

생성 시 `services/pipeline.createBatch({ acceptedFeedbackIds, label })`. status `queued`.

### 2.4 Batch 상세 — `/admin/pipeline/batches/[batchId]`

```
┌─ Batch-7 ────────────────────────────────────────────────┐
│ status: queued                                            │
│ 생성 2026-06-23 · 메모: "병의원 차량유지비 집중"           │
│ 132 feedback · 4 auditor                                  │
└───────────────────────────────────────────────────────────┘
┌─ 포함 피드백 (read-only) ────────────────────────────────┐
│ Feedback-103  Audit-42  …  (인정 by admin-1)             │
│ ...                                                       │
└───────────────────────────────────────────────────────────┘
┌─ 파이프라인 액션 (상태별) ───────────────────────────────┐
│ [submit to pipeline] (queued 일 때만)                     │
│   → PR 메타 mock 생성: { prNumber, prUrl, branchName }   │
│   → status = in_pipeline                                  │
│                                                           │
│ [mark merged] (in_pipeline 일 때)                          │
│   → ModelVersion 자동 생성 (semver bump rule)             │
│   → batch.targetModelVersion 설정                         │
│   → status = merged                                       │
│                                                           │
│ [deploy] (merged 일 때)                                    │
│   → ModelVersion.status = production                      │
│   → 이전 production 은 superseded                          │
│   → batch.status = deployed                               │
│                                                           │
│ [cancel] (queued 일 때만)                                  │
│                                                           │
│ [fail (mock)] (in_pipeline 일 때 — 디버그 용)              │
└───────────────────────────────────────────────────────────┘
```

> **PR 메타는 mock.** PR url 은 `https://github.com/<org>/<repo>/pull/<n>` 형태 placeholder 로 저장.
> 실 백엔드 연결 시 `services/pipeline.submitBatch` 가 GitHub API 호출로 교체.

### 2.5 Version 목록 — `/admin/pipeline/versions`
| 컬럼 | 비고 |
|---|---|
| Version | semver (v0.4.1 등) |
| 상태 | candidate / production / rolled_back / superseded |
| 생성일 | createdAt |
| Source batches | 배지 N개 |
| Eval metrics (mock) | accuracy / coverage |
| PR | link |
| 액션 | promote / rollback |

### 2.6 Version 상세 — `/admin/pipeline/versions/[versionId]`

```
┌─ v0.4.1 ─────────────────────────────────────────────────┐
│ status: production                                        │
│ 머지 2026-06-20  · PR #142                                │
│ source batches: Batch-6, Batch-5                          │
│ eval metrics:  acc 84.2%  cov 91%   (mock)                │
└───────────────────────────────────────────────────────────┘
┌─ 기여 평가자 ────────────────────────────────────────────┐
│ 평가자 A  · 인정 64건 → 본 버전 기여                       │
│ 평가자 B  · 인정 42건                                      │
│ ...                                                       │
└───────────────────────────────────────────────────────────┘
┌─ 액션 ───────────────────────────────────────────────────┐
│ [롤백] (production 일 때만)                                │
│   → version.status = rolled_back                          │
│   → 직전 production 후보를 자동 승격할지 prompt            │
│ [재승격] (rolled_back 일 때만)                             │
└───────────────────────────────────────────────────────────┘
```

#### 롤백 동작 (PoC 시뮬)
- `services/pipeline.rollback(versionId, { reason })`:
  - target version status → `rolled_back`.
  - 직전 `superseded` 상태였던 가장 최근 version 을 자동 production 후보로 prompt (admin 이 confirm).
  - source batches 의 status 는 `deployed` → `merged` 로 되돌림 (재배포 가능 상태).
  - admin event feed 에 기록.
  - auditor 측 ledger 는 영향 없음 (이미 정산된 credit 은 유지). 단, `pipeline_status` 변화는 auditor 대시보드 알림으로 노출 가능 (v1 옵션).

---

## 3. 자동/수동 정책

PoC 에서는 **모든 전환이 수동** — admin 이 버튼 클릭으로 트리거.
단, 향후 자동화를 염두에 두고 service 함수를 idempotent 하게 작성:

| 자동화 후보 | PoC 동작 | 미래 |
|---|---|---|
| 검수 완료 + 이의 기간 종료 → batch picker 후보 등록 | 자동 (selector 가 계산) | 동일 |
| Batch 가 일정 임계치 도달 → 자동 submit | 수동 | scheduled job |
| PR 머지 → version 생성 | 수동 (mark merged 버튼) | GitHub webhook |
| Eval green → 자동 promote | 수동 | CI gating |

---

## 4. 데이터 스키마 (요약)

```ts
type BatchStatus =
  | "queued" | "in_pipeline" | "merged" | "deployed"
  | "cancelled" | "pipeline_failed";

interface TrainingBatch {
  id: string;
  label: string;
  acceptedFeedbacks: { auditId: string; feedbackId: string }[];
  contributorIds: string[];               // distinct auditorIds
  createdAt: number;
  createdBy: string;                       // adminId
  status: BatchStatus;
  prMeta?: { prNumber: number; prUrl: string; branch: string; ciStatus?: string };
  targetModelVersion?: string;             // versionId, 머지 후 채워짐
  notes?: string;
}

type VersionStatus = "candidate" | "production" | "rolled_back" | "superseded";

interface ModelVersion {
  id: string;                              // "v0.4.1"
  semver: { major: number; minor: number; patch: number };
  status: VersionStatus;
  createdAt: number;
  mergedFromBatchIds: string[];
  sourcePr?: { prNumber: number; prUrl: string };
  metrics?: { accuracy?: number; coverage?: number; [k: string]: number | undefined };
  notes?: string;
}
```

---

## 5. Service 함수

```ts
// services/pipeline.ts
listEligibleFeedbacks(filter): Promise<EligibleFeedback[]>
   // status reviewed + finalized + 인정 + 미배치

createBatch(payload): Promise<TrainingBatch>            // status="queued"
cancelBatch(batchId): Promise<TrainingBatch>            // queued only

submitBatch(batchId): Promise<TrainingBatch>            // queued → in_pipeline + PR mock
markMerged(batchId, prMeta): Promise<{ batch; version }>// in_pipeline → merged, version 생성
markFailed(batchId, reason): Promise<TrainingBatch>     // in_pipeline → pipeline_failed (debug)

listVersions(filter): Promise<ModelVersion[]>
promoteVersion(versionId): Promise<{ promoted; superseded? }>  // candidate/merged → production
rollback(versionId, payload): Promise<{ rolledBack; promotedCandidate? }>

listBatches(filter): Promise<TrainingBatch[]>
summary(): Promise<PipelineSummary>                     // 대시보드용
```

모두 `Promise<T>`. 실 백엔드 연결 시:
- `createBatch` → `POST /api/batches`
- `submitBatch` → `POST /api/batches/:id/submit` (서버가 GitHub PR 생성)
- `markMerged` → GitHub webhook 으로 자동 호출되는 동작을 PoC 에선 admin 이 버튼으로 대체
- `rollback` → `POST /api/versions/:id/rollback`

---

## 6. Eval Metrics — Mock 정책

PoC 에서 모델 metrics 는 **고정된 mock 값** + 약간의 랜덤 변동.

```ts
// services/pipeline-mock.ts
function mockMetrics(batchSize: number, contributorCount: number): Metrics {
  const baseAcc = 0.80 + 0.001 * batchSize + 0.01 * contributorCount;
  return {
    accuracy: clamp(baseAcc + jitter(0.02), 0, 0.99),
    coverage: clamp(0.85 + 0.002 * contributorCount + jitter(0.03), 0, 0.99),
  };
}
```

> 실 데이터가 아니므로 **숫자에 의미 부여 X**. 단순히 demo 에서 변화하는 값을 보여주는 용도.
> 실 백엔드 연결 시 이 함수는 사라지고 CI eval 결과로 대체.

---

## 7. 인수 기준

### P5 (auditor·admin 의 P5 와 병합)
- [ ] `/admin/pipeline` 진입 시 현 production, 진행 중 batch, 묶을 수 있는 피드백 수가 정확.
- [ ] 새 Batch 생성 → 목록에 noqueued 등장.
- [ ] submit → in_pipeline + mock PR url 노출.
- [ ] mark merged → ModelVersion 생성, semver 자동 증가 (rule: 직전 production 의 patch+1).
- [ ] promote → 이전 production 은 superseded, dashboard 의 current 변경.
- [ ] rollback → status 변경 + admin 이벤트 피드에 기록 + (옵션) auditor 대시보드 알림.
- [ ] 새로고침 후 모든 상태 영속.

---

## 8. 향후 확장 (Out of PoC)

- 실 GitHub Webhook 수신 → markMerged 자동 호출
- CI pass/fail signal 수신 → 자동 promote 게이팅
- A/B 라우팅 (Version 별 트래픽 비율)
- Per-feedback weighting (어떤 평가자가 더 신뢰도 높은가)
- Eval dataset 도 KB 처럼 버전 관리
- 롤백 시 영향 평가자에게 자동 우편

---

## 9. 구현 현황

✅ **완료** (커밋 `106be34`).

### 화면별 매핑

| 문서 §2 화면 | 구현 위치 | 상태 |
|---|---|---|
| 2.1 파이프라인 대시보드 (`/admin/pipeline`) | `components/admin/pipeline-dashboard.tsx` | ✅ — 현재 production + 진행 중 batch + eligible 카운트 + 최근 버전 |
| 2.2 Batch 목록 (`/admin/pipeline/batches`) | `components/admin/batch-list-view.tsx` | ✅ |
| 2.3 새 Batch (`/admin/pipeline/batches/new`) | `components/admin/batch-new-form.tsx` | ✅ — eligible picker (자동 전체 선택, 토글) + 라벨/메모 |
| 2.4 Batch 상세 (`/admin/pipeline/batches/[id]`) | `components/admin/batch-detail-view.tsx` | ✅ — submit / mark merged / deploy / fail / cancel 상태별 액션 |
| 2.5 Version 목록 (`/admin/pipeline/versions`) | `components/admin/version-list-view.tsx` | ✅ |
| 2.6 Version 상세 (`/admin/pipeline/versions/[id]`) | `components/admin/version-detail-view.tsx` | ✅ — metrics + source batches + 기여 평가자 + promote/rollback (사유 입력) |

### 서비스

`services/pipeline.ts`:
- `listEligibleFeedbacks(filter)` — finalized review 의 accepted feedback 중 활성 batch 미포함만 (cancelled/failed 제외).
- `createBatch`, `cancelBatch`, `submitBatch` (PR mock #100~999 + CI=pending), `markMerged` (semver auto-increment + jitter metrics + CI=green), `markFailed`, `promoteVersion`, `rollback`.
- `summary` — 대시보드용.

### Mock metrics 함수

```ts
function mockMetrics(batchSize, contribs) {
  return {
    accuracy: clamp(0.80 + 0.001*batchSize + 0.01*contribs + jitter(0.02), 0, 0.99),
    coverage: clamp(0.85 + 0.002*contribs + jitter(0.03), 0, 0.99),
  };
}
```

### 사이드바 (admin)

"모델" 그룹에 [파이프라인 / Training Batch / ModelVersion] 3개 메뉴.
`exactPath` 기반 active 매칭 — 하위 페이지 진입 시 정확히 highlight.

### 검증된 E2E (P5 verification 에서)

1. 인정 피드백 → Batch 생성 → submit → in_pipeline (PR #429, CI pending) ✅
2. mark merged → ModelVersion v0.1.0 (candidate, accuracy 79.3%, coverage 86.8%) ✅
3. deploy → version=production, batch=deployed ✅
4. rollback (사유 입력) → version=rolled_back, batch=merged, note 저장 ✅
5. 대시보드 즉시 반영, console error 0, TS error 0 ✅
