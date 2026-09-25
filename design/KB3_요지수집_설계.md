# KB3 요지 수집 — 설계

**작성 2026-09-25.** 여러 세션에 걸친 데이터 수집 공사의 설계 마스터. 진행 기록은 맨 아래 § 진행 기록에 쌓는다.
설계가 현실과 어긋나면 **본문을 고친다.**

근거: `history/260925_KB3요지수집_경로실측_설계확정.md`(조사·결정 기록) · 정본 `docs/doing/BEFORE_AFTER_기능명세.md` A2·A6·O4·S2 (로컬)
· 코퍼스 확장 6규칙(메모리 `project_corpus_expansion_rules`) · LLM2 구현은 `design/LLM1v2_역할축소_구현설계.md` 다음 공사(W5).

---

## 1. 한 문장

**국세법령정보시스템 판례의 '요지'(1~3문장)를 키워드로 모아, LLM2 가 참조할 KB3 코퍼스를 만든다.**
세무사 추천(9/25): 판결 전문이 아니라 **요지를 RAG 에** 넣는다.

## 2. 무엇을 모으나

| 칸 | 출처 필드 | 쓰임 |
|---|---|---|
| **요지** | `ntstDcmGistCntn` | **RAG 본문** — 세무사가 말한 "두세 문장" 정보 |
| 제목 | `ntstDcmTtl` | 검색 보조·화면 표시 |
| 사건번호 | `ntstDcmDscmCntn` (예: `대법원-2025-두-34754`) | 인용·중복 제거 키 |
| 하급심 번호 | `ntstPrdgHpnnNoCntn` | 참고 |
| 세목 코드 | `ntstTlawClCd` | 세법으로 읽고(303 법인·305 종합소득·307 양도소득·308 상증 — 파일럿에서 읽어냄) 우리 17개 세목으로 매핑(`api/rag/taxonomy.py`). 모르는 코드는 관련 법령 이름으로 보조 |
| 귀속연도 | `attrYr` | 최신성 판단 |
| 관련 법령 | `dcmRltnStttList[].ntstTextNm` | 인용 법조문(파일럿 15/20 채움) — LLM2 의 M1(근거 없는 판정 금지) 재료 |
| 쟁점 태그 | `ntstDcmMatrCntn` (`;` 구분) | 검색 보조 → `tags` |
| 출처 링크 | ② 의 Location 그대로(파일럿 20/20 이 `/qt/USEQTA002P.do?ntstDcmId=<id>`), 없을 때만 `/pd/USEPDA002P.do?ntstDcmId=<id>` | 소급 추적 |

요지에는 `<br />`·줄바꿈이 섞여 온다 → 정리본에서 한 칸 공백으로(원본 raw 는 그대로).

**가져오지 않는 것**: 판결 전문 — 원래 "판결 내용은 붙임과 같습니다" + 첨부파일이다.
용어: 이 문서의 "상세 조회"는 **문서 1건을 여는 호출 이름**이지 내용 종류가 아니다. 그 응답 안의 **요지 칸 하나**가 목표다.

## 3. 수집 경로 (✅ 2026-09-25 실제 호출로 확인)

```
① 검색   law.go.kr Open API  GET /DRF/lawSearch.do?OC=<키>&target=prec&type=JSON&search=2&query=<키워드>&display=100&page=N
         → 판례일련번호 목록.  데이터출처명 == "국세법령정보시스템" 만 남긴다
② 연결   law.go.kr 웹       GET /LSW/precInfoP.do?precSeq=<판례일련번호>   (리다이렉트 따라가지 말고 Location 만 읽는다)
         → 302 Location: https://taxlaw.nts.go.kr/…?ntstDcmId=<id>
③ 요지   taxlaw             POST /action.do   form: actionId=ASIQTB002PR01
                                               paramData={"dcmDVO":{"ntstDcmId":"<id>"}}
         → JSON  data.ASIQTB002PR01.dcmDVO.ntstDcmGistCntn …   (status == "SUCCESS" 확인)
```

- `search=2` = 본문 검색. 기본(사건명 검색)은 "병의원" 0건이었다.
- ②가 필요한 이유: law.go.kr Open API 상세(`lawService.do`)는 국세법령정보시스템 판례에 **"일치하는 판례가 없습니다"** —
  기존 `collectors/law_prec.py` 가 요지 57/740 에 그친 원인. `/qt/`·`/pd/` 경로가 달라도 ③ 은 같은 actionId 로 된다(2건 확인).
- **OC 키** = `config.LAW_OC_KEY`(기본값 `choiyoojin` = 팀장 최유진의 open.law.go.kr 이용자 ID). **LLM 키가 아니다** — 수집 ①~③ 에 AI 호출 0, 국내 AI 트랙 무관. 대량 수집 사용 승인됨(9/25 사용자).

### 3-1. 지켜야 할 것

