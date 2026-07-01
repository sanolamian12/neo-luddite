#!/usr/bin/env python3
"""
Korean Tax Case Collection Pipeline
====================================
Collects tax cases from three source types:
  1. 국가법령정보 법령해석례  (law.go.kr expc API  — requires LAW_OC_KEY)
  2. 조세심판원 심판결정례    (tt.go.kr scraping   — no key needed)
  3. 국가법령정보 판례        (law.go.kr prec API  — requires LAW_OC_KEY)
  4. 한국세무사회 상담사례    (kacpta.or.kr scraping)

Usage:
  # Collect all sources (API key needed for expc/prec)
  LAW_OC_KEY=your_key python3 main.py

  # Collect only tribunal decisions (no key needed)
  python3 main.py --sources tribunal

  # Dry-run: show counts without saving
  python3 main.py --dry-run

  # Limit pages per source (for testing)
  python3 main.py --max-pages 2

Output:
  data/raw/{source}_YYYYMMDD.jsonl   — one JSON object per line
  data/processed/all_cases.jsonl     — merged, deduplicated
  data/processed/all_cases.csv       — Excel-friendly CSV
"""

import argparse
import json
import logging
import os
import sys
from datetime import datetime
from pathlib import Path

import config
from collectors.schema import TaxCase, load_jsonl, save_csv, save_jsonl

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("main")


def _load_collector(name: str):
    if name == "expc":
        from collectors.nts_expc import NtsExpcCollector
        return NtsExpcCollector()
    if name == "tribunal":
        from collectors.tribunal import TribunalCollector
        return TribunalCollector()
    if name == "prec":
        from collectors.law_prec import LawPrecCollector
        return LawPrecCollector()
    if name == "kacpta":
        from collectors.kacpta import KacptaCollector
        return KacptaCollector()
    raise ValueError(f"Unknown source: {name}")


def run_collector(name: str, max_pages: int | None, dry_run: bool) -> list[TaxCase]:
    logger.info("=== %s ===", name.upper())
    config.MAX_PAGES = max_pages

    collector = _load_collector(name)

    if name == "expc":
        cases = collector.collect()
    elif name == "tribunal":
        cases = collector.collect_main(max_pages=max_pages or 50)
        semok_cases = collector.collect_by_semok(
            max_pages_per_semok=max_pages or 10
        )
        # Merge, dedup by case_id
        seen = {c.case_id for c in cases}
        for c in semok_cases:
            if c.case_id not in seen:
                cases.append(c)
                seen.add(c.case_id)
    elif name == "prec":
        cases = collector.collect()
    elif name == "kacpta":
        cases = collector.collect(max_pages=max_pages or 5)
    else:
        cases = []

    logger.info("%s: %d cases collected", name, len(cases))
    return cases


def save_raw(name: str, cases: list[TaxCase]):
    date_str = datetime.now().strftime("%Y%m%d")
    path = os.path.join(config.RAW_DIR, f"{name}_{date_str}.jsonl")
    save_jsonl(cases, path)
    logger.info("Saved %d cases → %s", len(cases), path)


def merge_and_save(all_cases: list[TaxCase]):
    # Deduplicate by case_id (keep first occurrence)
    seen: set[str] = set()
    unique = []
    for c in all_cases:
        if c.case_id not in seen:
            seen.add(c.case_id)
            unique.append(c)

    jsonl_path = os.path.join(config.PROCESSED_DIR, "all_cases.jsonl")
    csv_path = os.path.join(config.PROCESSED_DIR, "all_cases.csv")
    save_jsonl(unique, jsonl_path)
    save_csv(unique, csv_path)
    logger.info("Merged: %d unique cases → %s & %s", len(unique), jsonl_path, csv_path)
    return unique


def print_summary(cases: list[TaxCase]):
    by_source: dict[str, int] = {}
    by_tax: dict[str, int] = {}
    by_type: dict[str, int] = {}

    for c in cases:
        by_source[c.source] = by_source.get(c.source, 0) + 1
        by_tax[c.tax_category] = by_tax.get(c.tax_category, 0) + 1
        k = c.decision_type or "N/A"
        by_type[k] = by_type.get(k, 0) + 1

    print("\n" + "=" * 55)
    print(f"  TOTAL CASES: {len(cases)}")
    print("=" * 55)
    print("\nBy Source:")
    for k, v in sorted(by_source.items(), key=lambda x: -x[1]):
        print(f"  {k:<20} {v:>5}")
    print("\nBy Tax Category:")
    for k, v in sorted(by_tax.items(), key=lambda x: -x[1]):
        print(f"  {k:<20} {v:>5}")
    print("\nBy Decision Type:")
    for k, v in sorted(by_type.items(), key=lambda x: -x[1]):
        print(f"  {k:<20} {v:>5}")
    print()


def main():
    parser = argparse.ArgumentParser(description="Korean Tax Case Collector")
    parser.add_argument(
        "--sources",
        nargs="+",
        choices=["expc", "tribunal", "prec", "kacpta", "all"],
        default=["all"],
        help="Which sources to collect (default: all)",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=None,
        help="Max pages per source (None = unlimited). Use 2-3 for testing.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Collect but do not save to disk",
    )
    parser.add_argument(
        "--no-ssl-verify",
        action="store_true",
        help="Disable SSL verification (for corporate proxies)",
    )
    args = parser.parse_args()

    if args.no_ssl_verify:
        config.SSL_VERIFY = False
        import ssl
        ssl._create_default_https_context = ssl._create_unverified_context

    sources = args.sources
    if "all" in sources:
        sources = ["expc", "tribunal", "prec", "kacpta"]

    all_cases: list[TaxCase] = []

    for source in sources:
        try:
            cases = run_collector(source, args.max_pages, args.dry_run)
            all_cases.extend(cases)
            if not args.dry_run and cases:
                save_raw(source, cases)
        except Exception as exc:
            logger.error("Source '%s' failed: %s", source, exc, exc_info=True)

    if all_cases:
        print_summary(all_cases)
        if not args.dry_run:
            merge_and_save(all_cases)
    else:
        logger.warning("No cases collected.")


if __name__ == "__main__":
    main()
