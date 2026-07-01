# Admin 셸 — 상세 설계

> **읽기 전제:** [00_concept.md](00_concept.md), [02_auditor.md](02_auditor.md).
> Admin 셸은 **신규**. 라우트 `/admin/...`, 신규 계정 `admin`.

## 0. 한 줄 정의

Admin 은 **lifecycle 의 모든 전환을 트리거**한다 — 어떤 대화를 감사 대상으로 올릴지, 누구에게 배정할지, 어떤 피드백을 인정할지, 무엇을 학습 배치로 묶을지, 어떤 모델 버전을 배포·롤백할지.

Auditor 셸이 "내 일감 / 내 결과" 의 1인칭 뷰라면, Admin 셸은 **전체 흐름의 3인칭 관제 뷰**.

---

## 1. 정보 구조 (라우트)

```
/admin                                       → /admin/dashboard 로 리다이렉트
/admin/dashboard                             상황실 (전사 KPI)
/admin/pool                                  감사 후보 풀 (ChatSession candidates)
/admin/pool/[conversationId]                 ChatSession 상세 (admin 시점)
/admin/tasks                                 Task 목록 (생성한 모든 Task)
/admin/tasks/new                             Task 생성
/admin/tasks/[taskId]                        Task 상세 (진행 / 픽업자 / 결과 진척도)
/admin/inspection                            검수 큐 (submitted audits)
/admin/inspection/[auditId]                  검수 화면 (Review 작성)
/admin/inquiries                             이의제기 목록
/admin/inquiries/[inquiryId]                 이의 상세 + 답변 작성
/admin/auditors                              평가자 관리 목록
/admin/auditors/[auditorId]                  평가자 상세 (이력 + 통계)
/admin/auditors/new                          평가자 등록
/admin/settlement                            정산 회차 목록
/admin/settlement/new                        새 회차 생성
/admin/settlement/[roundId]                  회차 상세
/admin/pipeline                              모델 파이프라인 (Training Batch → ModelVersion) — 04_pipeline 참조
/admin/pipeline/batches/[batchId]            Batch 상세
/admin/pipeline/versions/[versionId]         Model Version 상세
/admin/mail                                  발송함 (공지 / 답변 / 정산)
/admin/mail/new                              새 공지 작성
/admin/mail/[mailId]                         발송 우편 상세
```

> Admin 라우트는 미들웨어 / 가드로 보호하지 않는다 (PoC). 계정 전환기로만 진입.

---

## 2. 사이드바 IA

PDF 의 그룹 분류를 우리 도메인 용어로 재명명. 2-레벨 사이드바.

```
┌─ Sidebar (AdminShell) ─────────────────────────┐
│ ShieldCheck  운영                              │
│                                                │
│ ▾ 상황실                                       │
│    □ 대시보드                                  │
│    □ 이의제기            [● 1]                 │
│    □ 발송함                                    │
│                                                │
│ ▾ 작업 (Task) 흐름                             │
│    □ 후보 풀            [12 신규]              │
│    □ Task 목록                                 │
│    □ 검수 큐            [● 2]                  │
│                                                │
│ ▾ 사람·정산                                    │
│    □ 평가자                                    │
│    □ 정산 회차                                 │
│                                                │
│ ▾ 모델                                         │
│    □ 파이프라인                                │
│    □ 모델 버전                                 │
│                                                │
│ ─────────────────────                          │
│  [● admin]   ⌄                                 │
└────────────────────────────────────────────────┘
```

### 배지 규칙
| 메뉴 | 배지 | 정의 |
|---|---|---|
| 이의제기 | ● + 숫자 | 미답변 inquiry 수 |
| 후보 풀 | 회색 숫자 | 마지막 방문 이후 신규 ChatSession 수 |
| 검수 큐 | ● + 숫자 | submitted 상태 audit 수 |

---

## 3. 화면 상세

### 3.1 대시보드 — `/admin/dashboard`

**lifecycle 의 모든 stage 의 건수**를 한 화면에 — 어디가 막혀 있는지 즉시 보이도록.

