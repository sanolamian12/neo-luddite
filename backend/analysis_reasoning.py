#!/usr/bin/env python3
"""
Goal 3: Legal Reasoning & Interpretive Convention Analysis
==========================================================
Extracts the thinking process and interpretive canons embedded in
Korean tax law decisions. Covers:

  A. Interpretive Canon Detection
     문언해석 / 목적론적 해석 / 체계적 해석 / 유추해석 / 확장·축소해석
     입법취지 / 실질과세원칙 / 신의성실원칙

  B. Argument Structure Mapping
     "청구인 주장 → 처분청 반론 → 심판원 판단" flow
     Key pivot phrases ("그러나", "살피건대", "따라서" etc.)

  C. Legal Authority Hierarchy
     How decisions cite: 법령 > 대법원판례 > 조세심판원결정 > 유권해석

  D. Standard Reasoning Phrases (판단 관용어)
     Phrases that signal the decision's core reasoning

  E. Burden of Proof Patterns
     Who bears the burden in different case types

Output: data/analysis/reasoning_report.txt / .json
        data/analysis/reasoning_patterns.jsonl  (per-case patterns)
"""

import json
import os
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(__file__))
import config
from collectors.schema import load_jsonl, TaxCase
from analysis_structure import extract_tribunal_sections, extract_tribunal_subsections

OUT_DIR = os.path.join(os.path.dirname(__file__), "data", "analysis")
os.makedirs(OUT_DIR, exist_ok=True)

# ── A. Interpretive Canons ────────────────────────────────────────────────────

CANON_PATTERNS: dict[str, list[str]] = {
    "문언해석 (Literal)": [
        r"문언\s*상", r"문언의\s*의미", r"문자\s*그대로", r"명문으로",
        r"조문의\s*문언", r"법문\s*상", r"법문의\s*의미",
    ],
    "목적론적 해석 (Purposive)": [
        r"입법\s*취지", r"입법\s*목적", r"제도의\s*취지", r"규정의\s*취지",
        r"취지에\s*비추어", r"입법\s*연혁", r"도입\s*취지",
    ],
    "체계적 해석 (Systematic)": [
        r"체계\s*적", r"법체계", r"전체적\s*체계", r"다른\s*조항과\s*의\s*관계",
        r"법령\s*전체의", r"관련\s*규정과\s*의",
    ],
    "실질과세 원칙": [
        r"실질\s*과세", r"실질\s*귀속", r"경제적\s*실질", r"실질에\s*따라",
        r"형식\s*보다\s*실질", r"실질적\s*으로",
    ],
    "신의성실 원칙": [
        r"신의\s*성실", r"신의칙", r"금반언", r"신뢰\s*보호",
    ],
    "유추·확장해석 (Analogical)": [
        r"유추\s*적용", r"준용", r"확장\s*해석", r"유사한\s*경우",
        r"마찬가지로", r"같은\s*이치",
    ],
    "엄격해석 (Strict/Tax)": [
        r"엄격\s*하게", r"엄격\s*히", r"과세요건\s*명확주의",
        r"조세\s*법률주의", r"과세요건은\s*법률로",
        r"유추\s*해석[은이]\s*허용",
    ],
    "대법원 판례 인용": [
        r"대법원\s*\d{4}\.\d{1,2}\.\d{1,2}",
        r"대법원\s*판결", r"대법원은", r"대법원\s*\d+다\d+",
        r"판례에\s*의하면", r"선례에\s*따르면",
    ],
    "조세심판원 결정 인용": [
        r"조심\s*\d{4}", r"심판결정례", r"같은\s*취지의\s*결정",
        r"청구이유\s*같은", r"당원은",
    ],
}

# ── B. Argument Flow Markers ───────────────────────────────────────────────────

FLOW_MARKERS: dict[str, list[str]] = {
    "issue_framing": [
        r"이\s*사건의\s*쟁점", r"쟁점은", r"핵심\s*쟁점", r"살펴보건대",
        r"먼저.*살펴", r"이\s*건\s*처분",
    ],
    "claimant_position": [
        r"청구[인법인]*은.*주장", r"청구[인법인]*의.*주장",
        r"청구[인법인]*은.*한다", r"납세자는.*주장",
    ],
    "authority_position": [
        r"처분청은.*주장", r"처분청은.*본다", r"과세관청은",
        r"처분청.*의견", r"피청구인은",
    ],
    "pivots_to_reasoning": [
        r"살피건대", r"그러나", r"이에\s*대하여", r"그런데",
        r"위\s*규정에\s*의하면", r"관련\s*법령에\s*의하면",
        r"관계\s*법령을\s*살펴보면",
    ],
    "conclusion_signal": [
        r"따라서", r"이상과\s*같이", r"위와\s*같은\s*이유로",
        r"결론적으로", r"이상의\s*이유로", r"그러므로",
        r"이\s*건\s*심판청구를", r"청구주장을\s*받아들",
    ],
    "uphold_taxpayer": [
        r"청구주장은\s*이유\s*있", r"청구주장을\s*받아들",
        r"처분은\s*잘못", r"처분은\s*위법", r"취소하여야",
    ],
    "uphold_authority": [
        r"청구주장은\s*이유\s*없", r"청구주장을\s*받아들이기\s*어렵",
        r"처분은\s*적법", r"잘못이\s*없", r"타당하다",
    ],
}

