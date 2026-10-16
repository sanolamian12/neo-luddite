# E2E

## 프로토타입 탐색·가르치기 회귀

`agent-navigation.spec.ts`는 브라우저 로컬 데이터만 사용합니다. 운영 빌드를 실행한 뒤 아래처럼 이 파일만 지정합니다. 가르치기 방법 전환, 작성 중인 상담과 수동 사례 복원, 검색 뒤로/앞으로 가기, 개인 지식에서 공유 제안으로 이동·자동 저장·원래 사례 복귀를 확인합니다.

```sh
E2E_BASE_URL=http://localhost:3024 npx playwright test e2e/agent-navigation.spec.ts
```

## sync 회복력 (실 DB 읽기만)

`sync-retry.spec.ts` 는 관리자 상담 신청 화면(`/admin/consultations`)에서 `consultation_requests`
적재를 끊거나 매달아 놓고 화면이 '불러오는 중'에 갇히지 않는지, 탭 복귀 때 다시 당기는지 본다.
admin 계정(demo1234)으로 실 DB 에 로그인하지만 **읽기만** 한다. 복귀 테스트는 상담 신청이 1건
이상 있어야 통과한다.

```bash
cd frontend && npx next dev -p 3012 &        # ⚠ localhost 로 접속(127.0.0.1 은 HMR 이 끊긴다)
E2E_BASE_URL=http://localhost:3012 npx playwright test e2e/sync-retry.spec.ts
```

옛 정성 평가 검수 스펙(`session-eval-review.spec.ts`)과 원복 스크립트는 옛 검수 흐름 절단
S0·S2(10/16)에서 지웠다.

## Live/prototype integration regressions (S0–S1)

`entry-response.spec.ts` and `live-agent-integration.spec.ts` exercise real UI routes,
stores and services while intercepting HTTP calls to a local test API. They require
no production credentials and do not call an LLM or change production records.
Use a separate build from the prototype tests:

```bash
NEXT_PUBLIC_DATA_MODE=live NEXT_PUBLIC_API_BASE=http://localhost:8799 \
  NEXT_PUBLIC_SUPABASE_URL=http://localhost:8799 \
  NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon-key npm run build
npx next start --port 3026
# In another terminal:
E2E_BASE_URL=http://localhost:3026 npx playwright test \
  e2e/entry-response.spec.ts e2e/live-agent-integration.spec.ts
```

Coverage: source anchors/cards, absent optional metadata, reload, guest login
continuation, owner persistence/retry without an AI handoff, server agent saving,
room-agent selection, failed teaching save/recovery, KB3 publication/sharing,
AI preview transport, and hidden prototype-only routes. The existing
`agent-navigation.spec.ts` runs separately against a prototype production build.
These tests do not verify backend authorization, database migrations or model quality.
