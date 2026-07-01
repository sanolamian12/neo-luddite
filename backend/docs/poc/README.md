# CrediGraph PoC — 문서 색인

prototype 3 까지의 산출물(viewer / auditor 계정, 3-pane 감사 워크스페이스, KB) 위에서
**작동하는 PoC** 로 끌어올린 작업의 설계 + 구현 기록.

구조적 영감은 `docs/네오 러다이트 - CrediGraph Hub 구상안_260624_정중은.pdf` 의 워크플로 / 역할 분리 / 기여 통장 개념에서 빌려옴.
도메인은 **세무 AI 챗봇 + 휴먼 평가 루프** (PDF 의 세무사 데이터셋 발송 도메인은 차용 X).

---

## 진행 현황

| Phase | 주제 | 상태 |
|---|---|---|
| **P0** | 3-role 셸 + 라우트 스캐폴드 | ✅ 완료 (커밋 `476a358`) |
| **P1** | 작업 큐 + 픽업 + 후보 풀 자동 적재 | ✅ 완료 (커밋 `476a358`) |
| **P2** | 3-pane 워크스페이스 + 제출 탭 | ✅ 완료 (커밋 `476a358`) |
| **P3** | 검수 + 결과물 + 이의제기 + ledger | ✅ 완료 (커밋 `476a358`) |
| **P4** | 우편함 + 기여 통장 + 대시보드 + 정산 회차 | ✅ 완료 (커밋 `106be34`) |
| **P5** | 모델 파이프라인 (Batch → PR → Version → Rollback) | ✅ 완료 (커밋 `106be34`) |
| **P6** | 평가자 관리 (registry · 다중 평가자 시뮬) | ✅ 완료 |
| **Auth** | 세션 / 로그인 / RoleGuard | ✅ 완료 (별도 트랙) |

---

## 문서

| 문서 | 내용 |
|---|---|
| [00_concept.md](00_concept.md) | 3-role 개념 모델 · 전체 lifecycle · 엔터티 · 범위 · backend-readiness · 구현 현황 |
| [01_consumer.md](01_consumer.md) | Consumer 측 변경점 (감사 후보 풀 hook · AI service 래핑) · 구현 현황 |
| [02_auditor.md](02_auditor.md) | Auditor 셸 전 화면 (대시보드 · 작업 큐 · 결과물 · 우편함 · 기여 통장) · 구현 현황 |
| [03_admin.md](03_admin.md) | Admin 셸 전 화면 (상황실 · 후보 풀 · Task · 검수 · 정산 · 모델 · 평가자) · 구현 현황 |
| [04_pipeline.md](04_pipeline.md) | Training Batch → Model PR → Version / Rollback mock · 구현 현황 |
| [05_auth.md](05_auth.md) | 세션 모델 · 로그인 / 로그아웃 · RoleGuard · 데모 자격 증명 |

---

## 실제 구현된 파일 (요약)

### 스키마 / 모델
```
prototype/lib/poc-schema.ts          # Pool, AuditTask, Audit, Review, Inquiry,
                                     # LedgerEntry, Mail, SettlementRound,
                                     # TrainingBatch, ModelVersion, AuditorEntry
prototype/lib/account-schema.ts      # viewer/auditor/admin 계정 + 데모 credentials
```

### 스토어 (Zustand persist)
```
prototype/lib/account-store.ts             # session + 3 계정
prototype/lib/pool-store.ts                # 감사 후보 풀
prototype/lib/audit-task-store.ts          # Task
prototype/lib/audit-work-store.ts          # Audit (metadata)
prototype/lib/review-store.ts              # 검수 결과
prototype/lib/inquiry-store.ts             # 이의제기
prototype/lib/ledger-store.ts              # 기여 통장
prototype/lib/mail-store.ts                # 우편
prototype/lib/settlement-store.ts          # 정산 회차
prototype/lib/pipeline-store.ts            # Batch + ModelVersion
prototype/lib/auditor-registry-store.ts    # 평가자 registry (multi-auditor)
prototype/lib/audit-store.ts               # (prototype 2) 라인 피드백 + 세션 평가
prototype/lib/sidebar-badges.ts            # 사이드바 배지 집계
```

### 서비스 계층 (모두 `Promise<T>`)
```
prototype/services/pool.ts            # add · listCandidates · exclude · summary
prototype/services/audit-task.ts      # create · pickup · listOpenTasks · forceClose
prototype/services/audit.ts           # listMine · submit · patchProgress
prototype/services/review.ts          # startOrGet · setDecision · finalize · amendDecision
prototype/services/inquiry.ts         # create · reply (+ amend) · resolve
prototype/services/ledger.ts          # recordReviewOutcome · summary · listEntries
prototype/services/mail.ts            # send · listInbox · markRead
prototype/services/settlement.ts      # previewRound · publishRound · list
prototype/services/pipeline.ts        # listEligible · createBatch · submitBatch
                                      # markMerged · promoteVersion · rollback
prototype/services/auditor.ts         # list · create · suspend · stats · listWithStats
```

