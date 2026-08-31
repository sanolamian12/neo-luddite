# 07-16~21 미확정 검수 데이터 정리 — 논문 데이터 오인 정정 후 실제 대상 삭제

날짜: 2026-08-31
브랜치: `import-credigraph`
계기: admin 계정으로 "완료" 사이드 메뉴를 보던 중, 2026-07-16~21 사이 auditor·auditor2·auditor3
세 계정이 제출했지만 검수확정/인정·거절이 안 들어간 항목들이 다수 보임 → 사용자는 이게
ICTC 2026 논문 실험 때 쌓인 데이터로 기억하고 있었음

---

## 1. 1차 조사 — "논문 데이터"라는 가설은 틀렸다

에이전트를 동원해 스키마·history 문서·git log를 훑은 결과, 처음엔 다음 정황 때문에
논문 데이터라는 가설이 그럴듯해 보였다:
- `history/260718_정성평가_검수배선_분리_RAG적재_E2E자동화.md`가 07-18 시점에
  "session_evaluations 193건, finalized 0건"을 이미 기록해 둠
- 같은 주간에 RAG on/off A/B 성능평가 리포트(`260719_*`, `260720_*`)가 연속 생성됨
- 07-29 커밋 `87927ad "docs(paper): ICTC 2026 논문 실험 기록"`이 이 시기 리포트를 묶어 커밋

하지만 **`docs/academic paper/db_backup_260806/README.md`**(2026-08-06, 이전 세션이 이미
동일한 질문을 조사해 남긴 결론)를 발견하면서 뒤집혔다:

> "07-10~07-21의 등록·코멘트·승인은 제품 개발 작업(100건 일괄감사, RAG 성능검증)이다."
> "07-21 시점 미확정 항목은 검수 대기 상태로 남아 있을 뿐이라 그대로 두었다."

논문이 DB에 남긴 흔적은 `rag.passages` 168건의 07-27 상태변경(KB 오염 방지용) **하나뿐**이며
그마저도 이미 그때 복구까지 끝나 있었다. `history/260718` 문서를 다시 읽어보니, 미확정
데이터의 정체는 논문용이 아니라 **당시 실제 제품 버그**였다 — `session_evaluations`에
admin 쓰기 RLS 권한이 없어 관리자가 결정을 내려도 "0행 갱신"으로 조용히 실패하던 문제를
고치려고 마이그레이션 `0015_session_eval_review.sql`을 만들었던 것.

**교훈**: "논문 때 쌓인 데이터"라는 기억은 틀렸고, 실제로는 세무사들이 실작업으로 남긴
검수 대기열이었다. 도메인 지식(기억)보다 히스토리 문서·DB 실측이 우선한다.

---

## 2. auditor/auditor2/auditor3 세 계정의 실제 동원 목적

세 계정은 논문도 UI 테스트도 아니라, 하나의 목적 — "100건 일괄감사로 `rag.passages`를
채우고 반복 오류 패턴을 카탈로그화" — 으로 계속 동원된 실제 제품개발 작업자였다.

- **07/11~12**: 100개 대화 검수 → 07/14 최종승인 → `rag.passages` 362건 적재(성공 사례)
- **07/11**: session_evaluations(세션 총평)는 이때까지 RAG 유입 경로 자체가 없었음(사각지대)
- **07/18**: 마이그레이션 0015로 사각지대를 메움(admin 결정 + 두 게이트 + RAG 유입 경로 개통)
- **07/16~21**: 같은 3계정이 같은 `live-clinic-*` 배치(하차장 스냅샷 픽업)를 두 번째
  라운드로 검수·세션평가 작성 — RAG 개선(임계값·자문경로) 이후 재검증 겸 실작업

---

## 3. 1차 삭제 — session_evaluations 확정분 39건 (RAG 사본 확인 후)

DB 실측(07-16~22 창):

| 테이블 | auditor | auditor2 | auditor3 | 합계 |
|---|---|---|---|---|
| `session_evaluations` | 36(27fin+9pend) | 10(전부fin) | 8(2fin+6pend) | 54(39 finalized/15 pending) |

논리: `finalized`된 39건은 `rag.passages`에 `source_kind='session_eval'`로 **독립 사본**이
이미 적재돼 있다(참조가 아니라 텍스트 복사). 원본을 지워도 RAG 지식은 소실되지 않는다.

**조치** (`purge_finalized_session_evals.py`, 스크래치패드):
1. 대상 39건(전부 auditor+auditor2+auditor3, decision=accepted) 조회
2. JSON 백업(`finalized_session_evals_backup_260716_260721.json`)
3. `ledger_entries` 연결 확인(정보용, 39건 — 삭제 대상 아님)
4. `rag.passages` 사본 재확인 — 39건 전부 `dedupe_key='session_eval:<id>'`로 매칭, 전부 `active`
5. 안전 확인된 39건만 삭제, rowcount 검증 후 커밋

