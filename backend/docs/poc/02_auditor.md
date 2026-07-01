# Auditor 셸 — 상세 설계

> **읽기 전제:** [00_concept.md](00_concept.md) — 3-role 모델, lifecycle, 엔터티, 백엔드-readiness 원칙.
> Auditor 셸은 prototype 3 의 `auditor` 계정을 그대로 사용하되, **셸 내용을 풍부화**한다.

## 0. 한 줄 정의

평가자가 **작업을 픽업 → 감사 → 결과 확인 → 기여 이력 추적**까지 한 셸 안에서 끝낸다.
KB 와 우편함은 보조 surface 로 같은 셸에 둔다.

---

## 1. 정보 구조 (라우트)

prototype 3 의 `/audit/chat-logs`, `/audit/knowledge` 위에 **신규 4 섹션**을 더한다.

```
/audit                                       → /audit/dashboard 로 리다이렉트 (기본 진입점 변경)
/audit/dashboard                             기여 통장 대시보드
/audit/queue                                 작업 큐 (open tasks)
/audit/queue/[taskId]                        Task 상세 + 픽업
/audit/work                                  내 작업 목록 (in_progress drafts)
/audit/work/[auditId]                        3-pane 감사 워크스페이스 (= prototype 3 의 chat-logs/[conversationId])
/audit/results                               결과물 목록 (검수 상태별)
/audit/results/[auditId]                     결과물 상세 (Review + 이의제기)
/audit/mailbox                               우편 수신함
/audit/mailbox/[mailId]                      우편 상세
/audit/ledger                                기여 이력 (회차별 / 누적)
/audit/ledger/[entryId]                      기여 항목 상세 (어떤 audit 이 어떤 batch 에 포함됐는지)
/audit/knowledge                             KB (prototype 3 그대로)
/audit/knowledge/[...path]                   KB 리더/에디터 (prototype 3 그대로)
```

> **prototype 3 의 `/audit/chat-logs/[conversationId]` → `/audit/work/[auditId]` 로 이전.**
> 이유: PoC 에서 "감사"는 **Task 픽업 → Audit 생성** 후에만 시작된다. URL 의 primary key 가 conversationId 가 아니라 **auditId** 가 되어야 한다 (한 대화가 여러 Audit 의 대상이 될 수 있음). 구 라우트는 리다이렉트 유지.

---

## 2. 사이드바 IA

```
┌─ Sidebar (AuditorShell) ───────────────────┐
│ ClipboardCheck  상담 평가                  │ ← Header
│                                            │
│  ▣ 대시보드                                │ ← /audit/dashboard
│  □ 작업 큐                  [3]            │ ← /audit/queue (open task 수 배지)
│  □ 내 작업                  [1]            │ ← /audit/work (in_progress audit 수)
│  □ 결과물                   [2 ●]          │ ← /audit/results (검수 완료 + 미확인 ● 도트)
│  □ 우편함                   [● 1]          │ ← /audit/mailbox (미확인 ● 도트 + 수)
│  □ 기여 통장                               │ ← /audit/ledger
│  ─────────────────────                     │
│  □ 지식 베이스                             │ ← /audit/knowledge (prototype 3)
│                                            │
│  ─────────────────────                     │
│  [● 평가자]   ⌄                            │ ← Footer (AccountSwitcher)
└────────────────────────────────────────────┘
```

### 배지 규칙
| 메뉴 | 배지 | 정의 |
|---|---|---|
| 작업 큐 | 회색 숫자 | 현 auditor 가 픽업 가능한 open task 수 |
| 내 작업 | 노랑 숫자 | status = `draft` 인 audit 수 (제출 전) |
| 결과물 | 회색 숫자 + 미확인 시 ● | reviewed 된 audit 수 / 본 적 없는 결과가 있으면 ● |
| 우편함 | ● + 숫자 | 미확인 우편 수 |

> 배지는 store selector 로 파생, store 가 갱신되면 즉시 반영.

---

## 3. 화면 상세

### 3.1 대시보드 — `/audit/dashboard`

기여 통장의 메인 페이지. **현재 상태와 누적 성과를 한눈에**.

