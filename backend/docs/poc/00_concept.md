# CrediGraph PoC — 개념 모델 (Conceptual Model)

> 본 문서는 우리 PoC의 **개념 모델**을 정의한다. 도메인은 **세무 AI 챗봇 + 휴먼 평가(audit) 루프**.
> 구조적 영감은 `네오 러다이트 - CrediGraph Hub 구상안_260624_정중은.pdf` 의 워크플로 / 역할 구분 / 기여 통장 개념에서 빌려오되,
> 세무 데이터셋 발송 / 정산금 분배 등 PDF 고유 도메인은 **차용하지 않는다**.

---

## 1. 한 문단 정의

소비자(사장님)는 챗 인터페이스로 AI에게 세무 질문을 던지고 답을 받는다.
그 대화 로그는 **휴먼 평가자(세무 전문가)** 의 손에 넘어가 **문장 단위 감사**를 거치며,
거기서 만들어진 피드백은 **모델 개선 파이프라인**(데이터셋 빌드 → 학습 PR → 배포 → 롤백)으로 흘러간다.
**Admin** 은 이 흐름 전체를 조율한다 — 누가 무엇을 감사할지 배정하고, 평가 품질을 검수하고,
평가자에게 **기여(credit)** 를 인정하고, 모델 버전을 관리한다.

PoC 의 목표는 이 세 역할이 **하나의 시스템 안에서 분리된 화면**을 가지고 동작하는 것을 보여주는 것이다.

---

## 2. 세 역할 (Three Roles)

| 역할 | 한국어 라벨 | 입장 | 무엇을 하는가 |
|---|---|---|---|
| Consumer | 사장님 / 상담자 | 챗 화면 | AI 에게 세무 질문, 응답 검토, 후속 질문 |
| Auditor | 평가자 / 세무사 | 감사 워크스페이스 | 배정된 대화 로그를 문장 단위로 감사, 피드백 작성 |
| Admin | 운영자 | 운영 콘솔 | 작업 배정, 평가 검수, 기여 정산, 모델 버전 관리 |

### 2.1 Consumer
- **이미 구현됨** (prototype 1·3 의 `/chat/<occupation>` 트랙).
- AI 응답을 받은 시점에서 **암묵적으로 감사 대상 후보**가 된다 — 별도 동의 플로우 없음 (PoC 가정).
- 본 문서에서는 Consumer 신규 기능은 다루지 않는다. 자세한 내용은 [01_consumer.md](01_consumer.md) 참조.

### 2.2 Auditor
- **사람**. 세무 전문 지식 보유.
- **occupation 무관** — 모든 업종의 대화를 감사할 수 있다 (자격은 Admin 이 부여).
- 작업 단위는 **하나의 대화(conversation)** — 그 안의 모든 assistant 문장에 라인 피드백을 달고, 마지막에 세션 평가를 남긴다.
- 자신의 **기여 통장(contribution ledger)** 을 가진다 — 누적 기여 수, 인정/거절 비율, 크레딧 잔액, 회차별 정산 이력.
- 자세한 내용은 [02_auditor.md](02_auditor.md) 참조.

### 2.3 Admin
- **사람** (PoC 에서는 단일 계정).
- 권한: 작업 배정, 평가자 계정 관리, 피드백 검수, 기여 인정/거절, 정산 회차 생성, 데이터셋 / 모델 버전 관리.
- 자세한 내용은 [03_admin.md](03_admin.md) 참조.

---

## 3. 전체 Lifecycle (End-to-End Flow)

PDF 의 `하차장 → 작업실 → 검수실 → 포장실 → 기여 통장` 구조를 우리 도메인에 맞춰 재구성한다.

