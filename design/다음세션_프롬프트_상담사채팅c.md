# 다음 세션 프롬프트 — 인앱 상담사 채팅 (c) 제안(경로 B)

아래를 새 세션 첫 메시지로 붙여 넣는다.

---

인앱 상담사 채팅 · 비식별 상담사 풀의 **(c) 단계**를 진행하자. (a) 0037·(b) 0038 은 2026-09-21 에 배포했다.

## 먼저 읽을 것
1. `design/인앱상담사채팅_상담사풀_설계.md` — 설계 마스터. 특히 §1(경로 B), §3.3(`list_pool_cases` 에 "내가 제안했는지" 열을 (c)에서 더함),
   **§3.4 제안**, §3.5(`open_room` 이 `origin='offer'` 를 아직 거부 — (c)가 채운다), §3.8 알림, §4.1 설정 메뉴·`/offers`, §4.2 `[연결 요청]`,
   §5 상태 기계, §7 위험표(**SUBSCRIBED ≠ 수신 시작**, **anon 정책 평가 오류**), §10 3·4번, **§11 진행 기록의 (a)(b) 줄**.
2. 스키마: `supabase/migrations/0038_consultation_rooms.sql`(`open_room` — 출처 검증 분기에 offer 를 더할 자리),
   `0037_pool_consents_masking.sql`(`list_pool_cases` 반환 열 — 바꾸면 `drop function` 후 재생성), `0035`(전이 함수 한 곳 원칙·메일 헬퍼).
3. 시험 틀: `supabase/tests/test_0038_rooms.py`(드라이런·`--applied`·`--fresh`·`--refn`) — `test_0039_offers.py` 로 복사해 쓴다.
4. 프론트: `components/case-pool/expert-pool-view.tsx`(`[연결 요청]` 붙일 자리), `components/layout/account-switcher.tsx`(사장님 설정 메뉴 = 지금 로그아웃뿐),
   `components/room/*`·`lib/room-store.ts`(승인 → 방으로 이동), `lib/supabase/sync.ts`(`waitForPostgresReady` 옵션).

## 이번 (c) 범위
1. **마이그레이션 `0039`**
   - `public.consultation_offers` (§3.4): `id, conversation_id, expert_id, viewer_id, message(≤300, 선택), status, status_history,
     created_at, updated_at, expires_at` · `status ∈ pending|approved|declined|withdrawn|expired` · 재제안 규칙은 §10-3 답에 따라.
     RLS: 세무사 = 본인 제안 select, 사장님 = 본인 앞 select, admin 전체. **insert/update 정책 없음**.
   - `make_offer(conversation_id, message)` — 세무사 본인 + **유효 동의 존재** + 상한(대화당 pending N) 검사 + 고객에게 메일.
   - `transition_offer(id, next, note)` — 전이는 이 함수 하나로(0035 원칙). 승인 → `open_room(..., 'offer', id)` 호출,
     거절·철회 → 상대에게 메일. 만료(7일)는 목록에서 빼거나 전이 시 검사(pg_cron 여부는 판단).
   - `open_room` 을 `create or replace` — `origin='offer'` 면 같은 (대화·사장님·세무사)의 `approved` 제안이 있어야 한다.
   - `list_pool_cases()` 에 `offered_by_me`(또는 내 제안 상태) 열 추가 — 반환 열이 바뀌므로 drop 후 재생성.
   - Realtime publication 에 `consultation_offers`. **정책에 쓰는 함수는 anon 실행 가능하게**(§7 — 안 그러면 이벤트가 통째로 사라진다).
   - 메일은 kind `consultation`, `ref={kind:'offer', id}`. 프론트 `mailRefSchema` 에 `offer` 가지 추가(캐스트라 옛 프론트는 안전).
