#!/usr/bin/env python3
"""
Goal 1: Overall Landscape Analysis
====================================
Comprehensive statistical portrait of the collected tax cases:
  - Volume & coverage by source, 세목, year
  - Decision outcome rates (인용/기각 etc.) and trends
  - Most active legal battlegrounds (law articles, tax categories)
  - Temporal evolution of tax disputes
  - Cross-source comparison

Output: data/analysis/landscape_report.json  (machine-readable)
        data/analysis/landscape_report.txt   (human-readable)
"""

import json
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(__file__))
import config
from collectors.schema import load_jsonl, TaxCase

OUT_DIR = os.path.join(os.path.dirname(__file__), "data", "analysis")
os.makedirs(OUT_DIR, exist_ok=True)


# ── helpers ──────────────────────────────────────────────────────────────────

def year(c: TaxCase) -> int | None:
    if c.decision_date and len(c.decision_date) >= 4:
        try:
            return int(c.decision_date[:4])
        except ValueError:
            pass
    return None


def pct(n: int, total: int) -> str:
    return f"{n/total*100:.1f}%" if total else "0%"


# ── analysis functions ────────────────────────────────────────────────────────

def source_breakdown(cases: list[TaxCase]) -> dict:
    counter = Counter(c.source for c in cases)
    with_text = Counter(c.source for c in cases if len(c.full_text) > 200)
    return {
        src: {
            "count": n,
            "with_full_text": with_text.get(src, 0),
            "full_text_rate": pct(with_text.get(src, 0), n),
        }
        for src, n in counter.most_common()
    }


def tax_category_breakdown(cases: list[TaxCase]) -> dict:
    counter = Counter(c.tax_category for c in cases)
    by_source: dict[str, Counter] = defaultdict(Counter)
    for c in cases:
        by_source[c.tax_category][c.source] += 1
    return {
        cat: {
            "total": n,
            "share": pct(n, len(cases)),
            "by_source": dict(by_source[cat].most_common()),
        }
        for cat, n in counter.most_common()
    }


def decision_type_breakdown(cases: list[TaxCase]) -> dict:
    counter = Counter(c.decision_type or "N/A" for c in cases)
    tribunal = [c for c in cases if c.source == "tribunal"]
    trib_counter = Counter(c.decision_type or "N/A" for c in tribunal)
    return {
        "all_sources": dict(counter.most_common()),
        "tribunal_only": dict(trib_counter.most_common()),
        "tribunal_인용_rate": pct(trib_counter.get("인용", 0) + trib_counter.get("취소", 0),
                                  sum(trib_counter.values())),
        "tribunal_기각_rate": pct(trib_counter.get("기각", 0), sum(trib_counter.values())),
    }


def temporal_analysis(cases: list[TaxCase]) -> dict:
    by_year: dict[int, list[TaxCase]] = defaultdict(list)
    for c in cases:
        y = year(c)
        if y:
            by_year[y].append(c)

    yearly = {}
    for y in sorted(by_year):
        yr_cases = by_year[y]
        trib = [c for c in yr_cases if c.source == "tribunal"]
        trib_counter = Counter(c.decision_type or "N/A" for c in trib)
        yearly[str(y)] = {
            "total": len(yr_cases),
            "tribunal": len(trib),
            "인용+취소": trib_counter.get("인용", 0) + trib_counter.get("취소", 0),
            "기각": trib_counter.get("기각", 0),
            "재조사": trib_counter.get("재조사", 0),
        }
    return yearly


def top_law_articles(cases: list[TaxCase], top_n: int = 25) -> list[dict]:
    counter: Counter = Counter()
    for c in cases:
        for art in c.law_articles:
            art = art.strip()
            if art and len(art) > 3:
                counter[art] += 1
    return [
        {"article": art, "count": n, "share": pct(n, len(cases))}
        for art, n in counter.most_common(top_n)
    ]


def tax_category_x_decision(cases: list[TaxCase]) -> dict:
    """Cross-tab: tax category × decision type (tribunal only)."""
    trib = [c for c in cases if c.source == "tribunal"]
    result: dict[str, dict] = defaultdict(lambda: defaultdict(int))
    for c in trib:
        result[c.tax_category][c.decision_type or "N/A"] += 1
    # Compute 인용률 per category
    out = {}
    for cat, decisions in sorted(result.items(), key=lambda x: -sum(x[1].values())):
        total = sum(decisions.values())
        accepted = decisions.get("인용", 0) + decisions.get("취소", 0)
        out[cat] = {
            "total": total,
            "인용+취소": accepted,
            "인용률": pct(accepted, total),
            "기각": decisions.get("기각", 0),
            "기각률": pct(decisions.get("기각", 0), total),
            "재조사": decisions.get("재조사", 0),
            "각하": decisions.get("각하", 0),
        }
    return out


def agency_breakdown(cases: list[TaxCase]) -> dict:
    counter = Counter(c.agency for c in cases if c.agency)
    return dict(counter.most_common(15))


