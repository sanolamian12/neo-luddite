r"""W5 오프라인 하니스 — LLM2 답변 단계를 testset 으로 돌려 판정 품질 계기를 잰다. 설계 design/W5_LLM2_답변단계_설계.md §6.

재는 것(설계 §6 + O-W5-4):
  판정 분포(최종·모델 원본) · M1 강등률(no_basis) · 인용 삭제 수 · 조문 가드 삭제 수 · numeric_guard 삭제 수 ·
  엔진 대조(M4) 상태·일치율(병의원 testset) · 개인/법인 혼입(질문에 '법인' 이 없는데 답·basis 가 법인세법)

제품 원문을 그대로 부른다: 검색 = `get_retriever(True, "v2")`(KB3 만 DB 대신 메모리 — 0041 적재 전),
답 = `llm2.write_answer`, 대조 = `engine_contrast.run`, 숫자 가드 = `numeric_guard.drop_unsourced_numbers`.
단일 턴 질문이라 되묻기 없음 → gaps=[] (gap 강등은 이 하니스로 안 잰다).

두 단계:
  retrieve  문항별 검색 결과 → <out>/passages.jsonl (rag·kbdict 는 프로덕션 DB — **낮에**)
  answer    passages.jsonl 로 LLM2 + 엔진 대조 → <out>/records.jsonl, summary.md
  둘 다 이어하기(이미 있는 uid 는 건너뜀). --no-db 는 rag·kbdict 를 끄고 kb3 메모리만(밤·검증용).

사용 (agentic-v2 worktree 의 backend 에서, 메인 venv):
  ..\..\Neo-Luddite\backend\.venv\Scripts\python.exe scripts\w5_harness.py all --out <dir> [--no-db] [--limit N]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
# 벡터 캐시·.env 는 메인 작업 트리에만 있다(gitignore). worktree 에서 돌려도 그쪽을 본다.
_MAIN_BACKEND = Path(os.environ.get("NL_MAIN_BACKEND", _BACKEND.parents[1] / "Neo-Luddite" / "backend"))
TESTSETS = [p if p.exists() else _MAIN_BACKEND / p.relative_to(_BACKEND)
            for p in (_BACKEND / "testset.json", _BACKEND / "data" / "kb3" / "testset_citizen.json")]


def _setup(no_db: bool) -> None:
    if str(_BACKEND) not in sys.path:
        sys.path.insert(0, str(_BACKEND))
    if no_db:
        os.environ["SUPABASE_DB_URL"] = ""          # load_dotenv 는 이미 있는 키를 덮지 않는다
    from dotenv import load_dotenv

    env = _BACKEND / ".env" if (_BACKEND / ".env").exists() else _MAIN_BACKEND / ".env"
    load_dotenv(env)
    # 제품과 같은 이유(pipeline_agentic 함정 §5): 스레드들이 openai 하위 모듈을 동시에 처음 import 하면 교착.
    import openai.resources.chat  # noqa: F401
    import openai.resources.embeddings  # noqa: F401

    from scripts import kb3_ingest

    if not kb3_ingest.CACHE_PATH.exists():
        kb3_ingest.CACHE_PATH = _MAIN_BACKEND / "data" / "kb3" / "embeddings.npz"


def _load_rows(limit: int | None, only: str | None) -> list[dict]:
    rows = []
    for f in TESTSETS:
        rows += json.loads(f.read_text(encoding="utf-8"))
    if only:
        rows = [r for r in rows if r.get("setgroup") in only.split(",")]
    return rows[:limit] if limit else rows


def _done(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    out = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            r = json.loads(line)
            out[r["uid"]] = r
    return out


def _append(path: Path, lock: threading.Lock, obj: dict) -> None:
    with lock, path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")


def _run_pool(rows, fn, workers: int, label: str) -> None:
    t0, n = time.time(), 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(fn, r): r["uid"] for r in rows}
        for fut in as_completed(futs):
            n += 1
            try:
                fut.result()
            except Exception as exc:  # noqa: BLE001 — 한 문항 실패로 전체를 멈추지 않는다(다음 실행이 이어한다)
                print(f"  ! {futs[fut]} {type(exc).__name__}: {exc}", flush=True)
            if n % 10 == 0 or n == len(rows):
                print(f"  {label} {n}/{len(rows)} · {time.time() - t0:.0f}s", flush=True)


# ── retrieve ──────────────────────────────────────────────────────────────────

def cmd_retrieve(args, rows) -> None:
    from api import pipeline
    from api.rag import kb3_store, retriever as R
    from scripts.kb3_ingest import LOAD_SCOPES, MemoryKb3Retriever

    mem = MemoryKb3Retriever(LOAD_SCOPES, min_score=float(os.environ.get("KB3_MIN_SCORE", "0.40")))
    R.Kb3Retriever = lambda min_score=0.0: mem          # 적재 전: 제품 팩토리의 kb3 자리만 메모리로
    kb3_store.is_configured = lambda: True
    ret = R.get_retriever(True, "v2")
    print("갈래:", [(name, type(r).__name__) for name, r in ret.arms], "쿼터:", ret.quotas, flush=True)

    out = args.out / "passages.jsonl"
    have = _done(out)
    todo = [r for r in rows if r["uid"] not in have]
    print(f"retrieve: {len(todo)} 문항 (이미 {len(have)})", flush=True)
    lock = threading.Lock()

    def one(row):
        t = time.time()
        ps = ret.retrieve(row["question"], k=pipeline._rag_top_k(), occupation="clinic")
        _append(out, lock, {"uid": row["uid"], "sec": round(time.time() - t, 1), "passages": [
            {"id": p.id, "corpus": p.corpus, "source_kind": p.source_kind, "score": round(p.score, 4),
             "case_refs": p.case_refs, "law_articles": p.law_articles, "tax_category": p.tax_category,
             "content": p.content} for p in ps]})

    _run_pool(todo, one, args.retrieve_workers, "retrieve")


# ── answer ────────────────────────────────────────────────────────────────────

_CORP = re.compile(r"법인세법")
_INDIV = re.compile(r"소득세법")


def _corp_flags(question: str, passages: list[dict], ans) -> dict:
    """O-W5-4 — 질문이 법인을 말하지 않는데 법인 규정이 근거·답에 들어왔나."""
    q_corp = "법인" in question
    kb3 = [p for p in passages if (p["corpus"] or "").startswith("kb3")]
    kb3_corp_only = [p for p in kb3 if _CORP.search(p["content"]) and not _INDIV.search(p["content"])]
    text = " ".join([s.get("text") or "" for s in ans.segments] + ans.basis)
    return {"qCorp": q_corp, "kb3": len(kb3), "kb3CorpOnly": len(kb3_corp_only),
            "answerCorp": bool(_CORP.search(text)), "answerIndiv": bool(_INDIV.search(text))}


def cmd_answer(args, rows) -> None:
    from api import engine_contrast, llm2, numeric_guard, pipeline
    from api.rag.retriever import Passage

    cached = _done(args.out / "passages.jsonl")
    out = args.out / "records.jsonl"
    have = _done(out)
    todo = [r for r in rows if r["uid"] not in have and r["uid"] in cached]
    miss = [r["uid"] for r in rows if r["uid"] not in cached]
    if miss:
        print(f"  검색 캐시 없음 {len(miss)}건 — 먼저 retrieve: {miss[:5]}…", flush=True)
    print(f"answer: {len(todo)} 문항 (이미 {len(have)})", flush=True)
    lock = threading.Lock()
    clinic = {r["uid"] for r in json.loads(TESTSETS[0].read_text(encoding="utf-8"))}

    def one(row):
        q = row["question"]
        pdicts = cached[row["uid"]]["passages"]
        passages = [Passage(content=p["content"], score=p["score"], source_kind=p["source_kind"],
                            law_articles=p.get("law_articles") or [], tax_category=p.get("tax_category"),
                            case_refs=p.get("case_refs") or [], corpus=p["corpus"], id=p.get("id"))
                    for p in pdicts]
        rec = {"uid": row["uid"], "setgroup": row.get("setgroup"), "question": q,
               "corpora": dict(Counter(p["corpus"] or "rag" for p in pdicts))}
        if passages:
            t = time.time()
            ans = llm2.write_answer([], q, [], [], passages)
            rec["sec"] = round(time.time() - t, 1)
            guarded = numeric_guard.drop_unsourced_numbers(
                ans.segments, *pipeline._number_sources([], q, passages), where=f"w5 {row['uid']}")
            kept = sum(1 for s in guarded if s in ans.segments)
            rec["llm2"] = ans.meta()
            rec["segments"] = ans.segments
            rec["numericDropped"] = len(ans.segments) - kept
            rec["corp"] = _corp_flags(q, pdicts, ans)
        else:
            ans = None
            rec["llm2"] = None                       # 제품: '선례 없음' 갈래 — LLM2 안 부름
        if row["uid"] in clinic and engine_contrast.enabled():
            eng = engine_contrast.run([], q)
            if ans is not None and eng.get("status") == "compared":
                eng["agree"] = eng["engineVerdict"] == ans.verdict
            rec["engine"] = eng
        _append(out, lock, rec)

    _run_pool(todo, one, args.workers, "answer")


# ── 요약 ──────────────────────────────────────────────────────────────────────

def _pct(a: int, b: int) -> str:
    return f"{a}/{b} ({100 * a / b:.0f}%)" if b else "-"


def summarize(out: Path) -> str:
    recs = list(_done(out / "records.jsonl").values())
    groups = ["near", "far", "citizen"]
    lines = [f"# W5 하니스 요약 — {out.name}", "", f"문항 {len(recs)} · 생성 {time.strftime('%Y-%m-%d %H:%M')}", ""]

    lines += ["## 판정 · M1 · 가드", "",
              "| 묶음 | n | 근거0 | 판정 분포(최종) | 모델 원본 → 강등(no_basis) | 인용 삭제 | 조문가드 문장 | 숫자가드 문장 | 실패 |",
              "|---|---|---|---|---|---|---|---|---|"]
    for g in groups + ["전체"]:
        rs = [r for r in recs if g == "전체" or r["setgroup"] == g]
        if not rs:
            continue
        ans = [r for r in rs if r["llm2"]]
        final = Counter(r["llm2"]["verdict"] for r in ans)
        down = sum(1 for r in ans if r["llm2"].get("downgraded") == "no_basis")
        firm_raw = sum(1 for r in ans if (r["llm2"].get("verdictRaw") or "판정 보류") != "판정 보류")
        lines.append(
            f"| {g} | {len(rs)} | {len(rs) - len(ans)} | "
            + " · ".join(f"{v} {final[v]}" for v in ("인정", "일부 인정", "부인", "조건부", "판정 보류") if final[v])
            + f" | 원본 판정 {firm_raw} → 강등 {_pct(down, firm_raw)} | "
            f"{sum(r['llm2'].get('citationsDropped', 0) for r in ans)} | "
            f"{sum(r['llm2'].get('articleDropped', 0) for r in ans)} ({sum(1 for r in ans if r['llm2'].get('articleDropped'))}문항) | "
            f"{sum(r.get('numericDropped', 0) for r in ans)} ({sum(1 for r in ans if r.get('numericDropped'))}문항) | "
            f"{sum(1 for r in ans if r['llm2'].get('failed'))} |")

    eng = [r for r in recs if r.get("engine")]
    if eng:
        st = Counter(r["engine"]["status"] for r in eng)
        comp = [r for r in eng if r["engine"]["status"] == "compared"]
        agree = sum(1 for r in comp if r["engine"].get("agree"))
        lines += ["", "## 엔진 대조(M4, 병의원 testset)", "",
                  "상태: " + " · ".join(f"{k} {v}" for k, v in st.most_common()),
                  f"compared 일치율: {_pct(agree, len(comp))}", ""]
        if comp:
            lines += ["| uid | 엔진 | LLM2(최종) | 모델 원본 | 강등 | 일치 |", "|---|---|---|---|---|---|"]
            for r in sorted(comp, key=lambda r: r["uid"]):
                l2 = r["llm2"] or {}
                lines.append(f"| {r['uid']} | {r['engine']['engineVerdict']} | {l2.get('verdict', '(근거0)')} | "
                             f"{l2.get('verdictRaw', '')} | {l2.get('downgraded') or ''} | "
                             f"{'✓' if r['engine'].get('agree') else '✗'} |")

    lines += ["", "## 개인/법인 혼입(O-W5-4) — 질문에 '법인' 없음", "",
              "| 묶음 | 대상 | kb3 근거가 법인세법만인 것 ≥1 | 답·basis 가 법인세법 인용 | 그중 소득세법 언급 없음 |",
              "|---|---|---|---|---|"]
    for g in groups + ["전체"]:
        rs = [r for r in recs if (g == "전체" or r["setgroup"] == g) and r.get("corp") and not r["corp"]["qCorp"]]
        if not rs:
            continue
        pmix = sum(1 for r in rs if r["corp"]["kb3CorpOnly"])
        acorp = sum(1 for r in rs if r["corp"]["answerCorp"])
        aonly = sum(1 for r in rs if r["corp"]["answerCorp"] and not r["corp"]["answerIndiv"])
        lines.append(f"| {g} | {len(rs)} | {_pct(pmix, len(rs))} | {_pct(acorp, len(rs))} | {_pct(aonly, len(rs))} |")

    secs = [r["sec"] for r in recs if r.get("sec")]
    if secs:
        secs.sort()
        lines += ["", f"LLM2 시간: 중앙 {secs[len(secs) // 2]}s · 최대 {secs[-1]}s"]
    return "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stage", choices=["retrieve", "answer", "all", "summary"])
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--no-db", action="store_true", help="rag·kbdict 끔(kb3 메모리만) — 밤·검증용")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--only", help="setgroup 쉼표 목록(near,far,citizen)")
    ap.add_argument("--workers", type=int, default=3, help="answer 동시 수(Upstage 게이트 k=3)")
    ap.add_argument("--retrieve-workers", type=int, default=1, help="retrieve 동시 수(DB 부하 — 기본 1)")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    _setup(args.no_db)
    rows = _load_rows(args.limit, args.only)
    if args.stage in ("retrieve", "all"):
        cmd_retrieve(args, rows)
    if args.stage in ("answer", "all"):
        cmd_answer(args, rows)
    md = summarize(args.out)
    (args.out / "summary.md").write_text(md, encoding="utf-8")
    print(md)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