```
┌─ Topbar ─────────────────────────────────────────────────────────┐
│ 안녕하세요, {reviewerName} 님                          [내보내기 ⬇] │
└──────────────────────────────────────────────────────────────────┘
┌─ 1행: 현재 활동 (Stats Row) ─────────────────────────────────────┐
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐               │
│ │ 픽업 가능 │ │ 진행 중   │ │ 검수 대기 │ │ 미확인 우편│               │
│ │   3건    │ │   1건    │ │   2건    │ │   1통    │               │
│ │  →큐로   │ │  →작업   │ │  →결과물 │ │  →우편함  │               │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘               │
└──────────────────────────────────────────────────────────────────┘
┌─ 2행: 기여 통장 (Ledger Summary) ────────────────────────────────┐
│ ┌─────────────────────────────────────┐ ┌─────────────────────┐  │
│ │ 누적 Credit:    1,240 cr             │ │ 인정률 (lifetime)    │  │
│ │ 이번 달:        +180 cr (↑12%)       │ │   ███████░░  83%    │  │
│ │ 마지막 정산:    2026-06 회차 (+150)   │ │ (총 312건 중 258건) │  │
│ └─────────────────────────────────────┘ └─────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
┌─ 3행: 활동 추이 (Chart) ─────────────────────────────────────────┐
│  주간 / 월간 / 분기 토글                                          │
│  - 누적 막대그래프: 인정(green) vs 거절(grey) per period          │
│  - 우측 작은 도넛: 카테고리별 (업종별 / 프레임워크별) 비율          │
└──────────────────────────────────────────────────────────────────┘
┌─ 4행: 최근 활동 (Activity Feed) ─────────────────────────────────┐
│ • [2026-06-24] Audit-42 제출 → 검수 대기                           │
│ • [2026-06-23] Result-39 결과 확인됨 (피드백 5건 중 4건 인정)        │
│ • [2026-06-22] 우편: "2026-06 회차 정산 안내"                      │
│ • [2026-06-22] Task-Q14 픽업                                       │
└──────────────────────────────────────────────────────────────────┘
```

#### 데이터 흐름

```
DashboardPage
  └─ useAuditorDashboard(auditorId)              // composite selector
       ├─ services/audit-task.listOpenTasks({ assignableTo: auditorId })
       ├─ services/audit.listMine({ status: "draft" })
       ├─ services/audit.listMine({ status: "reviewed", since: lastSeen })
       ├─ services/mail.listInbox({ unreadOnly: true })
       └─ services/ledger.summary(auditorId)
           → { totalCredit, monthlyDelta, acceptanceRate, recentEntries }
```

> 컴포넌트는 service 만 호출. service 내부는 현재 Zustand 읽기, 추후 fetch 로 교체.

#### 인수 기준
- [ ] 4개 stat 카드, 각각 클릭 시 해당 라우트로 이동.
- [ ] 누적 Credit · 인정률은 service 의 `ledger.summary` 결과를 그대로 표시.
- [ ] 차트는 빈 데이터(첫 진입 직후) 시 placeholder 표시, runtime error 없음.
- [ ] 활동 피드 항목 클릭 → 해당 상세 화면으로 이동.
- [ ] 첫 진입 (시드 데이터 hydration 후) 모든 숫자가 0 이 아닌 의미 있는 값으로 노출.

---

### 3.2 작업 큐 — `/audit/queue`

Admin 이 게시한 open task 중 **현재 평가자가 픽업 가능한 것**들의 목록.

#### 헤더 + 필터
```
┌──────────────────────────────────────────────────────────────┐
│ 작업 큐                                                       │
│ [전체 ▾]  [업종 ▾]  [마감 임박 ▾]    [정렬: 마감 빠른 순 ▾]    │
└──────────────────────────────────────────────────────────────┘
```
- 전체 / 픽업 가능 / 픽업 불가 (정원 마감) 필터.
- 업종 필터 (Task 에 포함된 ChatSession 의 occupation 다중 선택).
- 마감 임박 = 24h / 72h / 7d 토글.

#### 테이블
| 컬럼 | 비고 |
|---|---|
| Task ID | 클릭 → `/audit/queue/[taskId]` |
| 분류 | 업종 chips (혼합 시 "혼합") |
| 대화 수 | conversationIds.length |
| 모집 | `currentPickups / capacity` (예: `2/3`) — 가득 차면 회색 배지 |
| 등록일 | createdAt |
| 마감일 | deadline (남은 시간 small badge) |
| 상태 | `open` / `full` / `closed` |
| 액션 | 픽업 가능 시 `[픽업]` 버튼 |