2. **세무사**: `/audit/pool` 상세에 `[연결 요청]` → 메시지 1건(선택) → `make_offer()`. 이미 제안했으면 상태 표시. 상한·만료 안내.
3. **사장님**: 설정 메뉴(`AccountSwitcher`)에 `세무사 연결 요청 N건` → `/offers`. 목록 = 세무사 프로필 카드(`ExpertCardView`) + 동봉 메시지 +
   어떤 대화 건인지. `[승인]` → 방 개설 → **그 방(`/rooms/<id>`)으로 이동** / `[거절]`(사유 선택). 모바일 컨벤션(412px) 유지.

## 하지 않을 것 (단계 분리)
`conversations_staff_read` 축소는 **(d)** — **앞당기지 말 것**(회귀 범위가 넓어 단독 배포·롤백 단위). 사장님 사이드바 탭 분리
(AI 상담 / 세무사 채팅, 사장님 방 목록)는 **(e)**. admin 제안·방 집계·강제 종료 화면(§4.3)도 이번 범위 밖(따로 묻지 않으면).
**다른 컬렉션(신청·메일·대화…)에 `waitForPostgresReady` 를 켜는 일**도 이번 범위 밖 — 켜면 모든 화면 첫 적재가 2.5초 늦어진다(§7, 사용자 판단 필요).
방 안 대화의 RAG 적재·첨부·타이핑 표시도 하지 않는다(§6).

## 착수 전에 사용자에게 물을 것
- 설계 §10 **3번: 재제안** — 거절·철회·만료된 세무사가 같은 대화에 다시 제안할 수 있는가. 지금 설계는 `unique(conversation_id, expert_id)` 로 **1회만**.
  (허용하면 unique 를 "pending 중복 금지" 부분 unique 로 바꿔야 한다.)
- 설계 §10 **4번 나머지**: 대화당 pending 제안 **5건**, 제안 만료 **7일**이 전시 데모에 맞는지. (열린 방 3 은 (b)에서 확정.)

## 검증 (이 프로젝트 관행)
- 역할별 RLS(psycopg 트랜잭션 + 롤백): 동의 없는 대화에 제안 불가 / 사장님·다른 세무사 제안 불가 / 남의 제안 전이 불가 /
  pending 상한 초과 거부 / 만료분 승인 불가 / **승인이 방을 만든다(origin offer)** / 방 상한 3 초과 시 승인 롤백 /
  철회 동의(`revoke_pool_consent`) 뒤에도 이미 열린 방은 유지(D4) / anon 이 정책 함수 실행 가능·false. `test_0039_offers.py`(`--applied`/`--fresh`).
- 브라우저 E2E **두 컨텍스트**: 사장님 동의 신청 → **다른 세무사**가 풀에서 연결 요청 → 사장님 설정 메뉴 뱃지 → `/offers` 승인 → 방으로 이동 →
  주고받기 → 거절 흐름 1건. **2회 연속 통과**. 412px 가로 스크롤 0. page error 0.
  E2E 는 **매 회 정리 후 시작**(이전 회의 남은 신청·방이 "첫 번째 항목" 클릭을 엉뚱한 방으로 보낸다 — (b)에서 겪음).
- 회귀: `test_0038_rooms.py --applied` **77/77**, `test_0037_pool_masking.py --applied` **87/87**, (b)의 방 E2E, (a)의 풀 E2E.
  `open_room`·`list_pool_cases` 를 바꾸므로 경로 A 수락 → 방, 풀 목록·상세·열람 기록도 다시 확인.
- tsc 0 · 변경 파일 lint 0(프로젝트 전체 lint 는 기존 41건 — 늘지 않으면 됨) · build ✓.
  E2E 가 만든 대화·신청·제안·메일·방·메시지·`rag.chat_turns` 는 끝나고 지운다(대화 **218건**, 메일 1건, chat_turns 408건으로 원복되는지 확인).

## 세션을 끝낼 때 반드시 (다음 세션이 이어받는 방법)
1. 설계 마스터 `design/인앱상담사채팅_상담사풀_설계.md` **§11 진행 기록에 이번 단계 결과를 덧붙인다** —
   무엇을 적용/배포했는지(커밋·마이그레이션 번호), 도중에 바뀐 설계 결정, E2E 가 잡아 고친 것, 남은 것.
   설계가 현실과 어긋났으면 §3~§10 본문도 고친다(기록만 쌓고 본문을 안 고치면 다음 세션이 옛 설계를 믿는다).
