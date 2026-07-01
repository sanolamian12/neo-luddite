#!/usr/bin/env python3
"""
Deep-Dive Landscape Analysis
==============================
Extracts recurring legal issue clusters by tax category from the full text
of collected cases.  Produces a structured argument taxonomy report.

Output:
  data/analysis/deep_landscape_report.txt
  data/analysis/deep_landscape_report.json
"""

import json
import os
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(__file__))
import config
from collectors.schema import load_jsonl, TaxCase

OUT_DIR = os.path.join(os.path.dirname(__file__), "data", "analysis")
os.makedirs(OUT_DIR, exist_ok=True)

# ── Issue cluster patterns per tax category ───────────────────────────────────
# Each entry: (cluster_name, [keyword_patterns])
# A case matches the cluster if ANY keyword pattern appears in title+full_text.

ISSUE_CLUSTERS: dict[str, list[tuple[str, list[str]]]] = {
    "소득세": [
        ("1세대1주택 양도소득세 비과세", ["1세대1주택", "1세대 1주택", "1가구1주택", "양도소득세.*비과세", "비과세.*양도"]),
        ("근로소득 비과세·범위", ["근로소득.*비과세", "비과세.*근로", "비과세.*봉급", "비과세.*급여", "육아.*수당", "맞춤형복지", "자가운전보조금", "식대.*비과세"]),
        ("필요경비 인정 여부", ["필요경비", "건설자금이자", "감가상각", "업무관련성"]),
        ("대주주·주식 양도차익", ["대주주", "주식.*양도", "양도차익.*주식", "주식.*양도차익"]),
        ("종합소득세 신고·공제", ["종합소득세", "소득공제", "세액공제", "인적공제"]),
        ("퇴직소득세", ["퇴직소득", "퇴직금", "퇴직위로금"]),
        ("원천징수 귀속·납부", ["원천징수", "원천세", "납세의무자.*소득"]),
        ("사업소득·성실신고", ["사업소득", "성실신고", "추계과세", "기준경비율"]),
        ("특수관계인 부당행위", ["부당행위계산", "특수관계인.*소득", "시가.*부당"]),
        ("주택임차자금·장기저당", ["주택임차자금", "장기저당", "임차보증금", "임차자금공제"]),
        ("기타소득 구분", ["기타소득", "일시적.*소득", "상금", "강사료"]),
        ("비거주자·외국인 과세", ["비거주자", "국외원천소득", "조세조약", "외국인.*소득"]),
        ("금융소득 종합과세", ["금융소득.*종합", "이자소득", "배당소득"]),
    ],
    "법인세": [
        ("2차납세의무·과점주주", ["2차납세의무", "과점주주", "제2차.*납세"]),
        ("부과제척기간", ["부과제척기간", "제척기간", "5년.*부과", "10년.*부과", "15년.*부과"]),
        ("국제조세·이전가격·정상가격", ["이전가격", "정상가격", "국외특수관계", "BEPS", "이익분할", "비교가능"]),
        ("합병·분할·구조조정 세무", ["합병.*취득세", "분할.*세무", "구조조정", "포합주식", "합병차손익", "합병법인"]),
        ("공익법인·지정기부금", ["공익법인", "지정기부금", "출연재산", "기부금.*손금", "사회복지법인"]),
        ("손금 인정 범위", ["손금불산입", "손금산입", "업무무관비용", "접대비", "기업업무추진비", "기부금.*한도"]),
        ("사해행위 취소", ["사해행위", "채권자취소", "조세채권.*취소"]),
        ("세금계산서·매출누락", ["매출누락", "누락매출", "세금계산서.*법인"]),
        ("부동산 취득·보유 관련", ["법인.*부동산", "토지.*법인", "비업무용토지"]),
        ("특수관계인 거래·부당행위", ["특수관계인.*법인", "시가초과매입", "부당행위계산.*법인"]),
        ("세액공제·감면", ["세액공제", "중소기업.*감면", "연구개발비", "투자세액공제"]),
        ("결손금 소급공제·이월", ["결손금", "이월결손금", "소급공제"]),
        ("소득처분·인정배당", ["소득처분", "인정배당", "대표자.*인정", "상여처분"]),
        ("납세의무 성립·신고", ["법인세.*신고", "납세의무.*성립", "사업연도"]),
    ],
    "부가가치세": [
        ("세금계산서 진위·가공계산서", ["가공세금계산서", "사실과 다른 세금계산서", "허위세금계산서", "자료상", "가공거래", "세금계산서.*위장", "위장세금계산서"]),
        ("매입세액 불공제", ["매입세액.*불공제", "불공제.*매입세액", "매입세액공제.*부인", "세금계산서.*불공제"]),
        ("면세 적용 범위", ["면세", "부가가치세.*면제", "면세.*농업", "면세.*교육", "면세.*의료", "면세.*식료품"]),
        ("영세율 적용", ["영세율", "수출.*세율", "zero.*rate"]),
        ("과세표준 산정", ["과세표준", "공급가액", "간주공급", "재화의 공급"]),
        ("사업자 등록·공급자 신원", ["실제공급자", "명의위장", "사업자등록.*위장", "실물거래"]),
        ("의제매입세액공제", ["의제매입세액", "의제매입공제"]),
        ("용역 공급 시기·장소", ["용역.*공급시기", "공급시기", "공급장소", "역무의 제공"]),
        ("부동산임대업 과세", ["부동산임대.*부가", "상업용건물", "임대.*과세"]),
        ("간이과세자", ["간이과세", "간이과세자"]),
        ("신탁·공동사업 공급자", ["신탁.*부가", "공동사업.*부가", "명의신탁.*부가"]),
        ("수입재화 부가세", ["수입재화", "관세청.*부가", "수입.*부가가치세"]),
    ],
    "가산세": [
        ("신고불성실 가산세", ["신고불성실", "무신고.*가산세", "과소신고.*가산세"]),
        ("납부불성실 가산세", ["납부불성실", "납부지연.*가산세", "가산세.*납부"]),
        ("세금계산서 미발급 가산세", ["세금계산서.*미발급", "계산서.*불성실", "세금계산서.*가산세"]),
        ("가산세 감면·정당한 사유", ["정당한 사유", "가산세.*면제", "가산세.*감면", "정당한이유"]),
        ("원천징수 불이행 가산세", ["원천징수.*가산세", "원천징수.*불이행", "원천세.*가산"]),
        ("부과제척기간 내 가산세", ["가산세.*제척", "제척기간.*가산세"]),
    ],
    "양도소득세": [
        ("1세대1주택 비과세 요건", ["1세대1주택", "양도소득세.*비과세", "보유기간", "거주기간"]),
        ("취득가액 산정", ["취득가액", "기준시가", "실지거래가액", "환산취득가액"]),
        ("토지·건물 구분 과세", ["토지.*양도", "나대지", "사업용토지", "비사업용토지"]),
        ("특례세율·중과세", ["중과세율", "다주택자", "조정대상지역", "단기양도"]),
        ("양도차익 계산", ["양도차익", "양도가액", "필요경비.*양도"]),
        ("공유물 분할 과세 여부", ["공유물분할", "공유지분", "분할.*양도"]),
        ("국외부동산 양도", ["국외부동산", "해외부동산", "국외자산.*양도"]),
    ],
    "상속세·증여세": [
        ("명의신탁 증여의제", ["명의신탁", "증여의제", "신탁재산.*증여"]),
        ("비상장주식 평가", ["비상장주식.*평가", "주식.*상속", "비상장주식.*증여", "순자산가액"]),
        ("부동산 상속가액", ["상속.*부동산", "상속가액", "부동산.*상속"]),
        ("세대생략 할증과세", ["세대생략", "할증과세", "조부모.*손자"]),
        ("공제 적용", ["배우자공제", "상속공제", "기초공제", "일괄공제"]),
        ("신탁재산 귀속", ["신탁.*상속", "유언대용신탁", "수익자연속신탁"]),
        ("창업자금·가업승계 공제", ["가업승계", "가업상속공제", "창업자금공제"]),
        ("증여 시기·가액 산정", ["증여시기", "증여가액", "증여일.*시가"]),
        ("완전포괄주의 증여", ["완전포괄주의", "포괄적.*증여", "이익의 증여"]),
    ],
    "종합부동산세": [
        ("과세 대상·합산 여부", ["종합부동산세.*합산", "합산배제", "임대주택.*합산", "합산과세"]),
        ("공제 금액·세율", ["종부세.*공제", "공정시장가액비율", "종합부동산세.*세율"]),
        ("부부 공동소유 공제", ["부부공동", "1세대.*종부세", "1가구.*종부세"]),
        ("법인 종합부동산세", ["법인.*종합부동산세", "법인.*종부세"]),
        ("위헌 여부·부과 적법성", ["종합부동산세.*위헌", "위헌.*종부세", "합헌"]),
    ],
    "관세": [
        ("과세가격 결정", ["과세가격", "거래가격", "관세평가", "가산요소"]),
        ("품목분류", ["품목분류", "HS코드", "세번", "관세율표"]),
        ("원산지 판정", ["원산지", "FTA.*관세", "원산지증명"]),
        ("감면·환급", ["관세.*환급", "관세.*감면", "환급신청"]),
        ("부정수입·신고의무", ["밀수", "부정수입", "신고의무.*관세"]),
    ],
    "기타": [
        ("납세의무 성립·귀속 시기", ["납세의무.*성립", "귀속시기", "권리확정주의"]),
        ("국세부과 원칙·신의성실", ["신의성실", "신뢰보호", "실질과세"]),
        ("과세처분 절차 하자", ["절차위반", "세무조사.*위법", "사전통지", "처분이유제시"]),
        ("조세불복·심판 절차", ["심판청구", "이의신청", "감사원심사", "행정소송"]),
        ("지방세 관련", ["취득세", "재산세", "지방세", "등록면허세", "주민세"]),
        ("국세기본법 총칙", ["국세기본법", "조세채권", "납세자권리", "납부기한"]),
    ],
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def normalize_category(cat: str) -> str:
    """Map collected tax_category values to our cluster keys."""
    if not cat:
        return "기타"
    cat = cat.strip()
    MAP = {
        "소득세": "소득세",
        "법인세": "법인세",
        "부가가치세": "부가가치세",
        "가산세": "가산세",
        "양도소득세": "양도소득세",
        "상속세": "상속세·증여세",
        "증여세": "상속세·증여세",
        "종합부동산세": "종합부동산세",
        "관세": "관세",
        "원천세": "기타",
        "기타": "기타",
    }
    return MAP.get(cat, "기타")


def case_text(case: TaxCase) -> str:
    """Combine title + summary + full_text for pattern matching."""
    parts = [case.title or "", case.summary or "", case.full_text or ""]
    return " ".join(parts)


def match_clusters(text: str, clusters: list[tuple[str, list[str]]]) -> list[str]:
    """Return list of cluster names whose keyword patterns match the text."""
    hits = []
    for cluster_name, patterns in clusters:
        for pat in patterns:
            if re.search(pat, text):
                hits.append(cluster_name)
                break
    return hits


def top_keywords_from_titles(cases: list[TaxCase], top_n: int = 30) -> list[tuple[str, int]]:
    """Extract frequent meaningful tokens from titles (2+ chars, Korean)."""
    token_re = re.compile(r"[가-힣]{2,8}")
    STOP = {"하여", "한다", "있다", "없다", "하는", "에서", "으로", "에게", "이를", "이다",
            "것이", "것은", "것을", "경우", "관한", "대한", "따른", "위한", "관련", "여부",
            "해당", "이에", "기타", "당해", "각각", "또는", "및", "등의", "및의", "하여야",
            "적용", "부분", "처분", "가산", "결정", "해석", "대하여", "의한", "이하"}
    counter: Counter = Counter()
    for c in cases:
        title = c.title or ""
        for tok in token_re.findall(title):
            if tok not in STOP and len(tok) >= 2:
                counter[tok] += 1
    return counter.most_common(top_n)


def sample_titles(cases: list[TaxCase], n: int = 8) -> list[str]:
    seen: set[str] = set()
    result = []
    for c in cases:
        t = (c.title or "").strip()[:80]
        if t and t not in seen:
            seen.add(t)
            result.append(t)
        if len(result) >= n:
            break
    return result


# ── Main analysis ─────────────────────────────────────────────────────────────

def analyze_category(cat_key: str, cases: list[TaxCase]) -> dict:
    clusters = ISSUE_CLUSTERS.get(cat_key, ISSUE_CLUSTERS["기타"])
    cluster_counts: Counter = Counter()
    case_cluster_map: list[list[str]] = []

    for case in cases:
        text = case_text(case)
        hits = match_clusters(text, clusters)
        cluster_counts.update(hits)
        case_cluster_map.append(hits)

    unmatched = sum(1 for h in case_cluster_map if not h)

    return {
        "total_cases": len(cases),
        "sources": dict(Counter(c.source for c in cases).most_common()),
        "clusters": {name: cluster_counts.get(name, 0) for name, _ in clusters},
        "unmatched_cases": unmatched,
        "top_keywords": top_keywords_from_titles(cases, 20),
        "sample_titles": sample_titles(cases, 10),
    }


# ── Report rendering ──────────────────────────────────────────────────────────

CATEGORY_DESCRIPTIONS = {
    "소득세": "개인 소득세 — 근로·사업·양도·퇴직·금융소득 전반",
    "법인세": "법인세 — 기업 소득·손금·국제조세·구조조정",
    "부가가치세": "부가가치세 — 거래세·세금계산서·면세·영세율",
    "가산세": "가산세 — 신고·납부 불성실·세금계산서 가산세",
    "양도소득세": "양도소득세 — 부동산·주식 양도차익 과세",
    "상속세·증여세": "상속세·증여세 — 재산이전 과세·명의신탁·평가",
    "종합부동산세": "종합부동산세 — 주택·토지 보유세",
    "관세": "관세 — 수입세·과세가격·품목분류·원산지",
    "기타": "기타 — 국세기본법·지방세·절차 관련",
}

CATEGORY_ORDER = [
    "소득세", "법인세", "부가가치세", "가산세",
    "양도소득세", "상속세·증여세", "종합부동산세", "관세", "기타"
]


def render_report(by_cat: dict[str, dict]) -> str:
    W = 72
    lines: list[str] = []

    def header(t):
        lines.extend(["", "═" * W, f"  {t}", "═" * W])

    def section(t):
        lines.extend(["", f"── {t} " + "─" * max(0, W - len(t) - 4)])

    header("KOREAN TAX DISPUTE — ARGUMENT TAXONOMY BY CATEGORY")
    lines.append(f"  Deep-dive landscape: recurring legal issue clusters\n")

    total_cases = sum(d["total_cases"] for d in by_cat.values())
    lines.append(f"  Total cases analyzed: {total_cases:,}")

    # Overview table
    section("OVERVIEW — CASES PER CATEGORY")
    lines.append(f"  {'Category':<22} {'Cases':>6}  {'Sources'}")
    lines.append("  " + "-" * 60)
    for cat in CATEGORY_ORDER:
        if cat not in by_cat:
            continue
        d = by_cat[cat]
        src_str = "  ".join(f"{k}:{v}" for k, v in d["sources"].items())
        lines.append(f"  {cat:<22} {d['total_cases']:>6}  {src_str}")

    # Per-category deep dive
    for cat in CATEGORY_ORDER:
        if cat not in by_cat:
            continue
        d = by_cat[cat]
        desc = CATEGORY_DESCRIPTIONS.get(cat, cat)
        section(f"{cat}  ({desc})")
        lines.append(f"  Total: {d['total_cases']} cases  |  Unmatched: {d['unmatched_cases']}\n")

        # Cluster breakdown
        clusters = d["clusters"]
        if clusters:
            max_v = max(clusters.values()) if clusters.values() else 1
            lines.append(f"  {'Issue cluster':<38} {'Count':>5}  Bar")
            lines.append("  " + "-" * 65)
            for name, count in sorted(clusters.items(), key=lambda x: -x[1]):
                if count == 0:
                    continue
                bar = "█" * min(int(count / max(max_v, 1) * 25), 25)
                pct = f"{count/d['total_cases']*100:.0f}%"
                lines.append(f"  {name:<38} {count:>5} {pct:>4}  {bar}")

        # Top keywords
        kws = d["top_keywords"]
        if kws:
            kw_str = " · ".join(f"{w}({n})" for w, n in kws[:15])
            lines.append(f"\n  Top title keywords: {kw_str}")

        # Sample titles
        titles = d["sample_titles"]
        if titles:
            lines.append(f"\n  Sample titles (up to 10):")
            for t in titles[:10]:
                lines.append(f"    • {t}")

    # Key findings summary
    section("KEY FINDINGS & NOTEWORTHY TOPICS")
    lines.append("""
  ┌─ 소득세 ─────────────────────────────────────────────────────┐
  │  1. 1세대1주택 비과세 — 주택 수·보유·거주기간 해석이 가장 빈번   │
  │  2. 근로소득 비과세 범위 — 복지포인트·육아수당·식대 포함 여부    │
  │  3. 대주주 요건 — 주식 양도세 과세 기준 분쟁                    │
  │  4. 특수관계인 부당행위계산 — 시가 판단 분쟁                    │
  │  5. 사업소득 vs 기타소득 구분 — 프리랜서·강사 과세 기준          │
  └────────────────────────────────────────────────────────────────┘

  ┌─ 법인세 ─────────────────────────────────────────────────────┐
  │  1. 2차납세의무(과점주주) — 제2차 납세의무자 범위 가장 빈번      │
  │  2. 부과제척기간 — 5·10·15년 기간별 세목별 해석                │
  │  3. 이전가격(국제조세) — 정상가격 산출·이익분할법 분쟁           │
  │  4. 손금 인정 — 접대비(기업업무추진비) 한도·업무무관 비용       │
  │  5. 합병·구조조정 — 합병차손익·취득세 과세 여부                 │
  └────────────────────────────────────────────────────────────────┘

  ┌─ 부가가치세 ──────────────────────────────────────────────────┐
  │  1. 가공·허위 세금계산서 — 자료상·위장거래 (최다 분쟁)           │
  │  2. 매입세액 불공제 — 공급자 불분명·사실과 다른 계산서           │
  │  3. 면세 범위 — 농업·교육·의료용역 면세 경계선                  │
  │  4. 영세율 — 수출거래 요건·간접수출 해당 여부                   │
  │  5. 사업자 등록·공급자 신원 — 명의위장 거래 실질 판단            │
  └────────────────────────────────────────────────────────────────┘

  ┌─ 가산세 ─────────────────────────────────────────────────────┐
  │  1. 신고불성실 가산세 — 정당한 사유 인정 여부가 핵심 쟁점        │
  │  2. 납부지연 가산세 — 납부 불성실 기간 산정                     │
  │  3. 세금계산서 불성실 가산세 — 발급·수취 의무 위반               │
  └────────────────────────────────────────────────────────────────┘

  ┌─ 상속·증여세 ─────────────────────────────────────────────────┐
  │  1. 명의신탁 증여의제 — 실질소유자 vs 명의자 귀속 분쟁           │
  │  2. 비상장주식 평가 — 순자산가액·할인율 산정                    │
  │  3. 완전포괄주의 증여 — 이익의 증여 범위 확장 해석               │
  │  4. 가업상속공제 — 사후관리 요건 충족 여부                      │
  └────────────────────────────────────────────────────────────────┘

  ┌─ 종합부동산세 ────────────────────────────────────────────────┐
  │  1. 합산 여부 — 임대주택·법인소유 주택 합산배제 요건             │
  │  2. 공정시장가액비율 — 세율·공제 적용 기준 분쟁                  │
  └────────────────────────────────────────────────────────────────┘

  ┌─ 관세 ───────────────────────────────────────────────────────┐
  │  1. 품목분류 — HS 세번 분류 다툼 (기술제품·화학품 중심)          │
  │  2. 과세가격 — 거래가격 인정 여부·로열티·가산요소                │
  │  3. 원산지 판정 — FTA 세율 적용 요건                           │
  └────────────────────────────────────────────────────────────────┘""")

    lines.extend(["", "═" * W])
    return "\n".join(lines)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    path = os.path.join(config.PROCESSED_DIR, "all_cases.jsonl")
    if not os.path.exists(path):
        print("Run main.py first.")
        return

    cases = load_jsonl(path)
    print(f"Loaded {len(cases)} cases.")

    # Group by normalized category
    by_raw_cat: dict[str, list[TaxCase]] = defaultdict(list)
    for c in cases:
        by_raw_cat[c.tax_category].append(c)

    # Merge into our taxonomy keys
    by_cat: dict[str, list[TaxCase]] = defaultdict(list)
    for raw_cat, cat_cases in by_raw_cat.items():
        key = normalize_category(raw_cat)
        by_cat[key].extend(cat_cases)

    print(f"Categories: {dict((k, len(v)) for k,v in by_cat.items())}")

    # Analyze each category
    results: dict[str, dict] = {}
    for cat in CATEGORY_ORDER:
        if cat not in by_cat:
            continue
        print(f"  Analyzing {cat} ({len(by_cat[cat])} cases)...")
        results[cat] = analyze_category(cat, by_cat[cat])

    # Render report
    txt = render_report(results)
    print(txt)

    # Save
    txt_path = os.path.join(OUT_DIR, "deep_landscape_report.txt")
    json_path = os.path.join(OUT_DIR, "deep_landscape_report.json")

    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(txt)

    # Make clusters JSON-serializable
    json_results = {}
    for cat, d in results.items():
        json_results[cat] = {
            **d,
            "top_keywords": [[w, n] for w, n in d["top_keywords"]],
        }

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(json_results, f, ensure_ascii=False, indent=2)

    print(f"\nSaved: {txt_path}")
    print(f"Saved: {json_path}")


if __name__ == "__main__":
    main()