체크 박스 다중 선택 → `[일괄 픽업]` 버튼 (capacity 가 모두 가능한 경우만 활성).

#### Task 상세 — `/audit/queue/[taskId]`
```
┌─ Task 요약 ──────────────────────────────────────────────┐
│ Task-Q14   · 등록 2026-06-22  · 마감 2026-06-29 (D-5)    │
│ 분류: 병의원 · 모집 2/3 · 상태: open                       │
│ 게시자: admin-1                                           │
└──────────────────────────────────────────────────────────┘
┌─ 포함된 대화 목록 (read-only preview) ───────────────────┐
│ Conv-101  병의원 / 차량유지비   12 turns                  │
│ Conv-102  병의원 / 골프회원권   8 turns                   │
│ Conv-103  병의원 / 헬스장        15 turns                 │
│   ↳ 각 row 클릭 → 미리보기 모달 (전사 read-only)            │
└──────────────────────────────────────────────────────────┘
┌─ 자격 / 조건 (있을 경우) ───────────────────────────────┐
│ • 누적 인정 50건 이상                                     │
│ • 병의원 카테고리 5건 이상 경험                            │
└──────────────────────────────────────────────────────────┘
                                                [픽업하기]
```

#### 픽업 동작
- 버튼 클릭 → `services/audit-task.pickup(taskId, auditorId)`.
- 성공 시 Task 의 `pickups[]` 에 추가되고, 각 conversation 마다 **`Audit` 객체가 `draft` 로 생성**되며, `/audit/work` 로 이동.
- 조건 미충족 시 버튼 disabled + 미충족 사유 inline 표시 (service 가 reason string 반환).

#### 인수 기준
- [ ] 필터 / 정렬 동작, URL 쿼리에 반영 (`?status=open&occupation=clinic`).
- [ ] 픽업 후 큐에서 해당 Task 즉시 제거(또는 회색 처리), `/audit/work` 배지 +1.
- [ ] 자격 미충족 시 픽업 버튼 disabled + 사유 표시.
- [ ] 빈 큐 상태 placeholder ("현재 가능한 작업이 없습니다").

---

### 3.3 내 작업 — `/audit/work`

픽업해서 진행 중인 audit (status = `draft`) 목록. **이 화면이 작업의 hub**.

#### 테이블
| 컬럼 | 비고 |
|---|---|
| Audit ID | 클릭 → `/audit/work/[auditId]` (3-pane 진입) |
| 대화 | conversation.title (없으면 첫 user message snippet) |
| 업종 | 배지 |
| 픽업일 | pickedAt |
| 마감일 | parent task.deadline + 남은 시간 |
| 진행도 | `<달린 피드백 수> / <assistant 문장 수>` + 세션평가 ●/○ |
| 액션 | `[이어서 작업]` / `[작업 취소]` |

> "작업 취소" → 본인 기여가 0 이면 가능 (PDF 의 "본인 기여가 있는 일감 체크 불가" 룰 참고).
> 취소 시 해당 Audit 는 삭제되고 Task 정원이 1 회복됨.

#### 인수 기준
- [ ] 진행도 막대(picker 단위) 정확.
- [ ] "이어서 작업" → 3-pane 진입 시 미저장 상태 복원 (Zustand persist).
- [ ] "작업 취소" 버튼: 기여 0 인 경우만 활성, 클릭 시 confirm.
- [ ] 마감 임박(24h 미만) 시 row 강조 색.

---

### 3.4 감사 워크스페이스 — `/audit/work/[auditId]`

**prototype 3 의 3-pane 워크스페이스를 그대로 재사용.**
변경점:
- URL key 가 `conversationId` → `auditId`.
- 큐 스트립(좌측) 의 대상이 "동일 페르소나의 세션" 에서 **"내가 진행 중인 다른 Audit"** 으로 바뀐다 (Task 간 빠른 이동).
- Topbar 에 **부모 Task 와 마감 시간** 표시.
- Inspector 의 "근거(deferred)" 탭 자리에 **"제출"** 탭 신설 — 작업 완료 시 누르는 곳.

