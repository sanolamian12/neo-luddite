#!/usr/bin/env python3
"""
Goal 2: Resolution Structure Analysis
=======================================
Extracts and maps the structural anatomy of each resolution type:

  조세심판원 결정문:
    처분개요 → 청구인 주장 → 처분청 의견 → 심리 및 판단 → 결론(주문)

  법령해석례 (유권해석):
    질의요지 → 회답 → 이유

  대법원 판례:
    판시사항 → 판결요지 → 이유

Produces:
  - Section length distributions
  - Structural completeness per source
  - Common patterns in each section
  - Extracted structured JSON for each case
  - data/analysis/structure_report.txt / .json
  - data/analysis/cases_structured.jsonl  (one enriched record per case)
"""

import json
import os
import re
import sys
from collections import Counter, defaultdict
from html.parser import HTMLParser

sys.path.insert(0, os.path.dirname(__file__))
import config
from collectors.schema import load_jsonl, TaxCase

OUT_DIR = os.path.join(os.path.dirname(__file__), "data", "analysis")
os.makedirs(OUT_DIR, exist_ok=True)

# ── Section extractors ────────────────────────────────────────────────────────

# Tribunal section markers (appear as bracketed labels in full text)
TRIBUNAL_SECTIONS = [
    "청구번호", "세목", "결정유형", "제목", "결정요지", "관련법령",
    "참조결정", "따른결정", "주문", "이유",
    # Sub-sections within 이유:
    "처분개요", "청구인주장", "청구법인주장", "처분청의견", "심리및판단", "결론",
]

# Subsection patterns within 이유 section
TRIBUNAL_SUBSECTION_RE = re.compile(
    r"(?:^|\n)\s*(\d+[\.\)]\s*)?"
    r"(처분\s*개요|청구[인법인]*\s*주장|처분청\s*의견|심리\s*및\s*판단|결\s*론|쟁\s*점)",
    re.MULTILINE,
)

EXPC_SECTIONS = ["질의요지", "회답", "이유"]

PREC_SECTIONS = ["판시사항", "판결요지", "참조조문", "참조판례"]


def extract_tribunal_sections(full_text: str) -> dict[str, str]:
    """Parse the bracketed section structure of tribunal decisions."""
    sections: dict[str, list[str]] = {}
    current = "header"
    for line in full_text.split("\n"):
        clean = line.strip()
        if not clean or "---" in clean:
            continue
        m = re.match(r"^\[([^\]]{2,20})\]$", clean.replace("\xa0", "").replace("　", ""))
        if m:
            key = m.group(1).replace(" ", "").replace("　", "")
            current = key
            sections.setdefault(current, [])
        else:
            sections.setdefault(current, []).append(clean)

    return {k: " ".join(v).strip() for k, v in sections.items()}


def extract_tribunal_subsections(reasoning: str) -> dict[str, str]:
    """Extract sub-sections within 이유: 처분개요, 청구인 주장, 처분청 의견, 심리 및 판단, 결론."""
    patterns = [
        ("처분개요", r"처\s*분\s*개\s*요"),
        ("청구인주장", r"청구[인법인]*\s*주\s*장"),
        ("처분청의견", r"처\s*분\s*청\s*의\s*견"),
        ("심리및판단", r"심\s*리\s*및\s*판\s*단|판\s*단"),
        ("결론", r"결\s*론"),
    ]
    positions = []
    for name, pat in patterns:
        for m in re.finditer(pat, reasoning):
            positions.append((m.start(), name, m.end()))
    positions.sort()

    subsections: dict[str, str] = {}
    for i, (start, name, end) in enumerate(positions):
        next_start = positions[i + 1][0] if i + 1 < len(positions) else len(reasoning)
        subsections[name] = reasoning[end:next_start].strip()

    return subsections


def extract_expc_sections(case: TaxCase) -> dict[str, str]:
    """For expc cases the schema already has structured fields baked in."""
    text = case.full_text
    sections: dict[str, str] = {}
    for sec in EXPC_SECTIONS:
        m = re.search(rf"{sec}\s*[:\s](.+?)(?={'|'.join(EXPC_SECTIONS)}|$)", text, re.DOTALL)
        if m:
            sections[sec] = m.group(1).strip()[:2000]
    # Fallback: split by approximate positions
    if not sections:
        parts = re.split(r"(질의요지|회\s*답|이\s*유)", text)
        current = None
        for p in parts:
            pk = p.strip().replace(" ", "")
            if pk in ("질의요지", "회답", "이유"):
                current = pk
            elif current:
                sections[current] = p.strip()[:2000]
                current = None
    return sections