```
[Consumer]                              [Admin]                          [Auditor]
    │                                     │                                 │
    ① 챗 세션 생성                         │                                 │
    (질문·AI 답변)                         │                                 │
    │                                     │                                 │
    └─── chat session ──────────────────► ② 감사 후보 풀(pool)에 적재 ──┐    │
                                          │                              │    │
                                          ③ Task 묶음 생성                │    │
                                          (대화 N건 + 평가자 조건 + 마감) │    │
                                          │                              │    │
                                          └── Task 게시 ──────────────► ④ Task 픽업 (큐에서 선택)
                                                                          │
                                                                          ⑤ Audit 수행
                                                                          (문장별 피드백 + 세션 평가)
                                                                          │
                                          ⑥ Audit 제출 ◄──────────────────┘
                                          │
                                          ⑦ 검수
                                          (피드백 항목별 기여 인정/거절)
                                          │
                                          ⑧ 결과 공지 ──────────────────► ⑨ 결과 확인
                                          │ (이의제기 기간 N일)             │
                                          │                                 │
                                          │ ◄────── 이의제기 (선택) ───────┘
                                          │
                                          ⑩ 이의제기 종료 → 인정된 피드백을
                                              Training Batch 로 패키징
                                          │
                                          ⑪ Training Batch → Model Pipeline
                                              (PR 생성 · 학습 · 평가 · 머지 · 배포)
                                          │
                                          ⑫ Contribution 정산 (회차 단위)
                                              → 평가자 기여 통장 업데이트
                                          │
                                          └── 정산 공지 ─────────────────► (기여 통장에서 확인)
```

### 단계 매핑 (PDF 비유 → 우리 도메인)

| PDF 단계 | 우리 도메인 | 주체 | 산출물 |
|---|---|---|---|
| 화물 (Cargo) | **ChatSession** — 감사 후보 풀에 들어온 대화 로그 | Consumer 가 생성, Admin 이 후보화 | `conversationId`, 메타데이터 |
| 일감 (Task) | **AuditTask** — 평가자에게 배정되는 작업 단위 | Admin | `taskId`, conversationIds, 조건, 마감 |
| 작업 (Work) | **Audit** — 평가자의 라인 피드백 + 세션 평가 | Auditor | `auditId`, feedbacks, sessionEval |
| 결과물 (Result) | **AuditResult** — 제출된 Audit, 검수 대기 상태 | Auditor 제출 → Admin 검수 | status: `submitted`/`reviewed` |
| 검수 (Inspection) | **Review** — 피드백 항목별 기여 인정/거절 | Admin | per-feedback `acceptedContribution: boolean`, 사유 |
| 문의·이의제기 | **Inquiry / Dispute** — 평가자가 검수 결과에 대해 제기 | Auditor → Admin | `inquiryId`, 댓글 스레드 |
| 상품 / 박스 | **TrainingBatch** — 인정된 피드백들을 묶은 학습 배치 | Admin (자동 트리거) | `batchId`, 포함된 audit 항목들 |
| 발송 / DB 덤프 | **Model Update Pipeline** — PR 생성·학습·머지·배포 | Admin (자동/수동) | `modelVersion`, PR 링크 |
| 정산 / 기여 통장 | **Contribution Ledger** — 평가자별 누적 기여 + 크레딧 | Admin 이 회차 생성, Auditor 가 조회 | ledger entries |

> **차이점:** PDF 는 "데이터셋을 외부로 발송" 후 정산이 일어나는 구조지만, 우리는 발송이 **사내 모델 업데이트 PR** 로 끝난다. 따라서 PDF 의 "AI 매출 → 비율 적용 → 배당" 정산 모델은 차용하지 않고, **크레딧(credit) 단위의 추상 기여 점수**만 유지한다. 실제 금액 정산은 PoC 범위 밖.

---

## 4. 데이터 엔터티 (개념 수준)

> 스키마 세부 (필드명·타입)는 각 역할 문서에서 확장한다. 여기서는 엔터티 간 관계만 정의.