#### 제출 탭 (신규)
```
┌─ Inspector / 제출 ────────────────────┐
│ 필수 체크리스트                        │
│ ☑ 모든 assistant 문장에 피드백 또는    │
│   "이상 없음" 마킹 완료                │
│ ☑ 세션 평가 작성 완료                  │
│ ☑ 평가자 메모 (선택)                  │
│ ─────────────                          │
│ 제출 후에는 수정할 수 없습니다.         │
│           [제출하기]                   │
└────────────────────────────────────────┘
```
- 제출 → `services/audit.submit(auditId)` → status `draft` → `submitted`.
- 성공 시 `/audit/results/[auditId]` 로 이동 (검수 대기 상태).

#### 인수 기준
- [ ] 3-pane (큐 / 전사 / 인스펙터) 정상 동작 (prototype 3 회귀 X).
- [ ] 제출 탭의 체크리스트가 모두 충족돼야 [제출하기] 활성.
- [ ] 제출 후 status `submitted`, 큐 스트립과 사이드바 배지 즉시 갱신.

---

### 3.5 결과물 — `/audit/results`

내가 제출한 Audit 의 **검수 결과 확인 + 이의제기** 화면.

#### 목록 테이블
| 컬럼 | 비고 |
|---|---|
| Audit ID | 클릭 → 상세 |
| 대화 | 페르소나 / 토픽 |
| 제출일 | submittedAt |
| 검수일 | reviewedAt (미검수면 `-`) |
| 인정/거절 | `4/5` 형태 (인정 / 전체) |
| 상태 | `submitted` (검수 대기) / `reviewed` (확인 가능) / `finalized` (이의 종료) |
| 미확인 | 평가자가 본 적 없으면 ● |

필터: 상태 / 미확인만 / 인정률 구간.

#### 결과물 상세 — `/audit/results/[auditId]`
```
┌─ Topbar ─────────────────────────────────────────────────┐
│ Audit-42  ·  Conv-101 (병의원/차량유지비)                 │
│ 제출 2026-06-22  ·  검수 2026-06-23  ·  finalized 2026-06-30 │
│ 검수자: admin-1                                           │
└──────────────────────────────────────────────────────────┘
┌─ 1. 검수 요약 ────────────────────────────────────────────┐
│ 인정 4 / 거절 1 · 총평: "... 관리자 코멘트 ..."             │
│ 이의제기 가능 기간: D-7 (2026-06-30 까지)                  │
└──────────────────────────────────────────────────────────┘
┌─ 2. 문장별 결과 (스크롤 영역) ────────────────────────────┐
│ ┌── 문장 1 ────────────────────────────────────┐           │
│ │ user: ... assistant: ...                     │           │
│ │ ✓ 인정  · 내 피드백: "..."                   │           │
│ │   [이 결정에 대해 문의/이의제기]              │           │
│ └──────────────────────────────────────────────┘           │
│ ┌── 문장 2 ────────────────────────────────────┐           │
│ │ user: ... assistant: ...                     │           │
│ │ ✗ 거절 · 내 피드백: "..." · 사유: "..."      │           │
│ │   [이 결정에 대해 문의/이의제기]              │           │
│ │   ─ 이미 제기된 문의 (1)                     │           │
│ │     "..." admin 답변 대기                    │           │
│ └──────────────────────────────────────────────┘           │
└────────────────────────────────────────────────────────────┘
```

#### 이의제기 동작
- "문의/이의제기" 버튼 → 인라인 입력창 열림 → `services/inquiry.create({ auditId, feedbackId, body })`.
- 상태 `open` 으로 mailbox 에도 표시. admin 응답 시 새 메시지 알림.
- 이의제기 기간 (`disputeWindowEndsAt`) 지나면 버튼 disabled.

#### 인수 기준
- [ ] 인정 / 거절 마크 정확, 거절 사유 표시.
- [ ] 이의제기 기간 카운트다운 정확.
- [ ] 이의제기 제출 → mailbox 와 admin 측 inquiries 에 즉시 반영.
- [ ] finalized 후에는 모든 액션 disabled, read-only.

---

### 3.6 우편함 — `/audit/mailbox`

Admin 으로부터 받은 **공지 + 이의 답변 + 정산 안내**.

#### 목록
| 컬럼 | 비고 |
|---|---|
| 번호 | mailId |
| 종류 | `공지` / `문의 답변` / `정산 안내` |
| 제목 | clickable |
| 발신인 | 보통 admin-1 |
| 발송일 | sentAt |
| 상태 | `미확인` ● / 읽음 |

필터: 종류, 미확인 only, 키워드.

