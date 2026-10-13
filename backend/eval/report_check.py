r"""
결과보고서 수치 대조 (10/13) — `run_demo_eval.py` 원자료(jsonl)를 보고서 2.4·2.1 약속값에 바로 대조한다.

지침 `design/결과보고서_약속이행_개발지침_1013.md` §1 규칙 1("배포할 때마다 회귀 계측, §3 수치가 나빠지면 되돌리거나 그날 고친다")을
세션이 손으로 비교하다 빠뜨리지 않게 판정까지 기계로 낸다. 목표값은 아래 TARGETS 한 곳에만 둔다 — 보고서 원고 숫자가
바뀌면(지침 §5) 여기도 같은 날 고친다.

사용 (backend/ 에서):
    .\.venv\Scripts\python.exe -m eval.report_check                      # 가장 최근 계측 1회
    .\.venv\Scripts\python.exe -m eval.report_check --tag f1_prod        # 태그로(같은 태그 여러 회차면 합쳐서)
    .\.venv\Scripts\python.exe -m eval.report_check --files a.jsonl b.jsonl
결과: 화면 출력 + design/demo_eval_1010/report_check_<태그>.md
판정: ✅ 약속 충족 · ⚠ 경계(목표의 90% 안쪽까지) · ❌ 미달 · ℹ 참고(이 세트로는 판정 못 함)
"""

from __future__ import annotations

import argparse
import glob
import json
import os
import re
import statistics
from dataclasses import dataclass
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
RAW_DIR = _BACKEND.parent / "docs" / "doing" / "demo_eval_1010"
OUT_DIR = _BACKEND.parent / "design" / "demo_eval_1010"

# 보고서 약속값(원고 2.4 "최종" 열 · 2.1 지표). 바꿀 땐 원고·지침 §2-B 와 같은 날.
TARGETS = {
    "canned": 0.0,          # 상투 거절 답변 0%
    "error": 0.0,           # 서버 오류 0%
    "cited": 0.80,          # 출처 표시 답변 80% 이상
    "p50": 8.0,             # 응답 p50 8초 이내
    "p90": 14.0,            # 응답 p90 14초 이내
    "calc": 1.0,            # 근로소득세 계산 완결 100%
    "expense": 6,           # 경비 3턴 내 판정 6/6
    "law_first": 0.90,      # (A4) 자문형 답변 첫 근거가 법령 ≥90% — 근사 측정
}
EXPENSE_IDS = ("E01", "E02", "E03", "E04", "E05", "E06")
_STATUTE = re.compile(r"[가-힣]+법(?:\s?시행령|\s?시행규칙)?\s?제\s?\d+\s?조")


@dataclass
class Row:
    label: str
    report: str
    measured: str
    verdict: str
    note: str = ""


def _pct(x: float) -> str:
    return f"{x * 100:.1f}%"