def build_structured_case(case: TaxCase) -> dict:
    """Return a dict with source, metadata, and extracted sections."""
    base = {
        "case_id": case.case_id,
        "source": case.source,
        "case_number": case.case_number,
        "title": case.title,
        "tax_category": case.tax_category,
        "decision_date": case.decision_date,
        "decision_type": case.decision_type,
        "agency": case.agency,
        "summary": case.summary,
        "full_text_len": len(case.full_text),
        "sections": {},
        "subsections": {},
        "section_lengths": {},
    }

    if case.source == "tribunal" and case.full_text:
        secs = extract_tribunal_sections(case.full_text)
        base["sections"] = secs
        reasoning = secs.get("이유", "")
        if reasoning:
            base["subsections"] = extract_tribunal_subsections(reasoning)
        base["section_lengths"] = {k: len(v) for k, v in secs.items()}

    elif case.source == "law_expc" and case.full_text:
        secs = extract_expc_sections(case)
        base["sections"] = secs
        base["section_lengths"] = {k: len(v) for k, v in secs.items()}

    elif case.source == "law_prec":
        # For court precedents, the fields are in summary/title
        base["sections"] = {
            "판시사항": case.title,
            "판결요지": case.summary,
        }
        base["section_lengths"] = {k: len(v) for k, v in base["sections"].items()}

    return base


# ── Statistical summaries ──────────────────────────────────────────────────────

def section_presence_rate(structured: list[dict], source: str) -> dict:
    """What fraction of cases have each section?"""
    src_cases = [s for s in structured if s["source"] == source]
    if not src_cases:
        return {}
    all_sections: set[str] = set()
    for s in src_cases:
        all_sections.update(s["sections"].keys())
    return {
        sec: {
            "present": sum(1 for s in src_cases if sec in s["sections"] and s["sections"][sec]),
            "rate": f"{sum(1 for s in src_cases if sec in s["sections"] and s["sections"][sec])/len(src_cases)*100:.0f}%",
            "avg_chars": int(
                sum(len(s["sections"].get(sec, "")) for s in src_cases) / len(src_cases)
            ),
        }
        for sec in sorted(all_sections)
    }


def subsection_stats(structured: list[dict]) -> dict:
    trib = [s for s in structured if s["source"] == "tribunal"]
    if not trib:
        return {}
    subsec_names = ["처분개요", "청구인주장", "처분청의견", "심리및판단", "결론"]
    result = {}
    for name in subsec_names:
        cases_with = [s for s in trib if name in s["subsections"] and s["subsections"][name]]
        result[name] = {
            "present_in": len(cases_with),
            "rate": f"{len(cases_with)/len(trib)*100:.0f}%",
            "avg_chars": int(sum(len(s["subsections"][name]) for s in cases_with) / len(cases_with))
            if cases_with
            else 0,
        }
    return result