#### 상세 — `/audit/mailbox/[mailId]`
- 종류별 템플릿:
  - **공지** — 자유 텍스트 (admin 이 작성).
  - **문의 답변** — inquiry thread 가 inline 으로 펼쳐짐, "원본 결과물 보기" 링크.
  - **정산 안내** — 회차 / 금액 / 기여 항목 수 표 + "기여 통장에서 보기" 링크.
- 읽음 처리: 상세 진입 시 자동 `services/mail.markRead(mailId)`.

#### 인수 기준
- [ ] 미확인 도트, 읽음 처리 후 사라짐.
- [ ] 종류별 템플릿 정확.
- [ ] 정산 안내에서 ledger 항목으로 deep link 가능.

---

### 3.7 기여 통장 — `/audit/ledger`

내 **모든 기여 이력**의 원장. 회차별 / 누적 / 카테고리별 view.

```
┌─ 헤더 ────────────────────────────────────────────────────┐
│ 기여 통장                                  [내보내기 ⬇]    │
│ 누적 1,240 cr · 이번 달 +180 · 평균 인정률 83%             │
└────────────────────────────────────────────────────────────┘
┌─ 탭 ────────────────────────────────────────────────────┐
│ [전체 항목] [회차별] [카테고리별]                          │
└────────────────────────────────────────────────────────────┘
┌─ 전체 항목 탭 ────────────────────────────────────────────┐
│ 일자       종류        | 출처           | 변동        잔액  │
│ 2026-06-30 회차 정산   | 2026-06        | +150 cr   1,240   │
│ 2026-06-23 기여 인정   | Audit-42 (4건) | +40 cr    1,090   │
│ 2026-06-23 기여 거절   | Audit-42 (1건) |   0 cr    1,050   │
│ 2026-06-20 기여 인정   | Audit-41 (3건) | +30 cr    1,050   │
│ ...                                                          │
└────────────────────────────────────────────────────────────┘
```

#### 항목 상세 — `/audit/ledger/[entryId]`
- 종류 `회차 정산` 이면: 회차 메타 + 포함 audit 리스트 + 각 audit 의 인정 피드백 수.
- 종류 `기여 인정/거절` 이면: 원본 Audit + 어떤 feedback 이 어떻게 처리됐는지 + (있다면) 어떤 TrainingBatch 에 들어갔는지.

#### 카테고리별 탭
- 업종 / 프레임워크별 누적 차트 + 표.
- "어떤 분야에서 강한가" 를 자기 확인하는 용도.

#### 인수 기준
- [ ] 전체 항목 탭의 잔액 누계가 정확.
- [ ] 회차별 탭에서 각 회차의 합산 = 항목 합산 일치.
- [ ] 항목 상세에서 audit → audit detail 로 deep link.
- [ ] 내보내기 → JSON (ledger entries) + CSV 옵션.

---

### 3.8 KB — `/audit/knowledge/...`

**prototype 3 의 KB 그대로**. 본 PoC 에서는 변경 없음.
단, 라인 피드백 작성 시 KB 첨부 (`relatedKbIds`) 가 기여 평가 시 admin 의 참고 자료로 표시되도록 cross-link 유지 (이미 prototype 3 B5).

---

## 4. 데이터 흐름 / Service 계층

```
                      ┌─ services/audit-task ─┐
                      │  listOpenTasks         │
                      │  getTask               │
                      │  pickup                │
                      │  releasePickup         │
                      └────────────────────────┘
                                  │
                      ┌─ services/audit ───────┐
                      │  listMine(status)      │
                      │  get                   │
                      │  saveDraft             │
                      │  submit                │
                      └────────────────────────┘
                                  │
                      ┌─ services/review ──────┐  (auditor 는 read-only)
                      │  getForAudit           │
                      │  listMyReviewed        │
                      └────────────────────────┘
                                  │
                      ┌─ services/inquiry ─────┐
                      │  listMine              │
                      │  create                │
                      │  reply                 │
                      └────────────────────────┘
                                  │
                      ┌─ services/mail ────────┐
                      │  listInbox             │
                      │  get                   │
                      │  markRead              │
                      └────────────────────────┘
                                  │
                      ┌─ services/ledger ──────┐
                      │  summary(auditorId)    │
                      │  listEntries           │
                      │  getEntry              │
                      │  export                │
                      └────────────────────────┘

Stores (Zustand, persist)
  ├─ audit-task-store          (open tasks; admin 이 쓰고 auditor 는 읽음)
  ├─ audit-store               (audit drafts + submissions)
  ├─ review-store              (검수 결과; admin 이 씀)
  ├─ inquiry-store
  ├─ mail-store
  └─ ledger-store              (entries)

Seeds (load on hydration)
  prototype/data/poc-seeds/
    ├─ tasks.json
    ├─ audits.json             (이미 검수 끝난 과거 audit 몇 개 — ledger 시드용)
    ├─ reviews.json
    ├─ inquiries.json
    ├─ mails.json
    └─ ledger-entries.json
```