```
┌─ Topbar ──────────────────────────────────────────────────────┐
│ 상황실                                          [내보내기 ⬇]    │
└───────────────────────────────────────────────────────────────┘
┌─ 1행: 흐름 단계별 카드 (Pipeline Stages) ─────────────────────┐
│ ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌────────┐ │
│ │ 후보 풀  │ →│ 진행중   │ →│ 검수 대기│ →│ 인정    │ →│ 배포중 │ │
│ │  12 신규 │  │  Task 5  │  │  Audit 2 │  │  Batch 1 │  │ Ver 1  │ │
│ │ 누적 134 │  │ 픽업 4/8 │  │          │  │  대기    │  │ prod   │ │
│ └─────────┘  └─────────┘  └─────────┘  └─────────┘  └────────┘ │
│   (각 카드 클릭 → 해당 화면으로 이동, 호버 시 트렌드 미니 차트)  │
└───────────────────────────────────────────────────────────────┘
┌─ 2행: 활동 / 품질 ─────────────────────────────────────────────┐
│ ┌──────────────────────────┐ ┌────────────────────────────┐   │
│ │ 평가자 활동 (이번 주)      │ │ 인정률 (per auditor, top 5) │   │
│ │ 활동자 4명 / 등록 6명      │ │  평가자A ████████░░ 88%    │   │
│ │ 평균 처리 6.4건/명         │ │  평가자B ███████░░░ 75%    │   │
│ │ 최장 미응답 inquiry: 2일   │ │  평가자C ██████░░░░ 62%    │   │
│ └──────────────────────────┘ └────────────────────────────┘   │
└───────────────────────────────────────────────────────────────┘
┌─ 3행: 최근 사건 (Event Feed) ──────────────────────────────────┐
│ • [12:04] Audit-43 제출 → 검수 대기                              │
│ • [11:50] Task-Q14 모집 마감                                     │
│ • [09:12] ModelVersion v0.4.1 production 승격                    │
│ • [어제] Batch-7 머지 → v0.4.1 PR #142                           │
└───────────────────────────────────────────────────────────────┘
┌─ 4행: 알림 / 경보 ─────────────────────────────────────────────┐
│ ⚠ Task-Q11 마감 24h 이내 (픽업 1/3)                              │
│ ⚠ Inquiry #18 응답 대기 2일                                      │
│ ⚠ 이번 회차 미정산 인정 피드백 184건                              │
└───────────────────────────────────────────────────────────────┘
```

#### 데이터 흐름
```
DashboardPage
  └─ useAdminDashboard()
       ├─ services/pool.summary()
       ├─ services/audit-task.summary()
       ├─ services/audit.summary({ status: "submitted" })
       ├─ services/pipeline.summary()
       ├─ services/auditor.activitySummary({ window: "week" })
       ├─ services/inquiry.summary({ unanswered: true })
       └─ services/event.recent({ limit: 10 })
```

#### 인수 기준
- [ ] 5단계 흐름 카드의 숫자가 services 결과와 일치.
- [ ] 알림 영역에 임박/지연 항목이 자동 노출.
- [ ] 이벤트 피드 항목 클릭 → 해당 상세로 이동.

---

### 3.2 감사 후보 풀 — `/admin/pool`

Consumer 가 만든 ChatSession 들이 **자동으로 들어오는 곳**. Admin 이 이중 어떤 대화를 Task 로 묶을지 결정.

#### 목록
| 컬럼 | 비고 |
|---|---|
| Conv ID | 클릭 → 상세 |
| 업종 | occupation |
| 토픽 | conversation.topic.label (있으면) |
| Turn 수 | messages.length |
| 생성일 | createdAt |
| 후보 추가일 | candidateAt |
| 상태 | `new` / `assigned` (Task 에 포함됨) / `excluded` (admin 이 제외) |
| 액션 | `[제외]` (new 일 때) |

체크 박스 다중 선택 → 상단 액션:
- `[일괄 Task 등록]` → `/admin/tasks/new?conversationIds=...` 로 이동
- `[일괄 제외]`