def section_length_distribution(structured: list[dict], source: str, section: str) -> dict:
    lengths = [
        s["section_lengths"].get(section, 0)
        for s in structured
        if s["source"] == source and s["section_lengths"].get(section, 0) > 0
    ]
    if not lengths:
        return {}
    lengths.sort()
    n = len(lengths)
    return {
        "n": n,
        "mean": int(sum(lengths) / n),
        "median": lengths[n // 2],
        "p25": lengths[n // 4],
        "p75": lengths[3 * n // 4],
        "max": lengths[-1],
    }


def typical_structure_length(structured: list[dict]) -> dict:
    """Show average length of each section type per source."""
    result: dict[str, dict] = defaultdict(lambda: defaultdict(list))
    for s in structured:
        for sec, length in s["section_lengths"].items():
            if length > 0:
                result[s["source"]][sec].append(length)
    return {
        src: {sec: int(sum(lengths) / len(lengths)) for sec, lengths in secs.items()}
        for src, secs in result.items()
    }


# ── Rendering ─────────────────────────────────────────────────────────────────

def render_report(structured: list[dict], report: dict) -> str:
    W = 65
    lines: list[str] = []

    def header(t): lines.extend(["", "═" * W, f"  {t}", "═" * W])
    def section(t): lines.extend(["", f"── {t} " + "─" * max(0, W - len(t) - 4)])
    def row(label, val): lines.append(f"  {str(label):<35} {str(val):>15}")

    header("RESOLUTION STRUCTURE ANALYSIS")
    lines.append(f"  Total cases analyzed: {len(structured)}")

    section("TRIBUNAL 결정문 구조 (조세심판원)")
    lines.append("""
  Standard 결정문 anatomy:
  ┌─────────────────────────────────────────────────┐
  │  [청구번호]  사건번호 + 결정일                    │
  │  [세목]      소득세 / 법인세 / 부가가치세 …       │
  │  [결정유형]  기각 / 인용 / 재조사 / 각하          │
  │  [결정요지]  핵심 결론 요약 (1-3문장)             │
  │  [관련법령]  근거 법조항 목록                     │
  ├─────────────────────────────────────────────────┤
  │  [주문]      "심판청구를 기각/인용한다."           │
  ├─────────────────────────────────────────────────┤
  │  [이유]      4개 하위 구조:                       │
  │    1. 처분개요        — 과세 경위·배경             │
  │    2. 청구인 주장     — 납세자 논거                │
  │    3. 처분청 의견     — 세무서 반론                │
  │    4. 심리 및 판단    — 심판원의 법리 검토         │
  │   (결론)              — 주문 반복 + 이유 요약      │
  └─────────────────────────────────────────────────┘""")

    trib_presence = report.get("tribunal_section_presence", {})
    if trib_presence:
        lines.append(f"\n  Section presence in tribunal cases:")
        lines.append(f"  {'Section':<20} {'Cases':>7} {'Rate':>7} {'Avg chars':>10}")
        lines.append("  " + "-" * 47)
        for sec, d in sorted(trib_presence.items(), key=lambda x: -x[1]["present"]):
            lines.append(f"  {sec:<20} {d['present']:>7} {d['rate']:>7} {d['avg_chars']:>10,}")

    subsec = report.get("tribunal_subsections", {})
    if subsec:
        lines.append(f"\n  Sub-section extraction (within [이유]):")
        lines.append(f"  {'Sub-section':<20} {'Cases':>7} {'Rate':>7} {'Avg chars':>10}")
        lines.append("  " + "-" * 47)
        for name, d in subsec.items():
            lines.append(f"  {name:<20} {d['present_in']:>7} {d['rate']:>7} {d['avg_chars']:>10,}")

    section("법령해석례 구조 (국세청·법제처 유권해석)")
    lines.append("""
  Standard 해석례 anatomy:
  ┌─────────────────────────────────────────────────┐
  │  [질의요지]   납세자/기관의 질문 + 사실관계       │
  │  [회답]       해석기관의 결론 (1-2문장)           │
  │  [이유]       법령 조문 분석 + 논리 전개           │
  └─────────────────────────────────────────────────┘""")

    expc_lengths = report.get("expc_section_lengths", {})
    if expc_lengths:
        lines.append(f"\n  Section average lengths (chars):")
        for sec, stats in expc_lengths.items():
            if stats:
                lines.append(f"    {sec:<15}: avg {stats.get('mean',0):,}  median {stats.get('median',0):,}")

    section("대법원 판례 구조")
    lines.append("""
  Standard 판례 anatomy:
  ┌─────────────────────────────────────────────────┐
  │  [판시사항]   쟁점 법률 문제 요약                 │
  │  [판결요지]   대법원의 법률 해석 결론              │
  │  [참조조문]   적용 법령 조항                      │
  │  [참조판례]   선례 판례 목록                      │
  │  [이유]       사실관계 + 법리 + 판단              │
  └─────────────────────────────────────────────────┘
  (※ full text via law.go.kr LSW iframe — SSL restricted)""")

    section("SECTION LENGTH COMPARISON")
    avg_lengths = report.get("typical_section_lengths", {})
    for src, secs in avg_lengths.items():
        lines.append(f"\n  {src}:")
        for sec, avg in sorted(secs.items(), key=lambda x: -x[1])[:8]:
            bar = "█" * min(int(avg / 300), 30)
            lines.append(f"    {sec:<20} {avg:>7,} chars  {bar}")

    lines.extend(["", "═" * W])
    return "\n".join(lines)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    path = os.path.join(config.PROCESSED_DIR, "all_cases.jsonl")
    if not os.path.exists(path):
        print("Run main.py first.")
        return

    cases = load_jsonl(path)
    print(f"Loaded {len(cases)} cases. Building structured records...")

    structured = [build_structured_case(c) for c in cases]

    # Save structured cases
    struct_path = os.path.join(OUT_DIR, "cases_structured.jsonl")
    with open(struct_path, "w", encoding="utf-8") as f:
        for s in structured:
            f.write(json.dumps(s, ensure_ascii=False) + "\n")
    print(f"Saved structured cases → {struct_path}")

    trib_structured = [s for s in structured if s["source"] == "tribunal"]
    expc_structured = [s for s in structured if s["source"] == "law_expc"]

    report = {
        "total": len(structured),
        "tribunal_section_presence": section_presence_rate(structured, "tribunal"),
        "expc_section_presence": section_presence_rate(structured, "law_expc"),
        "tribunal_subsections": subsection_stats(structured),
        "expc_section_lengths": {
            sec: section_length_distribution(structured, "law_expc", sec)
            for sec in EXPC_SECTIONS
        },
        "tribunal_section_lengths": {
            sec: section_length_distribution(structured, "tribunal", sec)
            for sec in ["결정요지", "이유", "주문"]
        },
        "typical_section_lengths": typical_structure_length(structured),
    }

    txt = render_report(structured, report)
    print(txt)

    json_path = os.path.join(OUT_DIR, "structure_report.json")
    txt_path = os.path.join(OUT_DIR, "structure_report.txt")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(txt)
    print(f"\nSaved: {json_path}\nSaved: {txt_path}")


if __name__ == "__main__":
    main()