def _quantile(xs: list[float], q: float) -> float:
    if not xs:
        return float("nan")
    xs = sorted(xs)
    k = (len(xs) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (k - lo)


def _upper_ok(value: float, target: float) -> str:
    """값이 작을수록 좋은 지표(지연·오류)."""
    if value <= target:
        return "✅"
    return "⚠" if value <= target * 1.1 else "❌"


def _lower_ok(value: float, target: float) -> str:
    """값이 클수록 좋은 지표(출처·완결)."""
    if value >= target:
        return "✅"
    return "⚠" if value >= target * 0.9 else "❌"


def load(files: list[str]) -> list[dict]:
    rows: list[dict] = []
    for f in files:
        run = Path(f).stem
        for line in open(f, encoding="utf-8"):
            r = json.loads(line)
            r["_run"] = run
            rows.append(r)
    return rows


def check(rows: list[dict]) -> list[Row]:
    ok = [r for r in rows if not r.get("error")]
    n, n_ok = len(rows), len(ok)
    out: list[Row] = []

    err = (n - n_ok) / n if n else 0.0
    out.append(Row("서버 오류", "0%", f"{n - n_ok}/{n} ({_pct(err)})", "✅" if err == TARGETS["error"] else "❌"))

    canned = sum(1 for r in ok if r.get("canned")) / n_ok if n_ok else 0.0
    out.append(Row("상투 거절 답변", "0%", _pct(canned), "✅" if canned == 0 else "❌"))

    cited = sum(1 for r in ok if (r.get("citations") or 0) >= 1) / n_ok if n_ok else 0.0
    out.append(Row("출처 표시 답변", "80% 이상", _pct(cited), _lower_ok(cited, TARGETS["cited"]),
                   "세그먼트 citations ≥1 인 턴 ÷ 성공 턴"))

    lat = [r["latency_ms"] / 1000 for r in ok if r.get("latency_ms") is not None]
    p50, p90 = statistics.median(lat) if lat else float("nan"), _quantile(lat, 0.9)
    out.append(Row("응답 p50", "8초 이내", f"{p50:.1f}s", _upper_ok(p50, TARGETS["p50"])))
    out.append(Row("응답 p90", "14초 이내", f"{p90:.1f}s", _upper_ok(p90, TARGETS["p90"]),
                   f"최대 {max(lat):.1f}s" if lat else ""))

    # 먼저 묻기(10/13) 이후 정의: 시나리오가 2턴 안에 계산(outcome=calc)에 도달했는가. 1턴째 calc_ask 는 정상 경로.
    w = [r for r in ok if str(r.get("scenario", "")).startswith("W")]
    if w:
        keys = sorted({(r["_run"], r["scenario"]) for r in w})
        done = sum(1 for k in keys if any(r.get("outcome") == "calc" and r.get("turn", 9) <= 2
                                          for r in w if (r["_run"], r["scenario"]) == k))
        out.append(Row("근로소득세 계산 완결", "100%", f"{done}/{len(keys)} 시나리오",
                       _lower_ok(done / len(keys), TARGETS["calc"]), "W 시나리오가 2턴 안에 outcome=calc 도달"))
    else:
        out.append(Row("근로소득세 계산 완결", "100%", "—", "ℹ", "W 시나리오 없음"))

    runs = sorted({r["_run"] for r in rows})
    exp_rows = [r for r in ok if r.get("scenario") in EXPENSE_IDS]
    if exp_rows:
        per_run = []
        for run in runs:
            got = {r["scenario"] for r in exp_rows if r["_run"] == run and r.get("outcome") == "verdict" and r.get("turn", 9) <= 3}
            seen = {r["scenario"] for r in exp_rows if r["_run"] == run}
            if seen:
                per_run.append((run, len(got), len(seen)))
        worst = min(g for _, g, _ in per_run)
        out.append(Row("경비 3턴 내 판정", "6/6", " · ".join(f"{g}/{s}" for _, g, s in per_run),
                       "✅" if worst >= TARGETS["expense"] else "❌", "회차별"))
    else:
        out.append(Row("경비 3턴 내 판정", "6/6", "—", "ℹ", "E 시나리오 없음"))

    adv = [r for r in ok if r.get("outcome") in ("advisory", "law_advisory")]
    if adv:
        def law_first(r: dict) -> bool:
            lines = [ln for ln in (r.get("answer") or "").split("\n") if ln.strip()]
            body = lines[1:3]          # 첫 줄은 결정론 안내 문장
            return any(_STATUTE.search(ln) for ln in body)
        lf = sum(1 for r in adv if law_first(r)) / len(adv)
        out.append(Row("(A4) 자문 답 첫 근거 = 법령", "90% 이상", f"{_pct(lf)} ({len(adv)}턴)", _lower_ok(lf, TARGETS["law_first"]),
                       "근사: 안내 다음 두 문장에 'OO법 제N조'가 있는가"))

    np_ = sum(1 for r in ok if r.get("outcome") in ("no_precedent", "off_issue")) / n_ok if n_ok else 0.0
    out.append(Row("\"자료 없음\" 응답", "2.1% (시민 48)", _pct(np_), "ℹ", "보고서 값은 시민 48문항 기준 — 이 세트는 참고"))
    out.append(Row("동시 접속 8~10명·멈춤 0", "멈춤 0", "—", "ℹ", "순차 계측으로는 판정 불가 — R6 부하 시험"))
    return out


def render(rows_in: list[dict], files: list[str], result: list[Row]) -> str:
    n = len(rows_in)
    head = [f"# 보고서 수치 대조 — {', '.join(Path(f).stem for f in files)}", "",
            f"- 턴 {n}개 · 회차 {len(files)}개 · 기준: `design/결과보고서_약속이행_개발지침_1013.md` §2-B",
            "- 판정: ✅ 충족 · ⚠ 경계(목표 10% 안) · ❌ 미달 · ℹ 이 세트로는 판정 못 함", "",
            "| 지표 | 보고서 | 측정 | 판정 | 비고 |", "|---|---|---|---|---|"]
    body = [f"| {r.label} | {r.report} | {r.measured} | {r.verdict} | {r.note} |" for r in result]
    bad = [r.label for r in result if r.verdict in ("❌", "⚠")]
    tail = ["", f"**미달·경계: {', '.join(bad) if bad else '없음'}**" + (" — 지침 §1 규칙 1·2: 되돌리거나 그날 고치고, 못 지킬 것 같으면 사용자에게 즉시 알린다." if bad else "")]
    return "\n".join(head + body + tail) + "\n"


def main() -> None:
    import sys

    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", help="run_demo_eval 의 --tag (같은 태그 회차는 합친다)")
    ap.add_argument("--files", nargs="*")
    a = ap.parse_args()
    if a.files:
        files = a.files
    elif a.tag:
        files = sorted(glob.glob(str(RAW_DIR / f"{a.tag}_*.jsonl")))
    else:
        files = sorted(glob.glob(str(RAW_DIR / "*.jsonl")), key=os.path.getmtime)[-1:]
    if not files:
        raise SystemExit("계측 원자료가 없습니다 — 먼저 eval.run_demo_eval 을 돌리세요")
    rows = load(files)
    md = render(rows, files, check(rows))
    print(md)
    name = a.tag or Path(files[-1]).stem
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / f"report_check_{name}.md").write_text(md, encoding="utf-8")


if __name__ == "__main__":
    main()
