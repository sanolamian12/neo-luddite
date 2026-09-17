# 260917 KB통합 P6 — 규범 확정 거버넌스: 인증 → 이의 기간 → admin 사후 브레이크

로드맵: `docs/doing/KB통합_3층검색_로드맵.md` §3 P6. 직전: `history/260917_KB통합_P5_L0규범_DB승격_편집UI.md`.
커밋: `9b410cb`(①) · `62e5596`(②) · `01e6a2e`(③). 마이그레이션 0031·0032. 서버 `.env` `AUTH_MODE=required`.

## 0. 왜

P5까지는 **세무사 1명이 확정하면 곧바로 모든 답변의 시스템 프롬프트가 바뀌었다.** 게다가 백엔드는 무인증이라
신원을 요청 본문으로 받았다 — 어떤 거버넌스 규칙("3명 승인")을 얹어도 본문만 바꾸면 위조된다.
그래서 순서가 **인증 → 이의 기간 → admin 브레이크**(사용자 결정)다.

## 1. 결정 (사용자)

사전에 확정된 것(재논의 금지): 순서, 이의 기간 1일·디폴트 승인, 빠른 길(다수 승인 즉시 반영), 로그인 시 먼저 확인,
admin은 경로 밖 브레이크, 인증이 간이 테스트를 번거롭게 하면 안 됨.

이번 세션에 물어 정한 것:

| 항목 | 결정 |
|---|---|
| 인증 범위 | 쓰기 API 전체, **챗 제외** |
| 이의 해제 | **이의 철회 또는 수정(→초안·재공개)** 로만. 승인 수는 이의를 못 이김, admin 판단 경로 없음 |
| 로그인 알림 | **로그인 직후 팝업 + 사이드바 배지** (대시보드 카드·메일 발송은 미채택) |
| admin 권한 | **공개 중 제안 거부 + 확정본 즉시 롤백**. 긴급 단독 확정은 없음 |
| 승인 문턱 | 원래 3명 → **2명**(데모 세무사 계정 한계로 사용자가 낮춤). 설정값 `NORMS_FAST_APPROVALS` |

Claude가 무난한 제안을 그대로 택한 것: 작성자(+공개자)는 승인 집계 제외 · 공개 중 수정 시 결정·타이머 리셋 ·
로컬 우회 플래그 없이 토큰 헬퍼 · 세무사 1~2명 초기 운영은 기한 만료 자동 반영으로 충분.
**설계 중 바꾼 것**: 자동 반영 트리거를 pg_cron → **백엔드 폴러**로. 반영 직전 예산 검사(`build_norms`)가 Python이라
SQL만으로는 같은 검사를 못 한다(kb2_scheduler 모듈 주석의 판단과 동일). 진실은 `deadline_at`이라 서버 재기동에도 안전.

## 2. ① 인증

- `backend/api/auth.py` — HTTP 미들웨어. 쓰기 요청(GET/HEAD/OPTIONS·`/api/chat` 제외)에서 `Authorization: Bearer`를
  JWKS(`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`, **ES256** 확인)로 서명·만료·iss·aud 검증 → `profiles` 조회(60초 캐시).
- `actor(request, claimed)` — 인증됐으면 토큰 신원, 아니면(과도기) 본문 값. **기여 귀속 필드(ingest의 auditorId 등)는
  건드리지 않았다** — "누가 눌렀나"가 아니라 "누가 썼나"이므로.
- 역할: 쓰기 = auditor·admin. admin 전용 = `/admin/*`, rag toggle·retract·reclassify, rag edits approve/reject,
  norms reject/rollback. owner(DB role `user`)는 403.
- 401/403 응답에 CORS 헤더를 직접 붙인다(미들웨어가 CORS 바깥이라 — 500 핸들러와 같은 이유).
- 프론트 `lib/api-fetch.ts` — 쓰기 요청에만 Supabase 세션 토큰 부착(GET은 preflight 회피). norms·kb2·rag 서비스 적용.
- `backend/scripts/dev_token.py` — 데모 계정 토큰(`{user}@demo.local` / demo1234, anon key는 frontend/.env.local).
- 의존성 `PyJWT[crypto]` 추가.

**배포 3단계**: 백엔드(`optional`) → 프로덕션 API 9/9 → 프론트 main → 프로덕션 브라우저(POST에 토큰, 작성자=auditor2) →
서버 `.env` `AUTH_MODE=required`(백업 `.env.bak-260917-auth`) + 재시작 → 무토큰 쓰기 401, 챗은 무토큰 정상.
본문 `editorId: auditor3` + auditor2 토큰 → 서버 기록 auditor2(위조 무력화 확인).

## 3. ② 이의 기간 (0031)

상태: `draft → pending → confirmed` (+ discarded). 문서당 열린 제안(draft|pending) 하나(부분 유니크 인덱스 교체).

