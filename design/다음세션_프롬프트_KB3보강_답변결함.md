# 다음 세션 — KB3 단독 챗의 빈자리 보강 · 남은 답변 결함 (제품 세션)

**작성 2026-10-06.** 앞 세션 기록 = `history/261006_KB3단독전환_쟁점게이트_프로덕션반영.md`. 정본 설계 = `design/새RAG_KB3_구축설계.md`(D13·D14).
이 파일은 새 세션의 출발점이다. 세션이 끝나면 다음 프롬프트를 새로 쓰고 이 파일은 `docs/done/` 으로 옮긴다.

---

## 0. 지금 상태 (10/6)

| 항목 | 상태 |
|---|---|
| 브랜치 | 메인 폴더 `C:\Users\user\Neo-Luddite`, `import-credigraph`, origin push 됨. origin `main` 은 안 맞춤(프론트 변경 없음) |
| 백엔드 | `158-179-177-51.sslip.io` = `27297de`. **서버 `.env` `RAG_SOURCE=kb3`**(백업 `.env.bak-261006-kb3only`) — 챗 근거 = KB3 단독(kb2·rag·kbdict 안 씀). 되돌리기 = `RAG_SOURCE=fusion` + `sudo systemctl restart neo-luddite-api` |
| 쟁점 게이트 | 자문 경로, 코드 기본 ON. 끄기 = `.env` `KB3_ISSUE_GATE=off`. 전부 빠지면 outcome `off_issue` |
| 계측 | `rag.chat_turns` 에서 `kb3q_`(4턴)·`kb3prod_`(2턴) 접두 제외. `off_issue` 는 G3 분모 밖 — 따로 센다 |

## 1. 먼저 읽는다

1. 메모리 `MEMORY.md` — `project_new_rag_kb3`, `feedback_kb2_origin_ignore`, `project_korean_track_compliance`(D9), `project_corpus_expansion_rules`(6규칙)
2. 앞 세션 기록 §5(보강 목록)·§8(남은 결함)
3. 하네스 `docs/doing/kb3_측정자료_261005/wire_v1/` — `kb3_quality_diag.py`(import 시 DB 쓰기 차단·캡처), `kb3_only_check.py`(시민 48 + 초점 + P8), 원자료 `kb3_only_100637.json`

## 2. 사용자가 고를 일 (세션 시작 때 묻는다)

1. **KB3 보강** — 시민 48 중 KB3 단독으로 못 답한 11문항(off_issue 9 · no_precedent 2):
   의료비·월세·교육비 공제(C02·C05·C06), 부양가족(C08·C09), 전세보증금(C23), 무상거주 증여(C29), 간이과세 환급(C36), 조사 연기(C48), 필요경비(C15). 취득세(C25)는 지방세 — D12 범위 밖.
   - 먼저 **원인 가르기**(DB 쓰기 0): 그 주제 문서가 KB3 에 아예 없나 / 있는데 검색 순위·컷에 밀리나 / 게이트가 잘못 뺐나. `kb3_only_*.json` 의 `gate`·`passages` 와 `kb3.documents` 제목 검색으로.
   - 없는 주제면 **새 원천 수집**(질의회신 추가 세목·기간, 판례 재수집분 등) — 코퍼스 확장 6규칙(계측 먼저 · 한 번에 한 소스 · 라이선스 · 권위 등급 · 소급 가능). D9: 수집·코드는 Claude, 포맷팅은 Upstage.
2. **판례 재수집분 적재** — 사용자 별도 세션 산출(요지 + 상세내용) → `kb3_trib_format.py` 방식 포맷팅 → 따로 계측 → `kb3_prec` 적재(라벨·서열 자리 있음).
3. **남은 답변 결함** — C30 "부친이 증여세 납부"(수증자 납부가 맞음), C16 §39 퍼짐. 프롬프트 규칙은 solar 가 안 따른다는 게 두 번 확인됐다(P8 A, 10/6) → 입력 쪽(카드 본문 구성 등)이나 사후 검출로.
4. **추출(LLM1) 흔들림** — 시민 질문 약 1/3 이 검색 전에 되묻기로 떨어진다(지출 유형·금액을 묻는 엉뚱한 되묻기). KB3 를 보강해도 이 몫은 안 줄어든다. LLM1 데이터는 D10(작성 모델 확인 전 투입 금지).

## 3. 워크플로우

단계마다 사용자 확인: 진단(코드 0 · DB 쓰기 0) → 대응안 고르기 → 구현 + 하네스 로컬 검증 → 배포 → 프로덕션 확인(접두 구별, 예 `kb3r_`).

## 4. 재논의 금지

- Upstage 단독 · D9(제품 텍스트 = 원문 또는 Upstage 생성) · 국세만(D12) · **D13 KB3 단독 · KB2 유래 문제 무시** · D14 게이트('different' 만 뺌)
- 판정은 엔진 권위 · 컷 0.40(뒤집으려면 벤치 근거) · KB 문턱 2

## 5. 하지 말 것

- 로컬 서버(`uvicorn`)로 챗 검증 — 로컬 `.env` 가 **프로덕션 Supabase**. 하네스로.
- 158문항 벤치·논문 실험을 이 세션에 섞기 · 밤에 프로덕션 DB 대량 질의
- 사용자 확인 없이 서버 `.env` 변경·배포 · 프론트 변경 없이 origin `main` push
- KB2·rag·kbdict 에 다시 기대는 대응(D13)

## 6. 환경 메모

- venv `backend/.venv`. 하네스는 `KBDICT_MIN_SCORE`·`KB3_MIN_SCORE` 를 스스로 넣는다. KB3 단독은 `run_one(..., source="kb3")`.
- `/api/chat` 은 `occupation != "clinic"` 이면 파이프라인을 안 탄다 — 시민 질문도 `clinic` 으로.
- 여러 줄 한국어 프롬프트 문자열은 Edit 도구로.
- 서버 SSH: `ssh -i docs/ssh-key-2026-09-24.key ubuntu@158.179.177.51`, 앱 `/opt/neo-luddite/backend`.
- Upstage 지연 시 작문 시간 초과(≈245초) → 폴백 한 줄. 측정에서 이 회차는 따로 센다.