# ── C. Legal Authority Hierarchy ──────────────────────────────────────────────

AUTHORITY_PATTERNS: dict[str, str] = {
    "헌법재판소": r"헌법재판소",
    "대법원": r"대법원\s*\d{4}",
    "고등법원": r"고등법원\s*\d{4}",
    "행정법원": r"행정법원\s*\d{4}",
    "조세심판원": r"조심\s*\d{4}",
    "국세청 예규": r"법인\d{4}-\d+|서면\d{4}-\d+|기재부.*\d{4}",
    "법제처 해석": r"법제처.*\d{4}-\d+",
}

# ── D. Standard Reasoning Phrases ─────────────────────────────────────────────

REASONING_PHRASES = [
    # Opening the legal analysis
    "관련 법령을 살펴보면",
    "살피건대",
    "이 건을 살펴보면",
    "위 규정에 의하면",
    "관계 법령에 의하면",
    # Applying law to facts
    "이에 비추어 보면",
    "위 사실관계를 종합하면",
    "이상의 사실관계를 위 관련 법령에 비추어 보면",
    "이 건 사실관계를 위 규정에 적용하여 보면",
    # Weighing arguments
    "청구주장의 당부를 검토하면",
    "청구인의 주장을 검토한다",
    "처분청의 처분이 적법한지 여부를 살펴본다",
    # Reaching conclusion
    "이상과 같은 이유로",
    "위와 같은 이유로 이 건 심판청구는",
    "처분은 잘못이 없으므로",
    "처분은 잘못이 있으므로",
    # Standard judgments
    "심판청구를 기각한다",
    "당초 처분을 취소한다",
    "재조사하여 그 결과에 따라 과세표준 및 세액을 경정한다",
]


# ── Analysis functions ─────────────────────────────────────────────────────────

def detect_canons(text: str) -> dict[str, int]:
    """Count occurrences of each interpretive canon in text."""
    result = {}
    for canon, patterns in CANON_PATTERNS.items():
        count = sum(len(re.findall(p, text, re.IGNORECASE)) for p in patterns)
        if count:
            result[canon] = count
    return result


def detect_flow_markers(text: str) -> dict[str, list[str]]:
    """Find actual sentences containing each flow marker type."""
    result: dict[str, list[str]] = {}
    sentences = re.split(r"[.。\n]", text)
    for marker_type, patterns in FLOW_MARKERS.items():
        hits = []
        for sent in sentences:
            sent = sent.strip()
            if any(re.search(p, sent, re.IGNORECASE) for p in patterns):
                hits.append(sent[:200])
        if hits:
            result[marker_type] = hits[:3]  # top 3 examples
    return result


def detect_authority_citations(text: str) -> dict[str, int]:
    """Count citations to each type of legal authority."""
    return {
        auth: len(re.findall(pat, text, re.IGNORECASE))
        for auth, pat in AUTHORITY_PATTERNS.items()
        if re.search(pat, text, re.IGNORECASE)
    }


def find_reasoning_phrases(text: str) -> list[str]:
    """Find which standard reasoning phrases appear in text."""
    found = []
    for phrase in REASONING_PHRASES:
        if phrase in text:
            found.append(phrase)
    return found


def extract_issue_statements(text: str) -> list[str]:
    """Extract explicit쟁점 (issue) statements."""
    issues = []
    for m in re.finditer(r"쟁\s*점[은이]?\s*[,:：]?\s*([^.。\n]{20,200})", text):
        issues.append(m.group(1).strip()[:200])
    return issues[:5]


def analyse_case(case: TaxCase) -> dict:
    """Full reasoning analysis for one case."""
    text = case.full_text
    if not text:
        text = case.summary

    # For tribunal, focus on the 이유 section
    reasoning_text = text
    if case.source == "tribunal" and len(text) > 200:
        secs = extract_tribunal_sections(text)
        reasoning_text = secs.get("이유", text)

    return {
        "case_id": case.case_id,
        "source": case.source,
        "tax_category": case.tax_category,
        "decision_type": case.decision_type,
        "canons": detect_canons(reasoning_text),
        "flow_markers": {k: v for k, v in detect_flow_markers(reasoning_text).items()},
        "authority_citations": detect_authority_citations(reasoning_text),
        "reasoning_phrases_found": find_reasoning_phrases(reasoning_text),
        "issue_statements": extract_issue_statements(reasoning_text),
        "text_length": len(text),
        "reasoning_length": len(reasoning_text),
    }


