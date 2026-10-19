r"""시간대 분산 재측정 합산(10/19) — `eval/multi_run.sh` 가 쌓은 회차들을 한 표로.

보고 원칙(사용자 10/19): 시간대를 골라 한 번 재는 것도 '고르기'다 → 전 회차 합산 = 본 숫자, 회차별 값·범위·측정 시각 병기.
열 = 회차 1…N + 합산(전 회차 턴을 합쳐 report_check 를 다시 계산). 시민 48·정의형 6 도 회차별 + 합산.

사용(backend/):
  .\.venv\Scripts\python.exe -m eval.multi_summary --prefix mr1019
  → design/demo_eval_1010/multi_mr1019.md
"""

from __future__ import annotations

import argparse
import glob
import json
import re
import statistics
import sys
from pathlib import Path

from eval.report_check import OUT_DIR, RAW_DIR, _quantile, check, load
from eval import citizen_check
from eval.run_demo_eval import load_env

# 정의형 문항 → 그 법의 정의 조문(답 본문에서 찾는다) · '유령 항'(항 없는 조문에 붙인 제N항)
DEFN = {"D01": r"부가가치세법」?\s?제2조", "D02": r"(?:국세기본법|상속세 및 증여세법)」?\s?제2조",
        "D03": r"소득세법」?\s?제88조", "D04": r"소득세법」?\s?제1조의2", "D05": r"법인세법」?\s?제2조",
        "D06": r"상속세 및 증여세법」?\s?제2조"}
PHANTOM = re.compile(r"(?:상속세 및 증여세법|부가가치세법|국세기본법|법인세법)」?\s?제2조\s?제\d+항|제2조제\d+조(?!의)|제88조\s?제\d+항")


def _files(tag: str) -> list[str]:
    return sorted(glob.glob(str(RAW_DIR / f"{tag}_*.jsonl")))


def _rounds(prefix: str) -> list[int]:
    ns = {int(m.group(1)) for f in glob.glob(str(RAW_DIR / f"{prefix}_r*_*.jsonl"))
          if (m := re.search(rf"{re.escape(prefix)}_r(\d+)_", Path(f).name))}
    return sorted(ns)


def _starts(prefix: str) -> dict[int, str]:
    log = RAW_DIR / f"{prefix}_progress.log"
    out = {}
    if log.exists():
        for line in log.read_text("utf-8").splitlines():
            m = re.search(r"회차 (\d+) 시작 \d{4}-\d\d-\d\d (\d\d:\d\d)", line)
            if m:
                h, mi = map(int, m.group(2).split(":"))
                out[int(m.group(1))] = f"{m.group(2)} UTC · KST {(h + 9) % 24:02d}:{mi:02d}"
    return out


