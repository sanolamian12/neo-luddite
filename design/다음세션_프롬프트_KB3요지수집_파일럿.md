✅ **KB3 요지 수집 경로는 2026-09-25 에 실측·설계 확정** — 코드는 0줄. 이 프롬프트가 다음 **데이터 세션**(단계 1 파일럿)의 것이다.

**먼저 읽는다 (순서대로)**
1. `design/KB3_요지수집_설계.md` — 설계 마스터. **§3 수집 경로(①②③ 호출 원문) · §3-1 지킬 것 · §4 키워드·상한 · §6 수령 기준**
2. `history/260925_KB3요지수집_경로실측_설계확정.md` — 왜 지금, 실측 표, 사용자와 정한 것
3. 기존 수집기 `backend/collectors/http_client.py`·`schema.py`·`law_prec.py`(DRF 호출 모양 참고) · `backend/config.py`(`LAW_OC_KEY`)

**작업 브랜치: `import-credigraph`** (수집기는 오프라인 도구 — 서버가 실행하지 않는다).

═══ 범위: 설계 §7 단계 1 ═══
- `backend/collectors/nts_taxlaw.py` 새로 — ① law.go.kr DRF 본문검색(`search=2`) → 출처 `국세법령정보시스템` 필터 →
  ② `precInfoP.do` 302 Location 에서 `ntstDcmId` → ③ taxlaw `action.do` `ASIQTB002PR01` 에서 요지.
  요청 간 1~2초 · 재개(받은 ID 건너뜀) · 원문 raw jsonl 보존 · 건별 실패는 세고 넘어감.
- **파일럿 20건**: 병의원 키워드 1개 + 시민 키워드 2~3개(예: 연말정산·1세대 1주택 비과세·증여세).
- 산출: raw `backend/data/raw/nts_taxlaw_<날짜>.jsonl` · 정리본 `backend/data/processed/kb3_gist.jsonl` · **계측 표**(키워드별 검색/출처통과/성공/요지빈칸/중복).
- 완료 조건: §6 기계 기준 통과 + **세무사에게 보여줄 요지 샘플 20건 표**(사건번호·제목·요지·세목·링크). 세무사 판정은 사용자가 받아 온다(단계 2).

═══ 정해진 것 (재논의 금지) ═══
- 요지(`ntstDcmGistCntn`)만 RAG 본문 — 전문은 안 받는다 · 시민 키워드 확장 OK · OC 키 `choiyoojin`(팀장 최유진) 대량 사용 승인 · KB3 는 우리가 수집(정본 A6 정정).

═══ 하지 말 것 ═══
- **taxlaw 에서 검색하지 않는다** — `/is/USEISA001M.do`·`/is/USEISA003M.do` 는 robots Disallow. 검색은 law.go.kr 로만.
- 동시 요청·간격 없는 루프 · 상한 없는 전체 수집(단계 3 전까지 20건).
- `rag.passages` 등 **DB 적재**(단계 4, 제품 세션, 사용자 확인) · 제품 구동 경로에 Claude.
- `agentic-v2` 에 수집기 커밋(수집기는 import-credigraph).

═══ 세션 마무리 ═══
1. 설계 마스터 § 진행 기록 + 어긋난 본문 수정. 2. `history/2609XX_KB3요지수집_…md`. 3. 메모리 `reference_kb3_collection_path`.
4. 다음 프롬프트(단계 2·3)를 `design/` 에 새로 쓰고 **이 파일은 지운다**. 5. import-credigraph 커밋 → `agentic-v2` 로 merge.
