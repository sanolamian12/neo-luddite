"""
Canonical data schema for a collected tax case.
All collectors output TaxCase instances which are serialised to JSON/CSV.
"""

import csv
import json
import os
from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class TaxCase:
    # ── Identity ─────────────────────────────────────────────────────────────
    case_id: str                       # unique key: {source}_{case_number}
    source: str                        # "nts_expc" | "law_expc" | "tribunal" | "kacpta" | "kicpa"
    source_url: str                    # permalink or page URL

    # ── Classification ────────────────────────────────────────────────────────
    case_number: str                   # 문서번호 / 사건번호
    title: str                         # 안건명 / 제목
    tax_category: str                  # 세목 (소득세, 법인세, 부가가치세 …)
    law_articles: list[str]            # 관련 법조항 (조문 번호 목록)

    # ── Decision ──────────────────────────────────────────────────────────────
    decision_date: str                 # ISO date: YYYY-MM-DD
    decision_type: Optional[str]       # 인용 | 기각 | 각하 | 재조사 | 회신 | None
    agency: str                        # 회신기관 / 결정기관

    # ── Content ──────────────────────────────────────────────────────────────
    summary: str                       # 결정 요지 / 답변 요지
    full_text: str                     # 본문 전문 (가능한 경우)

    # ── Metadata ─────────────────────────────────────────────────────────────
    inquiry_agency: Optional[str]      # 질의기관 (유권해석의 경우)
    tags: list[str] = field(default_factory=list)
    collected_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "TaxCase":
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})


# ── I/O helpers ──────────────────────────────────────────────────────────────

CSV_FIELDS = [
    "case_id", "source", "case_number", "title", "tax_category",
    "decision_date", "decision_type", "agency", "inquiry_agency",
    "summary", "source_url", "collected_at",
]


def save_jsonl(cases: list[TaxCase], path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for c in cases:
            f.write(json.dumps(c.to_dict(), ensure_ascii=False) + "\n")


def save_csv(cases: list[TaxCase], path: str):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for c in cases:
            writer.writerow(c.to_dict())


def load_jsonl(path: str) -> list[TaxCase]:
    cases = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                cases.append(TaxCase.from_dict(json.loads(line)))
    return cases