#### 상세 — `/admin/pool/[conversationId]`
- 전사 read-only (consumer 시점과 동일 렌더).
- 메타: occupation, topic, 생성/후보 시점, 이미 포함된 Task 들 (있으면).
- 액션: `[Task 에 추가]`, `[제외]`, `[원본 chat 으로 보기]`.

#### 자동 적재 룰 (PoC)
- Consumer 가 `/chat/<occupation>` 에서 대화를 종료(혹은 1턴 이상 진행)하면 즉시 후보 풀에 적재.
- 별도 동의 플로우 없음 (PoC 가정).
- 적재 hook 은 [01_consumer.md](01_consumer.md) 에서 명시.

#### 인수 기준
- [ ] consumer 셸에서 새 chat 종료 → 후보 풀 배지 +1.
- [ ] Task 에 포함된 대화는 풀에서 `assigned` 표시 (제거되지는 않음 — 다중 평가 가능).
- [ ] 제외 후 풀 목록에서 사라짐, 상세 페이지는 read-only.

---

### 3.3 Task 목록 — `/admin/tasks`

Admin 이 생성한 모든 Task. 진행 / 마감 / 픽업 현황 한눈에.

#### 테이블
| 컬럼 | 비고 |
|---|---|
| Task ID | 클릭 → 상세 |
| 분류 | 포함 대화의 업종 chips |
| 대화 수 | conversationIds.length |
| 모집 | `currentPickups / capacity` |
| 진행도 | `submitted / capacity` (검수 대기 + 완료) |
| 등록 | createdAt |
| 마감 | deadline (남은 시간) |
| 상태 | `open` / `full` / `in_progress` / `closed` |
| 액션 | `[기한 연장]`, `[강제 마감]` |

필터: 상태, 분류, 마감 임박.

#### 일괄 액션
- 다중 선택 → `[일괄 기한 연장]` (날짜 picker 모달).
- `[일괄 결과물 등록]` — PDF 패턴이지만 우리 도메인에서는 **사용 안 함** (audit 은 auditor 가 직접 제출). 제거.

---

### 3.4 Task 생성 — `/admin/tasks/new`

후보 풀에서 선택한 conversation 들을 묶어 **새 Task 게시**.

```
┌─ Task 생성 ───────────────────────────────────────────────────┐
│ 포함 대화 (선택됨)                                              │
│  - Conv-101 (병의원/차량유지비)                                │
│  - Conv-102 (병의원/골프회원권)                                │
│  - Conv-103 (병의원/헬스장)                            [추가]   │
│                                                                │
│ 모집 인원      [3 ▾]  (1 / 3 / 5 / 10 / 직접입력)               │
│ 평가자 조건                                                     │
│   ☐ 누적 인정 N건 이상     [50]                                │
│   ☐ 카테고리 N건 이상      [병의원 ▾]  [5]                     │
│   ☐ 랭킹 상위 X%           [상위 50%]                          │
│ 마감일         [📅 2026-06-29]                                  │
│ 메모 (선택)    ……                                              │
│                                                                │
│                                              [게시하기]         │
└────────────────────────────────────────────────────────────────┘
```

- 게시 시 services/audit-task.create(payload) → status `open`, auditor 큐에 즉시 노출.
- 동일 conversation 이 이미 다른 Task 에 포함돼 있어도 OK (다중 평가).
- 마감일은 캘린더 picker (단순 input[type=date] OK).

#### 인수 기준
- [ ] 게시 후 `/admin/tasks/[taskId]` 로 이동, auditor 측 `/audit/queue` 에 즉시 노출.
- [ ] 조건 미충족 평가자에게는 자격 미달 사유가 표시되도록 services/audit-task.checkEligibility(taskId, auditorId) 가 사유 string 반환.

---

### 3.5 Task 상세 — `/admin/tasks/[taskId]`

