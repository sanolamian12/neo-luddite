# 워크스트림 A — Supabase 스키마·인증·RLS 구현 (Seam B 영속)

날짜: 2026-07-02 · 브랜치: `import-credigraph` · 근거: [260702_마스터설계_ABC_워크스트림_분리실행.md](260702_마스터설계_ABC_워크스트림_분리실행.md) §1~3 + §4(A)

## 한 줄 요약
Zustand + localStorage 목업에만 있던 플랫폼 상태(Seam B)를 Supabase Postgres 로 이관하기 위한 **스키마·인증·RLS 전 계층을 코드로 완성**. 라이브 프로젝트 생성 + 서비스 컷오버만 남음(크리덴셜 필요 — C 의 프로젝트 생성 선행).

## 산출물 (이번 세션)
| 파일 | 내용 |
|---|---|
| `supabase/migrations/0001_public_schema.sql` | `public.*` 15개 테이블 (profiles·auditors·pool_candidates·audit_tasks·audits·line_feedback·session_evaluations·reviews·inquiries·ledger_entries·settlement_rounds·training_batches·model_versions·mail·kb_documents) |
| `supabase/migrations/0002_auth_rls.sql` | app_role enum(user/auditor/admin)·역할 헬퍼·신규가입 트리거·전 테이블 RLS 정책·Realtime publication |
| `supabase/seed.sql` | 데모 3계정(owner/auditor/admin, pw `demo1234`) + 샘플 풀 후보 |
| `supabase/config.toml` | Supabase CLI 로컬 설정 (seed 연결) |
| `frontend/lib/supabase/client.ts` | 브라우저 클라이언트(anon+RLS) 지연 초기화 싱글턴 |
| `frontend/.env.example` | `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY`, `NEXT_PUBLIC_API_BASE` (§3-2) |
| `backend/.env.example` (추가) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ORIGINS` (§3-2) |
| `frontend/package.json` | `@supabase/supabase-js` 추가·설치 완료 |

## 핵심 설계 결정 (§3-3 "시그니처 불변" 을 위한 것)
1. **text PK**: 앱이 만드는 문자열 id(`task-…`, `audit-…`, `conv-…`)를 그대로 PK 로. UUID 재발급 안 함 → 프론트 반환 객체 id 불변.
2. **epoch-ms bigint**: 모든 시각 필드(`*_at`·`deadline`·`timestamp`)를 `timestamptz` 가 아니라 `bigint` 로. services 가 `Date.now()` 숫자를 주고받으므로 왕복 무손실.
3. **jsonb = zod 하위 오브젝트**: `pickups`·`conditions`·`progress`·`scores`·`decisions`·`messages`·`source_ref`·`ref`·`allocations`·`semver`·`metrics`·`pr_meta` 등을 jsonb 로 1:1 저장 → 반환 형태가 Zustand 시절과 바이트 동일, 컷오버 리스크 최소. (트레이드오프: 배열 내부 SQL 쿼리는 불편 — 현 워크로드엔 무영향.)
4. **인증 임피던스 흡수**: `auth.uid()`(uuid) ↔ 도메인 텍스트 id 를 `profiles.domain_id` 로 매핑. RLS 는 `current_domain_id()` 로 `audits.auditor_id` 등과 조인.
5. **역할 매핑**: viewer(사장님)→`user`, auditor(평가자/세무사)→`auditor`, admin(운영자)→`admin`.

## RLS 요지
- 헬퍼 `current_role()`·`current_domain_id()`·`is_admin()` = `SECURITY DEFINER`(profiles 재귀 회피).
- 소유 기반: audits/line_feedback/session_evaluations/inquiries/ledger = 본인(domain_id) 것만, admin 은 전체.
- 열람 개방: audit_tasks/settlement_rounds/kb_documents/auditors = 인증자 read, admin write.
- mail = 발신·수신 당사자만. reviews = admin 전체 + auditor 는 본인 audit 리뷰 열람/확인표시.
- **Realtime**: `audit_tasks·audits·reviews·inquiries·mail` publication 등록 → 두 브라우저 실시간 반영(완료정의).

## 제외 범위 (의도적)
- `replay-store` = 런타임 UI 전용 → 영속 안 함.
- `uploaded-conversation-store`(Conversation 코퍼스) = Seam A/불변 데이터 성격 → A 범위 밖, 필요 시 후속 마이그레이션.

## 남은 일 (라이브 프로젝트 필요 — 비대화형 세션에서 불가)
1. **Supabase 프로젝트 생성**(Seoul ap-northeast-2) — §7 의존관계상 C 선행. 생성 후 `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY`, 백엔드 `SUPABASE_URL/SERVICE_ROLE_KEY` 채우기.
2. **마이그레이션 적용**: `supabase db push`(클라우드) 또는 `supabase db reset`(로컬, seed 포함).
3. **services/*.ts 컷오버**: 아래 pool.ts 템플릿대로 10개 서비스 내부를 Zustand→Supabase 로 교체(시그니처 불변). ⚠️ 부분 교체는 앱을 깨뜨림(서비스 간 상호 호출) → **전량 한 번에** 교체 후 검증 권장. 현재 앱은 localStorage 로 동작 중이라 이번 세션에선 미교체(데모 무손상 유지).
4. **완료정의 검증**: 두 브라우저(관리자/세무사)에서 일감 이관·검수결과가 상호 반영 + 역할별 접근 제어 동작.

## 서비스 컷오버 템플릿 (pool.ts — 나머지 9개 동형 반복)

**변경 규칙:** export 함수 시그니처(`Promise<T>`) 는 그대로. 내부 `useXStore.getState()` 호출만 `getSupabase()` 쿼리로 치환. camelCase(TS) ↔ snake_case(DB) 매핑 함수를 서비스 상단에 둠.

```ts
"use client";
import { getSupabase } from "@/lib/supabase/client";
import type { PoolCandidate, PoolStatus } from "@/lib/poc-schema";

