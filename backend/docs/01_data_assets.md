# 01. 데이터 자산 (Data Assets)

## 수집 결과 — 1,301건

| 출처 | 코드 | 건수 | 전문(full_text) | 접근 방법 |
|---|---|---:|---|---|
| 조세심판원 결정문 | `tribunal` | 270 | 235건 (~25K자/건) | tt.go.kr 스크래핑 + iframe `xmlViewer.do` |
| 국세청·기재부 유권해석 | `law_expc` | 55 | 55건 (100%) | law.go.kr expc REST API |
| 대법원 세금 판례 | `law_prec` | 741 | 0건 (제목·요지만) | law.go.kr prec API (전문은 SSL 차단) |
| 세무사회 상담 | `kacpta` | 0 | — | 미수집 (수집기만 존재) |
| **병합·중복제거** | | **1,301** | | `data/processed/all_cases.jsonl` |

## 핵심 데이터 파일

```
data/
  raw/
    tribunal_20260528.jsonl    조세심판원 (최신)
    expc_20260528.jsonl        유권해석
    prec_20260528.jsonl        대법원 판례
  processed/
    all_cases.jsonl            병합·중복제거 (분석의 단일 진입점) ★
    all_cases.csv              엑셀용 (UTF-8 BOM)
  analysis/                    분석 산출물 (.txt + .json 쌍)
```

## 스키마 (`collectors/schema.py` → `TaxCase`)

| 필드 | 설명 |
|---|---|
| `case_id` | 고유키 `{source}_{case_number}` |
| `source` | `tribunal` / `law_expc` / `law_prec` / `kacpta` |
| `case_number` | 사건번호 (예: 조심 2025서4062) |
| `title` | 제목/안건명 |
| `tax_category` | 세목 (소득세·법인세·부가가치세·가산세·양도소득세·상속증여·종부세·관세·기타) |
| `law_articles` | 관련 조문 목록 |
| `decision_date` | ISO 날짜 |
| `decision_type` | 인용·기각·각하·재조사·경정·회신 |
| `agency` | 결정·회신 기관 |
| `summary` | 결정요지/답변요지 |
| `full_text` | 본문 전문 |

## 재현 방법

```bash
# 수집 (조세심판원은 키 불필요)
python3 main.py --sources tribunal --max-pages 5

# 유권해석·판례 (LAW_OC_KEY 필요, 등록키="choiyoojin")
LAW_OC_KEY=choiyoojin python3 main.py --sources expc

# 로드
python3 -c "from collectors.schema import load_jsonl; \
cases=load_jsonl('data/processed/all_cases.jsonl'); print(len(cases))"
```

## 수집 시 해결한 핵심 이슈 (재작업 방지)

1. **expc ID 버그**: `<expc id="1">`의 id는 페이지 순번(1,2,3)이지 DB ID 아님 →
   자식요소 `법령해석례일련번호` 사용해야 전문 수집 가능.
2. **조세심판원 카드형 HTML**: 테이블이 아니라 `<li class="result-box">` 카드 →
   정규식 카드 파서 필요.
3. **조세심판원 전문은 iframe**: `/mUser/common/xmlViewer.do?dem_no=X&db=s` 직접 호출.
4. **대법원 판례 전문**: `law.go.kr/LSW` 서브도메인이 SSL EOF 차단 → 전문 수집 불가(제목·요지만).
5. **세목 코드**: 20=법인 12=소득 50=부가 11=양도 40=상증 90=관세 99=기타 95=지방.
6. **결정 코드**: S599=인용 S501=취소 S502=경정 S503=기각 S504=각하 S507=재조사.
