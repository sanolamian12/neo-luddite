# 워크스트림 A — Supabase 라이브 적용 (마이그레이션·시드·검증)

날짜: 2026-07-02 · 브랜치: `import-credigraph` · 선행: [260702_워크스트림A_Supabase스키마_인증_RLS_구현(완료).md](<260702_워크스트림A_Supabase스키마_인증_RLS_구현(완료).md>)

## 한 줄 요약
코드로 완성돼 있던 A의 DB 계층을 **실제 클라우드 프로젝트에 적용**. 마이그레이션 2종을 이력 기록과 함께 push, 시드 실행, 15테이블 RLS·Realtime·트리거·역할매핑 전부 라이브 검증 완료. 남은 건 `services/*.ts` 컷오버.

## 프로젝트 (라이브)
- 이름 `credigraph` · ref `hvnvxfakdhhbakdjkxos` · org `Neo-Luddite`(FREE) · compute NANO(t4g.nano)
- 리전 **Tokyo (ap-northeast-1)** — 생성 시점 Seoul 리전 생성 제한으로 Tokyo 확정(한국↔도쿄 ~30-40ms, §6 허용). 마스터 설계 §3-1 갱신함.
- URL `https://hvnvxfakdhhbakdjkxos.supabase.co`
- 접속: 직접(`db.<ref>`)은 IPv6-only라 로컬에서 미해석 → **세션 풀러 `aws-0-ap-northeast-1.pooler.supabase.com:5432`, user `postgres.<ref>`** 로 적용.

## 채운 env (gitignore — 미커밋)
- `frontend/.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `backend/.env`(기존 Upstage 키 보존, 추가): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

## 적용 절차 (재현용)
Supabase CLI 는 저장소를 오염시키지 않게 스크래치 디렉터리에 격리 설치(`npm i supabase`), repo 를 `--workdir` 로 가리켜 실행.
1. `supabase db push --db-url <세션풀러 URL> --workdir <repo>` → `0001_public_schema`, `0002_auth_rls` 적용. 이력 테이블(`supabase_migrations.schema_migrations`)에 0001·0002 기록.
2. `db push` 는 seed 를 돌리지 않음 → `seed.sql` 은 `pg`(node)로 세션 풀러에 직접 실행. `crypt`/`gen_salt` 해석 위해 `search_path = public, extensions, auth` 선설정.

## 검증 결과 (라이브 쿼리)
- `public.*` **15개 테이블, 전부 RLS 활성**(미적용 0).
- **Realtime publication 5개 테이블** 등록(audit_tasks·audits·reviews·inquiries·mail).
- auth 계정 3(owner/auditor/admin) → `on_auth_user_created` 트리거가 **profiles 3개 자동 생성**.
- 역할/도메인 매핑 정확: viewer→user(사장님) / auditor→auditor(평가자) / admin→admin(운영자).
- 시드 데이터: pool_candidates 2, auditors 1.

## 남은 일
1. **`services/*.ts` 10개 컷오버**(pool.ts 템플릿, 시그니처 불변) — 크리덴셜 확보됐으므로 다음 순서. 전량 한 번에 교체 + `tsc` 검증.
2. **완료정의 검증**: 두 브라우저(관리자/세무사) 상호 반영 + 역할별 접근 제어 — 실제 로그인 필요.
3. 데모 계정은 로컬 seed 방식(`auth.users` 직접 insert)으로 클라우드에 이미 생성됨. 프로젝트 재생성 시 재실행 필요.
</content>
