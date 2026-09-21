# 다음 세션 프롬프트 — 인앱 상담사 채팅 (d) 세무사 원문 열람 축소(D2)

아래를 새 세션 첫 메시지로 붙여 넣는다.

---

인앱 상담사 채팅 · 비식별 상담사 풀의 **(d) 단계**를 진행하자. (a) 0037·(b) 0038 은 2026-09-21, (c) 0039 는 2026-09-22 에 배포했다.

## 먼저 읽을 것
1. `design/인앱상담사채팅_상담사풀_설계.md` — 설계 마스터. 특히 §2 **D2**와 그 근거 실측(세무사 토큰 → 전체 218건 payload),
   **§3.7 축소 조건 4개와 영향 화면 회귀 목록**, §7 위험표(**anon 구독자의 정책 평가 오류가 이벤트를 지운다** — 이번 단계의 최대 함정),
   §9 환경 메모, **§11 진행 기록의 (a)(b)(c) 줄**.
2. 스키마: `supabase/migrations/0005_conversations.sql`(지금 정책 `conversations_staff_read` — `current_role() in ('admin','auditor')` 로 전부 허용),
   축소 조건이 참조하는 테이블 — `audits`(auditor_id), `audit_tasks`(status, conversation_ids), `consultation_rooms`(0038), `consultation_requests`(0034).
   0039 `consultation_offers` 는 조건에 없다(제안만으로는 원문을 안 연다 — 승인되면 방이 생겨 ③으로 열린다).
3. 시험 틀: `supabase/tests/test_0038_rooms.py`·`test_0039_offers.py`(드라이런·`--applied`·`--fresh`·`--refn`) — `test_0040_staff_read.py` 로 복사해 쓴다.
4. 프론트: `lib/conversation-store.ts`(세무사도 **전체 fetch** — RLS 가 줄이면 records 가 줄어들 뿐), `useConversationRecord`(없으면 단건 fetch).

## 이번 (d) 범위
1. **마이그레이션 `0040`** — `conversations_staff_read` 교체(설계 §3.7):
   세무사는 ① 내가 픽업한 검수 건(`audits.auditor_id = me`) ② 열린 일감에 실린 대화(`audit_tasks.status in ('open','full','in_progress')`
   and `id = any(conversation_ids)`) ③ 나와 방이 있는 대화(`consultation_rooms.expert_id = me`) ④ 내 앞으로 온 경로 A 신청
   (`consultation_requests.expert_id = me`) 만 읽는다. admin 은 전체 그대로. 사장님 정책(본인 것)은 건드리지 않는다.
   - **판정은 security definer 함수 하나로**(예: `can_staff_read_conversation(id)`) — 정책 안에서 다른 테이블을 서브쿼리로 읽으면 anon 평가 때
     권한 오류가 나 **Realtime 이벤트가 사장님에게서도 사라진다**(§7, (b)에서 실제로 겪음). 함수는 **anon 실행 허용**, `current_domain_id()` 가 null 이면 false.
   - `conversations` 는 사장님 사이드바·AI 챗이 Realtime 으로 받는 테이블이다 — 교체 뒤 사장님 쪽 Realtime(새 대화가 사이드바에 뜸)이 그대로인지 반드시 본다.
2. **§3.7 회귀 목록 전수** — `/audit/queue`(목록·**상세의 픽업 전 미리보기** = 조건 ②) · `/audit/work`(+워크스페이스) · `/audit/results`(목록·상세) ·
   `/audit/consultations`(대화 원문 링크 = ④) · `/audit/rooms`(원 대화 링크·방 제목 = ③) · `/audit/kb-map` · **`/audit/chat-logs`·`/audit/[conversationId]`**
   (설계 목록에 없던 라우트 — 무엇을 보여 주는지 먼저 확인하고, 축소 뒤 빈 화면이면 의도인지 판단해 사용자에게 묻는다) ·
   admin 쪽 `pool-table`·`inspection-*`·`task-create-form`(admin 은 전체라 바뀌면 안 된다).
   "목록에 있는데 대화가 없다"를 각 화면이 어떻게 그리는지(빈 제목·null 접근·영원한 로딩) 확인하고, 깨지는 곳만 고친다.

