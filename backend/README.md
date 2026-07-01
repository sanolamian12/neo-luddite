# Korean Tax Case Collection Pipeline

Collects and structures tax cases from Korean government sources for analysis.

> 📚 **지식베이스**: 수집·분석·전략·판단 엔진의 전체 정리는 [`docs/README.md`](docs/README.md) 참조.
> 프로토타입 개발 시 이 지식베이스를 출발점으로 사용.

## Sources

| Source | URL | Method | Key Required |
|--------|-----|--------|------|
| 법령해석례 (국세청·기재부 유권해석) | law.go.kr expc API | REST API | ✅ LAW_OC_KEY |
| 조세심판원 결정례 | tt.go.kr | Web scraping | ❌ |
| 대법원 세금 판례 | law.go.kr prec API | REST API | ✅ LAW_OC_KEY |
| 세무사회 상담사례 | kacpta.or.kr webzine | Web scraping | ❌ |

## Setup

### 1. Get API key (for 법령해석례 + 판례)
Register at https://open.law.go.kr/LSO/openApi/keyApplyView.do
Free, instant approval. Set the key as an environment variable:
```bash
export LAW_OC_KEY="your_key_here"
```

### 2. (Optional) Install packages for better performance
```bash
python3 -m venv .venv
.venv/bin/pip install requests beautifulsoup4 lxml pandas
```
The pipeline works with Python stdlib only — these packages are optional.

### 3. Run collection

```bash
# Collect from all sources (API key needed for expc/prec)
LAW_OC_KEY=your_key python3 main.py

# Collect only tribunal decisions (no key needed, immediate)
python3 main.py --sources tribunal

# Test with 2 pages per source
python3 main.py --max-pages 2

# Bypass SSL for corporate proxies
python3 main.py --no-ssl-verify

# Dry run (no files saved)
python3 main.py --dry-run --max-pages 1
```

### 4. Analyse results

```bash
# Full statistical report
python3 analysis.py

# Filter by tax category
python3 analysis.py --filter-tax 법인세

# Export top-100 hardest cases for annotation
python3 analysis.py --top-difficult 100 --export data/processed/hard_cases.csv

# Export with full text
python3 analysis.py --export data/processed/ranked.csv --with-full-text
```

## Output Files

```
data/
  raw/
    tribunal_YYYYMMDD.jsonl       — raw tribunal decisions
    expc_YYYYMMDD.jsonl           — raw 법령해석례
    prec_YYYYMMDD.jsonl           — raw court precedents
    kacpta_YYYYMMDD.jsonl         — raw 세무사회 cases
  processed/
    all_cases.jsonl               — merged, deduplicated
    all_cases.csv                 — Excel-friendly (UTF-8 BOM)
    ranked_for_annotation.csv     — sorted by difficulty score
```

## Data Schema (TaxCase)

| Field | Description |
|-------|-------------|
| case_id | Unique key: `{source}_{case_number}` |
| source | `law_expc` / `tribunal` / `law_prec` / `kacpta` |
| case_number | 문서번호 / 사건번호 |
| title | 안건명 / 사건명 |
| tax_category | 세목 (소득세, 법인세, 부가가치세 …) |
| law_articles | 관련 조문 목록 |
| decision_date | ISO date (YYYY-MM-DD) |
| decision_type | 인용 / 기각 / 각하 / 재조사 / 회신 |
| agency | 결정·회신 기관 |
| summary | 결정요지 / 답변요지 (≤500자) |
| full_text | 본문 전문 |
| inquiry_agency | 질의기관 (유권해석의 경우) |
| difficulty_score | Heuristic weight for curation (analysis.py) |

## Difficulty Scoring

`analysis.py` scores each case by:
- Decision type weight (인용 > 재조사 > 기각)
- Full text length (longer = more complex)
- Number of law articles cited
- Recency (2020+ bonus)

Use `--top-difficult N` to extract the hardest N cases for labelling.
