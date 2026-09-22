# 다음 세션 프롬프트 — 인앱 상담사 채팅 (e) 사장님 사이드바 탭 분리 + 모바일

아래를 새 세션 첫 메시지로 붙여 넣는다.

---

인앱 상담사 채팅 · 비식별 상담사 풀의 **(e) 단계**를 진행하자. (a) 0037·(b) 0038 은 2026-09-21, (c) 0039·(d) 0040 은 2026-09-22 에 배포·적용했다.
(e)가 이 공사의 마지막 단계다.

## 먼저 읽을 것
1. `design/인앱상담사채팅_상담사풀_설계.md` — 설계 마스터. 특히 **§4.1 사장님 화면**(사이드바 "상담 세션" 탭 2개, 방 목록이 (b)~(d) 동안 없었던 이유),
   §3.5·3.6(방·메시지, 안 읽음 = 방의 `*_last_read_at` 한 칸), §3.8(사장님 "세무사 상담" 뱃지 = 안 읽은 consultation 메일 + 방 안 읽음, ref offer 메일 제외),
   §7 위험표(구독 준비 대기·**"보이게 됨"엔 이벤트가 없다**), §9 환경, **§11 진행 기록의 (a)~(d) 줄**.
2. 프론트: `components/layout/app-sidebar.tsx`(지금의 `liveSessions` = conversations 목록, 채팅 밖에선 전체 세션),
   `lib/room-store.ts`(방·메시지 두 컬렉션, 안 읽음 계산), `components/room/{room-view,expert-rooms-view,open-room-button}.tsx`
   (세무사 방 목록 `expert-rooms-view` 가 거의 같은 목록 — 이름·아바타·마지막 메시지·안 읽음·정렬 `sortRooms` 를 재사용할 수 있는지 먼저 본다),
   `app/rooms/[roomId]`(사장님 방 화면), `lib/sidebar-badges.ts`(**UTF-8 인데 NUL 바이트 2개** — 바이트 단위 편집, §9).
3. 모바일 컨벤션: 메모리 `project_mobile_responsive_convention`(412px/`md` 분기, 다중 패널→탭 `mobileShow` prop, `useIsMobile` 말고 CSS).

## 이번 (e) 범위
1. **사장님 사이드바 "상담 세션" 을 탭 2개로**: `AI 상담`(지금의 `liveSessions`) / `세무사 채팅`(`consultation_rooms` 중 `viewer_id = 나`).
   세무사 채팅 항목 = 상대 세무사 이름·아바타(공개 카드 → 명부 순, 둘 다 없으면 id 를 비추지 않는다 — (c)에서 고친 규칙) · 마지막 메시지 한 줄 · 안 읽음 수 ·
   열림/닫힘. 누르면 `/rooms/<id>`. 탭 머리에 세무사 채팅 안 읽음 합계.
2. **모바일(412px)**: 사이드바 시트 안에서도 두 탭이 그대로 동작, 가로 스크롤 0.
3. 방 목록이 생기므로 `/consultations` 상세의 [채팅방 열기]는 그대로 두되, 사장님이 방에 들어가는 길이 둘이 된다 — 방 화면의 뒤로 가기가 어디로 가는지 정리.

## 하지 않을 것 (단계 분리)
admin 제안·방 집계·강제 종료 화면(§4.3), 컬렉션을 채널 하나로 묶는 준비 대기 단축(§7), 만료된 제안 행 정리, 마감 지난 일감 닫기(0040 ② 범위),
`/audit/chat-logs/<라이브 id>` 서버 오류(0040 이전부터 — §3.7), 경로 B 방의 세무사 쪽 원 대화 화면, 방 안 대화의 RAG 적재·첨부·타이핑(§6)은 범위 밖(따로 묻지 않으면).
DB 변경은 없어야 한다 — 필요해 보이면 멈추고 묻는다.

## 착수 전에 사용자에게 물을 것
- **기본 탭**: 항상 `AI 상담` 먼저(기본안 — 지금 사용자 흐름 그대로) / 세무사 채팅에 안 읽음이 있으면 그쪽 먼저.
- **닫힌 방**: 목록 아래로 묶어 흐리게(기본안) / 숨김 / 섞어서 최근순.
- **채팅 밖 화면**(`/consultations`·`/offers`·`/rooms/*`)에서도 탭을 보일지 — 지금 `liveSessions` 는 채팅 밖에선 전체 세션을 보여 준다. 기본안: 어디서나 같은 탭.

## 검증 (이 프로젝트 관행)
- 브라우저 E2E(두 컨텍스트, 사장님·세무사): 방 2개(경로 A 수락 1 + 경로 B 승인 1) → 사장님 세무사 채팅 탭에 둘 다(이름·아바타, id 노출 없음) →
  세무사가 메시지 → 탭·항목 안 읽음 +1, 그 방이 맨 위로(Realtime, 새로고침 없이) → 누르면 그 방 → 읽음 0 → 세무사 방 닫기 → 닫힘 표시.
  **페이지를 연 직후 생긴 방도 뜨는지**(준비 대기 틈, §7). 412px 탭 전환·가로 스크롤 0, page error 0. **2회 연속 통과, 매 회 정리 후 시작.**
- 회귀: (b) 방 E2E 30/30, (c) 경로 B E2E 30/30, (a) 풀 E2E 21/21, (d) `e2e_staff_read.mjs` 32/32(**사이드바 Realtime 검사가 AI 상담 탭 안의 제목을 찾는다 —
  기본 탭을 바꾸면 스크립트도 고친다**), `regress.mjs`(세무사·admin 50화면) + 사장님 화면(`/chat/clinic`·`/consultations`·`/offers`·`/rooms/<id>`) 추가,
  `e2e/sync-retry.spec.ts` 2/2, DB `test_0040 --applied` 52/52·`test_0039` 76/76·`test_0038` 77/77·`test_0037` 87/87(DB 변경이 없어도 한 번).
