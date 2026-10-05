# 2026-10-04 — ugnchoi 새 프론트 인수 · 게스트 챗 live 연결 · main 배포

커밋: `d3e588e`(게스트 챗) · `ff02ead`(세무사 사이드바) · `95d3786`(사장님 사이드바) · `a63859e`(import-credigraph 문서 커밋 merge) · `e29982a`(env 예시)
→ **origin `main` = `import-credigraph` = `frontend-v3` = `e29982a`** (fast-forward). 백엔드 무변경 → `deploy.sh` 안 돌림.
작업 폴더: worktree `C:\Users\user\Neo-Luddite-fv3`(frontend-v3). 이제 main 과 같으므로 지워도 된다.

## 1. 결과 한 줄

팀 리더 ugnchoi(Yoojin Choi)가 다른 레포에서 만든 UI 15커밋을 우리 레포로 들여왔다.
새 첫 화면 게스트 챗을 실제 `/api/chat`(Upstage)에 붙이고, 세무사·사장님 화면을 live 모드에 맞춘 뒤 프로덕션에 배포했다.
사용자가 브라우저로 확인했다(게스트 챗 · 로그인 인계 · 사장님 사이드바 · 세무사 사이드바/대시보드 4항목 OK).

## 2. 출처 확인 (사용자 질문: 이 레포가 우리 것에서 파생됐나)

- `github.com/ugnchoi/neo-luddite-prototype`(remote 이름 **`ugproto`** 로 등록) — 그 레포의 `import-credigraph` 가 우리 `a4e8b56`(9/30)과 해시까지 같다. 우리 히스토리 통째 위에서 작업한 것.
- 그쪽 `main` 은 우리 main 보다 **15커밋 앞, 0커밋 뒤**(9/30~10/2, 전부 Yoojin Choi). 사용자가 준 URL `57f5fba` 는 15개 중 12번째였고 실제 최신은 `4971c6b`.
- 바뀐 것은 frontend·design 문서뿐. **backend/·supabase/ 는 0줄.**
- 앞으로 ugnchoi 가 새로 push 하면 `git fetch ugproto` 로 받는다. 그쪽에서 계속 작업하면 다시 갈라지니 우리 main 위에서 작업하도록 전달 필요(사용자 몫).

## 3. 사용자 결정 (재논의 금지)

| # | 결정 |
|---|---|
| 반영 방식 | 별도 브랜치(`frontend-v3`)에서 live 연결 후 main 머지. 데모 그대로 main 배포 안 함 |
| 세무사 사이드바·대시보드 | 새 UI + 빠진 메뉴(검수 참여/진행/완료 · 기여 로그 · 지식 베이스 · RAG 지식망 · KB2 · AI 상담 규범 · 챗 로그) 복원 |
| 사장님 사이드바 | 새 EntrySidebar 로 통일 + 로그인 시 Supabase 대화 목록 병합 |
| 상담 요청 화면 | 에이전트 스튜디오 결정을 따른다 |
| 에이전트 스튜디오 | **서버 저장 + AI 답변 반영까지 구현**, 시점은 **새 RAG 구축 뒤**(그동안 live 에서 숨김) |
| ├ 적용 범위 | 연결된 세무사 것만(상담 신청·채팅방 연결 뒤 그 사장님 대화에만) |
| ├ 반영 방식 | 원칙·되묻기 질문 = 답변 프롬프트, 가르친 사례 = **새 RAG 에 세무사 출처로** |
| └ 게시 | 저장=초안 → 미리보기 통과 → 세무사 본인이 게시(승인자 없음) |
| agentic-v2 | **사실상 폐기.** 팀이 RAG 용 데이터를 대대적으로 새로 만들었고, RAG·KB3 는 이 프로젝트(main/import-credigraph)에 새로 구축 |

## 4. 만든 것

**게스트 챗 live 연결 (`d3e588e`)**
- `lib/entry-chat.ts` — 응답 생성기 주입(`EntryResponder`). 프로토타입은 기존 `sampleResponse`, live 는 `lib/entry-chat-store.ts` 의 `liveRespond` 가 `services/chat.send` 호출. live 저장 키 분리(`entry-chat-v1:live`).
- 랜딩·챗 셸에서 live 로그인 강제 제거(비로그인 방문자 챗 — 메모리 `project_chat_no_auth_exhibition`). 로그인 후 게스트 대화 인계(`adopt`)를 두 모드 공통으로.
- 답변 카드(`uiBlocks`) 표시, 로그인 사장님 대화는 `persistLive` 로 Supabase 에 `source=live` 영속 → 하차장 경로 유지. 세무사 상담 신청 카드는 live 에서 실제 전송 문구.

**세무사 워크스페이스 (`ff02ead`)**
- `lib/data-mode.ts` 에 **`agentStudioEnabled`(= isPrototype)** — 스튜디오·상담 요청 허브의 단일 스위치. 서버 저장 구현 후 이 값만 바꾼다.
- `components/layout/expert-sidebar.tsx` — 공용 `ExpertNav` + 프로토타입용(에이전트 메뉴)/live 용(지식 참여·상담·지식·규범 + 문서 트리) 두 변형. `audit-sidebar.tsx` 는 재수출 한 줄.
- live 대시보드 = 기존 기여 현황(이미 ugnchoi 가 새 디자인 적용) + "나의 상담"(새 신청·진행 중·안 읽은 채팅).