```
ChatSession
  ├─ id, occupation, createdAt
  ├─ messages[]                                  (Consumer + AI)
  └─ (감사 후보 풀에 들어가면) candidacy: { eligible, addedAt }

AuditTask                                        ← Admin 이 생성
  ├─ id, createdAt, deadline
  ├─ conversationIds[]                            (이 Task 에 포함된 ChatSession 들)
  ├─ assigneeConditions                           (auditor 자격 / 모집 인원 / 우선순위)
  ├─ pickups[]                                    (실제 픽업한 auditor 목록 + 시점)
  └─ status: open | in_progress | closed

Audit                                            ← Auditor 가 한 Task 안에서 작업
  ├─ id, taskId, conversationId, auditorId
  ├─ lineFeedbacks[]                              (문장 단위; prototype 2/3 의 LineFeedback 재사용)
  ├─ sessionEval                                  (세션 단위; 평점·태그·총평)
  ├─ submittedAt
  └─ status: draft | submitted | reviewed | finalized

Review                                           ← Admin 이 Audit 을 검수
  ├─ auditId, reviewedBy, reviewedAt
  ├─ perFeedbackDecisions[]                       ({ feedbackId, accepted, reason })
  ├─ overallNote
  └─ disputeWindowEndsAt

Inquiry                                          ← Auditor 가 검수 결과에 이의 제기
  ├─ id, reviewId, feedbackId?, raisedBy, raisedAt
  ├─ messages[]                                   (스레드)
  └─ status: open | resolved

TrainingBatch                                    ← 인정된 피드백을 묶은 학습 단위
  ├─ id, createdAt
  ├─ acceptedFeedbacks[]                          ({ auditId, feedbackId })
  ├─ targetModelVersion                           (예측치; PR 머지 후 확정)
  └─ status: queued | in_pipeline | merged | deployed | rolled_back

ModelVersion                                     ← 모델 버전 메타
  ├─ id (semver), createdAt, prUrl
  ├─ sourceBatchIds[]                             (이 버전을 만든 TrainingBatch 들)
  ├─ metrics                                      (eval 지표 — PoC 는 mock)
  └─ status: candidate | production | rolled_back

ContributionLedger                               ← 평가자별 기여 통장
  ├─ auditorId
  └─ entries[]                                    ({ kind, amount, sourceRef, timestamp })
                                                  kind: contribution_accepted | contribution_rejected
                                                       | settlement_round_credit | bonus | …
```

### 관계 요약
- `ChatSession 1 ─ N AuditTask` (한 대화가 여러 Task 에 포함될 수 있음 — 다중 평가)
- `AuditTask 1 ─ N Audit` (Task 의 모집 인원만큼)
- `Audit 1 ─ 1 Review`
- `Review 1 ─ N Inquiry`
- `Audit N ─ N TrainingBatch` (인정된 피드백만 진입)
- `TrainingBatch N ─ 1 ModelVersion`
- `Auditor 1 ─ 1 ContributionLedger`

---

## 5. 화면 구조 (3-Shell)

각 역할은 **자기 셸(shell)** 을 가진다. 셸 = 사이드바 + 메인 컨텐트 영역의 한 세트. 셸 간 이동은 계정 전환기로.

```
ConsumerShell (viewer)         AuditorShell (auditor)        AdminShell (admin)
  /chat/<occupation>             /audit/...                    /admin/...
  · 새 상담                       · 대시보드 (기여 통장)         · 대시보드 (상황실)
  · 상담 세션 목록                · 작업 큐                      · 감사 후보 풀
  · 업종 변경                     · 내 작업 (in_progress)        · 작업 (Task) 목록
                                  · 결과물 (검수 결과 확인)       · 검수 큐
                                  · 우편함 (공지·이의 답변)       · 평가자 관리
                                  · 지식 베이스(KB)               · 정산 / 기여 관리
                                                                  · 모델 파이프라인
                                                                  · 우편 발송
```

> 현재 prototype 3 까지 — `viewer` (consumer) + `auditor` 셸이 구현되어 있다. PoC 에서는 **`admin` 셸을 신규로 추가**하고,
> `auditor` 셸을 풍부화한다 (대시보드 + 작업 큐 + 우편함 + 결과물).

---

## 6. 본 PoC 의 범위 (Scope)

### 범위 안 (In-Scope)
- ✅ 3 역할 분리 (Consumer / Auditor / Admin) — 계정 전환기로 데모.
- ✅ Auditor: 대시보드, 작업 큐, 3-pane 감사 워크스페이스(기존), 결과물 확인, 우편함, 기여 통장.
- ✅ Admin: 후보 풀, Task 생성/배정, 검수, 이의제기 응대, 정산 회차 생성, 모델 파이프라인 모니터링 (mock).
- ✅ 데이터 엔터티는 위 §4 모두 — localStorage(Zustand persist) 기반.
- ✅ 모델 파이프라인은 **표현만** — TrainingBatch → PR 링크 → ModelVersion 메타. 실제 학습/PR 생성은 mock.

### 범위 밖 (Out-of-Scope)
- ❌ 실제 모델 재학습 / 실제 GitHub PR 생성.
- ❌ 실제 화폐 단위 정산 (credit 만 — 추상 단위).
- ❌ 백엔드 / 멀티 유저 동시성 / 권한 검증.
- ❌ 다계정 (Auditor 여러 명 시뮬레이션은 seed 데이터로 표현하되, 동시 로그인은 X).
- ❌ Consumer 신기능 — 기존 prototype 1·3 의 chat 트랙 그대로.