## 하지 않을 것 (단계 분리)
사장님 사이드바 탭 분리(AI 상담 / 세무사 채팅, 사장님 방 목록)는 **(e)**. admin 제안·방 집계·강제 종료 화면(§4.3), 컬렉션을 채널 하나로 묶는
준비 대기 단축(§7 미착수 항목), 만료된 제안 행 정리도 이번 범위 밖(따로 묻지 않으면). 방 안 대화의 RAG 적재·첨부·타이핑도 하지 않는다(§6).

## 착수 전에 사용자에게 물을 것
- 조건 ②(열린 일감의 대화를 픽업 전에 미리 보기)를 **그대로 둘지** — 큐 미리보기가 필요해서 넣은 조건이지만, 열린 일감이 많으면 사실상 넓은 열람이다.
  대안: 미리보기를 비식별 사본으로(= 원문 대신 마스킹) 바꾸는 것은 범위가 커지므로 (d)에선 조건 유지가 기본안.
- 조건 ④에 **거절·취소된 신청**도 포함할지(지금 문구는 상태 무관). 기본안: 상태 무관(세무사가 자기 신청 이력의 대화를 다시 볼 수 있게).
- `/audit/chat-logs` 가 세무사에게 전체 대화 로그를 보여 주는 화면이면, 축소 뒤 어떻게 할지(빈 목록 허용 / admin 전용으로 옮김).

## 검증 (이 프로젝트 관행)
- 역할별 RLS(psycopg 트랜잭션 + 롤백): 세무사 토큰으로 **배정 밖 대화 0행**(설계 §2 의 218건 시험을 반대로), 조건 ①~④ 각각 1행씩 열림,
  조건이 사라지면(방 삭제·일감 닫힘) 다시 0행, admin 전체 그대로, 사장님 본인 것 그대로, **anon: 판정 함수 실행 가능·false, conversations 0행(오류 없이)**.
  `test_0040_staff_read.py`(`--applied`/`--fresh`). 운영 실측: 세무사 토큰 PostgREST 직접 질의 건수 전·후.
- 브라우저 E2E: §3.7 회귀 목록 화면 전부(세무사·admin) + 사장님 새 대화가 사이드바에 Realtime 으로 뜸 + (b) 방 E2E(원 대화 링크) + (c) 경로 B E2E(승인 뒤
  세무사가 원 대화를 열 수 있음 = ③). **2회 연속 통과**, 412px 가로 스크롤 0, page error 0. E2E 는 **매 회 정리 후 시작**.
- 회귀: `test_0039_offers.py --applied` 76/76, `test_0038_rooms.py --applied` 77/77, `test_0037_pool_masking.py --applied` 87/87, `e2e/sync-retry.spec.ts` 2/2.
- tsc 0 · 새 파일 lint 0(프로젝트 전체는 41건 — 늘지 않으면 됨) · build ✓.
  E2E 가 만든 대화·신청·제안·메일·방·메시지·`rag.chat_turns` 는 끝나고 지운다(대화 **218건**, 메일 1건, chat_turns 408건으로 원복되는지 확인).

## 세션을 끝낼 때 반드시 (다음 세션이 이어받는 방법)
1. 설계 마스터 `design/인앱상담사채팅_상담사풀_설계.md` **§11 진행 기록에 이번 단계 결과를 덧붙인다** —
   무엇을 적용/배포했는지(커밋·마이그레이션 번호), 도중에 바뀐 설계 결정, E2E 가 잡아 고친 것, 남은 것.
   설계가 현실과 어긋났으면 §3~§10 본문도 고친다(특히 §3.7 — 기록만 쌓고 본문을 안 고치면 다음 세션이 옛 설계를 믿는다).
