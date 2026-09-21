# 다음 세션 프롬프트 — 인앱 상담사 채팅 (b) 방·메시지

아래를 새 세션 첫 메시지로 붙여 넣는다.

---

인앱 상담사 채팅 · 비식별 상담사 풀의 **(b) 단계**를 진행하자.

## 먼저 읽을 것
1. `design/인앱상담사채팅_상담사풀_설계.md` — 설계 마스터. 특히 §2 D3(경로 A도 채팅방으로 일원화)·D4, §3.5·3.6·3.8, §5 상태 기계,
   §7 위험표(Realtime 유실 대비), §8 단계표, §9 환경, §10 2번, **§11 진행 기록의 (a) 줄**(바뀐 설계·남은 것).
2. `design/세무사연결_핸드오프_이식설계.md` — 0035 `transition_consultation` 의 "전이는 함수 하나로" 원칙, (c)의 Realtime 유실 원인(`lib/supabase/sync.ts` 구독 → fetch 순서).
3. 스키마: `supabase/migrations/0035_consultation_transitions.sql`(수락 시 방을 열 자리), `0034`(RLS 모양), `0037_pool_consents_masking.sql`(바로 앞 단계).
4. 프론트: `lib/consultation-store.ts`(makeCollectionSync 사용례), `components/consultation/*`(사장님·세무사 상세 — [채팅방 열기]를 붙일 자리).

## 이번 (b) 범위
1. **마이그레이션 `0038`**
   - `public.consultation_rooms` (설계 §3.5) · `public.consultation_messages` (§3.6) + RLS(방 참여자 + admin 만 select/insert,
     update 는 본인 메시지 `deleted_at` 만) + Realtime publication 두 테이블.
   - `open_room(conversation_id, viewer_id, expert_id, origin, origin_id)` — 방 개설의 **유일한 경로**, `unique(conversation_id, expert_id)` 라
     이미 있으면 그 방을 돌려준다. 열린 방 상한 3(§3.4) 검사.
   - `transition_consultation` 을 `create or replace` 해서 **`accepted` 전이 때 `open_room()` 을 호출**(D3). 기존 전이·메일은 그대로 둔다.
   - 읽음: 방의 `viewer_last_read_at` / `expert_last_read_at` 한 칸(메시지별 읽음 행 금지). 갱신은 RPC(`mark_room_read`) 로.
   - 알림 메일: kind `consultation` 재사용, `ref={kind:'room', id}`. **방당 1건**(첫 메시지 등), 그 뒤로는 뱃지만.
   - 방 종료(`close_room`) — §10-2 답에 따라.
2. **방 화면(양쪽 공용 컴포넌트)** — 사장님 `/rooms/[roomId]`, 세무사 `/audit/rooms`(목록 + 방).
   메시지 목록 + 입력창, 상단에 상대 프로필과 원 대화 링크. 열 때 한 번 더 fetch(§7).
3. **진입점** — `/consultations`·`/audit/consultations` 상세에 `[채팅방 열기]`(수락된 신청). 안 읽음 뱃지(사이드바, 세무사 쪽).
   `lib/sidebar-badges.ts` 는 **UTF-16** 이다 — 인코딩 유지.

## 하지 않을 것 (단계 분리)
세무사→고객 제안(`consultation_offers`, 풀의 [연결 요청], `/offers`)은 **(c)**, `conversations_staff_read` 축소는 **(d)**,
사장님 사이드바 탭 분리(AI 상담 / 세무사 채팅)는 **(e)**. **(d)를 앞당기지 말 것** — 회귀 범위가 넓어 단독 배포·롤백 단위다.
방 안 대화의 RAG 적재·첨부·타이핑 표시도 하지 않는다(§6).

## 착수 전에 사용자에게 물을 것
- 설계 §10 **2번: 방 종료 권한** — 양쪽 누구나(+admin) vs 고객만. `close_room()` 의 권한 검사가 여기서 갈린다.
- (3번 재제안·4번 상한 수치는 (c)에서 묻는다. 단 열린 방 상한 3은 (b)의 `open_room` 에 들어가므로, 4번 중 "방 3개"만 같이 확인해도 된다.)