2. **다음 단계 프롬프트 파일을 새로 쓴다** — `design/다음세션_프롬프트_상담사채팅d.md`. 이 파일과 같은 구성
   (먼저 읽을 것 / 이번 범위 / 하지 않을 것 / 물을 것 / 검증 / 이 블록 / 환경·배포). (d)는 §3.7 축소 + 회귀 목록 전수다.
   끝난 이 파일은 지우고 `design/README.md` 목록을 고친다.
3. `history/` 에 세션 정리 md 를 쓴다. **`design/` 은 추적 대상이므로 갱신한 설계·프롬프트도 같은 커밋에 넣는다.**
4. 메모리 `project_inapp_consultant_chat` 의 단계 줄을 갱신한다(어디까지 끝났는지 한 줄).

## 환경·배포
설계 §9 그대로. (a)(b)에서 확인한 것:
- 로컬 E2E 빌드: `NEXT_PUBLIC_API_BASE=http://localhost:8788 NEXT_PUBLIC_CHAT_MODE=remote npx next build && npx next start -p 3012`
  (`.env.local` 은 8787·replay 라 그대로 빌드하면 채팅이 재생 모드다).
  백엔드: `CORS_ORIGINS=http://localhost:3012 backend/.venv/Scripts/python.exe -m uvicorn api.main:app --port 8788`(backend/ 에서).
- **재빌드 전에 3012 를 쥔 옛 `next start` 를 확실히 죽인다**(PowerShell `Get-NetTCPConnection -LocalPort 3012` → `Stop-Process`).
  남아 있으면 새 서버가 EADDRINUSE 로 죽고 옛 서버가 없는 청크를 내줘 E2E 가 전부 실패한다.
- 로그인 아이디: 사장님 `owner`(domain_id 는 `viewer`), 세무사 `auditor`(표시명 "평가자")·`auditor2`·`auditor3`, 전부 `demo1234`. 폼 `#username`·`#password`.
  연결 카드에서 특정 세무사 고르기: `[aria-label="평가자 세무사 선택"]`.
- 채팅에서 "…세무사 연결해 주세요" 는 Upstage 호출 없이 연결 카드가 뜬다(명시 요청) — E2E 에 쓰기 좋다.
- (b)의 E2E·정리 스크립트 틀: 방 E2E 는 사이드바 뱃지를 `[data-sidebar="sidebar"] a[href="…"] [aria-label$="항목"]` 로 읽는다.
  정리는 "표시 시각 이후 생긴 사장님 대화·신청·메일(ref requestId/room id)·chat_turns" 삭제 → 방·메시지·동의·열람은 대화 cascade.
- Realtime 이 이상하면 **먼저 A/B 로 가른다**: Node supabase-js 두 클라이언트(로그인 1 · anon 1)로 구독하고 SQL 로 행을 넣어 이벤트를 본다.
  브라우저는 Playwright `page.on("websocket")` 프레임에서 `phx_reply` 와 `"Subscribed to PostgreSQL"` 시각을 찍어 본다.
- 적용된 마이그레이션을 고쳐야 하면 함수·권한만 바꿔 끼우고(**사용자 확인**), 파일도 같이 고친 뒤 `--fresh` 로 파일=DB 일치를 확인한다.
배포는 프론트 `git push origin HEAD:main`(백엔드 변경 없으면 그것만). **마이그레이션 먼저, 프론트 다음**
(옛 프론트는 제안 화면만 없을 뿐 안전 — 메일 ref 는 캐스트라 새 kind 를 몰라도 깨지지 않는다).
**마이그레이션 적용과 배포는 각각 실행 전에 사용자 확인.** `design/` 은 추적 대상, `docs/` 는 로컬 전용이다.
