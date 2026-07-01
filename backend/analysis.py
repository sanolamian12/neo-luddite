#!/usr/bin/env python3
"""
Tax Case Analysis
==================
Loads collected cases and provides:
  - Distribution summaries (세목, 결정유형, 연도별)
  - Keyword frequency analysis
  - Citation network (which law articles appear most)
  - Difficulty scoring (for training data curation)
  - Export for annotation tools

Usage:
  python3 analysis.py                          # full report
  python3 analysis.py --filter-source tribunal
  python3 analysis.py --filter-tax 법인세
  python3 analysis.py --top-difficult 50       # hardest cases
"""

import argparse
import csv
import json
import os
import re
from collections import Counter, defaultdict
from pathlib import Path

import config
from collectors.schema import TaxCase, load_jsonl, save_csv


# ── Load ─────────────────────────────────────────────────────────────────────

def load_all() -> list[TaxCase]:
    path = os.path.join(config.PROCESSED_DIR, "all_cases.jsonl")
    if not os.path.exists(path):
        # Try raw files
        cases = []
        raw_dir = Path(config.RAW_DIR)
        for f in sorted(raw_dir.glob("*.jsonl")):
            cases.extend(load_jsonl(str(f)))
        return cases
    return load_jsonl(path)


# ── Filters ───────────────────────────────────────────────────────────────────

def filter_cases(
    cases: list[TaxCase],
    source: str | None = None,
    tax_category: str | None = None,
    decision_type: str | None = None,
    year_from: int | None = None,
    year_to: int | None = None,
) -> list[TaxCase]:
    out = []
    for c in cases:
        if source and c.source != source:
            continue
        if tax_category and c.tax_category != tax_category:
            continue
        if decision_type and c.decision_type != decision_type:
            continue
        if year_from or year_to:
            y = int(c.decision_date[:4]) if c.decision_date and len(c.decision_date) >= 4 else 0
            if year_from and y < year_from:
                continue
            if year_to and y > year_to:
                continue
        out.append(c)
    return out


# ── Statistics ────────────────────────────────────────────────────────────────

def describe(cases: list[TaxCase]) -> dict:
    by_source = Counter(c.source for c in cases)
    by_tax = Counter(c.tax_category for c in cases)
    by_type = Counter(c.decision_type or "N/A" for c in cases)
    years = [
        int(c.decision_date[:4])
        for c in cases
        if c.decision_date and len(c.decision_date) >= 4
        and c.decision_date[:4].isdigit()
    ]
    by_year = Counter(years)

    return {
        "total": len(cases),
        "by_source": dict(by_source.most_common()),
        "by_tax_category": dict(by_tax.most_common()),
        "by_decision_type": dict(by_type.most_common()),
        "by_year": {str(k): v for k, v in sorted(by_year.items())},
    }


def top_law_articles(cases: list[TaxCase], top_n: int = 20) -> list[tuple[str, int]]:
    counter: Counter = Counter()
    for c in cases:
        for art in c.law_articles:
            counter[art.strip()] += 1
    return counter.most_common(top_n)


def keyword_frequency(cases: list[TaxCase], top_n: int = 30) -> list[tuple[str, int]]:
    """Tokenise titles and summaries, count word frequency (Korean bigrams)."""
    counter: Counter = Counter()
    for c in cases:
        text = c.title + " " + c.summary
        # Simple whitespace + punctuation tokenisation
        tokens = re.findall(r"[가-힣]{2,6}", text)
        counter.update(tokens)
    # Remove stop words (rough list)
    stops = {"있는", "없는", "하는", "경우", "대한", "관련", "따른", "위하여", "통하여",
              "해당", "이후", "이전", "여부", "유무", "소득", "과세", "적용"}
    return [(w, n) for w, n in counter.most_common(top_n * 2) if w not in stops][:top_n]


# ── Difficulty Scoring ────────────────────────────────────────────────────────