// DB row(snake) → 도메인(camel). jsonb/text[] 는 그대로 통과.
function rowToCandidate(r: any): PoolCandidate {
  return {
    conversationId: r.conversation_id,
    occupation: r.occupation,
    topic: r.topic ?? undefined,
    turnCount: r.turn_count,
    firstUserMessage: r.first_user_message ?? undefined,
    assistantTokenEstimate: r.assistant_token_estimate ?? undefined,
    addedAt: r.added_at,
    status: r.status,
    excludedReason: r.excluded_reason ?? undefined,
  };
}

export async function add(input: PoolAddInput): Promise<PoolCandidate> {
  const sb = getSupabase();
  // upsert: conversation_id 충돌 시 metadata 갱신(기존 add 의 idempotent 동작 보존)
  const { data, error } = await sb
    .from("pool_candidates")
    .upsert(
      {
        conversation_id: input.conversationId,
        occupation: input.occupation,
        topic: input.topic,
        turn_count: input.turnCount,
        first_user_message: input.firstUserMessage,
        assistant_token_estimate: input.assistantTokenEstimate,
        added_at: Date.now(),
        status: "new",
      },
      { onConflict: "conversation_id", ignoreDuplicates: false },
    )
    .select()
    .single();
  if (error) throw error;
  return rowToCandidate(data);
}

export async function listCandidates(filter?: PoolFilter): Promise<PoolListResult> {
  const sb = getSupabase();
  let q = sb.from("pool_candidates").select("*").order("added_at", { ascending: false });
  if (filter?.occupation) q = q.eq("occupation", filter.occupation);
  if (filter?.status) q = q.eq("status", filter.status);
  const { data, error } = await q;
  if (error) throw error;
  let items = (data ?? []).map(rowToCandidate);
  if (filter?.q) {
    const s = filter.q.toLowerCase();
    items = items.filter(
      (c) =>
        c.conversationId.toLowerCase().includes(s) ||
        c.topic?.toLowerCase().includes(s) ||
        c.firstUserMessage?.toLowerCase().includes(s),
    );
  }
  return { items, total: items.length };
}
// exclude / get / markAssigned / summary 도 동일 패턴(update().eq / select().eq / in()).
```

**jsonb 읽기-수정-쓰기 주의(audit-task pickup, audit progress 등):** 배열/오브젝트 필드는
select → 로컬 수정 → update 로 되쓰기. 동시성이 중요하면 Postgres 함수(RPC)로 원자화 가능(현 PoC 수준엔 불필요).

## 미결/결정 필요 (마스터 §4-A)
- RLS 세분화 수준: 현재 **역할 기반 + 소유 기반** 중간 수준으로 확정. 더 세밀히(예: task별 픽업자 제한) 필요 시 정책 추가.
- Realtime 대상: 5개 테이블로 시작. 대시보드 배지 실시간성 요구 시 확대.
- kb_documents 를 A 범위로 포함(피드백이 참조) — 확정.