# ── Aggregate statistics ───────────────────────────────────────────────────────

def aggregate_canons(analyses: list[dict]) -> dict:
    """How often does each canon appear across all cases?"""
    counter: Counter = Counter()
    case_count: Counter = Counter()
    total = len(analyses)
    for a in analyses:
        for canon, n in a["canons"].items():
            counter[canon] += n
            case_count[canon] += 1
    return {
        canon: {
            "total_mentions": counter[canon],
            "cases_using": case_count[canon],
            "case_rate": f"{case_count[canon]/total*100:.1f}%",
        }
        for canon in sorted(counter, key=lambda x: -counter[x])
    }


def aggregate_flow(analyses: list[dict]) -> dict:
    """Frequency of flow markers across all cases."""
    counter: Counter = Counter()
    for a in analyses:
        for marker in a["flow_markers"]:
            counter[marker] += 1
    return dict(counter.most_common())


def aggregate_authorities(analyses: list[dict]) -> dict:
    counter: Counter = Counter()
    case_count: Counter = Counter()
    for a in analyses:
        for auth, n in a["authority_citations"].items():
            counter[auth] += n
            case_count[auth] += 1
    return {
        auth: {"total": counter[auth], "cases": case_count[auth]}
        for auth in sorted(counter, key=lambda x: -counter[x])
    }


def aggregate_reasoning_phrases(analyses: list[dict]) -> dict:
    counter: Counter = Counter()
    for a in analyses:
        for p in a["reasoning_phrases_found"]:
            counter[p] += 1
    return dict(counter.most_common(25))


def canon_by_decision_type(analyses: list[dict]) -> dict:
    """Which interpretive canons dominate in 인용 vs 기각 decisions?"""
    by_type: dict[str, Counter] = defaultdict(Counter)
    for a in analyses:
        dtype = a.get("decision_type") or "N/A"
        for canon in a["canons"]:
            by_type[dtype][canon] += 1
    return {dt: dict(c.most_common(5)) for dt, c in by_type.items() if dt != "N/A"}


def canon_by_tax_category(analyses: list[dict]) -> dict:
    """Which interpretive canons are most used per tax category?"""
    by_cat: dict[str, Counter] = defaultdict(Counter)
    for a in analyses:
        for canon in a["canons"]:
            by_cat[a["tax_category"]][canon] += 1
    return {
        cat: dict(c.most_common(3))
        for cat, c in sorted(by_cat.items(), key=lambda x: -sum(x[1].values()))
        if sum(c.values()) > 0
    }


# ── Rendering ─────────────────────────────────────────────────────────────────

