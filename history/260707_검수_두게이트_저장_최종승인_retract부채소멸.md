# 검수 두 게이트 — [검수 저장] / [최종 승인] + amend retract 부채 소멸

날짜: 2026-07-07 · 브랜치: `import-credigraph` · 지휘문서: [260702_마스터설계_ABC_워크스트림_분리실행.md](260702_마스터설계_ABC_워크스트림_분리실행.md)

## 한 줄 요약
검수 확정을 **단일 게이트("검수 완료" 1버튼)에서 두 게이트로 분리**했다. 관리자가 승인/반려를 입력한 뒤 **[검수 저장]** 하면 결과가 세무사에게 열리고(이의·문의 가능), 관리자는 결정을 계속 수정할 수 있다. 이래저래 수정된 최종안을 **[최종 승인]** 하면 그때 **딱 한 번** ledger 기여 적립 + RAG 포장실 적재가 일어나고 이후 **불변**이 된다. 이의·수정이 전부 "저장~최종승인" 구간에서 끝나고 포장은 최종승인에서만 일어나므로, **최종승인 후 accept↔reject 뒤집힘이 원천 불가** → 선행 설계의 `amend 자동 retract` 부채가 **필요 자체가 소멸**했다.

## 배경 (뒤집던 문제)
- 구 흐름: "검수 완료"(`review.finalize`) 1버튼이 ① review→finalized ② audit→reviewed ③ ledger 적립 ④ **RAG 적재** ⑤ 7일 이의 window 개시 를 한 번에 수행. 이의는 **확정·적재 이후**에 열렸다.
- 그래서 이의로 `amendDecision`이 accept→reject 를 뒤집으면 **이미 포장된 passage 를 되돌려야(retract)** 했다. "적재가 먼저, 뒤집기가 나중"이 구조적 부채였다.
- 사용자 결정: 이의·수정은 **포장 전(저장 단계)** 에 몰고, 포장은 **최종 승인 단 한 번**. 최종 승인된 것은 못 바꾼다.

## 확정 스펙 (사용자, 2026-07-07)
1. **이의 가능 구간 = "저장~최종승인" 사이** (시간 제한 없음, 관리자가 최종승인할 때까지). 구 7일 dispute window 폐지.
2. **ledger 기여 적립 시점 = [최종 승인]** (저장 아님). RAG passage 가 최종승인에서 생기므로 기여 적립도 같은 게이트 → "기여=RAG존속" 논지 정합.
3. 버튼 라벨 = **[검수 저장]** / **[최종 승인]**.

## 상태머신 (단일 → 두 게이트)
| 게이트 | review.status | audit.status | 세무사 | 관리자 | ledger·RAG |
|---|---|---|---|---|---|
| 검수 중 | `draft` | submitted | 대기 | 결정 입력 | — |
| **[검수 저장]** | `saved` **(신설)** | reviewed | 결과 확인·이의제기·문의 | 결정 **계속 수정 가능** | — |
| **[최종 승인]** | `finalized` | **finalized** | 확정 결과 열람(불변) | **잠김** | **적립 + 포장 적재** |

- 기존 코드 어휘와 정합: 세무사 목록은 이미 audit `reviewed` 를 "확인"으로, `finalized` 를 최종으로 다뤘다(구 flow 는 둘을 동시에 세팅). 이번엔 시간축으로 분리 — `reviewed`=저장(이의 대기), `finalized`=최종. (구 flow 에서 audit `finalized` 상태는 사실상 미사용이었다.)

## 산출물 (프론트만, DB 마이그레이션 불필요)
> `reviews.status` 컬럼은 `text default 'draft'` 로 **CHECK 제약이 없어** `saved` 값 추가에 마이그레이션이 필요 없다. RLS `reviews_auditor_read` 는 상태 불문 본인 audit 의 review 를 읽게 해줘 세무사가 `saved` 를 바로 본다.

- **[lib/poc-schema.ts](../frontend/lib/poc-schema.ts)** — `reviewStatusSchema = z.enum(["draft","saved","finalized"])`.
- **[services/review.ts](../frontend/services/review.ts)** — 구 `finalize` 를 둘로 분리.
  - `save(reviewId)` — draft/saved→saved, audit→reviewed. **ledger·RAG 미접촉.** finalized 는 거부.
  - `finalize(reviewId)` — **saved→finalized 만 허용**(아니면 throw), audit→finalized. **이 게이트에서만** `recordReviewOutcome`(최종 결정 기준) + `ingestAcceptedFeedback`(RAG). finalized 재호출은 멱등.
  - `setDecision`/`amendDecision` — **finalized 면 throw**(불변 강제). `amendDecision` 의 ledger 재계산 제거(최종승인이 최종결정으로 1회 적립하므로 저장 구간 amend 는 decisions 만 갱신 → 적재 전이라 retract 불필요).
  - 구 `DISPUTE_WINDOW_MS`(7일)·`dispute_window_ends_at` 세팅 제거.