def difficulty_score(case: TaxCase) -> float:
    """
    Heuristic difficulty / curation weight:
      - 인용 tribunal decisions are rarer → harder → higher weight
      - Long full text → more complex
      - Multiple law articles → more complex
      - Recent year → more relevant
    """
    score = 1.0

    # Decision type weights
    weights = {"인용": 2.0, "재조사": 1.8, "기각": 1.0, "각하": 0.6, "회신": 1.2}
    score *= weights.get(case.decision_type or "", 1.0)

    # Length of full text (normalised)
    text_len = len(case.full_text)
    score += min(text_len / 3000, 2.0)

    # Number of law articles cited
    score += min(len(case.law_articles) * 0.2, 1.0)

    # Recency bonus (cases from 2020+)
    if case.decision_date and len(case.decision_date) >= 4:
        try:
            year = int(case.decision_date[:4])
            if year >= 2020:
                score += 0.5
            elif year >= 2015:
                score += 0.2
        except ValueError:
            pass

    return round(score, 3)


def rank_by_difficulty(cases: list[TaxCase], top_n: int | None = None) -> list[tuple[TaxCase, float]]:
    scored = [(c, difficulty_score(c)) for c in cases]
    scored.sort(key=lambda x: -x[1])
    return scored[:top_n] if top_n else scored


# ── Export ────────────────────────────────────────────────────────────────────

def export_for_annotation(
    cases: list[TaxCase],
    path: str,
    include_full_text: bool = False,
):
    """Export a subset for human annotation / fine-tuning."""
    rows = []
    for case, score in rank_by_difficulty(cases):
        row = {
            "case_id": case.case_id,
            "source": case.source,
            "case_number": case.case_number,
            "title": case.title,
            "tax_category": case.tax_category,
            "decision_date": case.decision_date,
            "decision_type": case.decision_type,
            "agency": case.agency,
            "summary": case.summary,
            "difficulty_score": score,
            "source_url": case.source_url,
        }
        if include_full_text:
            row["full_text"] = case.full_text
        rows.append(row)

    os.makedirs(os.path.dirname(path) if os.path.dirname(path) else ".", exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        if rows:
            writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)
    print(f"Exported {len(rows)} cases → {path}")


# ── CLI ───────────────────────────────────────────────────────────────────────

def _print_table(title: str, rows: list[tuple], header: tuple = ("Value", "Count")):
    print(f"\n{title}")
    print("-" * 40)
    print(f"  {header[0]:<25} {header[1]:>8}")
    print("-" * 40)
    for k, v in rows:
        print(f"  {str(k):<25} {v:>8}")


def main():
    parser = argparse.ArgumentParser(description="Tax Case Analysis")
    parser.add_argument("--filter-source", help="Filter by source name")
    parser.add_argument("--filter-tax", help="Filter by tax category (세목)")
    parser.add_argument("--filter-type", help="Filter by decision type")
    parser.add_argument("--year-from", type=int)
    parser.add_argument("--year-to", type=int)
    parser.add_argument("--top-difficult", type=int, default=None,
                        help="Export top-N hardest cases to CSV")
    parser.add_argument("--export", default=None,
                        help="Export ranked cases to this CSV path")
    parser.add_argument("--with-full-text", action="store_true")
    args = parser.parse_args()

    cases = load_all()
    if not cases:
        print("No cases found. Run main.py first.")
        return

    cases = filter_cases(
        cases,
        source=args.filter_source,
        tax_category=args.filter_tax,
        decision_type=args.filter_type,
        year_from=args.year_from,
        year_to=args.year_to,
    )

    stats = describe(cases)

    print("\n" + "=" * 55)
    print(f"  TOTAL: {stats['total']} cases")
    print("=" * 55)

    _print_table("By Source", list(stats["by_source"].items()))
    _print_table("By Tax Category (세목)", list(stats["by_tax_category"].items()))
    _print_table("By Decision Type (결정유형)", list(stats["by_decision_type"].items()))
    _print_table("By Year", list(stats["by_year"].items()))

    top_arts = top_law_articles(cases)
    if top_arts:
        _print_table("Most-Cited Law Articles (법조항)", top_arts)

    kw = keyword_frequency(cases)
    if kw:
        _print_table("Top Keywords (제목+요지)", kw)

    if args.top_difficult or args.export:
        out_path = args.export or os.path.join(
            config.PROCESSED_DIR, "ranked_for_annotation.csv"
        )
        export_for_annotation(cases, out_path, include_full_text=args.with_full_text)


if __name__ == "__main__":
    main()