def _defn(files: list[str]) -> tuple[int, int, int]:
    rows = [json.loads(l) for f in files for l in open(f, encoding="utf-8") if l.strip()]
    hit = sum(bool(re.search(DEFN.get(r["scenario"], "^$"), r.get("answer") or "")) for r in rows)
    ghost = sum(len(PHANTOM.findall(r.get("answer") or "")) for r in rows)
    return hit, len(rows), ghost


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--prefix", default="mr1019")
    a = ap.parse_args()
    load_env()   # 시민 48 'DB 밖 조문' 대조에 laws.articles 키가 필요하다
    ns = _rounds(a.prefix)
    if not ns:
        raise SystemExit(f"{a.prefix}_r*_*.jsonl 없음")
    starts = _starts(a.prefix)

    per = {n: {r.label: r for r in check(load(_files(f"{a.prefix}_r{n}")))} for n in ns}
    all_files = [f for n in ns for f in _files(f"{a.prefix}_r{n}")]
    pooled_rows = load(all_files)
    pooled = {r.label: r for r in check(pooled_rows)}
    labels = list(pooled)

    out = [f"# 시간대 분산 재측정 — {a.prefix} ({len(ns)}회차)", "",
           "보고 원칙(사용자 10/19): 합산 = 본 숫자 · 회차별 값과 범위·측정 시각 병기 · 좋은 회차만 고르지 않는다.", "",
           "## 회차", "", "| 회차 | 시작 | 데모 세트 원자료 |", "|---|---|---|"]
    for n in ns:
        out.append(f"| r{n} | {starts.get(n, '?')} | {', '.join(Path(f).name for f in _files(f'{a.prefix}_r{n}'))} |")

    out += ["", "## 데모 세트(보고서 §2-B) — 회차별 · 합산", "",
            "| 지표 | 보고서 | " + " | ".join(f"r{n}" for n in ns) + " | **합산** | 판정 |",
            "|---|---|" + "---|" * len(ns) + "---|---|"]
    for lb in labels:
        p = pooled[lb]
        cells = [per[n][lb].measured + ("" if per[n][lb].verdict == "✅" else f" {per[n][lb].verdict}") if lb in per[n] else "—"
                 for n in ns]
        out.append(f"| {lb} | {p.report} | " + " | ".join(cells) + f" | **{p.measured}** | {p.verdict} |")

    # 지연 분포 — 회차별 p50·p90 의 범위와 합산
    lat = {n: [r["latency_ms"] / 1000 for r in load(_files(f"{a.prefix}_r{n}")) if not r.get("error")] for n in ns}
    p50s = [statistics.median(v) for v in lat.values() if v]
    p90s = [_quantile(v, 0.9) for v in lat.values() if v]
    allv = [x for v in lat.values() for x in v]
    out += ["", "## 지연 분포", "",
            f"- 합산 {len(allv)}턴: p50 **{statistics.median(allv):.1f}s** · p90 **{_quantile(allv, 0.9):.1f}s** · 최대 {max(allv):.1f}s",
            f"- 회차별 p50 범위 {min(p50s):.1f}~{max(p50s):.1f}s · p90 범위 {min(p90s):.1f}~{max(p90s):.1f}s",
            f"- 보고 문구 예: \"응답 p50 {statistics.median(allv):.1f}초 · p90 {_quantile(allv, 0.9):.1f}초"
            f"(10/19 KST 낮~저녁 {len(ns)}회 · {len(allv)}턴 합산, 회차별 p50 {min(p50s):.1f}~{max(p50s):.1f}초)\""]

    cit = [Path(f) for n in ns for f in _files(f"cit_{a.prefix}_r{n}")]
    if cit:
        table = [l for l in citizen_check.check(cit).splitlines() if l.startswith("| cit_") or l.startswith("| 회차") or l.startswith("|---")]
        rows = [json.loads(l) for f in cit for l in f.read_text("utf-8").splitlines() if l.strip()]
        ok = [r for r in rows if not r.get("error")]
        nop = sum(r.get("outcome") == "no_precedent" for r in ok)
        out += ["", "## 시민 48문항 — 회차별", ""] + table + [
            "", f"- 합산 {len(rows)}문항: 자료 없음 {nop}/{len(rows)} ({100 * nop / len(rows):.1f}%) · 오류 {len(rows) - len(ok)}"]

    d = [(n, _defn(_files(f"defn_{a.prefix}_r{n}"))) for n in ns]
    d = [(n, x) for n, x in d if x[1]]
    if d:
        out += ["", "## 정의형 6문항(A5) — 정의 조문 인용 · 유령 항", "", "| 회차 | 정의 조문 인용 | 유령 항 |", "|---|---|---|"]
        out += [f"| r{n} | {h}/{t} | {g} |" for n, (h, t, g) in d]
        H, T, G = (sum(x[i] for _, x in d) for i in range(3))
        out.append(f"| **합산** | **{H}/{T}** | **{G}** |")

    md = OUT_DIR / f"multi_{a.prefix}.md"
    md.write_text("\n".join(out) + "\n", "utf-8")
    print("\n".join(out))
    print(f"\n저장: {md}")


if __name__ == "__main__":
    main()
