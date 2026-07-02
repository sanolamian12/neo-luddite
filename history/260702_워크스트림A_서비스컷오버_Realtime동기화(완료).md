# 워크스트림 A — services/*.ts 전면 컷오버 + 스토어 Realtime 동기화

날짜: 2026-07-02 · 브랜치: `import-credigraph` · 선행: [260702_워크스트림A_Supabase_라이브적용_마이그레이션_시드(완료).md](<260702_워크스트림A_Supabase_라이브적용_마이그레이션_시드(완료).md>)

## 한 줄 요약
프론트 데이터 계층(서비스 10개 + 스토어 10개)을 Zustand+localStorage 목업에서 **Supabase(Postgres) 원천 + Realtime 동기화**로 전면 컷오버. UI 컴포넌트 무손상, tsc 통과. "두 브라우저 동기화" 완료정의는 라이브 로그인 검증만 남음.

## 왜 "서비스 내부만 교체"로는 부족했나 (핵심 발견)
컴포넌트는 `useXStore((s)=>s.items)` 로 **Zustand 를 반응형 구독**해서 렌더링하고, 쓰기만 서비스로 한다. 서비스 내부만 Supabase 로 바꾸면 쓰기는 DB 로 가도 스토어가 안 바뀌어 **화면이 갱신 안 됨**. 그래서 스토어를 **DB fetch + Realtime 구독 캐시**로 만드는 레이어가 필수. (이전 세션 문서가 라이브 없이 검증 못 해 놓쳤던 부분.)

## 아키텍처 (UI 32개 파일 무손상)
- **스토어** = Supabase 테이블의 Realtime 캐시. 최초 1회 전체 fetch → `postgres_changes` 구독. 컴포넌트는 계속 `useXStore`/`useXHydrated` 만 사용.
- **서비스 쓰기** = Supabase write + 낙관적 스토어 갱신(Realtime echo 는 멱등이라 이중적용 안전).
- **서비스 읽기** = Realtime 동기화된 스토어 캐시에서 필터/정렬(로직 불변).
- **읽기-수정-쓰기**(jsonb/배열: pickups·messages·decisions·balance 등) = 최신 행을 DB 에서 fresh fetch 후 수정(스테일 캐시 경합 방지).

## 산출물
| 파일 | 내용 |
|---|---|
| `frontend/lib/supabase/sync.ts` (신규) | `fetchAll` + `subscribe`(Realtime) + `makeCollectionSync` 공용 헬퍼 |
| `frontend/lib/*-store.ts` ×10 | persist/JSON seed 제거 → `hydrated` + `startSync`(DB+Realtime). row↔domain 매퍼·`{X}Row` 타입 export. `useXStore`/`useXHydrated` 이름 보존 |
| `frontend/services/*.ts` ×10 | 쓰기 = Supabase + 낙관적 갱신. 시그니처 전부 불변 |
| `frontend/components/admin/pool-table.tsx` | 유일한 컴포넌트 직접 mutation(`_patchByConversationId`) → `poolService.markAssigned`(DB) 로 교체 |
| `supabase/migrations/0003_realtime_all_domains.sql` (신규·적용됨) | publication 을 6테이블 확장(pool_candidates·auditors·ledger_entries·settlement_rounds·training_batches·model_versions) → 11테이블 전부 실시간 |

기준(pool·audit-task·audit)은 직접 구현, 나머지 7개 도메인은 동일 패턴으로 병렬 서브에이전트가 교체.

## 매핑 규칙 (스키마 설계와 정합)
- **text PK** 보존 · **bigint 시각** → `Number()` 왕복 · **jsonb** = zod 하위 오브젝트 그대로 통과(camelCase 보존) · **text[]** 통과 · nullable → `?? undefined`.

## 교차 도메인 처리
- `audit-task.pickup/releasePickup` 은 audit_tasks + audits 두 테이블에 DB write(둘 다 반영).
- `review.finalize` 의 `audit.status='reviewed'` 는 로컬만 갱신하던 것을 **audits 테이블 DB update 로 수정**(안 그러면 Realtime 에 덮임). ← 통합 단계 버그 수정.
- 그 외 서비스 간 협력은 서비스 함수 호출 유지(inquiry→mail/review, settlement/review→ledger).

## RLS 정합성 (0002 대조)
- auditor: audit_tasks 픽업 UPDATE·audits 소유 CRUD·inquiry 생성·review 확인표시 — 정책 허용 ✅
- admin: task/review/settlement/pipeline/ledger/mail 쓰기 — 허용 ✅
- ledger 는 admin 만 쓰는데 호출자(review.finalize·settlement.publish)가 전부 admin 컨텍스트라 정합 ✅

## 검증 상태
- `tsc --noEmit` **통과**(services 10 + stores 10 + 헬퍼 + 컴포넌트).
- 스키마/RLS/Realtime publication **정적 대조 완료**.
- ⚠️ **런타임 미검증**: 실제 브라우저 2개 로그인으로 완료정의(일감 이관·검수결과 상호 반영) 확인 필요. 주의 지점: ledger `_removeBySource` 의 jsonb 화살표 필터(`source_ref->>kind`), 최초 로드 시 10개 테이블 fetch+구독 부하(데모 규모엔 무영향).

## 남은 일
1. **완료정의 런타임 검증**: `npm run dev` → owner/auditor/admin(`demo1234`) 두 창 로그인 → admin이 task 생성 → auditor 픽업·제출 → admin 검수 → 상호 실시간 반영 확인.
2. **범위 밖(후속)**: line_feedback·session_evaluations(audit-store), kb_documents(kb-store) 는 A 서비스 10개에 없어 미컷오버. 리뷰 플로우 전체 동기화하려면 후속 마이그레이션 필요.
3. 데모 시드가 pool 2·auditor 1 뿐 → task/audit/ledger 등은 빈 상태로 시작(UI 흐름으로 생성). 풍부한 데모 원하면 JSON seed 를 seed.sql 로 이식.
</content>