```
┌─ Task 요약 ───────────────────────────────────────────────┐
│ Task-Q14 · 등록 2026-06-22 · 마감 2026-06-29              │
│ 분류: 병의원 · 모집 2/3 · 상태: open                       │
└───────────────────────────────────────────────────────────┘
┌─ 픽업 / 진행 상황 ────────────────────────────────────────┐
│ 평가자 A   픽업 06-22 12:00  · Audit-43 submitted          │
│ 평가자 B   픽업 06-22 14:30  · Audit-44 draft (3/8 진행)    │
│ (slot 3 미픽업)                                            │
└───────────────────────────────────────────────────────────┘
┌─ 포함 대화 ───────────────────────────────────────────────┐
│ Conv-101  · 미리보기                                       │
│ Conv-102  · 미리보기                                       │
│ Conv-103  · 미리보기                                       │
└───────────────────────────────────────────────────────────┘
                                       [기한 연장] [강제 마감]
```

#### 인수 기준
- [ ] 픽업 / 진행 / 제출 상태가 real-time (store mutation 직후 반영).
- [ ] 강제 마감 시 미제출 audit 은 status `cancelled` 로 — 정산 대상 아님.

---

### 3.6 검수 큐 — `/admin/inspection`

`status = submitted` 인 audit 목록. PDF 의 "결과물 목록".

| 컬럼 | 비고 |
|---|---|
| Audit ID | 클릭 → 검수 화면 |
| 평가자 | auditor label |
| Task | 부모 Task ID |
| 대화 | conversation 요약 |
| 피드백 수 | lineFeedbacks.length |
| 제출일 | submittedAt |
| 검수 마감 | (생성 가능: `submittedAt + N일`) — 일단 정보만, 자동 마감은 v1 없음 |
| 상태 | `submitted` (검수 전) / `reviewed` (검수 후 이의제기 기간) |

필터: 상태, 평가자, 분류.

체크 박스 다중 선택 → `[일괄 자동 인정]` (모든 피드백 인정 처리, 빠른 디버그 용 — PDF 의 "일괄 상품등록" 에 해당).

---

### 3.7 검수 화면 — `/admin/inspection/[auditId]`

PDF 의 "검수 모드" 와 핵심 동일. **3-pane** — 왼쪽 큐, 가운데 전사, 오른쪽 인스펙터(평가자 피드백 + 인정/거절 토글).

```
┌─ /admin/inspection/[auditId] ────────────────────────────────────────┐
│ ┌─ Queue ──────┐ ┌─ Transcript (read-only) ──┐ ┌─ Reviewer Inspector ┐ │
│ │ Audit-43 ●  │ │ user: ...                  │ │ ▣ 결정 (default)   │ │
│ │ Audit-44 ●  │ │ assistant: ...             │ │ □ 평가자 메모       │ │
│ │ Audit-39  ✓ │ │   ▸ seg + 피드백 chip      │ │ □ 첨부 KB           │ │
│ │              │ │ ────                       │ │ ─────────────       │ │
│ │              │ │ ...                        │ │ [선택 문장]          │ │
│ │              │ │                            │ │ 평가자 피드백:       │ │
│ │              │ │                            │ │  "..."              │ │
│ │              │ │                            │ │ KB 첨부: 차량유지비 │ │
│ │              │ │                            │ │                     │ │
│ │              │ │                            │ │ ─ 결정 ─            │ │
│ │              │ │                            │ │ ○ 인정              │ │
│ │              │ │                            │ │ ○ 거절 (사유 입력)  │ │
│ │              │ │                            │ │ ○ 보류              │ │
│ └──────────────┘ └────────────────────────────┘ └─────────────────────┘ │
│                                                                          │
│ Footer: 인정 4 / 거절 1 / 보류 0     [전체 인정] [검수 완료]              │
└──────────────────────────────────────────────────────────────────────────┘
```

#### 동작
- 가운데 전사는 read-only. 평가자가 단 피드백이 인라인 chip 으로 보임 — 클릭 시 인스펙터로 컨텍스트 이동.
- 우측 "결정" 탭: 각 피드백에 대해 인정 / 거절(사유 필수) / 보류 라디오.
- 푸터 [전체 인정] = 빠른 모드 (모든 피드백 일괄 인정).
- [검수 완료] → services/review.finalize(auditId, decisions) — status `submitted` → `reviewed`.
  - 동시에 inquiry window 시작 (`disputeWindowEndsAt = now + 7d`).
  - 인정된 피드백마다 `ledger entry kind="contribution_accepted"` 자동 추가.
  - 거절된 피드백은 entry kind="contribution_rejected", amount 0.
  - 이후 회차 정산 (3.10) 에서 round entry 가 합산됨.