**사장님 사이드바 (`95d3786`)**
- 옛 `AppSidebar` 삭제 → 모든 사장님 화면이 `EntrySidebar`.
- `components/layout/owner-server-conversations.tsx` — viewer 일 때만 `next/dynamic` 지연 로드(conversation-store 는 import 만으로 Realtime 을 켜므로 비로그인엔 안 붙인다).
- 이 브라우저에 없는 대화(`local-*`·옛 `live-*`)는 `fetchConversationRecord` → `entryChatStore.restore` 로 새 UI 에서 이어가기. 옛 챗 화면은 샘플 대본 재생(`clinic-*`)에만 남음.

## 5. 검증

- 프로덕션 `/api/chat` 2턴 실호출(게스트 저장소 경로 그대로) — 턴당 3~4.5초, Zod 계약 통과.
- owner 데모 계정으로 Supabase 읽기 전용 조회 — 본인 대화 59건, 전부 `live-clinic-*`, 필터(ownerId·clinic) 일치.
- tsc 0 · 테스트 56 → **59**(추가 3: live 응답기 2 · restore 1) · live 빌드 통과.
- 배포 후: push 약 20초 뒤 프로덕션 하단 "병의원 세무 상담"(live) 확인, 주요 경로 200, CORS `neo-luddite.vercel.app` 허용, 번들에 API base 포함.

## 6. 드러난 것 · 함정

1. **`isPrototype` 가 두 뜻을 겸한다** — "샘플 데이터"와 "새 UX". ugnchoi 코드는 `NEXT_PUBLIC_DATA_MODE !== "live"` 면 프로토타입이 **기본값**(프로덕션 빌드 포함). 그대로 main 에 올렸으면 프로덕션이 `prototype.invalid` 로 API 를 쏘고 인증도 우회했다.
2. **새 게스트 챗은 live 에서도 가짜 응답이었다** — 키워드 보고 0.45초 뒤 고정 문장. live 에선 첫 화면이 로그인으로 튕기고 옛 챗 UI 가 떴다.
3. **Vercel 변수 먼저, push 나중** — 순서가 바뀌면 배포 순간 프로덕션이 샘플 모드. `NEXT_PUBLIC_*` 는 Secret 저장 불가 → 일반 값(Production+Preview).
4. `notFound()` 가 클라이언트 레이아웃 아래라 `/audit/agents` 는 **HTTP 200 + 404 본문**. 동작은 정상.
5. 옛 대화를 새 화면에서 열기만 해도 `EntryOwnerHandoff` 가 upsert → `updated_at` 갱신 → 목록 위로 올라온다. 하차장 사진은 생성 시각 기준이라 영향 없음 — 그대로 둠.
6. 2턴째에 사용자가 답한 사실(운행기록부 있음)을 흡수 못 하고 같은 확인 질문 반복 — **백엔드 v1 파이프라인 동작**(프론트 무관).
7. main push 는 auto 모드 분류기가 **프로덕션 배포로 차단** → 사용자 명시 승인 후 실행, `.claude/settings.local.json` 에 `git push origin *:main` · `*:import-credigraph` · `main` · `import-credigraph` allow 4개 추가.
8. lint 1건(`components/chat/segment-renderer.tsx` set-state-in-effect)은 ugnchoi 코드에 원래 있던 것 — 안 건드림.

## 7. 못 한 것 · 남은 것

- **새 RAG·KB3 구축** — 다음 세션. 워크플로우 = `design/다음세션_프롬프트_새RAG_KB3구축.md`.
- 에이전트 스튜디오 서버 저장·AI 반영 + 상담 요청 허브 개방 — 새 RAG 뒤(§3 결정 그대로).
- worktree `../Neo-Luddite-fv3` · 브랜치 `frontend-v3` 정리(사용자 확인 후).
- 로컬 개발 주의: 메인 폴더 `frontend/.env.local` 에 `NEXT_PUBLIC_DATA_MODE=live` 가 없으면 로컬도 샘플 모드로 뜬다. 메인 폴더는 `package-lock` 이 바뀌어 `npm ci` 필요.

## 8. 덧붙임 (10/5) — 세무사 사이드바 재결정 · `435463e`

- 사용자 질문: "auditor 로 들어가면 ugnchoi 가 만든 사례 추가·RAG 적재 UI 가 안 보인다, 프로토타입 브랜치라서?"
  → **아니다.** ugproto/main 은 우리 main 에 전부 포함(그 뒤 새 커밋 없음). 원인은 §4 의 `agentStudioEnabled` 게이트(§3 결정대로 live 숨김).
- 사용자 재결정: **내 에이전트는 live 에서 계속 숨김.** 사이드바는 **10/1 사용자 피드백 메일 구성을 기본**으로 —
  세무사(대시보드·상담 프로필·우편함) / 상담(상담 신청·상담사 풀·채팅방) + 검수 흐름·기여 로그·KB·RAG 지식망·KB2·규범·챗 로그는 맨 아래 **접힌 "참고"** 그룹
  (현재 화면이 그 안이면 펼침, 접혀 있을 땐 대기 건수 뱃지). §3 표의 "세무사 사이드바" 행을 이걸로 대체한다.
- 데모 때 에이전트 스튜디오는 ugnchoi 프로토타입 사이트(neo-luddite-prototype.vercel.app, auditor/demo1234).
- 함정: 메인 폴더 `node_modules` 가 옛 lock 이라 `tsx` 없음 → `npm ci` 후 테스트 59 통과. GitHub push 가 "fatal error in commit_refs" 로 1회 실패 → 재시도 성공.
