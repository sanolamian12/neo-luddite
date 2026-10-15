"""journald [upstage_call] 줄 → ch=eval 창별 fn 별 ms 중앙값·평균 출력 토큰·입력 토큰. 사용:
   python fn_stats.py <journal.txt> <이름>=<UTC시작>~<UTC끝> ...   (시각은 'YYYY-MM-DDTHH:MM')"""
import json, statistics, sys
from collections import defaultdict

sys.stdout.reconfigure(encoding="utf-8")
rows = []
for ln in open(sys.argv[1], encoding="utf-8", errors="replace"):
    i = ln.find("[upstage_call] ")
    if i < 0:
        continue
    try:
        r = json.loads(ln[i + len("[upstage_call] "):])
    except Exception:
        continue
    if r.get("ch") == "eval" and r.get("kind") == "chat":
        rows.append(r)

wins = []
for a in sys.argv[2:]:
    name, rng = a.split("=", 1)
    lo, hi = rng.split("~")
    wins.append((name, lo, hi))

fns = sorted({r["fn"] for r in rows})
print("| fn | " + " | ".join(w[0] for w in wins) + " |")
print("|---|" + "---|" * len(wins))
for fn in fns:
    cells = []
    for name, lo, hi in wins:
        sel = [r for r in rows if r["fn"] == fn and lo <= r["ts"][:16] <= hi]
        if not sel:
            cells.append("—")
            continue
        ms = statistics.median(r["ms"] for r in sel) / 1000
        ct = statistics.mean(r.get("completion_tokens", 0) for r in sel)
        pt = statistics.mean(r.get("prompt_tokens", 0) for r in sel)
        cells.append(f"{ms:.2f}s · {ct:.0f}↑ · {pt:.0f}↓ (n{len(sel)})")
    print(f"| {fn} | " + " | ".join(cells) + " |")