#### 인수 기준
- [ ] 인정/거절 토글 즉시 footer 카운트 반영.
- [ ] 거절 시 사유 미입력 → 검수 완료 disabled.
- [ ] 검수 완료 → auditor 측 결과물 목록에 즉시 표시 (배지 ● 증가).
- [ ] 검수 후 다시 진입하면 read-only 모드 + "재검수" 버튼은 v1 에 없음.

---

### 3.8 이의제기 — `/admin/inquiries`

Auditor 가 제기한 inquiry 들의 목록 + 답변.

목록 컬럼:
| 컬럼 | 비고 |
|---|---|
| Inquiry ID | clickable |
| 대상 | Audit ID / Feedback ID |
| 제기자 | auditor |
| 제기일 | raisedAt |
| 상태 | `open` (미답변) / `replied` / `resolved` |
| 마지막 메시지 | snippet |

#### 상세 — `/admin/inquiries/[inquiryId]`
- 원본 결과물에서 거절된 피드백 + 사유 표시.
- 평가자의 이의 메시지 thread.
- 답변 입력 → services/inquiry.reply(inquiryId, body).
- 답변 시 옵션: `[결정 변경: 인정으로]` — 클릭 시 해당 feedback 의 review decision 을 retroactively `accepted` 로 바꾸고, ledger 에 `kind="adjustment"` entry 추가.

#### 인수 기준
- [ ] 답변 → auditor 우편함에 `inquiry_reply` kind 우편 자동 생성.
- [ ] 결정 변경 시 ledger 보정 entry 추가 + auditor 잔액 갱신.
- [ ] resolved 처리 → 목록에서 회색 처리.

---

### 3.9 평가자 관리 — `/admin/auditors`

평가자 계정 / 자격 / 활동 통계.

#### 목록
| 컬럼 | 비고 |
|---|---|
| ID | auditorId |
| 이름 | reviewerName |
| 등록일 | createdAt |
| 최근 활동 | lastActiveAt |
| 누적 audit | submitted count |
| 누적 인정률 | % |
| 누적 credit | ledger balance |
| 상태 | `active` / `suspended` |
| 액션 | `[우편 보내기]` `[정지/복구]` |

`[새 평가자 등록]` → 폼:
- 이름, 이메일, 연락처
- 자격 (병의원 인증 등 — 단순 toggle list, PoC 는 자격 검증 X)
- 등록 시 자동으로 ContributionLedger 생성.

#### 상세 — `/admin/auditors/[auditorId]`
- 계정 정보
- 활동 차트 (auditor 본인 대시보드와 동일하지만 admin 시점)
- 최근 audit 목록
- 정산 이력
- [우편 보내기], [정지/복구], [메모 추가] (admin only note)

---

### 3.10 정산 회차 — `/admin/settlement`

`기여 인정` ledger entry 들이 회차별로 집계되는 곳.

#### 목록
| 컬럼 | 비고 |
|---|---|
| 회차 | YYYY-MM-NN |
| 생성일 | createdAt |
| 대상 기간 | from → to |
| 참여 평가자 | N명 |
| 인정 피드백 수 | sum |
| 회차 credit pool | 총량 (admin 이 결정) |
| 분배율 | per-auditor 가중치 룰 (`even` / `weighted_by_count`) |
| 상태 | `draft` / `published` |

#### 새 회차 — `/admin/settlement/new`
```
┌─ 새 정산 회차 ────────────────────────────────────┐
│ 회차 라벨    [2026-07-1]                           │
│ 대상 기간    [2026-06-01] ~ [2026-06-30]           │
│ 포함 ledger  자동 산출:  184건 (X 평가자)           │
│ 분배 모델    ○ even (1/N)                          │
│              ● weighted_by_count (인정수 비례)      │
│ 회차 pool    [300] cr   (가중치/직접입력 토글)      │
│ 미리보기                                            │
│   평가자 A: 인정 80 → 130 cr                       │
│   평가자 B: 인정 60 → 98 cr                        │
│   평가자 C: 인정 44 → 72 cr                        │
│                                                    │
│                                  [회차 게시하기]    │
└────────────────────────────────────────────────────┘
```

