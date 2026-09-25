✅ **LLM1 데이터·평가 세션은 2026-09-25 에 끝났다 — 결론: LLM1 역할 축소.** 이 프롬프트가 다음 세션(**제품 세션**)의 것이다.

**먼저 읽는다 (순서대로)**
1. `design/LLM1v2_역할축소_구현설계.md` — **설계 마스터.** 흐름(§3)·코드 자리(§4)·단계(§5)·열린 결정(§6)·측정 밖 변경(§7)·검증된 프롬프트 원문(부록 A·B)
2. `history/260925_LLM1_W4개선회차_…LLM1역할축소.md` — 왜 이렇게 됐나(수치)
3. `docs/doing/v2격리_원복설계.md` — 격리 3층·클론 범위·원복 4단계·**브랜치가 못 지키는 것 4개**(§4)
4. `history/260924_Phase0_인프라이전_A1_12GB_ARM64_이관완료.md` · `history/260924_운영_RUNBOOK_인프라이전_후.md` — 서버 현황(단계 0.5 가 여기 위에 선다)

═══ 이 세션의 범위: 설계 §5 의 단계 0.5 와 1 ═══
**0.5 — v2 자리 (서버)**
- systemd 유닛 2개를 띄울 수 있는 구성(v2 유닛 파일은 두되 **enable 하지 않음**) + Caddy 라우팅 자리.
- `--workers 1` 유지(워커 늘리면 리퍼가 다른 워커의 job 을 죽인다 — Phase 0 기록). 의존성은 `requirements-api.lock.txt`.
- 완료 조건: **v1 동작 영향 0** — 헬스체크 + 실제 채팅 1회.

**1 — 브랜치 + 스캐폴딩 (코드)**
- `agentic-v2` 를 `import-credigraph` 에서 분기. **이 브랜치를 import-credigraph·main 에 합치지 않는다.**
- `backend/api/pipeline_agentic.py` 골격(처음엔 v1 `pipeline.run_clinic` 으로 위임) + `CHAT_PIPELINE=v1|v2` env + `?pipeline=v2`
  (`main.py:1251` 의 `rag`/`ragSource` 인자와 같은 모양), **디폴트 v1**.
- 열린 결정 **O-2(턴 간 상태)** — `schema.py`·프론트 `Message` 타입을 보고 선택지(권고: 응답 선택 필드 + history 왕복 / `agentic.*` 테이블)와
  근거를 제시하고 **사용자가 결정**한다. O-1 의 "건너뛰기" 신호가 들어갈 자리도 같이 본다.
- 완료 조건: 디폴트 v1 에서 기존 테스트 통과 · `?pipeline=v2` 가 골격을 탄다.

여력이 남으면 단계 2(W3, `llm1.extract_facts()` — 부록 A **원문 그대로**, 판정 필드 값은 무시)에 착수.

═══ 사용자에게 물을 것 (정하지 말 것) ═══
- ~~O-1~~ **확정(9/25)**: "이대로 답변 받기" 버튼 둔다(정본 A1-1) — 구현은 단계 3. 이 세션에선 O-2 설계 때 **"건너뛰기" 신호가 들어갈 자리**까지 같이 본다.
- **O-2**: **사용자가 이 세션에서 결정한다**(9/25 유보) — 단계 1 에서 `schema.py`·프론트 `Message` 를 보고 선택지와 근거를 제시, 결정을 받는다.

═══ 재논의 금지 ═══
- **LLM1 은 1턴에서 충분을 판정하지 않는다.** D4 는 로직이고 종료를 보장할 뿐. 2턴 대조 범위는 **닫는다**(열린 재추출 금지).
- 모델 교체 · 검색형 체크리스트 RAG — 9/25 측정으로 닫힘.
- D3·D4 값, action 3종(ask/proceed/proceed_with_gap), kind new/rephrase/reask, 턴별 filled/unknown, KB2 폐기, solar-pro3, normalized_query=인계 계약.

═══ 하지 말 것 ═══
- `import-credigraph` 에 v2 코드 push(서버가 pull 한다) · 프론트 `main` push(Vercel 자동 배포).
- 기존 테이블 ALTER/DROP — DB 가 필요하면 **새 스키마 `agentic.*` 에 추가만**. `kb2.*` 삭제 금지.
- 공유 파일 클론(`schema.py`·`upstage_gate.py`·`numeric_guard.py`·`handoff.py`·`auth.py`·`rag/*`). `pipeline.py`·`llm.py`·`handoff.py` 수정 금지.
- 서버 `.env` 는 deploy.sh 밖이다 — `CHAT_PIPELINE` 추가는 손으로, RUNBOOK 에 적는다.
- 데이터·평가 작업(하니스 모드 추가, 턴 단위 평가 = 설계 §5 단계 4)은 **이 세션에서 하지 않는다** — 별도 데이터 세션.

═══ 세션 마무리 ═══
1. 설계 마스터 § 진행 기록에 한 줄 + 현실과 어긋난 본문 수정. 2. 기록 `history/2609XX_LLM1v2_…md`.
3. 메모리 `project_llm1_pivot` 갱신. 4. 다음 단계 프롬프트를 `design/` 에 새로 쓰고 **이 파일은 지운다**(design/README 규칙). 5. 커밋.