def full_text_stats(cases: list[TaxCase]) -> dict:
    lengths = [len(c.full_text) for c in cases if c.full_text]
    if not lengths:
        return {}
    lengths.sort()
    n = len(lengths)
    return {
        "cases_with_text": n,
        "total_chars": sum(lengths),
        "avg_chars": int(sum(lengths) / n),
        "median_chars": lengths[n // 2],
        "min_chars": lengths[0],
        "max_chars": lengths[-1],
        "p25": lengths[n // 4],
        "p75": lengths[3 * n // 4],
    }


# ── report rendering ──────────────────────────────────────────────────────────

def _bar(value: int, max_val: int, width: int = 30) -> str:
    filled = int(value / max_val * width) if max_val else 0
    return "█" * filled + "░" * (width - filled)


def render_text_report(report: dict) -> str:
    lines: list[str] = []
    W = 65

    def header(title: str):
        lines.append("")
        lines.append("═" * W)
        lines.append(f"  {title}")
        lines.append("═" * W)

    def section(title: str):
        lines.append("")
        lines.append(f"── {title} " + "─" * max(0, W - len(title) - 4))

    def row(label: str, value, extra: str = ""):
        s = f"  {str(label):<30} {str(value):>8}"
        if extra:
            s += f"  {extra}"
        lines.append(s)

    header("KOREAN TAX CASE LANDSCAPE ANALYSIS")
    lines.append(f"  Total cases: {report['total']:,}")
    lines.append(f"  Sources: {len(report['source_breakdown'])}")
    lines.append(f"  Date range: {report['date_range']}")

    section("1. SOURCE BREAKDOWN")
    for src, d in report["source_breakdown"].items():
        row(src, d["count"], f"(full text: {d['with_full_text']} / {d['full_text_rate']})")

    section("2. TAX CATEGORY (세목)")
    max_cat = max(d["total"] for d in report["tax_category_breakdown"].values())
    for cat, d in report["tax_category_breakdown"].items():
        bar = _bar(d["total"], max_cat, 20)
        row(cat, d["total"], f"{d['share']}  {bar}")

    section("3. DECISION OUTCOMES")
    all_dec = report["decision_type_breakdown"]["all_sources"]
    max_dec = max(all_dec.values()) if all_dec else 1
    for dtype, n in all_dec.items():
        row(dtype or "N/A", n, _bar(n, max_dec, 20))
    lines.append("")
    lines.append(f"  조세심판원 인용+취소율: {report['decision_type_breakdown']['tribunal_인용_rate']}")
    lines.append(f"  조세심판원 기각율:      {report['decision_type_breakdown']['tribunal_기각_rate']}")

    section("4. TAX CATEGORY × DECISION OUTCOME (조세심판원)")
    lines.append(f"  {'세목':<18} {'건수':>5} {'인용+취소':>8} {'인용률':>8} {'기각':>6} {'재조사':>6}")
    lines.append("  " + "-" * 55)
    for cat, d in report["tax_category_x_decision"].items():
        lines.append(
            f"  {cat:<18} {d['total']:>5} {d['인용+취소']:>8} {d['인용률']:>8} "
            f"{d['기각']:>6} {d['재조사']:>6}"
        )

    section("5. TEMPORAL TREND (연도별)")
    lines.append(f"  {'연도':<6} {'전체':>6} {'심판':>6} {'인용+취소':>9} {'기각':>6} {'재조사':>6}")
    lines.append("  " + "-" * 42)
    for yr, d in sorted(report["temporal_analysis"].items()):
        if int(yr) >= 2010:  # Show from 2010 for readability
            lines.append(
                f"  {yr:<6} {d['total']:>6} {d['tribunal']:>6} "
                f"{d['인용+취소']:>9} {d['기각']:>6} {d['재조사']:>6}"
            )

    section("6. TOP CITED LAW ARTICLES")
    for i, item in enumerate(report["top_law_articles"][:15], 1):
        lines.append(f"  {i:>2}. {item['article'][:50]:<50} {item['count']:>4}")

    section("7. FULL TEXT COVERAGE")
    fts = report["full_text_stats"]
    if fts:
        row("Cases with full text", fts["cases_with_text"])
        row("Total characters", f"{fts['total_chars']:,}")
        row("Average per case", f"{fts['avg_chars']:,}")
        row("Median per case", f"{fts['median_chars']:,}")
        row("Longest case", f"{fts['max_chars']:,}")

    lines.append("")
    lines.append("═" * W)
    return "\n".join(lines)


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    path = os.path.join(config.PROCESSED_DIR, "all_cases.jsonl")
    if not os.path.exists(path):
        print("Run main.py first to collect cases.")
        return

    cases = load_jsonl(path)
    print(f"Loaded {len(cases)} cases.")

    years = [year(c) for c in cases if year(c)]
    date_range = f"{min(years)}–{max(years)}" if years else "unknown"

    report = {
        "total": len(cases),
        "date_range": date_range,
        "source_breakdown": source_breakdown(cases),
        "tax_category_breakdown": tax_category_breakdown(cases),
        "decision_type_breakdown": decision_type_breakdown(cases),
        "temporal_analysis": temporal_analysis(cases),
        "top_law_articles": top_law_articles(cases),
        "tax_category_x_decision": tax_category_x_decision(cases),
        "agency_breakdown": agency_breakdown(cases),
        "full_text_stats": full_text_stats(cases),
    }

    # Save JSON
    json_path = os.path.join(OUT_DIR, "landscape_report.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    # Save text report
    txt = render_text_report(report)
    txt_path = os.path.join(OUT_DIR, "landscape_report.txt")
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(txt)

    print(txt)
    print(f"\nSaved: {json_path}")
    print(f"Saved: {txt_path}")


if __name__ == "__main__":
    main()