- **[components/admin/inspection-workspace.tsx](../frontend/components/admin/inspection-workspace.tsx)** — 푸터 2버튼(`[검수 저장]`→saved 상태에서 `[최종 승인]`). `locked = review.status==="finalized"` 일 때만 편집 잠금(저장 상태에선 결정 chip·전체인정·총평 모두 수정 가능). `useRouter` 제거(상태 갱신으로 자동 리렌더).
- **[components/auditor/result-detail-view.tsx](../frontend/components/auditor/result-detail-view.tsx)** — `saved||finalized` 부터 결과 노출, 이의 가능=`saved`. 상태 배너(저장=amber "이의 가능" / 확정=emerald "잠김"). markSeen 도 saved 부터.
- **[components/auditor/results-table.tsx](../frontend/components/auditor/results-table.tsx)** · **[dashboard-view.tsx](../frontend/components/auditor/dashboard-view.tsx)** · **[lib/sidebar-badges.ts](../frontend/lib/sidebar-badges.ts)** — 인정/거절·미확인 배지를 `saved` 부터 반영. 이의 컬럼: saved="가능"/finalized="종료".
- **[components/admin/inquiries-view.tsx](../frontend/components/admin/inquiries-view.tsx)** — 결정변경(amend) 체크박스를 `saved` 에서만 노출, finalized 면 "변경 불가(답변만)" 안내.
- **[lib/poc-format.ts](../frontend/lib/poc-format.ts)** — audit `reviewed` 라벨 "검수완료"→"검수저장".

## 검증
- **정적**: 프론트 `tsc --noEmit` 0. 신규 lint 회귀 0(잔여 7건은 미변경 baseline 라인 = inspection-workspace 기존 useEffect 2·result-detail-view 기존 `"{segmentText}"`).
- **RAG 포장 경로 HTTP E2E(라이브 Tokyo credigraph + Upstage 실호출)**: 최종승인이 태우는 `POST /api/rag/ingest` 를 재현 — baseline `kbPassages=12` → ingest(헬스장 PT 코멘트, auditorId=auditor) → **13** → 재적재 멱등 **13 유지** → `POST /api/rag/retract`(retired) → active **12 복귀** → 스모크 행 DB 삭제 → **12 pristine**(빈-KB 논지 보존). 워킹트리 외 DB 부작용 없음.
- **미실행**: 브라우저 육안 워크스루(자동 브라우저 도구 부재). 아래 클릭 스크립트로 수동 확인 필요.

## 브라우저 워크스루 스크립트 (수동 — 두 서버 + 브라우저 2컨텍스트)
서버 기동:
- 프론트: `cd frontend && npm run dev` → :3000
- 백엔드: `cd backend && .venv/Scripts/python.exe -m uvicorn api.main:app --port 8787`

데모 계정(비번 demo1234): owner / auditor / auditor2 / admin. 다인원 방은 **별개 브라우저 컨텍스트 2개**.

1. **저장 게이트**: admin 으로 검수실(`/admin/inspection/<auditId>`) 진입 → 문장 코멘트에 인정/거절 입력(전부 결정=보류 0) → **[검수 저장]** 클릭. → 푸터가 "저장됨 · 세무사 확인/이의 대기" + [최종 승인] 으로 바뀌는지. RAG 는 아직 그대로(`/rag/health` count 불변).
2. **세무사 확인·이의**: auditor 로 완료 목록(`/audit/results`) → 해당 건 "확인" 배지(미확인 도트) → 상세에서 amber "이의 가능" 배너 + 거절 문장에 **[이의제기]** → 제출.
3. **관리자 수정**: admin 이 [저장 상태에서] 검수실 재진입 → 결정 chip 을 실제로 수정 가능한지(잠기지 않음) 확인. 이의 화면(`/admin/inquiries`)에서 답변 + "인정으로 변경" 체크(=amend) → decisions 갱신, status 여전히 saved.
4. **최종 승인**: admin 검수실에서 **[최종 승인]** → 푸터 "최종 승인 완료 · 포장실 적재됨". 이 시점 `/rag/health` count +N(accepted 수). 세무사 상세는 emerald "잠김" 배너, 이의 버튼 사라짐.
5. **불변 확인**: finalized 후 검수실 chip 비활성(잠김), 이의 화면 amend 체크박스 미노출("변경 불가").
6. **포장실**: `/admin/packaging` → 해당 대화 passage active 로 실렸는지 → [연결 끊기] → KB 검색/`/rag/health` active 감소.

## ⚠️ 알아둘 한계 (선행 부채 — 이번 변경이 만든 게 아님)
- **line_feedback 은 audit-store→Supabase 이관됨(0007, 260705)** 이라 크로스브라우저 공유 OK. 단 finalize 시 **백엔드 미기동이면 RAG 적재가 조용히 스킵**(`skipped`) — 관리자용 "미적재분 재동기화" 버튼은 여전히 남은 일.
- 저장 상태에서 **새 코멘트가 추가**되면 미결정분이 생겨 [최종 승인] 이 잠김(보류>0). 최종승인 시 미결정분은 **기본 인정**(구 flow 와 동일 편의값).

## 남은 일 (다음 세션)
1. **정산 존속연동 완결(1순위, unblocked)**: `settlement.preview()` 분배 기준을 `rag.passages status='active'` 의 auditor_id 기여도로 교체. (이번 두 게이트로 "확정=적재" 시점이 명확해져 더 깔끔히 얹힘.)
2. finalize 시 백엔드 미기동 대비 **재동기화 버튼**(미적재분 수동 재적재).
3. 브라우저 워크스루 육안 확인(위 스크립트).
4. 데모 전 `freeze_ms` 300000(5분) 복원 결정.
5. Seam C 배포(7/31 본선).

## 참고 메모리
- [[project_operational_flow]] (검사실 두 게이트 반영) · [[project_shared_audit_board]] · [[project_rag_product_thesis]] · [[project_snapshot_pool]] · [[reference_upstage_api]]