- `versions` + `published_by/at`, `deadline_at`, `applied_via`(direct|approvals|deadline). 기존 확정본은 `direct`.
- `norms.decisions`(approve|object, reason, **withdrawn_at/by/reason** — 삭제 없는 이력, 유효 결정은 1인 1개).
- `publish_draft`: 운영자·세무사, 사유 필수, 확정본과 동일·예산 초과 거절, `deadline = now + 1일`.
- `decide`: 세무사만, `expectedUpdatedAt` 일치 필요, 이의 사유 필수, 작성자·공개자 자기 승인 거절, 이전 결정은 `changed`로 철회 후 기록.
- `_try_apply`: **이의 > 0이면 무조건 불가** → 승인 ≥ 문턱이면 `approvals` → 기한 경과면 `deadline`(confirmed_by `system:deadline`).
- `withdraw_decision`: 이의를 거두면 그 자리에서 조건 재평가(기한이 이미 지났으면 즉시 반영).
- 공개 중 수정 → `draft`로 복귀, 결정 전부 `reset:edited`, 기한 제거. 공개 중 폐기는 작성자·공개자만(나머지는 이의로).
- `api/prompts/scheduler.py` — lifespan에서 60초 `apply_due`, 반영 시 `invalidate_norms()`.
- 프론트: `PendingProposal`(기한·승인 n/N·이의 목록·diff, 승인/이의/철회/수정/거둬들이기), 공개 다이얼로그,
  `lib/norms-pending.ts`(zustand) + `NormsPendingWatcher`(감사 셸, 60초 폴링, sessionStorage로 제안당 1회 팝업),
  사이드바 "AI 상담 규범" 배지. 규범 화면 변경 시 store 즉시 갱신.

**검증**
- 롤백 트랜잭션(마이그레이션까지 포함, 한 커넥션에서 `_tx`를 savepoint로 대체): 22항목 통과, DB 불변 확인.
- 프로덕션 브라우저 A: admin 공개 → auditor 로그인 팝업·이의 → "이의로 보류" → auditor2 팝업·배지 1·승인 →
  승인1·이의1 보류 유지·배지 소멸 → auditor 이의 철회(미반영) → 승인 → **v4 via approvals**(주입 1,381자). 10/10.
- 프로덕션 B(API+SQL): v3 내용 원복 제안 공개 → `deadline_at = now` → **폴러 25초 뒤 v5 via deadline**, 주입 1,314자. 5/5.

## 4. ③ admin 사후 브레이크 (0032)

- status `rejected`, applied_via `rollback`, `versions.admin_reason`. 별도 이력 테이블 없이 versions 행이 이력.
- `reject_proposal`: pending만, 사유 필수, 결정 `reset:rejected`, `discarded_by/at` 재사용.
- `rollback_active`: `expectedActiveVersionId` 일치 필요 → 직전 번호 확정본 내용으로 **새 확정본** insert(번호 증가,
  base_version_id = 대상, note "롤백 vX → vY 내용") → active 교체 → 즉시 invalidate. 열린 제안은 건드리지 않음.
- 프론트(admin 모드): 공개 중 제안 [거부](사유), 확정본 메타 [직전 확정본으로 롤백] 다이얼로그(diff·사유 필수),
  이력에 "거부된 제안"·admin 사유.

**검증**: 롤백 트랜잭션 12항목 → 프로덕션 브라우저 10/10 — 세무사 화면엔 롤백 없음 · auditor 공개 → admin 거부
(확정본 불변, 이력·사유) · 롤백1 → v6(=v4) · 롤백2 → v7(=v5) · **최종 내용 = 테스트 전 원래 내용, 1,314자**.

## 5. 현재 상태

- pitfalls 확정본 **v7**(내용 = v1 = md), master·frameworks v1. md 폴백과 내용 동일(내보내기 불필요).
- 버전 이력에 테스트 흔적: v2~v7, 거부 1건, 폐기 초안 — 사유 전부 `[기능 테스트 260917]`.
- 프로덕션 쓰기 API는 토큰 필수. 롤백은 서버 `.env` `AUTH_MODE=optional`.

## 6. 교훈

- **거버넌스 규칙보다 신원이 먼저.** 본문 신원 위에 쌓은 N명 승인은 장식이다.
- **토큰 필수화는 2단계 배포**(검증은 하되 없으면 통과 → 프론트 → 필수)로 구 프론트 파손 창을 없앴다.
- **스키마+로직을 롤백 트랜잭션에서 먼저 돌리면** 마이그레이션 적용 승인 전에 상태 전이 전체를 실DB로 검증할 수 있다
  (`_tx`/`_get_conn`을 단일 커넥션·savepoint로 교체).
- 제약 이름은 추정 말고 조회(`pg_constraint`) — 0030의 `versions_status_check`를 확인하고 교체했다.
- 브라우저 테스트는 "새 빌드인가"를 화면 문구로 먼저 확인하고 아니면 **변경 없이 중단**하게 짰다 — Vercel 반영 대기 중 옛 UI로 절반만 실행되는 사고 방지.
- Windows curl로 한글 JSON 본문을 보내면 400이 날 수 있다(인코딩) — 스모크는 Python urllib로.

## 7. 남은 것 (결정 필요)

- 승인 문턱 3 복귀 시점(세무사 실계정 수와 연동?).
- 이의가 달리면 작성자에게 알림(지금은 화면에서만 보임) — 배지 기준에 "내 제안에 이의" 추가 여부.
- 메일함 발송·대시보드 카드(이번엔 미채택).
- 악성 방어: 승인 자격·제안 빈도·diff 크기 상한.
- 챗(`/api/chat`) 인증.