#### 게시 동작
- services/settlement.publish(roundPayload) →
  - 각 평가자별 `LedgerEntry { kind: "settlement_round", amount: <분배량> }` 생성
  - 우편 자동 발송 (`kind="settlement"`)
- 새로 게시된 entry 는 auditor 의 ledger 와 대시보드에 즉시 반영.

#### 인수 기준
- [ ] 분배 모델 변경 시 미리보기 실시간 갱신.
- [ ] 게시 후 auditor 셸의 ledger 잔액 / 우편함 ● 갱신.
- [ ] 같은 기간 중복 회차 생성 시 경고 (overlap detection).

---

### 3.11 모델 파이프라인 — `/admin/pipeline`

별도 문서 [04_pipeline.md](04_pipeline.md) 에서 상세. 여기서는 진입점만:
- 검수 완료 + 이의 기간 종료된 audit 의 인정 피드백을 **자동 또는 수동으로** Training Batch 에 추가.
- Batch → PR 시뮬 → ModelVersion → production / rollback.
- 본 메뉴는 admin 셸의 "모델" 그룹 두 항목 (`파이프라인`, `모델 버전`) 으로 노출.

---

### 3.12 발송함 — `/admin/mail`

Admin 이 보낸 모든 우편의 outbox. PDF 의 "우편 발송함" 동일.

목록 컬럼:
| 컬럼 | 비고 |
|---|---|
| Mail ID | clickable |
| 종류 | 공지 / inquiry_reply / settlement |
| 제목 | clickable |
| 수신인 | "전체" 또는 평가자 ID |
| 발송일 | sentAt |

`[새 공지 발송]` — markdown 텍스트 + 수신인 (전체 / 다중 선택). PoC 는 plain text 만 (PDF 의 markdown editor 는 차용 X).

---

## 4. 데이터 흐름 / Service 계층

Auditor 와 같은 service 들을 **admin 시점 함수들로 확장**.

```
services/pool                  (admin 전용)
  ├─ listCandidates(filter)
  ├─ exclude(conversationId)
  └─ summary()

services/audit-task            (양쪽 사용)
  ├─ create(payload)           ← admin
  ├─ extendDeadline(taskId, newDeadline)
  ├─ forceClose(taskId)
  └─ summary()

services/audit
  ├─ listSubmitted(filter)     ← admin
  └─ getWithFeedbacks(auditId)

services/review                ← admin write
  ├─ create(auditId, decisions)
  ├─ finalize(auditId)
  └─ amend(auditId, decisionPatch)         ← inquiry 응답에서 호출

services/inquiry
  ├─ listAll(filter)           ← admin
  ├─ reply(inquiryId, body)    ← admin
  └─ resolve(inquiryId)

services/auditor               (admin 전용)
  ├─ list(filter)
  ├─ create(payload)
  ├─ suspend(id) / resume(id)
  └─ stats(id)

services/settlement            ← admin
  ├─ list()
  ├─ previewRound(payload)
  ├─ publishRound(payload)
  └─ get(roundId)

services/mail
  ├─ sendNotice(payload)       ← admin
  ├─ sendInquiryReply(...)     ← inquiry.reply 내부에서 호출
  └─ sendSettlement(...)       ← settlement.publishRound 내부에서 호출

services/pipeline              ← 04_pipeline 참조
  ├─ listEligibleFeedbacks()
  ├─ createBatch(payload)
  ├─ submitBatch(batchId)      (PR 생성 mock)
  ├─ markMerged(batchId, prMeta)
  ├─ promoteVersion(versionId)
  └─ rollback(versionId)

services/event                 (read-only, dashboard 용)
  └─ recent(limit)
```

---

## 5. 권한 / 가드 (PoC)

