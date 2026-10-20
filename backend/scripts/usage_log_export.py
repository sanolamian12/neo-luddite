"""
Upstage 사용 로그 꺼내기(10/12) — journald 의 `[upstage_call]` 줄 → CSV(호출 단위) + 일자별·기능별 집계 md.
대회 "API/사용 로그" 제출용. DB·네트워크를 쓰지 않는다(입력은 서버에서 받아 온 텍스트 파일).

1) 서버에서 받아 오기 (읽기 전용):
   ssh -i docs/ssh-key-2026-09-24.key ubuntu@158.179.177.51 ^
     "journalctl -u neo-luddite-api -o cat --since 2026-10-12 | grep '^\\[upstage_call\\]'" > upstage_calls.log
2) 변환:
   cd backend && .venv\\Scripts\\python.exe -m scripts.usage_log_export upstage_calls.log --out ../docs/doing/api_usage_log
   → calls.csv, summary.md  (--include-eval 을 주지 않으면 평가 러너(eval) 호출은 집계에서 뺀다)
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

PREFIX = "[upstage_call] "
KST = timezone(timedelta(hours=9))   # 서버 시계는 UTC — 일자 집계는 한국 날짜로
FIELDS = ["ts", "fn", "kind", "model", "ch", "conv", "ms", "ok", "err",
          "prompt_tokens", "completion_tokens", "total_tokens"]


def kst_day(ts: str | None) -> str:
    try:
        return datetime.strptime(ts or "", "%Y-%m-%dT%H:%M:%S%z").astimezone(KST).strftime("%Y-%m-%d")
    except ValueError:
        return (ts or "")[:10]


_DECODER = json.JSONDecoder()


def parse(path: Path) -> list[dict]:
    out = []
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        i = raw.find(PREFIX)
        if i < 0:
            continue
        try:   # JSON 뒤에 다른 로그가 같은 줄로 붙는다(10/19 부하 시험: '}[upstage_gate] …' 245줄) — 앞 객체만 읽는다
            out.append(_DECODER.raw_decode(raw[i + len(PREFIX):])[0])
        except json.JSONDecodeError:
            continue
    return out


def summarize(recs: list[dict]) -> str:
    by_day = defaultdict(Counter)
    by_fn = defaultdict(Counter)
    for r in recs:
        day = kst_day(r.get("ts"))
        for bucket in (by_day[day], by_fn[(r.get("fn"), r.get("model"))]):
            bucket["calls"] += 1
            bucket["fail"] += 0 if r.get("ok") else 1
            bucket["prompt"] += r.get("prompt_tokens") or 0
            bucket["completion"] += r.get("completion_tokens") or 0
            bucket["ms"] += r.get("ms") or 0
    convs = {r["conv"] for r in recs if r.get("conv")}
    lines = ["# Upstage API 사용 로그 요약", "",
             f"- 호출 {len(recs):,}회 · 대화(해시) {len(convs):,}개 · 기간 "
             f"{min(kst_day(r.get('ts')) for r in recs) if recs else '-'} ~ "
             f"{max(kst_day(r.get('ts')) for r in recs) if recs else '-'} (KST)",
             f"- 입력 토큰 {sum(c['prompt'] for c in by_day.values()):,} · 출력 토큰 {sum(c['completion'] for c in by_day.values()):,}",
             "", "## 일자별 (KST)", "", "| 일자 | 호출 | 실패 | 입력 토큰 | 출력 토큰 | 평균 지연(ms) |", "|---|---:|---:|---:|---:|---:|"]
    for day in sorted(by_day):
        c = by_day[day]
        lines.append(f"| {day} | {c['calls']:,} | {c['fail']:,} | {c['prompt']:,} | {c['completion']:,} | {c['ms'] // max(c['calls'], 1):,} |")
    lines += ["", "## 기능(호출 함수)·모델별", "", "| 기능 | 모델 | 호출 | 실패 | 입력 토큰 | 출력 토큰 | 평균 지연(ms) |",
              "|---|---|---:|---:|---:|---:|---:|"]
    for (fn, model), c in sorted(by_fn.items(), key=lambda kv: -kv[1]["calls"]):
        lines.append(f"| {fn} | {model} | {c['calls']:,} | {c['fail']:,} | {c['prompt']:,} | {c['completion']:,} | {c['ms'] // max(c['calls'], 1):,} |")
    return "\n".join(lines) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("log", type=Path)
    ap.add_argument("--out", type=Path, default=Path("api_usage_log"))
    ap.add_argument("--include-eval", action="store_true")
    a = ap.parse_args()
    recs = parse(a.log)
    if not a.include_eval:
        recs = [r for r in recs if r.get("ch") != "eval"]
    a.out.mkdir(parents=True, exist_ok=True)
    with (a.out / "calls.csv").open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
        w.writeheader()
        w.writerows(recs)
    (a.out / "summary.md").write_text(summarize(recs), encoding="utf-8")
    print(f"{len(recs):,}건 → {a.out / 'calls.csv'}, {a.out / 'summary.md'}")


if __name__ == "__main__":
    main()