> 모든 service 함수는 `Promise<T>` 반환. 백엔드 연결 시 시그니처 동일.

---

## 5. 스키마 (요약)

> 풀 스키마는 `lib/poc-schema.ts` (신규) 에서 zod 로 정의. 여기서는 핵심 필드만.

```ts
type AuditStatus = "draft" | "submitted" | "reviewed" | "finalized";

interface Audit {
  id: string;
  taskId: string;
  conversationId: string;
  auditorId: string;
  pickedAt: number;
  lineFeedbacks: LineFeedback[];         // prototype 2/3 스키마 그대로
  sessionEval?: SessionEval;
  submittedAt?: number;
  status: AuditStatus;
}

interface LedgerEntry {
  id: string;
  auditorId: string;
  kind:
    | "contribution_accepted"
    | "contribution_rejected"
    | "settlement_round"
    | "bonus"
    | "adjustment";
  amount: number;                        // credit (인정/거절 항목도 amount 가짐, 거절은 0)
  sourceRef:
    | { kind: "audit"; auditId: string; acceptedCount: number; rejectedCount: number }
    | { kind: "settlement"; roundId: string; includedAuditIds: string[] }
    | { kind: "manual"; note: string };
  balanceAfter: number;
  timestamp: number;
}

interface Mail {
  id: string;
  recipientId: string;                   // auditorId
  senderId: string;                      // adminId
  kind: "notice" | "inquiry_reply" | "settlement";
  subject: string;
  body: string;
  ref?: { kind: "inquiry"; inquiryId: string } | { kind: "settlement"; roundId: string };
  sentAt: number;
  readAt?: number;
}
```

---

## 6. 단계별 구현 계획 (P0–P5)

> prototype 3 의 `B` 시리즈가 끝났으므로 본 PoC 는 `P` 접두어 사용.

### P0 — 라우트·셸 스캐폴드 + Seed
- `/audit/dashboard`, `/audit/queue`, `/audit/work`, `/audit/results`, `/audit/mailbox`, `/audit/ledger` 빈 페이지 추가.
- 사이드바 IA 재배치 (배지는 0 으로 stub).
- `prototype/data/poc-seeds/*.json` 6개 작성, hydration 훅 추가.
- 인수: 모든 라우트 navigable, 빌드 통과.

### P1 — 작업 큐 + 픽업 + 내 작업
- `services/audit-task` 구현.
- `/audit/queue` 목록 + 상세 + 픽업.
- `/audit/work` 목록 + "이어서 작업" 라우트 wiring.
- 인수: 픽업 → /work 배지 증가 + draft Audit 생성 확인.

### P2 — 감사 워크스페이스 어댑트
- prototype 3 의 3-pane 을 `/audit/work/[auditId]` 로 이전.
- Inspector 에 "제출" 탭 추가.
- `services/audit.submit` → submitted 전환.
- 인수: 제출 → /results 에 즉시 표시.

### P3 — 결과물 + 이의제기
- `services/review` (read-only) + `services/inquiry`.
- `/audit/results` 목록 + 상세.
- 이의제기 인라인 입력 → mail 자동 생성 (admin 쪽 inbox 에 들어가는 동작은 03_admin 에서).
- 인수: finalized 이후 모든 액션 disabled.

### P4 — 우편함 + 기여 통장 + 대시보드
- `services/mail`, `services/ledger`.
- `/audit/mailbox` 목록·상세, 미확인 도트.
- `/audit/ledger` 전체/회차/카테고리 탭, 차트.
- `/audit/dashboard` — 위 모든 selector 를 조합한 카드 + 차트.
- 인수: 시드 hydration 직후 대시보드의 모든 카드 / 차트가 의미 있는 값.