- 라우트 미들웨어 없음. 셸 진입은 사이드바 푸터 계정 전환기로만.
- 단, 컴포넌트 레벨에서 `useActiveAccount()` 가 `admin` 이 아니면 `/audit/dashboard` 또는 `/chat/<occupation>` 으로 리다이렉트.
- 실 백엔드 연결 시 라우트 가드 + JWT role claim 으로 대체.

---

## 6. 단계별 구현 계획 (P0–P6)

> 모든 단계 완료. 실제 진행은 P3 의 이의제기 + P3.5 의 평가자 관리 분리 (P6) 로 진행됨.

### P0 — 계정·셸·라우트 스캐폴드 ✅
- `account-schema.ts` 에 `AdminAccount` 추가.
- 시드 계정 3개 (`viewer`, `auditor`, `admin`).
- 계정 전환기 메뉴에 admin 항목 추가.
- `/admin/...` 라우트 빈 페이지 + 사이드바 IA.
- 인수: 계정 전환 → admin 셸 진입.

### P1 — 후보 풀 + Task 생성/배정 ✅
- `services/pool`, `services/audit-task` (admin 쪽).
- 후보 풀 자동 적재 hook (consumer 셸에서).
- Task 생성 폼 + 목록 + 상세.

### P2 — 검수 (Review) ✅
- `services/review` + 검수 화면 3-pane.
- 인정/거절 토글 → ledger entry 자동 추가.

### P3 — 이의제기 ✅
- `services/inquiry` + 답변 화면 (`amend` 옵션 — 결정 인정으로 변경 + ledger 재계산 + mail 자동).

### P4 — 정산 회차 + 발송함 ✅
- `services/settlement` + 회차 생성 / 게시 / 미리보기 (`even` / `weighted_by_count`).
- `services/mail` 발송함 화면 + 새 공지 inline 컴포저.

### P5 — 대시보드 + 모델 파이프라인 ✅
- 모든 selector 조합한 admin/auditor 대시보드.
- 파이프라인 풀 구현 — [04_pipeline.md](04_pipeline.md) 참조.

### P6 — 평가자 관리 ✅ (P3 에서 분리되어 별도 단계)
- `auditor-registry-store-v1` — 세션 계정과 분리된 multi-auditor registry.
- `services/auditor.ts` — list / create / suspend / resume / stats / listWithStats.
- 시드 3명 (`auditor`, `auditor-2`, `auditor-3`) + 과거 활동 시드 (`auditor-history.json`).
- `/admin/auditors` 목록 (필터 + 검색 + 통계 컬럼).
- `/admin/auditors/[id]` 상세 (계정 + 4-카드 통계 + audit 이력 + ledger 이력 + 액션).
- `/admin/auditors/new` 등록 폼 (자격 toggle 6 preset + 직접 입력).

---

## 7. 전체 인수 — admin 측 데모 시나리오

1. consumer 셸에서 클리닉 차량유지비 상담 1건 생성 → 종료.
2. admin 셸 진입 → 대시보드: 후보 풀 +1, 알림 없음.
3. 후보 풀 → 새 ChatSession 체크 → [일괄 Task 등록] → Task 생성 폼 → 게시.
4. Task 상세에서 픽업 0/3 확인.
5. (auditor 셸에서 픽업 + 작업 + 제출 — 02 참조.)
6. admin 셸 대시보드: 검수 대기 +1 알림.
7. 검수 화면 진입 → 5개 피드백 중 4개 인정, 1개 거절 (사유 입력) → 검수 완료.
8. auditor 결과물 화면에 즉시 노출. auditor 가 거절 1건에 이의 제기.
9. admin 이의제기 메뉴에 ● 알림 → 답변 작성 + [결정 변경: 인정] 적용.
10. ledger 보정 entry 추가, auditor 우편함에 답변 도착.
11. 정산 회차 새로 생성 → 미리보기 → 게시 → auditor 잔액 갱신 확인.
12. 파이프라인 메뉴에서 인정된 피드백을 Batch 로 묶기 (04 에서 상세).
13. 새로고침 → 모든 상태 영속.

---

## 8. 구현 현황

✅ **P0–P5 완료** (`476a358` + `106be34`), **P6 평가자 관리 완료** (후속 커밋).

### 화면별 매핑

