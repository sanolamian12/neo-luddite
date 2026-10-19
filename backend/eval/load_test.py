r"""P9 동시 접속 부하 시험 — 보고서 2.4 "동시 접속 8~10명, 멈춤 0" (지침 §3 10/21).

9/18 P8 B `docs/doing/P8B_측정자료_260918/b_load.py`(구 1GB 서버, 단발 질문 5종)를 지금 API·A1 서버로 옮긴 판.
closed-loop: 동시 N 워커가 각자 시나리오(데모 세트의 여러 턴 대화)를 차례로 흘린다 — 한 턴 끝나면 다음 턴, history 를
프론트처럼 이어 붙인다. 시나리오 묶음은 아래 SCENARIOS 로 고정(갈래 섞기: 계산·경비 되묻기→판정·정의·요건·세율 표·자문).
워커 w 는 묶음을 w 만큼 돌린 순서로 시작해, 같은 순간 같은 갈래가 몰리지 않게 한다.

멈춤 = 오류(HTTP·타임아웃) 또는 한 턴 STALL_SEC 초 이상. 혼잡 안내(meta.congested — Upstage 게이트 30초 대기 초과)는 멈춤이
아니라 따로 센다(보고서에는 둘 다 적는다).

conversationId 는 `eval-load-<tag>-n<N>-w<w>-<i>` — 사용 로그·집계에서 `eval-` 로 갈린다(지침 §4). 챗은 인증 없음.

사용(backend/ 에서):
  .\.venv\Scripts\python.exe -m eval.load_test --tag dry --levels 1 --per-worker 1          # 드라이런
  .\.venv\Scripts\python.exe -m eval.load_test --tag 1021 --levels 1,8,10 --per-worker 3    # 본 시험
결과: 원자료 docs/doing/load_test/ (git 밖) · 요약 md design/demo_eval_1010/load_<tag>.md
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
QUESTIONS = HERE / "demo_questions_1010.jsonl"
RAW_DIR = REPO / "docs" / "doing" / "load_test"
SUMMARY_DIR = REPO / "design" / "demo_eval_1010"
BASE = "https://158-179-177-51.sslip.io"
STALL_SEC = 60
TIMEOUT = 300

# 고정 묶음 — 데모 세트 시나리오 id(턴 수 합 15). 바꾸면 회차 비교가 깨진다.
SCENARIOS = ["W03", "E01", "X04", "T02", "X07", "V02", "Y03", "E04"]


def load_scenarios() -> list[dict]:
    by_id = {}
    for line in QUESTIONS.read_text("utf-8").splitlines():
        if line.strip():
            r = json.loads(line)
            by_id[r["id"]] = r
    return [by_id[i] for i in SCENARIOS]


def user_message(text: str, order: int, cid: str) -> dict:
    return {"id": f"u_{cid}_{order}", "role": "user", "order": order,
            "segments": [{"id": f"us_{cid}_{order}", "text": text, "type": "question"}]}


def run_scenario(client: httpx.Client, base: str, cid: str, sc: dict) -> list[dict]:
    rows, history = [], []
    for t, text in enumerate(sc["turns"]):
        body = {"conversationId": cid, "occupation": "clinic", "history": history,
                "userInput": {"text": text}}
        t0 = time.time()
        row = {"conv": cid, "sc": sc["id"], "turn": t + 1, "t0": round(t0, 1)}
        try:
            r = client.post(f"{base}/api/chat", json=body)
            row["status"] = r.status_code
            if r.status_code == 200:
                data = r.json()
                msg, meta = data["message"], data.get("meta", {})
                row.update(congested=bool(meta.get("congested")), advisory=bool(meta.get("advisory")),
                           follow_up=bool(meta.get("followUp")), calc=bool(meta.get("calc")),
                           verdict=any(b.get("kind") == "verdict_card" for b in msg.get("uiBlocks") or []),
                           nseg=len(msg.get("segments") or []))
                history = history + [user_message(text, len(history), cid), msg]
            else:
                row["err"] = r.text[:200]
        except Exception as e:  # noqa: BLE001
            row.update(status=-1, err=repr(e)[:200])
        row["sec"] = round(time.time() - t0, 1)
        rows.append(row)
        if row["status"] != 200 or row.get("congested"):
            break   # 대화가 끊긴 뒤 턴은 의미가 없다
    return rows


def run_level(base: str, tag: str, n: int, per_worker: int, scs: list[dict]) -> tuple[list[dict], float]:
    rows: list[dict] = []
    lock = threading.Lock()

    def worker(w: int) -> None:
        with httpx.Client(timeout=TIMEOUT) as client:
            for i in range(per_worker):
                sc = scs[(w + i) % len(scs)]
                got = run_scenario(client, base, f"eval-load-{tag}-n{n}-w{w}-{i}", sc)
                for r in got:
                    r.update(n=n, w=w, i=i)
                    print(f"  N={n} w{w} #{i} {sc['id']} t{r['turn']} {r['sec']:6.1f}s st={r['status']}"
                          f"{' CONGESTED' if r.get('congested') else ''} {r.get('err', '')[:80]}", flush=True)
                with lock:
                    rows.extend(got)

    ts = [threading.Thread(target=worker, args=(w,)) for w in range(n)]
    t0 = time.time()
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    return rows, time.time() - t0


def pct(s: list[float], x: float) -> float:
    return s[min(len(s) - 1, int(len(s) * x))] if s else 0.0


def stats(rows: list[dict]) -> dict:
    ok = sorted(r["sec"] for r in rows if r["status"] == 200 and not r.get("congested"))
    return dict(turns=len(rows), ok=len(ok),
                p50=statistics.median(ok) if ok else 0.0, p90=pct(ok, .9), max=max((r["sec"] for r in rows), default=0.0),
                errors=sum(r["status"] != 200 for r in rows),
                stalls=sum(r["status"] != 200 or r["sec"] >= STALL_SEC for r in rows),
                congested=sum(bool(r.get("congested")) for r in rows))


def summarize(tag: str, base: str, started: str, levels: list[tuple[int, float, list[dict]]], raw: Path) -> str:
    out = [f"# 동시 접속 부하 시험 — {tag} ({started})", "",
           f"- 대상 `{base}` · closed-loop · 시나리오 묶음 {', '.join(SCENARIOS)} (데모 세트) · 멈춤 = 오류 또는 턴 {STALL_SEC}초 이상",
           f"- 원자료 `docs/doing/load_test/{raw.name}` (git 밖) · conversationId 접두 `eval-load-{tag}-`", "",
           "| 동시 N | 턴 | 벽시계 | p50 | p90 | 최대 | 멈춤 | 오류 | 혼잡 안내 |", "|---|---|---|---|---|---|---|---|---|"]
    for n, wall, rows in levels:
        s = stats(rows)
        out.append(f"| {n} | {s['turns']} | {wall:.0f}s | {s['p50']:.1f}s | {s['p90']:.1f}s | {s['max']:.1f}s | "
                   f"{s['stalls']} | {s['errors']} | {s['congested']} |")
    out += ["", "p50·p90 은 정상 응답(혼잡 안내 제외) 기준. 보고서 목표: 동시 8~10명 멈춤 0 · (참고) 단독 p50 10초·p90 18초."]
    return "\n".join(out) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", required=True)
    ap.add_argument("--base", default=BASE)
    ap.add_argument("--levels", default="1,8,10")
    ap.add_argument("--per-worker", type=int, default=3, help="워커당 시나리오 수")
    ap.add_argument("--pause", type=int, default=30, help="레벨 사이 쉼(초)")
    a = ap.parse_args()
    scs = load_scenarios()
    started = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    raw = RAW_DIR / f"load_{a.tag}_{time.strftime('%m%d%H%M')}.jsonl"
    done: list[tuple[int, float, list[dict]]] = []
    levels = [int(x) for x in a.levels.split(",")]
    for k, n in enumerate(levels):
        print(f"== N={n} × 시나리오 {a.per_worker}개 ==", flush=True)
        rows, wall = run_level(a.base, a.tag, n, a.per_worker, scs)
        done.append((n, wall, rows))
        with raw.open("a", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        s = stats(rows)
        print(f"  → N={n} 턴 {s['turns']} · p50 {s['p50']:.1f}s · p90 {s['p90']:.1f}s · 최대 {s['max']:.1f}s · "
              f"멈춤 {s['stalls']} · 오류 {s['errors']} · 혼잡 {s['congested']} (벽시계 {wall:.0f}s)", flush=True)
        if k < len(levels) - 1:
            time.sleep(a.pause)
    md = SUMMARY_DIR / f"load_{a.tag}.md"
    md.write_text(summarize(a.tag, a.base, started, done, raw), "utf-8")
    print(f"\n요약: {md}\n원자료: {raw}")


if __name__ == "__main__":
    main()