2. **다음 단계 프롬프트 파일을 새로 쓴다** — `design/다음세션_프롬프트_상담사채팅e.md`. 이 파일과 같은 구성
   (먼저 읽을 것 / 이번 범위 / 하지 않을 것 / 물을 것 / 검증 / 이 블록 / 환경·배포). (e)는 §4.1 사장님 사이드바 탭 분리 + 모바일(설계 §8 (e) 행).
   끝난 이 파일은 지우고 `design/README.md` 목록을 고친다.
3. `history/` 에 세션 정리 md 를 쓴다. **`design/` 은 추적 대상이므로 갱신한 설계·프롬프트도 같은 커밋에 넣는다.**
4. 메모리 `project_inapp_consultant_chat` 의 단계 줄을 갱신한다(어디까지 끝났는지 한 줄).

## 환경·배포
설계 §9 그대로. (a)(b)(c)에서 확인한 것:
- 로컬 E2E 빌드: `NEXT_PUBLIC_API_BASE=http://localhost:8788 NEXT_PUBLIC_CHAT_MODE=remote npx next build && npx next start -p 3012`
  (`.env.local` 은 8787·replay 라 그대로 빌드하면 채팅이 재생 모드다).
  백엔드: `CORS_ORIGINS=http://localhost:3012 backend/.venv/Scripts/python.exe -m uvicorn api.main:app --port 8788`(backend/ 에서).
- **재빌드 전에 3012 를 쥔 옛 `next start` 를 확실히 죽인다**(PowerShell `Get-NetTCPConnection -LocalPort 3012` → `Stop-Process`).
- 로그인 아이디: 사장님 `owner`(domain_id 는 `viewer`), 세무사 `auditor`(표시명 "평가자")·`auditor2`("평가자2")·`auditor3`("평가자3"), `admin`, 전부 `demo1234`.
- 채팅에서 "…세무사 연결해 주세요" 는 Upstage 호출 없이 연결 카드가 뜬다(명시 요청) — E2E 에 쓰기 좋다.
- (c)의 E2E·정리·측정 스크립트는 (c) 세션 scratchpad 에 있다(없으면 이 설명대로 다시 쓴다):
  `C:\Users\user\AppData\Local\Temp\claude\c--Users-user-Neo-Luddite\b550996d-121a-4fae-9c08-3fdccb0cf6ca\scratchpad\`
  — `e2e_db.py mark|show|cleanup`(표시 시각 이후 사장님 대화·신청·메일(ref requestId/room/offer id)·chat_turns 삭제, 방·메시지·제안·동의·열람은 대화 cascade),
  `run_all.sh <스크립트> <회차>`(mark → E2E → cleanup), `e2e_offers.mjs`((c) 27건), `e2e_rooms.mjs`((b) 30건), `e2e_pool.mjs`((a) 21건),
  `timing.mjs`(첫 화면 시간: 로딩 표시가 사라지고 2초 불변까지), `spin_check.mjs`, `ws_probe.mjs`(채널별 JOIN·준비 신호 시각).
- Realtime 이 이상하면 **먼저 A/B 로 가른다**: Node supabase-js 두 클라이언트(로그인 1 · anon 1)로 구독하고 SQL 로 행을 넣어 이벤트를 본다.
  브라우저는 `ws_probe.mjs` 로 `"Subscribed to PostgreSQL"` 시각을 찍는다(준비 신호는 채널당 ~250ms 직렬, §7).
- 적용된 마이그레이션을 고쳐야 하면 함수·권한만 바꿔 끼우고(**사용자 확인**), 파일도 같이 고친 뒤 `--fresh` 로 파일=DB 일치를 확인한다.
배포는 프론트 `git push origin HEAD:main`(백엔드 변경 없으면 그것만). **(d)는 마이그레이션이 본체** — 프론트 수정이 필요한 화면이 있으면
**프론트 먼저 배포(빈 대화에 견디게) → 마이그레이션** 순서가 안전하다(마이그레이션이 먼저면 옛 프론트가 빈 대화에서 깨질 수 있다).
**마이그레이션 적용과 배포는 각각 실행 전에 사용자 확인.** 롤백 = 0005 의 원래 정책으로 되돌리는 SQL 을 미리 준비해 둔다. `design/` 은 추적 대상, `docs/` 는 로컬 전용이다.