| 문서 §3 화면 | 구현 위치 | 상태 |
|---|---|---|
| 3.1 대시보드 (`/admin/dashboard`) | `components/admin/admin-dashboard-view.tsx` | ✅ — 5-stage 흐름 카드 + 알림 + 최근 이벤트 + open inquiries |
| 3.2 후보 풀 (`/admin/pool`) | `components/admin/pool-table.tsx` | ✅ — 필터/검색 + 일괄 Task 등록 + 일괄 제외 |
| 3.2 후보 상세 (`/admin/pool/[id]`) | `components/admin/pool-detail-view.tsx` | ✅ — 전사 미리보기 + 단건 Task 만들기 / 제외 |
| 3.3 Task 목록 (`/admin/tasks`) | `components/admin/tasks-table.tsx` | ✅ |
| 3.4 Task 생성 (`/admin/tasks/new`) | `components/admin/task-create-form.tsx` | ✅ — 대화 선택 + 모집 인원 + 마감일 |
| 3.5 Task 상세 (`/admin/tasks/[id]`) | `components/admin/task-detail-view.tsx` | ✅ — 픽업 슬롯 + audit 진행 |
| 3.6 검수 큐 (`/admin/inspection`) | `components/admin/inspection-table.tsx` | ✅ |
| 3.7 검수 화면 (`/admin/inspection/[id]`) | `components/admin/inspection-workspace.tsx` | ✅ — 전사 + chip 클릭 → 결정 인스펙터 + 검수 완료 |
| 3.8 이의제기 (`/admin/inquiries`) | `components/admin/inquiries-view.tsx` | ✅ — 2-pane + 답변 + [amend 인정 변경] |
| **3.9 평가자 관리** (`/admin/auditors`) | `components/admin/auditors-table.tsx` (P6) | ✅ — 다중 평가자 + 통계 + 정지/복구 |
| **3.9 평가자 상세** (`/admin/auditors/[id]`) | `components/admin/auditor-detail-view.tsx` (P6) | ✅ — 계정 + 통계 + audit/ledger 이력 + 액션 |
| **3.9 평가자 등록** (`/admin/auditors/new`) | `components/admin/auditor-new-form.tsx` (P6) | ✅ — 이름/이메일/휴대폰/자격 toggle/메모 |
| 3.10 정산 회차 (`/admin/settlement`) | `components/admin/settlement-table.tsx` | ✅ |
| 3.10 정산 회차 생성 (`/admin/settlement/new`) | `components/admin/settlement-new-form.tsx` | ✅ — 미리보기 (even / weighted_by_count) + 게시 시 ledger + 우편 자동 |
| 3.11 모델 파이프라인 | [04_pipeline.md](04_pipeline.md) 참조 | ✅ |
| 3.12 발송함 (`/admin/mail`) | `components/admin/mail-view.tsx` | ✅ — outbox + 새 공지 inline 컴포저 |

### P6 평가자 관리 — 설계 vs 구현 차이

원래 문서 §3.9 의 계획과 다른 점 (실제 구현이 더 정교함):

1. **Registry 분리** — `account-store` 의 session 계정과 별도로 `auditor-registry-store` 를 둠.
   세션은 단일 `auditor` 로 고정 (PoC), 그러나 admin 은 다중 평가자를 본다.
2. **시드 3명** — `auditor`(세션 기본), `auditor-2`(김감사), `auditor-3`(이검수) + 과거 audit/ledger 시드 (`auditor-history.json`) 로 의미 있는 통계 표시.
3. **자격 toggle 6 preset + 직접 입력** — 폼에서 자격 즉시 선택 가능.
4. **상태 토글 (정지/복구)** — 목록과 상세 양쪽에서 가능, 즉시 반영.
5. **메모 (관리자만 보는)** — 상세에서 인라인 편집.

### Service / 권한

- `services/auditor.ts` — `list`, `listWithStats`, `get`, `create`, `suspend`, `resume`, `updateNote`, `stats`.
- 권한: `RoleGuard` 가 `/admin/*` 모두 보호 (admin 세션만 접근). 자세한 내용은 [05_auth.md](05_auth.md) 참조.
