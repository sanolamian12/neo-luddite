r"""시민 48문항 운영 판정 — 규칙 8 구간 과제 1(design/규칙8구간_5과제_로드맵_1016.md).

보고서 값 "자료 없음 37.5% → 2.1%"(10/7~8, docs/doing/law_llm3_261007/llm3_check.py — 로컬 프로세스 안 off/on)
의 운영판. run_demo_eval --set eval/citizen48_1016.jsonl 로 쌓은 원자료를 읽어 집계한다.
report_check 는 데모 세트 전용 지표(경비·계산·A3)가 섞여 따로 둔다.

  자료 없음 = outcome no_precedent ÷ 48 (off_issue 는 따로 세서 같이 적는다 — 10/13 이후 생긴 갈래)
  조문 인용 답변 = 배지에 '…법 제N조' 가 하나라도 있는 답
  DB 밖 조문 = 배지의 (법령명, 조) 가 laws.articles 현행에 없는 것 — 0 이어야 한다

사용:
  cd backend
  .\.venv\Scripts\python.exe -m eval.citizen_check --tag cit_prod
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
from collections import Counter
from pathlib import Path

from eval.report_check import RAW_DIR, OUT_DIR, _quantile
from eval.run_demo_eval import load_env

TARGET_NO_DATA = 1 / 48          # 보고서 2.1%
_CITE = re.compile(r"^「?([가-힣A-Za-z·\s]+?법(?:\s?시행령|\s?시행규칙)?)」?\s?제\s?(\d+)\s?조(?:\s?의\s?(\d+))?")


def _current_keys() -> set[tuple[str, str]] | None:
    try:
        from api.rag import laws_store as L

        with L._get_conn().cursor() as cur:
            cur.execute("select law_name, article_no from laws.articles where " + L._CURRENT_WHERE)
            return {(re.sub(r"\s", "", a), b) for a, b in cur.fetchall()}
    except Exception as exc:  # noqa: BLE001
        print(f"[warn] laws.articles 조회 실패 — DB 밖 조문 판정 생략: {exc}")
        return None


def _statute_cites(r: dict) -> list[tuple[str, str, str]]:
    out = []
    for s in r.get("segments") or []:
        for c in s.get("c") or []:
            m = _CITE.match(c.strip())
            if m:
                no = m.group(2) + (f"의{m.group(3)}" if m.group(3) else "")
                out.append((c, re.sub(r"\s", "", m.group(1)), no))
    return out


def check(files: list[Path]) -> str:
    keys = _current_keys()
    out = ["# 시민 48문항 운영 판정", "", f"- 원자료: {', '.join(f'`{f.name}`' for f in files)}", ""]
    out += ["| 회차 | 문항 | 오류 | **자료 없음**(no_precedent) | off_issue | 조문 인용 답 | DB 밖 조문 | p50 | p90 | 판정 |",
            "|---|---|---|---|---|---|---|---|---|---|"]
    detail = []
    for f in files:
        rows = [json.loads(l) for l in f.read_text(encoding="utf-8").splitlines() if l.strip()]
        ok = [r for r in rows if not r.get("error")]
        oc = Counter(r.get("outcome", "?") for r in ok)
        nop = [r for r in ok if r.get("outcome") == "no_precedent"]
        off = [r for r in ok if r.get("outcome") == "off_issue"]
        cited = [r for r in ok if _statute_cites(r)]
        outside = [(r["scenario"], c) for r in ok for c, law, no in _statute_cites(r)
                   if keys is not None and (law, no) not in keys]
        lat = [r["latency_ms"] / 1000 for r in ok]
        n = len(rows)
        rate = len(nop) / n if n else 0
        verdict = "✅" if rate <= TARGET_NO_DATA + 1e-9 and not outside and len(ok) == n else "❌"
        out.append(f"| {f.stem} | {n} | {n - len(ok)} | {len(nop)}/{n} ({100 * rate:.1f}%) | {len(off)} | "
                   f"{len(cited)}/{len(ok)} | {'?' if keys is None else len(outside)} | "
                   f"{statistics.median(lat):.1f}s | {_quantile(lat, 0.9):.1f}s | {verdict} |" if lat else
                   f"| {f.stem} | {n} | {n - len(ok)} | - | - | - | - | - | - | ❌ |")
        detail += [f"", f"### {f.stem}", "", "outcome: " + " · ".join(f"{k} {v}" for k, v in oc.most_common())]
        for r in nop + off:
            detail.append(f"- {r['scenario']} `{r['outcome']}` — {r['user'][:60]} → {(r.get('answer') or '')[:80]!r}")
        for sid, c in outside:
            detail.append(f"- DB 밖 조문: {sid} {c}")
        for r in rows:
            if r.get("error"):
                detail.append(f"- 오류: {r['scenario']} {r['error'][:120]}")
    out.append("")
    out.append(f"기준: 자료 없음 ≤ {100 * TARGET_NO_DATA:.1f}%(1/48) · DB 밖 조문 0 · 오류 0. 지연은 참고.")
    return "\n".join(out + ["", "## 문항별(자료 없음·off_issue·DB 밖·오류)"] + detail) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", help="run_demo_eval 의 --tag (같은 태그 회차를 나란히)")
    ap.add_argument("--files", nargs="*")
    args = ap.parse_args()
    load_env()
    files = [Path(p) for p in args.files] if args.files else sorted(RAW_DIR.glob(f"{args.tag}_*.jsonl"))
    if not files:
        raise SystemExit("원자료 없음")
    md = check(files)
    out = OUT_DIR / f"citizen_check_{args.tag or files[0].stem}.md"
    out.write_text(md, encoding="utf-8")
    print(md)
    print(f"저장: {out}")


if __name__ == "__main__":
    main()
