# 4. 백엔드·인프라 엔지니어

## 개요

**데이터·권한·배치·서버를 판정의 주인으로 세우고, 그것을 운영하는 사람이다.**
구성은 Supabase(Postgres + pgvector + Realtime + pg_cron)와 Python FastAPI 백엔드다(systemd + Caddy, Oracle Cloud).
프론트는 Vercel에 있다. 이 자리의 일은 기능을 만드는 것보다 **기능이 조용히 깨지지 않게 하는 것**에 가깝다.
마이그레이션, RLS, 인증 모드, 배포 경로, 타임아웃, 동시 부하가 여기에 속한다.

## 역할

| 축 | 하는 일 |
|---|---|
| **스키마·권한** | 번호가 붙은 마이그레이션(`supabase/migrations/00NN_*.sql`), RLS 정책, `AUTH_MODE`, 프로덕션 쓰기 API 토큰을 관리한다 |
| **배치·스케줄** | pg_cron(스냅샷, edge 재계산, 폴러), 야간 예약, best-effort 동기 호출과 안전망을 운영한다 |
| **외부 API 운영** | Upstage 호출의 FIFO 게이트, 타임아웃 값 결정, 레이트리밋 규명, 혼잡 안내를 맡는다 |
| **배포·인프라** | 배포 경로를 운영하고(main = Vercel, import-credigraph = 서버 pull), 인스턴스 이전과 RUNBOOK을 맡는다 |

## 다루는 것

- `backend/api/main.py` · `schema.py` — 엔드포인트와 응답 모양
- `supabase/migrations/` — `apply_migration.py`로 적용
- `backend/deploy/` — `bootstrap.sh` · `deploy.sh` · RUNBOOK

## 다른 포지션과의 계약

- **← 지식·AI 엔지니어**: 무거운 호출은 요청 경로에 넣을지 배치로 뺄지를 함께 정한다. 요청 경로에 넣으면 **실패해도 본 동작을 막지 않게**(best-effort) 한다.
- **→ 프론트엔드**: 응답 모양(Zod)이 바뀌면 **프론트를 먼저** 배포한다. 모르는 필드를 Zod가 조용히 지운다.
- **→ 프로덕트 오너**: 비용과 한도를 실측값으로 보고한다(예: Always Free 한도 안이라 컴퓨트 $0).

## 이 자리에 필요한 역량

"push했는데 서버는 구버전"을 의심하는 습관. 그리고 404, 500, 타임아웃이 **각자 다른 것을 뜻한다**는 감각.

## 월간 업무

### 2026년 8월 (W04~W05)

> 마이그레이션을 프로덕션에 붙이고, 깨져 있던 배포 경로를 복구했다. 프로덕션 DELETE의 표준 절차가 생겼다.

| 주차 | 기간 | 주요 업무 |
|---|---|---|
| W04 | 08-23 ~ 08-29 | `0016`~`0018` 적용 · edge 재계산 best-effort 동기 호출 + pg_cron 안전망 · 서버 git 부분 체크아웃 복구 · 인프라 실태(CPU-only, 병목 RAM 1GB) |
| W05 | 08-30 ~ 09-05 | 프로덕션 DELETE 두 번(1차 오타깃, 2차 audits 52·reviews 16·line_feedback 186), RAG 손실 0 · 삭제 표준 절차(RAG 매칭 → 백업 → rowcount → 커밋) |

### 2026년 9월 (W06~W09)

> KE·FE에 붙어 있던 자리에서 갈라져 나온 달. 계기는 규범 거버넌스(인증)와 전시 동시 부하, 상담 채팅의 DB 강제 규칙, 인스턴스 이전이었다. 마지막 주의 중심은 "쓰지 않는 것"이었다.

| 주차 | 기간 | 주요 업무 |
|---|---|---|
| W06 | 09-06 ~ 09-12 | `0019`~`0027` 적용(KB2 스키마 8 + `rag.chat_turns`) · 야간 예약과 폴러 · 상한 없는 LLM 호출 10곳 `bounded_client` · stale job 회수 · 세대 가드 세 겹 · 타임아웃 240 → 60초 |
| W07 | 09-13 ~ 09-19 | 쓰기 API JWT 인증(`AUTH_MODE=required`, 챗 제외) · 이의 기간 폴러·admin 브레이크 · 120초 멈춤 재현 → Upstage FIFO 게이트(k=3, 30초 혼잡 안내, 동시 8 · 216턴 멈춤 0) |
| W08 | 09-20 ~ 09-26 | `0036`~`0040`(마스킹·방·발신자·열람 판정을 DB 함수로) · RLS 정책 함수는 anon revoke 금지 · 12GB ARM64 이전(컴퓨트 $0, lock 고정, `--workers 1`) · RUNBOOK · v2 유닛 disabled + Caddy 폴백 |
| W09 | 09-27 ~ 10-03 | `0041` 작성만, 적재는 dry-run 기본 · 지뢰 셋(PC 절전, 지연 import 교착, 밤 DB 끊김) |