- tsc 0 · 새 파일 lint 0(프로젝트 전체 41건 — 늘지 않으면 됨) · build ✓. 사장님 첫 화면 시간이 눈에 띄게 늘지 않는지 `timing.mjs` 로 전·후(방 컬렉션이 사장님 첫 화면에 새로 붙는다).
- E2E 가 만든 대화·신청·제안·메일·방·메시지·`rag.chat_turns` 는 끝나고 지운다(대화 **218건**, 신청 0, 메일 1건, chat_turns 408건, 일감 6, 검수 557 로 원복되는지 확인).

## 세션을 끝낼 때 반드시 (다음 세션이 이어받는 방법)
1. 설계 마스터 `design/인앱상담사채팅_상담사풀_설계.md` **§11 진행 기록에 이번 단계 결과를 덧붙인다** —
   무엇을 배포했는지(커밋), 도중에 바뀐 설계 결정, E2E 가 잡아 고친 것, 남은 것. 설계가 현실과 어긋났으면 §3~§10 본문도 고친다(특히 §4.1).
2. (e)가 마지막 단계이므로 **공사 종결 처리**: 설계 머리의 진행 줄을 "완료"로, 남은 일(§11 각 단계의 "남은 것")을 한 목록으로 모아 설계 끝에 두고,
   다음 공사로 넘길지 사용자에게 묻는다. design/README 규칙대로 **끝난 공사는 `history/` 요약으로 남기고 design/ 에서 지운다** — 지울지·언제 지울지는 사용자 확인.
   이 지시서는 지우고 `design/README.md` 목록을 고친다(다음 단계 프롬프트는 사용자가 남은 일 중 하나를 고르면 그때 쓴다).
3. `history/` 에 세션 정리 md 를 쓴다. **`design/` 은 추적 대상이므로 갱신한 설계·README 도 같은 커밋에 넣는다.**
4. 메모리 `project_inapp_consultant_chat` 의 단계 줄을 갱신한다(어디까지 끝났는지 한 줄).

## 환경·배포
설계 §9 그대로. (a)~(d)에서 확인한 것:
- 로컬 E2E 빌드: `NEXT_PUBLIC_API_BASE=http://localhost:8788 NEXT_PUBLIC_CHAT_MODE=remote npx next build && npx next start -p 3012`
  (`.env.local` 은 8787·replay 라 그대로 빌드하면 채팅이 재생 모드다).
  백엔드: `CORS_ORIGINS=http://localhost:3012 backend/.venv/Scripts/python.exe -m uvicorn api.main:app --port 8788`(backend/ 에서).
- **재빌드 전에 3012 를 쥔 옛 `next start` 를 확실히 죽인다**(PowerShell `Get-NetTCPConnection -LocalPort 3012` → `Stop-Process`).
- 로그인 아이디: 사장님 `owner`(domain_id 는 `viewer`), 세무사 `auditor`(표시명 "평가자")·`auditor2`("평가자2")·`auditor3`("평가자3"), `admin`, 전부 `demo1234`.
- 채팅에서 "…세무사 연결해 주세요" 는 Upstage 호출 없이 연결 카드가 뜬다(명시 요청) — E2E 에 쓰기 좋다.
- (d)의 E2E·정리·측정 스크립트는 (d) 세션 scratchpad 에 있다(없으면 이 설명대로 다시 쓴다):
  `C:\Users\user\AppData\Local\Temp\claude\c--Users-user-Neo-Luddite\a80be304-be97-44e2-9994-5e82fe3c63fd\scratchpad\`
  — `e2e_db.py mark|show|cleanup`(표시 시각 이후 사장님 대화·신청·메일·chat_turns + E2E 일감·검수 건 `e2e-sr-*` 삭제, 방·메시지·제안·동의·열람은 대화 cascade),
  `run_all.sh <스크립트> <회차>`(mark → E2E → cleanup), `e2e_offers.mjs`((c) 30건, (d) ③ 검사 포함), `e2e_rooms.mjs`((b) 30건), `e2e_pool.mjs`((a) 21건),
  `e2e_staff_read.mjs`((d) 32건, 따로 mark/cleanup), `e2e_sql.py task|close|insert_conv`, `regress.mjs <라벨>`(50화면, `BASE=` 로 운영도), `count_prod.mjs`(역할별 PostgREST 건수),
  `timing.mjs`(첫 화면 시간: 로딩 표시가 사라지고 2초 불변까지), `spin_check.mjs`, `ws_probe.mjs`(채널별 JOIN·준비 신호 시각), `rt_probe.mjs`.
- Realtime 이 이상하면 **먼저 A/B 로 가른다**: Node supabase-js 두 클라이언트(로그인 1 · anon 1)로 구독하고 SQL 로 행을 넣어 이벤트를 본다.
- Bash 도구로 인라인 python/node 에 `\n`·`\b` 를 넣으면 무너진다 — 이스케이프가 든 수정은 Write 로 스크립트 파일을 쓴 뒤 실행(§9).
배포는 프론트 `git push origin HEAD:main`(백엔드 변경 없으면 그것만), Vercel 확인은 `curl https://api.github.com/repos/sanolamian12/neo-luddite/commits/<sha>/status`.
**배포는 실행 전에 사용자 확인.** `design/` 은 추적 대상, `docs/` 는 로컬 전용이다.