**결과**: `session_evaluations` 39건 삭제, `rag.passages` 수치 불변(session_eval active 120건
유지) — RAG 손실 없음 확인.

### 삽질: 잘못된 테이블을 지운 뒤 다시 확인

삭제 후 사용자가 auditor로 재로그인해 확인했지만 "완료" 화면이 그대로였다. 원인 조사 결과,
**"완료"(`/audit/results`, `results-table.tsx`) 화면은 애초에 `session_evaluations`가 아니라
`audits`+`reviews`+`line_feedback`을 보여주는 화면**이었다 — 정성평가(세션 총평)는 완전히
별개의 "배선실(정성평가)" 탭용이다. 즉 1차 삭제는 안전했지만(RAG 손실 없음), 사용자가
실제로 보고 있던 문제와는 **애초에 무관한 테이블**이었다.

---

## 4. 2차 삭제 — 검수실(문장단위) '제출됨'(submitted) audits 52건

정정된 타깃으로 재조사:

| 검수자 | 상태 | 리뷰 상태 | 건수 |
|---|---|---|---|
| auditor | submitted | draft | 12 |
| auditor | submitted | 리뷰 없음 | 24 |
| auditor2 | submitted | 리뷰 없음 | 10 |
| auditor3 | reviewed | saved(이의가능) | 2 (삭제 대상 제외) |
| auditor3 | submitted | draft | 4 |
| auditor3 | submitted | 리뷰 없음 | 2 |

사용자 지시: "검수실(문장단위)에서 '제출됨'으로 표시된 데이터를 지워서 admin·auditor
양쪽에서 다 안 보이게" → `status='submitted'` 인 것만 대상(`reviewed` 2건은 한 단계 더
진행된 상태라 범위 밖으로 제외).

**사전 안전 확인**:
- `line_feedback.audit_id`는 전체 567건이 전부 NULL(설계상 `conversation_id`+`auditor_id`로만
  연결) → 대상 audits의 (auditor_id, conversation_id) 쌍으로 매칭
- 이 쌍이 대상 밖 다른 audit과 겹치는 경우 0건 확인(교차 삭제 위험 없음)
- 대상 대화들에 `rag.passages`(source_kind='feedback', status='active') 0건 — RAG 미반영 확정
- `reviews` 16건 전부 `draft` 확인(non-draft 섞이면 스크립트가 자동 중단하도록 가드)

**조치** (`purge_submitted_audits.py`, 스크래치패드):
1. 대상 audits 52건 / reviews 16건(draft) / line_feedback 186건((auditor,conv) 쌍 매칭) 조회
2. RAG 영향 재확인(0건이 아니면 자동 중단)
3. JSON 백업(`submitted_audits_backup_260716_260721.json`)
4. `line_feedback` → `reviews` → `audits` 순으로 삭제, 단계별 rowcount 검증

**결과**: audits 52건 · reviews 16건 · line_feedback 186건 삭제 완료, 커밋. 검증 쿼리로
07-16~22 구간에 `auditor3`의 `reviewed` 2건만 남았음을 확인. `rag.passages` 수치는
삭제 전후 동일(feedback active 287, session_eval active 120 등) — RAG 손실 없음.

---

## 5. 남은 일

- auditor3의 `reviewed`(검수저장, 이의가능) 2건은 이번 삭제 범위에서 의도적으로 제외했음.
  삭제할지는 별도 확인 필요.
- 두 백업 JSON은 스크래치패드에만 있고 저장소에는 커밋되지 않음(임시 안전망 용도).

## 6. 파일

**임시 스크립트 (스크래치패드, 저장소 비커밋)**
```
purge_finalized_session_evals.py   # session_evaluations 확정 39건 백업+삭제
purge_submitted_audits.py          # audits(submitted) 52건 + 연쇄 백업+삭제
verify_after_purge.py              # 삭제 후 검증 쿼리
finalized_session_evals_backup_260716_260721.json
submitted_audits_backup_260716_260721.json
```

**참고한 기존 문서**
```
docs/academic paper/db_backup_260806/README.md   # 논문 데이터 아님을 먼저 밝힌 선행 조사
history/260718_정성평가_검수배선_분리_RAG적재_E2E자동화.md   # 미확정 데이터의 진짜 원인(RLS 버그)
supabase/apply_migration.py                       # db_url() 접속 헬퍼 재사용
supabase/reset_session_eval_review.py             # 삭제 스크립트 구조 템플릿
```

> ⚠ 이번 조치는 프로덕션 Supabase에 직접 `DELETE`를 실행한 것이다. 두 스크립트 모두
> 삭제 전 RAG 반영 여부를 재확인하고 JSON 백업을 남긴 뒤에만 삭제하도록 가드했으나,
> 향후 유사 작업 시 이 문서의 "안전 확인 절차"(RAG 매칭 재확인 → 백업 → rowcount 검증
> → 커밋)를 그대로 재사용할 것.