| 규칙 | 값 |
|---|---|
| robots | law.go.kr 전면 Allow · **taxlaw 는 `/is/USEISA001M.do`·`/is/USEISA003M.do`(통합검색) Disallow → taxlaw 에서 검색하지 않는다.** 상세(`/pd/`·`/qt/`·`action.do`)만 |
| 속도 | 요청 간 **1~2초**(`HttpClient(delay=…)`), 동시 요청 없음 |
| 재개 | 이미 받은 `precSeq` 는 건너뛴다(raw jsonl 을 먼저 읽어서) — 중단돼도 이어서. **상한은 raw 누적 기준**(키워드별·전체) — 실행 인자가 바뀌어 순위가 달라져도 더 받지 않는다(파일럿 중 실제로 5건 더 받는 걸 보고 고침) |
| 순서 | ① 결과는 **선고일자순이라 관련성 순위가 없다** → 제목(`사건명`)에 키워드 어절이 다 든 건 먼저, 그다음 최신순. 이게 없으면 "연말정산" 첫 쪽이 횡령·출국 사건으로 찬다(실측) |
| 원본 보존 | ③ 응답의 `dcmDVO` 원문을 raw jsonl 에 그대로 — 정리 규칙이 바뀌어도 재수집 없이 다시 만든다 |
| 실패 | 건별 실패는 로그+카운트 후 다음 건으로. `status != SUCCESS`·요지 빈 칸은 따로 센다 |

## 4. 범위 — 키워드

병의원 한정에서 **전시회 시민 질문까지 확장**(9/25 사용자 승인). 양은 상한으로 조절한다.

| 분야 | 키워드(초안 — 파일럿 후 세무사 보강) |
|---|---|
| 근로자 | 연말정산 · 의료비 세액공제 · 월세 세액공제 · 교육비 공제 · 부양가족 |
| 프리랜서·부업 | 사업소득 · 종합소득세 · 기타소득 · 필요경비 |
| 집 | 1세대 1주택 비과세 · 양도소득세 · 일시적 2주택 · 전세보증금 · 취득세 |
| 가족 간 | 증여세 · 부모 자녀 증여 · 차용증 · 상속세 · 상속공제 |
| 자영업 | 간이과세자 · 부가가치세 · 현금영수증 · 가산세 |
| 병의원 | 의원 · 치과 · 한의원 · 의료업 · 요양급여 · 성실신고 — **"병의원"은 쓰지 않는다**(파일럿: 출처통과 9건·제목적중 0, 걸린 5건이 기부금·리베이트(법인)·농지 감면 — "수도권 병의원을 이용"이 거주 판단 근거로 나온 것) |

- **상한**: 키워드당 30건 · 1차 전체 500건(값은 파일럿 뒤 조정). 키워드별 건수를 로그로 남긴다(어느 키워드가 잡음이었나).
- **잡음 필터**: 출처 필터(①) + 제목 적중 우선(§3-1 순서) + 사건번호 중복 제거. "병의원" 본문 검색 53건 중 대부분이 의료법 형사·특허·손해배상이었다 — 출처 필터가 핵심.
- **근사 중복**: 같은 쟁점이 1심→2심→대법 심리불속행 사슬로 여러 건 온다. 요지 글자 2-gram 자카드 ≥ 0.6 을 `near_dup_of` 로 **표시만** 한다(파일럿 1건 — 농지 1·2심). 제거 여부는 단계 2 에서.
  연말정산 5건은 문구가 달라 안 잡혔지만 **다섯 건 모두 "부과제척기간 5년" 한 쟁점** — 키워드 하나가 한 쟁점으로 쏠린다.
- 한 키워드 결과가 여러 키워드에 겹치면 첫 키워드에 귀속하고 `keywords` 에 전부 기록.

## 5. 산출물·파일

| 자리 | 내용 |
|---|---|
| `backend/collectors/nts_taxlaw.py` ✅ | ①②③ 수집기. `collect`(→raw) / `build`(raw→정리본+계측) 두 명령. 기존 `HttpClient`(+`get_location` 추가)·`TaxCase`(`summary`=요지) 재사용, `source="nts_taxlaw"` |
| `backend/data/raw/nts_taxlaw_<YYYYMMDD>.jsonl` | ③ 원문(`dcmDVO`·`dcmRltnStttList`) + 수집 메타(keyword, precSeq, ntstDcmId, location, search_item, fetched_at) |
| `backend/data/raw/nts_taxlaw_search_<YYYYMMDD>.jsonl` | ① 출처통과 항목 전부(keyword, precSeq, 사건명, title_hit) — `keywords` 겹침 계산용. 재실행 시 이어 붙는다(build 가 중복 무시) |
| `backend/data/processed/kb3_gist.jsonl` | 정리본 — `TaxCase` 칸 + `tax_law`·`tax_law_code`·`attr_year`·`lower_case_number`·`keywords`·`gist_keyword_hit`·`near_dup_of` |
| `backend/data/processed/kb3_pilot_sample.md` | 세무사용 샘플 표(`build --sample-md`) |
| 계측 요약 | `collect` 끝: 키워드별 total/scanned/nts/title_hit/ok/resumed_skip/link_fail/doc_fail/gist_short/dup_other_kw 표 · `build` 끝: §6 비율 JSON |

