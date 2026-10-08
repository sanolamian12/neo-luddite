# 다음 세션 프롬프트 — 소셜 인증(Supabase) 연결: 팀장 PR #5 받아오기

> 작성 2026-10-08. 앞 기록 = `history/261008_개발현황분석_LLM3법령DB_프로덕션ON_응답지연대응.md`. 역할 분담 = 메모리 `project_team_split_1007`.

## 0. 상황

- 내 미션(10/6 팀 미팅): 비로그인 고객은 세무사 연결을 지원하지 않고, **로그인 고객만 채팅 중 세무사 연결 분기**. 이를 위해 Supabase 소셜 로그인,
  비밀번호 찾기 등 기본 계정관리, 관리자 사용자·사용 현황 모니터링이 필요.
- 화면 소유: **로그인·가입 화면 = 팀장**(완료했다고 함) · 관리자 화면 = 나.
- 지금 로그인 = 데모 계정 8개 하드코딩(`frontend/lib/account-schema.ts` `DEMO_CREDENTIALS` → `{id}@demo.local` 비밀번호 로그인).
  RLS·대화 소유권은 **도메인 id**(`viewer`·`owner2`…)로 묶여 있다.

## 1. 팀장 작업 위치 (10/8 확인)

- **우리 저장소 origin 의 PR #5 = 브랜치 `feat/supabase-social-auth`, 커밋 `16f3bac`** "feat(auth): add Supabase social registration and verified sessions".
  base = `3750838`(import-credigraph 의 LLM3 이전). 28파일 +922/−210. ugproto(팀장 레포)에는 없다.
- 들어 있는 것: `components/auth/auth-screen.tsx`·`social-buttons.tsx`(Google·Kakao) · `lib/social-auth.ts`(signInWithOAuth PKCE, `/auth/callback`
  교환) · `app/auth/callback/page.tsx` · `app/register` · `lib/live-auth.ts`·`account-store.ts` 수정 · 테스트 4개 · `design/supabase-auth.md` ·
  `frontend/.env.example`(`NEXT_PUBLIC_AUTH_PROVIDERS` 등) · **마이그레이션 `0046_social_registration.sql`**(handle_new_user: 공개 가입은 무조건
  role `user`·domain_id = auth uid · `guard_profile_identity` 트리거로 본인 역할·도메인 변경 차단) · `seed.sql` 수정.
- 없는 것: **비밀번호 찾기/재설정**, 관리자 모니터링.

## 2. 첫 함정

1. **마이그레이션 번호 충돌**: 운영 DB 엔 10/8 에 `0046_laws_articles` 가 이미 적용됐다. PR 의 `0046_social_registration.sql` 은 **0047 로 바꿔** 들여온다
   (`schema_migrations` 에 0046 이 있어 apply_migration.py 가 중단한다).
   **10/8 확인: PR 마이그레이션은 운영에 미적용**(팀장 확인 + DB 실측 — 이력 0046 = laws_articles 뿐, `protect_profile_identity` 트리거·
   `guard_profile_identity` 함수 없음, `handle_new_user` 는 PR 이전 판). 번호만 바꾸면 깨끗하게 적용된다.
2. 로컬 `.env` 가 프로덕션 Supabase 를 가리킨다 — 로컬 서버로 가입 시험을 하면 운영 `auth.users` 에 계정이 생긴다. 시험 계정은 끝나고 지운다.
3. OAuth 제공자 설정(Supabase 대시보드 Google·Kakao client id/secret, Redirect URL = Vercel 도메인 `/auth/callback`)은 **사용자 손이 필요**하다.
4. Vercel `NEXT_PUBLIC_*` 는 Secret 저장 불가 → Config 로(메모리 `project_deployment_plan`). SUPABASE 키는 건드리지 말 것.
5. 새 가입자의 domain_id = auth uid — 기존 데모 계정(`viewer` 등)과 대화·RLS 가 섞이지 않는지, 세무사 연결(0034~0040)·3자 방(0044)이 uid 도메인으로도 도는지 확인.
6. 프론트 배포 = origin `main` push(Vercel). import-credigraph 가 main 보다 3커밋 앞(LLM3 백엔드) — main 맞출 때 같이 간다(백엔드 응답 모양 변화 없음).

## 3. 진행 (단계마다 내 확인)

1. 진단(코드 0, DB 쓰기 0): PR #5 diff 읽기 · `design/supabase-auth.md` · 우리 import-credigraph 와 충돌 지점 · 0046→0047 · profiles/handle_new_user 기존 정의(0001~)와 차이.
2. 병합 방식 고르기(PR 을 import-credigraph 로 병합 + 번호 변경 커밋 / cherry-pick) · OAuth 설정 체크리스트를 사용자에게.
3. 구현·검증: 마이그레이션 0047 적용(확인 받고) · 로컬 tsc·테스트·build · 가입 → 로그인 → 챗 → 세무사 연결 경로를 실브라우저로.
4. 비밀번호 찾기/재설정(PR 에 없음 — 화면은 팀장과 소유 협의 후, `resetPasswordForEmail` + 재설정 화면) .
5. 배포(main push → Vercel) · 프로덕션 확인 · 시험 계정 정리.
6. 그다음 후보: 관리자 사용자·사용 현황 모니터링(내 화면) · 가르치기 공용 KB 일괄 반영 교체.

## 4. 새 세션 첫 메시지(붙여 넣기용)

```
지난 세션에서 LLM3(관련 법령 선택)와 자체 법령 DB(laws.articles, 0046)를 프로덕션에 켜고 응답 지연을 25초→8~12초로 줄였어(8b214a1·679a4a3, import-credigraph push·배포 완료).
기록은 history/261008_개발현황분석_LLM3법령DB_프로덕션ON_응답지연대응.md 야.

이번 세션은 소셜 인증이야. 팀장이 로그인·가입 화면 PR 을 끝냈다고 해 — origin 의 PR #5, 브랜치 feat/supabase-social-auth(16f3bac).
출발점은 design/다음세션_프롬프트_소셜인증_supabase.md 야.

주의할 점:
- PR 의 마이그레이션 0046_social_registration.sql 은 운영에 아직 적용되지 않았어(팀장 확인 + 지난 세션 DB 실측). 운영 0046 은 이미 laws_articles 라서 번호만 0047 로 바꿔 적용하면 돼.
- 로컬 .env 가 프로덕션 Supabase 를 가리키니까 가입 시험 계정은 끝나고 지워줘.
- 마이그레이션 적용·배포·Supabase 대시보드 설정은 내 확인을 받고 해줘.

먼저 PR 내용과 지금 코드를 읽고(코드 0, DB 쓰기 0), 병합 방식과 내가 대시보드에서 해야 할 일을 정리해줄래?
```