---

## 6.1 백엔드 / AI 모델 연결 대비 (Backend-Ready 원칙)

PoC 는 **로컬 데이터 소스 (localStorage + 시드 JSON)** 로 동작하지만, **차후 실제 백엔드 + AI 모델 연결**을 전제로 설계한다.
즉, **데이터 접근 계층을 일찍 추상화**하여 나중에 fetch / WebSocket 으로 갈아끼우기 쉽게 만든다.

### 원칙

1. **모든 데이터 접근은 service 함수로 한 번 감싼다.**
   컴포넌트는 store / fetch 를 직접 호출하지 않고 `services/<entity>.ts` 의 함수를 통해 접근.
   ```ts
   // services/audit-task.ts (예시)
   export async function listOpenTasks(filter?: TaskFilter): Promise<AuditTask[]> { ... }
   export async function pickupTask(taskId: string, auditorId: string): Promise<AuditTask> { ... }
   export async function submitAudit(audit: Audit): Promise<Audit> { ... }
   ```
   현재 구현은 내부에서 Zustand store 를 읽고 쓰지만, 시그니처는 **항상 `Promise<T>` 반환**.
   나중에 동일 시그니처로 `fetch('/api/...')` 호출로 교체.

2. **데이터 모양은 API 응답이 될 수 있는 모양으로.**
   - 모든 엔터티에 `id` (uuid, 안정), `createdAt` / `updatedAt` (epoch ms 또는 ISO string).
   - 참조는 **id 만** 가진다 (예: `Audit.taskId`, `Review.auditId`). 객체를 직접 nest 하지 않는다.
   - List 응답 자리에는 `{ items: T[], total: number, cursor?: string }` 형태를 가정하고 reducer 도 그렇게 짠다.

3. **시드 데이터는 "백엔드의 첫 응답" 처럼 다룬다.**
   `prototype/data/poc-seeds/` 폴더에 JSON 파일로 두고, 앱 시작 시 store 가 비어 있으면 시드를 hydration.
   → 실 백엔드 연결 시 이 hydration 만 `GET /api/bootstrap` 으로 교체.

4. **AI 모델 응답도 service 로 감싼다.**
   현재는 prototype 1 의 결정적 재생(deterministic replay)이지만, 향후 실 모델 호출 시:
   ```ts
   // services/ai-model.ts
   export async function askAi(prompt: string, context?: AiContext): Promise<AiResponse> { ... }
   ```
   PoC 구현은 시드에서 매칭, 차후 `POST /api/inference` 로 교체.

5. **Side-effect 가 있는 액션은 명시적인 command 객체로.**
   예: "Task 마감", "Audit 제출", "Review 확정", "Batch 머지" 같은 액션은 단순 store mutation 이 아니라
   command 함수 (`closeTask(taskId, reason)`) 로 노출. 차후 `POST /api/tasks/:id/close` 로 교체.

6. **시간 / 식별자는 클라이언트가 만들지 않는 척한다.**
   `id` 와 `createdAt` 은 service 함수 내부에서 생성하되, 컴포넌트는 service 가 반환한 값만 사용.
   백엔드 도입 시 서버가 발급하는 값으로 자연스럽게 이전.

### PoC 와 백엔드 연결 시 바뀌는 것 / 안 바뀌는 것

| 계층 | PoC | 백엔드 연결 후 | 변경 폭 |
|---|---|---|---|
| UI 컴포넌트 | 동일 | 동일 | 없음 |
| service 함수 시그니처 | `Promise<T>` | `Promise<T>` | 없음 |
| service 함수 내부 | Zustand 읽기 / 쓰기 | `fetch` 호출 | **여기만 바뀜** |
| 스토어 (Zustand) | 캐시 + 영속 | 캐시 only (서버가 진실) | persist 옵션 off |
| 시드 hydration | 시작 시 1회 | `GET /api/bootstrap` 응답 | 진입점만 교체 |
| AI 응답 | 결정적 재생 | `POST /api/inference` | service 함수 내부만 |

이 원칙은 각 detail 문서에서 **"service / store / persist 분리"** 섹션으로 구체화한다.

---

## 7. PDF 에서 빌리지 **않는** 것들