### 시드 (`prototype/data/poc-seeds/`)
```
pool.json                  # 3개 후보 (clinic-vehicle/golf/gym)
audit-tasks.json           # 2개 Task
auditors.json              # 3명 평가자
auditor-history.json       # 과거 audit 3건 + ledger 5건
```

> 모든 시드는 store hydration 시 timestamp 자동 보정 (과거 60일+ 이면 최근으로 anchor 이동) — 데모 가독성 보장.

### 라우트

**Consumer (`viewer` 세션)**
```
/chat/[occupation]                  # 챗 (prototype 1)
/select                             # 업종 변경 (prototype 1)
```

**Auditor (`auditor` 세션)**
```
/audit                              → /audit/dashboard
/audit/dashboard                    # 활동 stat 카드 + ledger 요약 + 최근 활동
/audit/queue, /queue/[taskId]       # 작업 큐 + 픽업
/audit/work, /work/[auditId]        # 내 작업 + 3-pane 워크스페이스
/audit/results, /results/[auditId]  # 결과물 + 이의제기
/audit/mailbox, /mailbox/[mailId]   # 우편함
/audit/ledger                       # 기여 통장 (3 탭: 전체/회차별/카테고리별)
/audit/chat-logs (legacy)           # prototype 3 호환
/audit/knowledge (prototype 3)      # KB
```

**Admin (`admin` 세션)**
```
/admin                              → /admin/dashboard
/admin/dashboard                    # 5-stage 흐름 + 알림 + 이벤트
/admin/pool, /pool/[conversationId] # 후보 풀
/admin/tasks, /tasks/[id], /tasks/new
/admin/inspection, /inspection/[auditId]   # 3-pane 검수
/admin/inquiries                    # 이의제기 (답변 + amend)
/admin/auditors, /auditors/[id], /auditors/new    # 평가자 관리 (P6)
/admin/settlement, /settlement/new  # 정산 회차
/admin/mail, /mail/new              # 발송함
/admin/pipeline                     # 파이프라인 대시보드
/admin/pipeline/batches[/new|/[id]] # Training Batch
/admin/pipeline/versions[/[id]]     # ModelVersion
```

---

## 전체 lifecycle 데모 시나리오

```
1. Consumer 가 /chat/clinic 에서 1턴 진행
   → 후보 풀 자동 적재 (registry key 사용)

2. Admin 이 /admin/pool 에서 후보 → [일괄 Task 등록]
   → /admin/tasks/new 폼 → 게시

3. Auditor /audit/queue 에 즉시 등장 → [픽업하기]
   → Audit (draft) 자동 생성 → /audit/work 로 이동

4. /audit/work/[auditId] 진입 (3-pane)
   → 전사 segment 클릭 → 라인 피드백 작성
   → 세션 평가 작성 → 제출 탭 → [제출하기]

5. Admin /admin/inspection 에 즉시 노출
   → 검수 화면에서 인정/거절 토글 → [검수 완료]
   → audit `submitted → reviewed`, ledger entry 자동 (+10 cr per accept)

6. Auditor /audit/results 에 ● 알림 표시 → 결과 확인
   → 거절된 피드백에 [이의제기] inline form

7. Admin /admin/inquiries 에 ● 알림 → 답변 + [amend(인정으로 변경)]
   → ledger 재계산, mail 자동 발송

8. Auditor /audit/mailbox 에 새 우편 → 읽음 처리

9. Admin /admin/settlement/new → 회차 게시
   → 평가자별 credit 분배 + 정산 안내 우편 자동

10. Admin /admin/pipeline 에 인정 피드백 1+ 표시
    → /admin/pipeline/batches/new → Batch 생성
    → submit → in_pipeline + mock PR
    → mark merged → ModelVersion candidate (semver 자동 증가, 가짜 metrics)
    → deploy → production
    → 필요 시 rollback (사유 입력) → 자동 superseded 복귀

11. Admin /admin/auditors 에서 다중 평가자 + 통계 확인
    → 신규 등록 / 정지 / 복구 / 메모

12. 새로고침 후 모든 상태 영속, 콘솔 에러 없음
```

---

## 관계
- prototype 3 의 KB 는 auditor 셸의 `/audit/knowledge` 로 유지.
- prototype 3 의 라인 피드백 / 세션 평가 스토어 (`audit-store-v1`) 는 그대로 재사용 (conversationId 키).
- 신규: `admin` 계정 / 셸 / 라우트, P0–P6 모든 스토어/서비스/UI, 세션 + 로그인.
