# 한국 세무 케이스 지식베이스 (Knowledge Base)

조세 케이스(심판·해석·판례) 수집 → 분석 → 세무 서비스 전략 → 판단 엔진 프로토타입까지의
모든 작업을 정리한 지식베이스. 향후 프로토타입 개발의 기반 자료.

## 전체 흐름 (probing exercises map)

```
[1] 데이터 수집        3개 출처 → 1,301건 케이스        → docs/01_data_assets.md
        │
[2] 분석 (3 Goals)     Goal1 랜드스케이프
        │              Goal2 결정문 구조
        │              Goal3 해석 관행·사고방식          → docs/02_analysis_findings.md
        │
[3] 서비스 전략         세목 선택 + 직업군 타게팅
        │              (국세통계 정량화 / 페인포인트)    → docs/03_service_strategy.md
        │
[4] 판단 엔진           크리에이터 세무 엔진
        │              병의원 비용처리 엔진              → docs/04_decision_engines.md
        │
[5] 프로토타입 1        세무 상담 챗봇(병의원) 시뮬레이션
        │              Next.js+assistant-ui, 7 Phase     → docs/prototype/README.md
        │
[6] 프로토타입 2        챗 라인 단위 감사 & 피드백
                       (데이터 인벤토리 단계)            → docs/prototype2/README.md
```

## 문서 색인

| 문서 | 내용 |
|---|---|
| [01_data_assets.md](01_data_assets.md) | 수집 데이터 자산·스키마·재현 방법 |
| [02_analysis_findings.md](02_analysis_findings.md) | 3대 분석 목표의 핵심 발견 |
| [03_service_strategy.md](03_service_strategy.md) | 세무 서비스 전략·직업군 타게팅 (국세통계 근거) |
| [04_decision_engines.md](04_decision_engines.md) | 판단 엔진 설계·사용법·확장 가이드 |
| [prototype/README.md](prototype/README.md) | 프로토타입 1: 세무 상담 챗봇 시뮬레이션 (Phase 0–6) |
| [prototype2/README.md](prototype2/README.md) | 프로토타입 2: 챗 라인 단위 감사 & 피드백 (데이터 인벤토리) |

## 코드 자산 한눈에

| 파일 | 역할 | 실행 |
|---|---|---|
| `main.py` | 케이스 수집 파이프라인 | `python3 main.py --sources tribunal` |
| `collectors/` | 출처별 수집기 (tribunal/expc/prec/kacpta) | — |
| `analysis_landscape.py` · `_deep.py` | Goal 1: 랜드스케이프 / 쟁점 택소노미 | `python3 analysis_landscape_deep.py` |
| `analysis_structure.py` | Goal 2: 결정문 구조 분해 | `python3 analysis_structure.py` |
| `analysis_reasoning.py` · `_deep.py` | Goal 3: 해석론 / 결정트리 | `python3 analysis_reasoning_deep.py` |
| `creator_tax_engine.py` | 크리에이터 세무 판단 엔진 | `python3 creator_tax_engine.py` |
| `clinic_expense_engine.py` | 병의원 비용처리 판단 엔진 | `python3 clinic_expense_engine.py` |

## 환경 메모

- Python 3 **표준 라이브러리만** 사용 (사내 프록시로 pip 차단 → 외부 의존성 없음)
- 데이터 재로드: `from collectors.schema import load_jsonl; load_jsonl('data/processed/all_cases.jsonl')`
- 분석 산출물은 `data/analysis/`에 `.txt`(가독용) + `.json`(기계용) 쌍으로 저장