명시적으로 차용하지 않는 PDF 의 요소들 (혼동 방지):

- ❌ "AI 매출 → 비율 적용 → 배당" 정산 모델 → 우리는 추상 credit 만.
- ❌ "박스 발송 → 외부 DB 덤프" → 우리는 사내 모델 파이프라인 (사내 PR).
- ❌ 통장 사본 / 자격 증명 PDF 업로드 → PoC 평가자는 seed 계정으로 단순화.
- ❌ "휴대폰/이메일 인증" 등 실 인증 플로우.
- ❌ "공지 / 문의 답변" 우편의 markdown 에디터·이미지 첨부 — PoC 는 plain text 만.
- ❌ "전체 작업자 일괄 발송" 같은 mass 액션 — PoC 는 단일 평가자 시연 중심.

---

## 8. 세션 모델 (P0 이후 추가됨)

본 문서 초기 작성 시점엔 "계정 전환기" 만 있었지만, 구현 단계에서 **명시적 로그인 / 세션**을
도입했다. 사이드바 푸터의 계정 전환 드롭다운은 **로그아웃** 기능으로 단순화.

자세한 내용은 [05_auth.md](05_auth.md) 참조. 요약:
- 첫 진입은 `/login` — 데모 자격 증명 3종 (`owner`, `auditor`, `admin` / 공용 비밀번호 `demo1234`).
- 로그인 시 `session = "viewer" | "auditor" | "admin"` 저장 (localStorage 영속).
- 각 셸은 `RoleGuard` 로 보호 — 다른 역할로 진입 시 본인 랜딩으로 리다이렉트, 비로그인 시 `/login`.
- 셸 사이드바 푸터는 로그인한 계정 + 인라인 이름 편집 + 로그아웃.

> **다중 평가자와의 관계:** 세션은 단일 `auditor` 계정으로 고정 (PoC 가정).
> 그러나 admin 의 "평가자 관리" 화면은 다중 평가자를 다룬다 — 별도의 **평가자 레지스트리** 가
> `auditor-registry-store` 에 존재. 신규 등록한 평가자는 데모 상 로그인할 수 없지만
> ledger / audit 의 history attribution 으로 사용된다. 자세한 내용은 [03_admin.md §3.9](03_admin.md#39-평가자-관리--adminauditors) 참조.

---

## 9. 구현 현황 (Implementation Status)

본 개념 문서의 모든 §1–§7 항목이 구현됨. 단계별 진행:

| Phase | 범위 | 상태 | 커밋 |
|---|---|---|---|
| P0 | 3-role 셸 + 라우트 스캐폴드 + 계정 전환기 | ✅ | `476a358` |
| P1 | Pool 자동 적재 + Task 생성/픽업 + 내 작업 큐 | ✅ | `476a358` |
| P2 | 3-pane 워크스페이스 (`/audit/work/[auditId]`) + 제출 탭 | ✅ | `476a358` |
| P3 | 검수 (per-feedback 인정/거절) + 결과물 + 이의제기 + ledger 자동 | ✅ | `476a358` |
| P4 | 우편함 + 기여 통장 + 대시보드 + 정산 회차 | ✅ | `106be34` |
| P5 | 모델 파이프라인 (Batch → PR mock → Version → Rollback) | ✅ | `106be34` |
| P6 | 평가자 관리 (registry 분리 · 다중 평가자) | ✅ | 후속 |
| Auth | 세션 / 로그인 / RoleGuard | ✅ | 별도 트랙 |

차이점 (계획 vs. 구현):
- **계정 전환기 → 로그인 + 세션** 으로 격상.
- **평가자 1명 가정 → 다중 평가자 레지스트리** 추가 (세션은 여전히 1명).
- 그 외 §1–§7 의 lifecycle / 엔터티 / 범위는 그대로 구현.

각 영역의 상세는 다음 문서들로:
1. [01_consumer.md](01_consumer.md) — Consumer 측 hook (감사 후보 풀 적재).
2. [02_auditor.md](02_auditor.md) — Auditor 셸 전 화면.
3. [03_admin.md](03_admin.md) — Admin 셸 전 화면 (§3.9 평가자 관리 포함).
4. [04_pipeline.md](04_pipeline.md) — 모델 파이프라인 mock 상세.
5. [05_auth.md](05_auth.md) — 세션 모델 + RoleGuard.
