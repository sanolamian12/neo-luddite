r"""6-arm 벌크 생성기 — 2×3 요인설계(모델 3계열 × RAG on/off).

bulk_ask.py(RAG OFF) / bulk_ask_rag.py(RAG ON)의 **자산을 그대로 재사용**한다.
세 provider 가 공유하는 것:

  · SYSTEM_PROMPT      (bulk_ask)          — 페르소나가 갈리면 arm 비교가 오염된다
  · retrieve()         (bulk_ask_rag)      — 제품과 동일 검색 경로
  · build_user_prompt()(bulk_ask_rag)      — 극성 라벨링 포함 주입 틀
  · temperature = 0.3                      — 세 계열 모두 이 파라미터를 받는 세대로 고정

갈리는 것은 **생성 모델**과 **RAG 주입 여부** 둘뿐이다.

검색은 문항당 **한 번만** 수행하고 캐시해 세 provider 의 RAG ON arm 이 **문자 그대로 동일한
passage** 를 받도록 한다. provider 마다 재검색하면 미세한 차이가 arm 에 섞인다.

사용:
  cd backend
  .\.venv\Scripts\python.exe bulk_ask_multi.py --testset testset.json \
      --provider openai --model gpt-4.1 --rag off --workers 4
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Optional

from bulk_ask import SYSTEM_PROMPT, load_env
from bulk_ask_rag import build_user_prompt, retrieve

TEMPERATURE = 0.3
# 한 건이 무한정 매달리면 벌크 전체가 멈춘다. SDK 기본 타임아웃은 10분이라 너무 길다.
CALL_TIMEOUT = 180.0
COLS = [
    "uid", "question", "provider", "rag", "model",
    "hits", "top", "stratum",
    "answer", "prompt_tokens", "completion_tokens", "elapsed_ms", "collected_at",
]

_write_lock = threading.Lock()
_retrieval_cache: dict[str, tuple[list[str], int, float]] = {}
_cache_lock = threading.Lock()


# ── provider 별 호출 ────────────────────────────────────────────────────────
def _key(*names: str) -> Optional[str]:
    """.env 변수명이 프로젝트마다 다를 수 있어 여러 이름을 순서대로 본다."""
    for n in names:
        v = os.environ.get(n)
        if v:
            return v.strip()
    return None


def ask_solar(system: str, user: str, model: str) -> tuple[str, int, int]:
    from openai import OpenAI

    cl = OpenAI(
        api_key=_key("UPSTAGE_API_KEY"),
        base_url=os.environ.get("UPSTAGE_BASE_URL", "https://api.upstage.ai/v1"),
        timeout=CALL_TIMEOUT, max_retries=0,   # 재시도는 run_one 이 관리한다
    )
    r = cl.chat.completions.create(
        model=model, temperature=TEMPERATURE,
        messages=[{"role": "system", "content": system},
                  {"role": "user", "content": user}],
    )
    u = r.usage
    return (r.choices[0].message.content or "").strip(), \
        getattr(u, "prompt_tokens", 0), getattr(u, "completion_tokens", 0)


def ask_openai(system: str, user: str, model: str) -> tuple[str, int, int]:
    from openai import OpenAI

    cl = OpenAI(api_key=_key("OPENAI_API_KEY", "API_KEY_OPENAI"),
                timeout=CALL_TIMEOUT, max_retries=0)
    r = cl.chat.completions.create(
        model=model, temperature=TEMPERATURE,
        messages=[{"role": "system", "content": system},
                  {"role": "user", "content": user}],
    )
    u = r.usage
    return (r.choices[0].message.content or "").strip(), \
        getattr(u, "prompt_tokens", 0), getattr(u, "completion_tokens", 0)


def ask_gemini(system: str, user: str, model: str) -> tuple[str, int, int]:
    from google import genai
    from google.genai import types

    cl = genai.Client(
        api_key=_key("GOOGLE_API_KEY", "API_KEY_GEMINI"),
        http_options=types.HttpOptions(timeout=int(CALL_TIMEOUT * 1000)),  # ms
    )
    r = cl.models.generate_content(
        model=model, contents=user,
        config=types.GenerateContentConfig(
            system_instruction=system,      # Gemini 는 system 이 config 안에 들어간다
            temperature=TEMPERATURE,
        ),
    )
    um = getattr(r, "usage_metadata", None)
    return (r.text or "").strip(), \
        getattr(um, "prompt_token_count", 0) or 0, \
        getattr(um, "candidates_token_count", 0) or 0


PROVIDERS = {"solar": ask_solar, "openai": ask_openai, "gemini": ask_gemini}
DEFAULT_MODEL = {"solar": "solar-pro3", "openai": "gpt-4.1", "gemini": "gemini-2.5-pro"}


# ── 검색(문항당 1회, 전 provider 공유) ──────────────────────────────────────
def get_passages(uid: str, question: str, k: int, min_score: float):
    with _cache_lock:
        if uid in _retrieval_cache:
            return _retrieval_cache[uid]
    passages, diag = retrieve(question, k, min_score)
    top = max([d.get("score", 0.0) for d in diag if "score" in d], default=0.0)
    val = (passages, len(passages), round(top, 4))
    with _cache_lock:
        _retrieval_cache[uid] = val
    return val


def run_one(row: dict, provider: str, model: str, rag_on: bool,
            k: int, min_score: float, retries: int) -> dict:
    uid, question = row["uid"], row["question"]
    if rag_on:
        passages, hits, top = get_passages(uid, question, k, min_score)
        user = build_user_prompt(question, passages)
    else:
        hits, top = row.get("hits", ""), row.get("top", "")
        user = question

    fn = PROVIDERS[provider]
    t0 = time.time()
    answer, pin, pout = "", 0, 0
    for attempt in range(retries):
        try:
            answer, pin, pout = fn(SYSTEM_PROMPT, user, model)
            break
        except Exception as e:  # noqa: BLE001 — 한 건 실패로 벌크가 멈추면 안 된다
            if attempt == retries - 1:
                answer = f"[ERROR] {type(e).__name__}: {e}"
            else:
                time.sleep(min(2 ** attempt * 2, 60))
    return {
        "uid": uid, "question": question, "provider": provider,
        "rag": "on" if rag_on else "off", "model": model,
        "hits": hits, "top": top, "stratum": row.get("stratum", ""),
        "answer": answer, "prompt_tokens": pin, "completion_tokens": pout,
        "elapsed_ms": int((time.time() - t0) * 1000),
        "collected_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }


def load_done(path: Path) -> set[tuple[str, str, str]]:
    """이미 정상 수집된 (uid, provider, rag) — 재실행 시 건너뛴다."""
    if not path.exists():
        return set()
    done = set()
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            if r.get("answer") and not r["answer"].startswith("[ERROR]"):
                done.add((r["uid"], r["provider"], r["rag"]))
    return done


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--testset", required=True, help="uid/question 을 담은 json")
    ap.add_argument("--provider", required=True, choices=sorted(PROVIDERS))
    ap.add_argument("--model", default=None)
    ap.add_argument("--rag", default="off", choices=["on", "off"])
    ap.add_argument("--out", default="answers_long.csv")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--limit", type=int, default=0, help="앞 N건만 (스모크용)")
    args = ap.parse_args()

    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8")
        except Exception:  # noqa: BLE001
            pass

    here = Path(__file__).resolve().parent
    sys.path.insert(0, str(here))
    load_env(here / ".env")

    model = args.model or DEFAULT_MODEL[args.provider]
    rag_on = args.rag == "on"
    k = int(os.environ.get("RAG_TOP_K", "5"))
    min_score = float(os.environ.get("RAG_MIN_SCORE", "0.50"))

    if rag_on and not os.environ.get("SUPABASE_DB_URL"):
        print("SUPABASE_DB_URL 없음 — RAG ON 불가", file=sys.stderr)
        return 1

    rows = json.loads(Path(args.testset).read_text(encoding="utf-8"))
    out = Path(args.out)
    done = load_done(out)
    todo = [r for r in rows if (r["uid"], args.provider, args.rag) not in done]
    if args.limit:
        todo = todo[: args.limit]

    print(f"provider={args.provider}  model={model}  rag={args.rag}  "
          f"temperature={TEMPERATURE}")
    print(f"대상 {len(todo)} / 전체 {len(rows)} (건너뜀 {len(rows)-len(todo)})")
    if not todo:
        return 0

    new = not out.exists()
    fh = out.open("a", encoding="utf-8-sig", newline="")
    w = csv.DictWriter(fh, fieldnames=COLS)
    if new:
        w.writeheader()
        fh.flush()

    n_err = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = [ex.submit(run_one, r, args.provider, model, rag_on, k, min_score, 4)
                for r in todo]
        # as_completed: 끝나는 대로 쓴다. 제출 순서로 받으면 느린 한 건이 뒤 전부의
        # 기록을 막아, 재시도 중인 1건 때문에 벌크가 멈춘 것처럼 보인다.
        for i, fu in enumerate(as_completed(futs), 1):
            rec = fu.result()
            bad = rec["answer"].startswith("[ERROR]")
            n_err += bad
            with _write_lock:
                w.writerow(rec)
                fh.flush()
            mark = "✗" if bad else "·"
            print(f"  {mark} [{i}/{len(todo)}] {rec['uid']} "
                  f"hits={rec['hits']} {len(rec['answer'])}자 "
                  f"{rec['prompt_tokens']}+{rec['completion_tokens']}tok")
    fh.close()
    print(f"\n완료 → {out}   오류 {n_err}건" +
          ("  (재실행하면 오류 건만 다시 시도)" if n_err else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