실행: `cd backend && .venv/Scripts/python.exe -m collectors.nts_taxlaw collect --keywords … --per-keyword 30 --total-cap 500 --max-pages 5` → `… build --sample-md data/processed/kb3_pilot_sample.md`

**브랜치**: 수집기는 오프라인 도구라 `import-credigraph`(기존 `collectors/` 가 있는 곳). 서버는 이 코드를 실행하지 않는다.
**RAG 적재 코드·DB 는 이 공사 범위가 아니다**(§7 단계 4, 제품 세션).

## 6. 수령 검수 기준 (정본 O4 — 수치로 먼저 합의)

초안(파일럿 결과로 확정):
- 요지 **20자 이상** 비율 ≥ 95% (빈 요지·"붙임과 같습니다" 류는 탈락)
- 사건번호·출처 링크 **100%**
- 세목 매핑 성공(미분류 아님) ≥ 80%
- 파일럿 20건 중 **세무사가 "요지만으로 RAG 에 쓸 만하다"** 판정 ≥ 16건
- 관련 법령 칸 채움 비율은 **기록만**(합격 조건 아님 — 원래 비는 경우가 있다)

**파일럿 결과(9/25, 20건)**: 요지 20자↑ **100%** · 사건번호·링크 **100%** · 세목 매핑 **100%**(코드 기준 — 관련 법령 기준이었을 땐 75% 로 미달) · 관련 법령 75% · 요지 키워드 적중 85%(빗나간 3건 = 병의원) · 근사중복 1 · 기존 5월 수집본과 겹침 0 · ②③ 실패 0.
요지 길이 27~429자, 중앙 127자. **주의**: 매핑 100% 중 17개 세목 가운데 '기타'가 아닌 건 85% — 17개가 병의원 지출 관점이라 법인세는 '기타', 양도·연말정산은 전부 `소득세·법인전환·개원폐업` 한 칸으로 몰린다. 적재 때 검색·표시는 `tax_law` 를 함께 쓰는 게 맞다.

## 7. 단계

| 단계 | 내용 | 완료 조건 |
|---|---|---|
| **1 파일럿** ✅ 9/25 | `nts_taxlaw.py` 작성 + 병의원 1 · 시민 키워드 3개로 **20건** | 계측 표 + 요지 샘플 20건 · §6 기계 기준 통과 |
| **2 세무사 확인** | 샘플 20건을 세무사에게 — 요지만으로 충분한가, 키워드 보강 | 판정 ≥ 16/20 · 키워드 목록 확정 · §6 확정 |
| **3 본 수집** | 전체 키워드 · 상한 500 | 계측 표 · §6 기준 통과 · 정리본 커밋 |
| **4 RAG 적재 (제품 세션)** | `rag.passages` 에 corpus `kb3`(`FusionRetriever` 가 corpus 추가 수용, `retriever.py:200`). **프로덕션 DB 쓰기 → 적용 전 사용자 확인** · 권위 등급 · precision 계측 먼저 | LLM2(W5) 설계와 함께 |

## 8. 알고 갈 것

- **트랙**: 수집 ①~③ 은 AI 없음. 세목 분류 등에 LLM 이 필요하면 **Upstage(런타임과 같은 규칙) 또는 오프라인 배치의 Claude** — 제품 구동 경로에 Claude 금지.
- **권위 등급**: 판례 요지는 세무사 검수 코멘트(`rag`)·참고 사전(`kbdict`)과 권위가 다르다(법원·심판 결정). 적재 때 라벨 블록을 따로(`llm.py` P4 관례).
- **저작권·출처**: 판결·결정은 저작권 보호 대상이 아니다(저작권법 제7조). 요지 문안은 국세청 작성 — 출처 링크를 반드시 남긴다.
- 기존 5월 수집본(`backend/data/processed/all_cases.jsonl`, 1,301건)은 의료 관련 ~67건·law_prec 요지 57/740 — 주 재료 아님. 사건번호로 겹침만 확인.

---

## 진행 기록

- **2026-09-25** — 경로 실측·설계 작성. 코드 0줄. 예시 `대법원-2025-두-34754`·`서울고등법원-2015-누-631` 요지 수신 확인. 사용자 결정: 시민 키워드 확장 · OC 키(최유진) 대량 사용 승인 · 요지 = 세무사가 말한 두세 문장 정보. 다음 = 단계 1 파일럿.
- **2026-09-25 (후속 세션)** — **단계 1 완료.** `nts_taxlaw.py`(collect/build) + `HttpClient.get_location`. 키워드 병의원·연말정산·1세대 1주택 비과세·증여세 각 5건 = 20건, ②③ 실패 0, §6 기계 기준 통과(위 파일럿 결과). 본문 고친 것: 링크는 ② Location(`/qt/`) · 세목은 코드 1순위 · 제목 적중 우선 정렬 · 상한 누적 기준 · `<br />` 정리 · 근사중복 표시 · "병의원" 키워드 폐기. 기록 `history/260925_KB3요지수집_단계1파일럿.md`. 다음 = 단계 2(세무사 샘플 판정, 사용자가 받아 옴) → 3.
