# Seam A 라이브챗 "Failed to fetch"(CORS) 원인 규명 + 핫픽스 배포

날짜: 2026-07-10 · 브랜치: `import-credigraph`(→ `main` fast-forward) · 커밋 `349d7ec`
증상: 라이브 상담 화면에서 특정 질문 시 **"Seam A 연결 실패(https://132-145-115-166.sslip.io) … Failed to fetch"**, 브라우저 콘솔엔 **`No 'Access-Control-Allow-Origin' header is present on the requested resource`**. "종종 뜨다가 이제 아예 안 됨."

## 결론 (한 줄)

백엔드는 정상. **특정 질문에서 서버가 500을 던지는데 그 500 응답에 CORS 헤더가 없어 브라우저가 응답을 통째로 차단** → 프론트엔 실제 status 대신 "Failed to fetch"만 표시됐다. 근본 원인은 미지원 지출유형에서의 미처리 예외(500).

## 진단 경로 (재현 가능한 순서)

1. **백엔드 생존 확인** — `/health` `{"ok":true,"service":"seam-a","model":"solar-pro3"}` 200, `/docs` 200. 죽은 게 아님.
2. **CORS 정상 확인** — `/api/chat` OPTIONS 프리플라이트 200 + `Access-Control-Allow-Origin: https://neo-luddite.vercel.app` 정상 하강. 일반 2xx엔 CORS 붙음.
3. **실제 POST → 500** — `/api/chat` 실호출이 ~2s 만에 500. 빠른 실패 = 지연/타임아웃 아님.
4. **500엔 CORS 헤더 없음(결정적)** — Origin 줘도 500 응답에 `Access-Control-Allow-Origin` 부재 → 브라우저가 차단 → fetch가 throw → "Failed to fetch". 증상 완전 설명됨.
5. **RAG/DB 배제** — `/rag/health` `dbConfigured:true, kbPassages:8`, `?rag=false`(RAG 끔)에서도 여전히 500 → **코어 Upstage 경로 문제**, RAG 아님.
6. **Upstage 키 정상** — 로컬 키로 `chat/completions` 직접 호출 200("Pong!"). 키·쿼터·모델 다 정상.
7. **로컬 재현으로 트레이스백 확보** — 실제 파이프라인을 로컬(venv)에서 태워 `KeyError` 확인.

## 근본 원인

- 사용자 질문(대출/이자)에서 Solar가 `etype: "이자비용"`, `amount: 30000000` 추출.
- 엔진 `clinic_expense_engine.ExpenseType`은 **9종뿐**: `업무용승용차·임차료·접대성지출·광고선전비·통신비·복리후생비·출장비·소프트웨어구독·가사관련비`. **이자/금융비용 없음.**
- `engine_adapter.to_engine_inputs()`의 `eng.ExpenseType[extracted["etype"]]`가 이름 조회 → **`KeyError: '이자비용'`** → 미처리 500.
- **function-calling의 `enum`은 소프트 제약** — 목록 밖 값 산출 가능. 질문 문구에 따라 발생/미발생 → "종종 뜨다가 이제 아예"와 정확히 일치(데이터 의존).
- Starlette 기본 500(ServerErrorMiddleware)은 **CORSMiddleware 바깥**에서 나가 CORS 헤더가 없음 → 브라우저가 가려 "Failed to fetch"로 둔갑.

## 수정 (커밋 `349d7ec`, 3파일 44+/3-)

1. **`backend/api/pipeline.py` (`run_clinic`)** — 추출된 `etype`이 `SUPPORTED_ETYPES`에 없으면 크래시 대신 **지원 유형을 안내하는 `caveat` 메시지 반환**(followUp). 마스터 §2.3 graceful 패턴.
2. **`backend/api/engine_adapter.py`** — `biz_type`/`etype` enum 조회를 방어적으로(무효값 → 기본값/graceful), `SUPPORTED_ETYPES` 노출.
3. **`backend/api/main.py`** — `@app.exception_handler(Exception)` 추가: 미처리 예외를 **CORS 헤더(Origin 되비침) 붙은 JSON 500**으로 변환 → 앞으로 어떤 서버 에러든 프론트가 실제 status/detail을 보게(재발 방지, 방어 심층화).

> 주의: 이자비용을 *판정*하게 만든 게 아니라 **미지원 유형을 우아하게 안내**하도록 한 것. 엔진에 이자/금융비용 규칙 추가는 별도 작업.

## 배포 — 프론트 자동 / 백엔드 수동 (핵심 교훈)

- **`main` push의 자동배포는 프론트(Vercel)만.** 이번 fix는 백엔드 변경이라 프론트 재배포는 실질 no-op.
- **백엔드(Oracle 도쿄)는 자동배포 없음** — `/opt/neo-luddite`에 `.git` 없음(최초 tar-pipe 복사본, git도 CI도 아님). 따라서:
  - `git push origin 349d7ec:main`(f6c3dcc..349d7ec, clean fast-forward) — `main`·`import-credigraph` 동기화.
  - `scp` 3파일 → `ubuntu@132.145.115.166:/opt/neo-luddite/backend/api/` (SSH키 `docs/ssh-key-2026-07-09.key`, Windows는 $HOME 복사+chmod600).
  - `sudo systemctl restart neo-luddite-api`.
  - 서버 원본 3파일은 `*.bak`으로 백업(롤백용).

## 라이브 검증 (공개 HTTPS)

- 전엔 500이던 **대출이자 질문 → 200 + `Access-Control-Allow-Origin: …vercel.app` + 안내 메시지** ✅
- 지원 질문(승용차 5천만·운행기록부 없음) → **200 + 판정카드 `전부인정`**, 4.7s 실 Upstage 추론 ✅

## 후속(선택)

- 엔진에 이자/금융비용(지급이자) 판정 규칙 추가 검토 — 병의원 대출이자는 실무상 필요경비 대상.
- 미지원 etype 발생을 로깅해 "규칙 확장 후보"로 수집하면 RAG/엔진 성장 신호로 활용 가능.

관련: 메모리 `project_deployment_plan`(자동배포 경계 못박음) · `reference_upstage_api` · `project_operational_flow` · `260709_SeamC_배포_라이브_Vercel_Oracle도쿄.md`