## 검증 (이 프로젝트 관행)
- 역할별 RLS(psycopg 트랜잭션 + 롤백): 방 참여자만 메시지 읽기·쓰기 / 제3의 세무사·다른 사장님 0행 / 남의 메시지 soft delete 불가 /
  `open_room` 중복 호출 시 같은 방 / 상한 초과 거부 / 수락 전이가 방을 만든다. `supabase/tests/test_0037_pool_masking.py` 의 틀을 복사해
  `test_0038_rooms.py` 로 두면 된다(`--applied`/`--fresh` 모드 포함).
- 브라우저 E2E **두 컨텍스트**: 사장님 신청 → 세무사 수락 → 양쪽에 방 → 주고받기(Realtime) → 안 읽음 뱃지 증감 → 새로고침·재진입 후 유지.
  **2회 연속 통과**. 412px 가로 스크롤 0. page error 0.
- 회귀: (a)의 E2E(동의 → 풀 → 철회)와 0037 시험 87/87 을 다시 돌린다 — 0035 함수를 고치므로 신청·수락·거절·완료·취소 전이와 메일도 확인.
- tsc 0 · lint 0 · build ✓. E2E 가 만든 대화·신청·메일·방·메시지·`rag.chat_turns` 는 끝나고 지운다(대화 218건으로 원복되는지 확인).

## 세션을 끝낼 때 반드시 (다음 세션이 이어받는 방법)
1. 설계 마스터 `design/인앱상담사채팅_상담사풀_설계.md` **§11 진행 기록에 이번 단계 결과를 덧붙인다** —
   무엇을 적용/배포했는지(커밋·마이그레이션 번호), 도중에 바뀐 설계 결정, E2E 가 잡아 고친 것, 남은 것.
   설계가 현실과 어긋났으면 §3~§8 본문도 고친다(기록만 쌓고 본문을 안 고치면 다음 세션이 옛 설계를 믿는다).
2. **다음 단계 프롬프트 파일을 새로 쓴다** — `design/다음세션_프롬프트_상담사채팅c.md`. 이 파일과 같은 구성
   (먼저 읽을 것 / 이번 범위 / 하지 않을 것 / 물을 것 / 검증 / 이 블록 / 환경·배포). 끝난 이 파일은 지우고 `design/README.md` 목록을 고친다.
3. `history/` 에 세션 정리 md 를 쓴다. **`design/` 은 추적 대상이므로 갱신한 설계·프롬프트도 같은 커밋에 넣는다.**
4. 메모리 `project_inapp_consultant_chat` 의 단계 줄을 갱신한다(어디까지 끝났는지 한 줄).

## 환경·배포
설계 §9 그대로. (a)에서 확인한 것 추가:
- 로컬 E2E 빌드: `NEXT_PUBLIC_API_BASE=http://localhost:8788 NEXT_PUBLIC_CHAT_MODE=remote npx next build && npx next start -p 3012`
  (`.env.local` 은 8787·replay 라 그대로 빌드하면 채팅이 재생 모드다).
  백엔드: `CORS_ORIGINS=http://localhost:3012 backend/.venv/Scripts/python.exe -m uvicorn api.main:app --port 8788`(backend/ 에서).
- **재빌드 전에 3012 를 쥔 옛 `next start` 를 확실히 죽인다** — 남아 있으면 새 서버가 EADDRINUSE 로 죽고 옛 서버가 없는 청크를 내줘
  "Failed to load chunk" 로 E2E 가 전부 실패한다(작업 관리자/`Stop-Process` 로 PID 확인).
- 로그인 아이디: 사장님 `owner`(domain_id 는 `viewer`), 세무사 `auditor`·`auditor2`, 전부 `demo1234`. 로그인 폼 `#username`·`#password`.
- 채팅에서 "…세무사 연결해 주세요" 는 Upstage 호출 없이 연결 카드가 뜬다(명시 요청) — E2E 에 쓰기 좋다.
- 적용된 마이그레이션 파일을 고쳐야 하면 함수만 `create or replace` 로 바꿔 끼우고(사용자 확인), `--fresh` 로 파일=DB 일치를 확인한다.
배포는 프론트 `git push origin HEAD:main`. 0038 은 0035 함수를 바꾸므로 **마이그레이션 먼저, 프론트 다음**(옛 프론트는 방 화면만 없을 뿐 안전).
**마이그레이션 적용과 배포는 각각 실행 전에 사용자 확인.** `design/` 은 추적 대상, `docs/` 는 로컬 전용이다.