def render_report(report: dict) -> str:
    W = 70
    lines: list[str] = []

    def header(t): lines.extend(["", "═" * W, f"  {t}", "═" * W])
    def section(t): lines.extend(["", f"── {t} " + "─" * max(0, W - len(t) - 4)])
    def row(label, val, extra=""): lines.append(f"  {str(label):<40} {str(val):>10}  {extra}")

    header("LEGAL REASONING & INTERPRETIVE CONVENTION ANALYSIS")
    lines.append(f"  Cases with reasoning text: {report['cases_analysed']}")

    section("A. INTERPRETIVE CANONS (해석론)")
    lines.append("""
  Korean tax law decisions employ distinct interpretive canons.
  Frequency shows both total mentions and cases-using rate:\n""")
    for canon, d in report["canon_frequency"].items():
        bar = "█" * min(d["cases_using"] // 3, 25)
        lines.append(
            f"  {canon:<40} {d['cases_using']:>5} cases ({d['case_rate']})  {bar}"
        )

    section("B. CANON USE BY DECISION TYPE (결정유형별 해석론)")
    lines.append("  Which canons appear more in 인용 vs 기각 decisions?\n")
    for dtype, canons in sorted(report["canon_by_decision"].items()):
        lines.append(f"  [{dtype}]")
        for canon, n in canons.items():
            lines.append(f"    {canon:<40} {n:>4}")

    section("C. CANON USE BY TAX CATEGORY (세목별 해석론)")
    for cat, canons in report["canon_by_category"].items():
        if canons:
            tops = ", ".join(f"{c.split('(')[0].strip()}" for c in list(canons)[:3])
            lines.append(f"  {cat:<20}  {tops}")

    section("D. ARGUMENT FLOW MARKERS (논리 전개 신호어)")
    lines.append("""
  Korean decisions follow a structured rhetorical flow.
  Key transitional phrases signal each argumentative move:\n""")
    flow_desc = {
        "issue_framing":       "쟁점 제시      — '이 사건의 쟁점은…', '살펴보건대'",
        "claimant_position":   "청구인 주장    — '청구인은 주장하기를…'",
        "authority_position":  "처분청 의견    — '처분청은 이에 대하여…'",
        "pivots_to_reasoning": "법리 검토 진입 — '살피건대', '그러나', '관련 법령에 의하면'",
        "conclusion_signal":   "결론 도달      — '따라서', '이상과 같이'",
        "uphold_taxpayer":     "납세자 승소    — '처분은 잘못이 있으므로'",
        "uphold_authority":    "과세관청 승소  — '청구주장은 이유 없다'",
    }
    flow_counts = report["flow_marker_frequency"]
    for marker, desc in flow_desc.items():
        n = flow_counts.get(marker, 0)
        lines.append(f"  {desc}")
        lines.append(f"    → found in {n} cases")

    section("E. LEGAL AUTHORITY CITATION HIERARCHY")
    lines.append("""
  How decisions establish legal support (hierarchy: 헌재 > 대법원 > 심판원):
""")
    for auth, d in report["authority_citations"].items():
        bar = "█" * min(d["cases"] // 5, 30)
        lines.append(f"  {auth:<20} {d['total']:>6} mentions  {d['cases']:>5} cases  {bar}")

    section("F. STANDARD REASONING PHRASES (판단 관용어)")
    lines.append("  Formulaic phrases that signal each stage of the reasoning:\n")
    for phrase, n in list(report["reasoning_phrases"].items())[:20]:
        lines.append(f"  ({n:>3}×)  {phrase}")

    section("G. INTERPRETIVE CONVENTIONS SUMMARY")
    lines.append("""
  Key findings on how Korean tax tribunals reason:

  1. STRICT LITERAL INTERPRETATION by default
     Tax obligations arise only where statutes explicitly impose them.
     Ambiguity is resolved against the tax authority (과세요건 명확주의).

  2. PURPOSIVE INTERPRETATION as supplement
     When literal reading leads to absurd results, 입법취지 is invoked.
     Legislators' intent is inferred from 입법연혁 and 제도의 취지.

  3. ECONOMIC SUBSTANCE PRINCIPLE (실질과세원칙)
     Forms are disregarded when substance differs; Art. 14 GNTL applied.
     Critical in tax avoidance, sham transaction, and related-party cases.

  4. HIERARCHICAL CITATION PATTERN
     Decisions cite authorities in descending order of weight:
     헌법재판소 > 대법원 > 고등법원 > 조세심판원 > 유권해석

  5. STANDARD PIVOT: 살피건대 / 이에 대하여
     These phrases mark the transition from fact-recitation to legal analysis.
     Nearly all tribunal decisions use them to signal the 판단 section.

  6. BURDEN OF PROOF
     General rule: tax authority bears burden of proving taxable event.
     Exception: taxpayer bears burden for exemptions, deductions, credits.
     Key phrase: "청구인이 이를 입증하여야 한다" / "처분청이 입증하여야 한다"

  7. PROPORTIONALITY & ABUSE OF RIGHTS
     Increasingly cited in penalty (가산세) cases: whether the taxpayer
     had reasonable grounds (정당한 이유) to be excused from penalties.
""")

    lines.extend(["", "═" * W])
    return "\n".join(lines)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    path = os.path.join(config.PROCESSED_DIR, "all_cases.jsonl")
    if not os.path.exists(path):
        print("Run main.py first.")
        return

    cases = load_jsonl(path)
    cases_with_text = [c for c in cases if len(c.full_text) > 100 or len(c.summary) > 50]
    print(f"Loaded {len(cases)} cases, {len(cases_with_text)} with reasoning text.")

    print("Analysing reasoning patterns...")
    analyses = [analyse_case(c) for c in cases_with_text]

    # Save per-case patterns
    patterns_path = os.path.join(OUT_DIR, "reasoning_patterns.jsonl")
    with open(patterns_path, "w", encoding="utf-8") as f:
        for a in analyses:
            f.write(json.dumps(a, ensure_ascii=False) + "\n")

    report = {
        "cases_analysed": len(analyses),
        "canon_frequency": aggregate_canons(analyses),
        "canon_by_decision": canon_by_decision_type(analyses),
        "canon_by_category": canon_by_tax_category(analyses),
        "flow_marker_frequency": aggregate_flow(analyses),
        "authority_citations": aggregate_authorities(analyses),
        "reasoning_phrases": aggregate_reasoning_phrases(analyses),
    }

    txt = render_report(report)
    print(txt)

    json_path = os.path.join(OUT_DIR, "reasoning_report.json")
    txt_path = os.path.join(OUT_DIR, "reasoning_report.txt")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(txt)
    print(f"\nSaved: {json_path}\nSaved: {txt_path}\nSaved: {patterns_path}")


if __name__ == "__main__":
    main()
