r"""검색기 N-way 벤치 — none / rag / kb2 / hybrid / fusion (KB통합 3층검색 로드맵 P2, 2026-09-16).

무엇을 재나: **검색 단계만.** 작문 모델·프롬프트는 갈래와 무관하게 같으므로, 갈래 차이는
"어떤 근거가 몇 개, 얼마나 관련 있게 들어가느냐"로 귀속된다. 답변 생성까지 돌리면 작문
분산(temperature)이 검색 차이를 덮는다.

갈래는 **제품 팩토리 그대로** 만든다 — get_retriever(force_enabled=True, source=X). 즉
.env 의 RAG_MIN_SCORE / KB2_MIN_SCORE / FUSION_QUOTA_* / RAG_TOP_K 가 프로덕션과 같으면
프로덕션 검색 결과와 같다. --variant 로 쿼터·rrf_k 변형 갈래를 덧붙일 수 있다(튜닝용).

관련성 채점: 문항마다 모든 갈래가 가져온 passage 를 **합집합·중복제거·셔플**해 갈래 표시 없이
solar-pro3 에 한 번 묻는다(블라인드). 등급 2=질문의 쟁점에 직접 답하는 근거, 1=같은 주제의
배경, 0=무관. 사람 라벨이 아니라 LLM 판정이므로 절대치보다 **갈래 간 상대 비교**로 읽는다.
(오프라인 벤치지만 Upstage 로 채점 — 제품과 같은 계열이라 트랙 논의 자체가 필요 없다.)

지표(갈래별):
  coverage   근거가 1건 이상 들어간 문항 비율
  useful     등급2 근거가 1건 이상 들어간 문항 비율   ← 이게 "답할 수 있는 범위"
  prec≥1/=2  들어간 근거 중 등급≥1 / 등급2 비율      ← precision 감시(로드맵 §6-②)
  gain       문항당 등급 합(DCG, 순위 할인)           ← 근거 총량×품질
  noise      문항당 등급0 근거 수                     ← 프롬프트에 섞이는 잡음

사용:
  cd backend
  .\.venv\Scripts\python.exe bench_fusion.py --testset testset.json --out <dir>
  .\.venv\Scripts\python.exe bench_fusion.py --testset testset.json --out <dir> --variant fusion_q23:2:3
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

BASE_ARMS = ["none", "rag", "kb2", "hybrid", "fusion"]
JUDGE_EXCERPT = 1200   # rag 번들은 길다(Q+A+C). 관련성 판정엔 앞부분이면 충분


def _pid(content: str) -> str:
    return hashlib.sha1(content.encode("utf-8")).hexdigest()[:10]


def build_arms(variants: list[str]):
    from api.rag.retriever import FusionRetriever, get_retriever

    arms = {name: get_retriever(force_enabled=True, source=name) for name in BASE_ARMS if name != "none"}
    from api.rag.retriever import NullRetriever
    arms = {"none": NullRetriever(), **arms}
    for spec in variants:           # 이름:kb2쿼터:rag쿼터[:rrf_k]
        parts = spec.split(":")
        name, qk, qr = parts[0], int(parts[1]), int(parts[2])
        rrf_k = int(parts[3]) if len(parts) > 3 else 60
        arms[name] = FusionRetriever(
            arms=[("kb2", get_retriever(True, "kb2")), ("rag", get_retriever(True, "rag"))],
            quotas={"kb2": qk, "rag": qr}, rrf_k=rrf_k,
        )
    return arms


def install_embed_cache():
    """문항당 임베딩 1회 — 갈래마다 다시 부르면 비용만 들고 결과는 같다."""
    from api.rag import embeddings

    orig = embeddings.embed_query
    cache: dict[str, list[float]] = {}
    lock = threading.Lock()

    def cached(text):
        with lock:
            if text in cache:
                return cache[text]
        vec = orig(text)
        with lock:
            cache[text] = vec
        return vec

    embeddings.embed_query = cached


def judge(client, model: str, question: str, passages: dict[str, str], seed: int) -> dict[str, int]:
    """블라인드 관련성 등급. 실패 시 빈 dict(그 문항은 채점 누락으로 집계)."""
    if not passages:
        return {}
    ids = list(passages)
    random.Random(seed).shuffle(ids)
    listing = "\n\n".join(f"[{pid}]\n{passages[pid][:JUDGE_EXCERPT]}" for pid in ids)
    tool = {
        "type": "function",
        "function": {
            "name": "grade_passages",
            "description": "각 자료가 질문에 답하는 근거로 얼마나 관련 있는지 등급을 매긴다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "grades": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string", "enum": ids},
                                "grade": {"type": "integer", "enum": [0, 1, 2]},
                            },
                            "required": ["id", "grade"],
                        },
                    }
                },
                "required": ["grades"],
            },
        },
    }
    system = (
        "당신은 세무 상담 검색 결과의 관련성 채점관입니다. 사용자 질문과 검색된 자료 여러 건이 "
        "주어집니다. 자료마다 등급을 매기세요.\n"
        "2 = 질문의 핵심 쟁점(그 지출·그 제도)에 직접 답하는 데 쓸 수 있는 근거\n"
        "1 = 같은 세목·주제라 배경으로는 도움이 되지만 쟁점에 직접 답하지는 않음\n"
        "0 = 무관하거나 다른 쟁점\n"
        "자료의 문체·길이·출처 형식은 무시하고 내용만 보세요. 모든 id 에 등급을 매기세요. "
        "grade_passages 도구로만 응답하세요."
    )
    for attempt in range(4):
        try:
            resp = client.chat.completions.create(
                model=model, temperature=0,
                messages=[{"role": "system", "content": system},
                          {"role": "user", "content": f"[질문]\n{question}\n\n[자료]\n{listing}"}],
                tools=[tool],
                tool_choice={"type": "function", "function": {"name": "grade_passages"}},
            )
            calls = getattr(resp.choices[0].message, "tool_calls", None)
            if not calls:
                raise ValueError("no tool call")
            grades = {}
            for g in json.loads(calls[0].function.arguments).get("grades", []):
                if g.get("id") in passages and g.get("grade") in (0, 1, 2):
                    grades[g["id"]] = int(g["grade"])
            return grades
        except Exception as exc:  # noqa: BLE001
            if attempt == 3:
                print(f"  judge 실패: {type(exc).__name__}: {exc}", file=sys.stderr)
                return {}
            time.sleep(2 ** attempt * 2)
    return {}


def run_question(row, arms, k, client, model, do_judge):
    q = row["question"]
    got = {}
    pool: dict[str, str] = {}
    for name, r in arms.items():
        ps = r.retrieve(q, k=k, occupation="clinic")
        got[name] = [{"id": _pid(p.content), "score": round(p.score, 4), "kind": p.source_kind} for p in ps]
        for p in ps:
            pool[_pid(p.content)] = p.content
    grades = judge(client, model, q, pool, seed=int(_pid(row["uid"]), 16)) if do_judge else {}
    return {"uid": row["uid"], "setgroup": row.get("setgroup"), "question": q,
            "arms": got, "grades": grades, "pool": len(pool)}


def summarize(records, arm_names, group=None):
    rows = []
    recs = [r for r in records if group is None or r["setgroup"] == group]
    n = len(recs)
    for arm in arm_names:
        cov = useful = got = g1 = g2 = noise = kb2_share = 0
        gain = 0.0
        ungraded = 0
        for r in recs:
            hits = r["arms"][arm]
            if hits:
                cov += 1
            got += len(hits)
            u = False
            for rank, h in enumerate(hits, start=1):
                g = r["grades"].get(h["id"])
                if g is None:
                    ungraded += 1
                    continue
                g1 += g >= 1
                g2 += g == 2
                noise += g == 0
                u = u or g == 2
                gain += g / math.log2(rank + 1)
                kb2_share += h["kind"] == "kb2"
            useful += u
        graded = got - ungraded
        rows.append({
            "arm": arm, "n": n,
            "coverage": cov / n if n else 0, "useful": useful / n if n else 0,
            "hits_per_q": got / n if n else 0,
            "prec_ge1": g1 / graded if graded else None, "prec_eq2": g2 / graded if graded else None,
            "gain_per_q": gain / n if n else 0, "noise_per_q": noise / n if n else 0,
            "kb2_share": (kb2_share / graded) if graded else None, "ungraded": ungraded,
        })
    return rows


def fmt_table(rows) -> str:
    def pct(v):
        return "—" if v is None else f"{v*100:.1f}%"
    out = ["| arm | coverage | useful(등급2≥1) | hits/q | prec≥1 | prec=2 | gain/q | noise/q | kb2 비중 |",
           "|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        out.append(f"| {r['arm']} | {pct(r['coverage'])} | {pct(r['useful'])} | {r['hits_per_q']:.2f} | "
                   f"{pct(r['prec_ge1'])} | {pct(r['prec_eq2'])} | {r['gain_per_q']:.2f} | "
                   f"{r['noise_per_q']:.2f} | {pct(r['kb2_share'])} |")
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--testset", required=True)
    ap.add_argument("--out", required=True, help="결과 디렉터리(원자료 json + 요약 md)")
    ap.add_argument("--variant", action="append", default=[], help="이름:kb2쿼터:rag쿼터[:rrf_k]")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--no-judge", action="store_true")
    args = ap.parse_args()

    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8")
        except Exception:  # noqa: BLE001
            pass
    here = Path(__file__).resolve().parent
    sys.path.insert(0, str(here))
    from bulk_ask import load_env
    load_env(here / ".env")
    if not os.environ.get("SUPABASE_DB_URL"):
        print("SUPABASE_DB_URL 없음 — 검색 벤치 불가", file=sys.stderr)
        return 1

    from openai import OpenAI
    install_embed_cache()
    arms = build_arms(args.variant)
    k = int(os.environ.get("RAG_TOP_K", "5"))
    model = os.environ.get("UPSTAGE_CHAT_MODEL", "solar-pro3")
    client = OpenAI(api_key=os.environ["UPSTAGE_API_KEY"],
                    base_url=os.environ.get("UPSTAGE_BASE_URL", "https://api.upstage.ai/v1"),
                    timeout=180, max_retries=0)

    rows = json.loads(Path(args.testset).read_text(encoding="utf-8"))
    if args.limit:
        rows = rows[: args.limit]
    config = {
        "k": k, "RAG_MIN_SCORE": os.environ.get("RAG_MIN_SCORE", "0.0"),
        "KB2_MIN_SCORE": os.environ.get("KB2_MIN_SCORE", "0.35"),
        "FUSION_QUOTA_KB2": os.environ.get("FUSION_QUOTA_KB2", "3"),
        "FUSION_QUOTA_RAG": os.environ.get("FUSION_QUOTA_RAG", "3"),
        "variants": args.variant, "judge_model": model, "n": len(rows),
        "run_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    print(f"문항 {len(rows)} · 갈래 {list(arms)} · {config}")

    records = []
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = [ex.submit(run_question, r, arms, k, client, model, not args.no_judge) for r in rows]
        for i, fu in enumerate(as_completed(futs), 1):
            rec = fu.result()
            records.append(rec)
            hits = " ".join(f"{a}={len(rec['arms'][a])}" for a in arms if a != "none")
            print(f"  [{i}/{len(rows)}] {rec['uid']} pool={rec['pool']} graded={len(rec['grades'])} {hits}", flush=True)
    records.sort(key=lambda r: r["uid"])

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    names = list(arms)
    summary = {"config": config, "all": summarize(records, names),
               "by_setgroup": {g: summarize(records, names, g)
                               for g in sorted({r["setgroup"] for r in records if r["setgroup"]})}}
    (out / "bench_records.json").write_text(json.dumps(records, ensure_ascii=False, indent=1), encoding="utf-8")
    (out / "bench_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    md = [f"# 검색기 벤치 {config['run_at']}", "", f"설정: `{json.dumps(config, ensure_ascii=False)}`", "",
          "## 전체", fmt_table(summary["all"])]
    for g, rs in summary["by_setgroup"].items():
        md += ["", f"## setgroup={g}", fmt_table(rs)]
    (out / "bench_summary.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print("\n".join(md))
    print(f"\n완료 {time.time()-t0:.0f}s → {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