### P5 — 백엔드-readiness 정리
- 모든 store 직접 접근을 service 함수로 일원화 (lint rule 또는 코드 리뷰).
- service 함수 시그니처를 백엔드 컨트랙트와 align (README 에 표로 명시).
- `services/ai-model.ts` skeleton (현재는 prototype 1 의 결정적 재생을 wrapping).
- 인수: 컴포넌트 → store 직접 import 0건, 모든 데이터 접근이 service 경유.

---

## 7. 전체 인수 — 데모 시나리오

1. auditor 로 로그인 (계정 전환기).
2. 대시보드: 미확인 우편 1통, 진행 중 1건, 검수 대기 2건이 카드로 노출.
3. `[픽업 가능 3건]` 카드 클릭 → 작업 큐 → Task-Q14 선택 → 픽업.
4. 자동으로 `/audit/work` 이동 → 신규 Audit-43 클릭 → 3-pane 진입.
5. 문장별 피드백 작성, KB 문서 첨부, 세션 평가, "제출" 탭에서 제출.
6. `/audit/results/Audit-43` 로 이동, 상태 = `submitted` (검수 대기).
7. (admin 셸로 전환해 검수 수행 — 03_admin 참조)
8. 다시 auditor 로 돌아오면 결과물 탭에 ● 도트, 클릭 → 인정 4 / 거절 1 확인.
9. 거절 1건에 대해 이의제기 인라인 작성 → mailbox 에 답변 대기 표시.
10. `[정산 안내 우편]` 수신 → 기여 통장에서 회차 항목 → 잔액 갱신 확인.
11. 새로고침 → 모든 상태 영속 (Zustand persist + seed merge).

---

## 8. 구현 현황

✅ **P0–P5 모두 완료** (커밋 `476a358` + `106be34`).

### 화면별 매핑

| 문서 §3 화면 | 구현 위치 | 상태 |
|---|---|---|
| 3.1 대시보드 (`/audit/dashboard`) | `components/auditor/dashboard-view.tsx` | ✅ — 4 stat 카드 · ledger 요약 · 최근 활동 피드 · 진행 중 audit preview |
| 3.2 작업 큐 (`/audit/queue`) | `components/auditor/queue-table.tsx` | ✅ — 픽업 가능 필터 + 진행도 + 마감 |
| 3.3 작업 큐 상세 (`/audit/queue/[taskId]`) | `components/auditor/queue-detail-view.tsx` | ✅ — 포함 대화 + [픽업하기] |
| 3.4 내 작업 (`/audit/work`) | `components/auditor/work-table.tsx` | ✅ — drafts + [이어서] / [취소] |
| 3.5 감사 워크스페이스 (`/audit/work/[auditId]`) | `components/audit/work/audit-workspace.tsx` (+ work-queue-strip / work-inspector / work-topbar) | ✅ — 3-pane + 제출 탭 (체크리스트 + 커버리지 + 메모) |
| 3.6 결과물 목록 (`/audit/results`) | `components/auditor/results-table.tsx` | ✅ — 미확인 도트 + 인정/거절 + 이의 가능 기간 |
| 3.7 결과물 상세 (`/audit/results/[auditId]`) | `components/auditor/result-detail-view.tsx` | ✅ — 검수 요약 + 문장별 결과 + 이의제기 inline form |
| 3.8 우편함 (`/audit/mailbox`) | `components/auditor/mailbox-view.tsx` | ✅ — 2-pane (목록/상세) + auto markRead + 미확인 도트 |
| 3.9 기여 통장 (`/audit/ledger`) | `components/auditor/ledger-view.tsx` | ✅ — 3 탭 (전체 / 회차별 / 카테고리별) + 헤더 누적 + JSON export |

### 인스펙터 / 워크스페이스 변경점

- "근거" 탭 → **"제출" 탭** 으로 교체 (당초 계획대로).
- `/audit/chat-logs/[id]` 는 **legacy** 로 유지 (사이드바 "참고" 그룹에 표시).
- 작업 워크스페이스의 URL key = `auditId` (계획대로 `conversationId` → `auditId` 이전).

### 백엔드-readiness 점검

- 모든 컴포넌트 → service 경유 (`services/audit-task`, `services/audit`, `services/inquiry`, `services/mail`, `services/ledger`).
- Store mutation 은 컴포넌트 직접 호출 0건 (사이드바 배지 sync 한 곳만 예외 — admin pool 측).
- Service 시그니처 모두 `Promise<T>` — 백엔드 fetch 로 교체 시 내부만 수정.
