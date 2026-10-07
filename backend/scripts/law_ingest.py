r"""
법령 DB(LLM3 용) 2단계 — 조문별 '쟁점 한 줄'(Solar) + 임베딩(Upstage) → 파일 (2026-10-07)

입력: backend/data/laws/articles.jsonl (scripts/law_pdf_parse.py 산출)
산출(DB 쓰기 0):
  backend/data/laws/gists.json        키 = 조문 본문 sha1 → {issue, keywords, model, …}
  backend/data/laws/embeddings.npz    키 = 임베딩 텍스트 sha1 (kb3_ingest.py 와 같은 모양)

왜 쟁점 한 줄인가: LLM3 는 후보 조문 중 '이 질문의 쟁점에 맞는 것'을 고르기만 한다(생성 금지).
긴 원문(중앙 450자·최대 1.3만 자) 대신 짧은 목록을 보여 줘야 고르는 정확도와 토큰이 산다.
요약은 트랙 규칙상 Solar 로 만든다(원문 파싱은 코드).

Solar 가 몰리면 먹통이 되는 일이 있어 **순차 1건씩 + 간격**(--interval) 으로 부른다. 실패하면
길게 쉬고(30·60·120초), 연속 실패가 --max-fail 번이면 멈춘다. 생성분은 매번 파일에 남으므로
다시 돌리면 이어서 한다. 도는 동안 Windows 절전을 막는다(설정은 바꾸지 않음).

사용 (backend/ 에서):
    .\.venv\Scripts\python.exe scripts\law_ingest.py gist --laws 국세기본법 소득세법 "상속세 및 증여세법" --limit 20
    .\.venv\Scripts\python.exe scripts\law_ingest.py gist --laws 국세기본법 소득세법 "상속세 및 증여세법"
    .\.venv\Scripts\python.exe scripts\law_ingest.py embed --laws 국세기본법 소득세법 "상속세 및 증여세법"
    .\.venv\Scripts\python.exe scripts\law_ingest.py status
    .\.venv\Scripts\python.exe scripts\law_ingest.py search "세무조사 연기 신청할 수 있나요"
"""

from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
import sys
import time
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(_BACKEND / ".env")

DATA = _BACKEND / "data" / "laws"
ARTICLES = DATA / "articles.jsonl"
GISTS = DATA / "gists.json"
EMB = DATA / "embeddings.npz"

GIST_INPUT_CHARS = 6000   # 이보다 긴 조문(전체 0.3%)은 앞부분만 보여 준다
EMBED_BODY_CHARS = 2500   # 임베딩 입력 상한(4000 토큰 한도 안쪽)
EMBED_BATCH = 16
TIMEOUT = 90
BACKOFF = (30, 60, 120)


def _sha1(t: str) -> str:
    return hashlib.sha1(t.encode("utf-8")).hexdigest()


def _keep_awake(on: bool) -> None:
    """도는 동안 시스템 절전 금지(ES_CONTINUOUS|ES_SYSTEM_REQUIRED). 프로세스가 끝나면 자동 해제."""
    if os.name == "nt":
        ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | (0x00000001 if on else 0))


def load_articles(laws: list[str] | None) -> list[dict]:
    rows = [json.loads(l) for l in ARTICLES.open(encoding="utf-8")]
    rows = [r for r in rows if r["version"] == "current" and not r["deleted"]]
    if laws:
        rows = [r for r in rows if r["parent_law"] in set(laws)]
    return rows


def load_gists() -> dict:
    return json.loads(GISTS.read_text(encoding="utf-8")) if GISTS.exists() else {}


def save_gists(g: dict) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    tmp = GISTS.with_suffix(".tmp")
    tmp.write_text(json.dumps(g, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    tmp.replace(GISTS)


# ── 쟁점 한 줄 ──────────────────────────────────────────────────────────────

_GIST_SYSTEM = (
    "당신은 세무 상담 AI 가 법령 조문을 고를 때 쓸 색인을 만드는 도우미입니다. 주어진 조문 하나를 읽고 "
    "emit_gist 도구로만 응답하세요.\n"
    "- issue: 이 조문이 **무엇을 정하는지** 한 문장(40~90자). 누가·어떤 경우에·무엇을 할 수 있다/해야 한다/"
    "어떻게 계산한다 꼴로. 조문에 없는 내용·수치·다른 조문 번호를 넣지 마세요. '이 조문은' 같은 머리말 없이 쓰세요.\n"
    "- keywords: 일반인이 상담창에 쓸 법한 표현 3~6개(예: '세무조사 미루기', '증여 공제 한도'). "
    "조문에 없는 세목·제도를 지어내지 마세요.\n"
    "- 삭제되었거나 다른 조문을 준용만 하는 조문이면 그 사실을 issue 에 그대로 쓰세요."
)
_GIST_TOOL = {
    "type": "function",
    "function": {
        "name": "emit_gist",
        "description": "조문 하나의 쟁점 한 줄과 사용자 표현 키워드.",
        "parameters": {
            "type": "object",
            "properties": {
                "issue": {"type": "string"},
                "keywords": {"type": "array", "minItems": 3, "maxItems": 6, "items": {"type": "string"}},
            },
            "required": ["issue", "keywords"],
        },
    },
}


def _gist_input(r: dict) -> str:
    body = r["text"]
    if len(body) > GIST_INPUT_CHARS:
        body = body[:GIST_INPUT_CHARS] + "\n…(이하 생략)"
    where = f" · 위치: {r['heading']}" if r["heading"] else ""
    return f"[{r['law_name']}{where}]\n{body}"


def generate_gist(r: dict) -> dict:
    from api import llm

    resp = llm.bounded_client(TIMEOUT, retries=0).chat.completions.create(
        model=llm._chat_model(),
        messages=[{"role": "system", "content": _GIST_SYSTEM}, {"role": "user", "content": _gist_input(r)}],
        tools=[_GIST_TOOL],
        tool_choice={"type": "function", "function": {"name": "emit_gist"}},
        temperature=0.2,
    )
    calls = getattr(resp.choices[0].message, "tool_calls", None)
    if not calls:
        raise RuntimeError("tool call 없음")
    a = json.loads(calls[0].function.arguments)
    a = a.get("properties", a) if isinstance(a, dict) else {}   # solar 의 {"properties":{…}} 포장(10/6 실측)
    issue = str(a.get("issue", "")).strip()
    kws = [str(k).strip() for k in a.get("keywords") or [] if str(k).strip()]
    if len(issue) > 200:   # 긴 조문은 한 줄이 길게 나온다(국기령 §47 213자) — 버리지 말고 자른다
        issue = issue[:197].rstrip() + "…"
    if len(issue) < 10 or not kws:
        raise RuntimeError(f"형식 불량: issue {len(issue)}자, keywords {len(kws)}")
    return {"issue": issue, "keywords": kws[:6]}


def cmd_gist(a) -> None:
    rows = load_articles(a.laws)
    g = load_gists()
    todo = [r for r in rows if _sha1(r["text"]) not in g]
    if a.limit:
        todo = todo[: a.limit]
    print(f"대상 {len(rows)}조 · 이미 있음 {len(rows) - len([r for r in rows if _sha1(r['text']) not in g])} · 이번 {len(todo)}"
          f" · 간격 {a.interval}s", flush=True)
    _keep_awake(True)
    fails = done = 0
    t0 = time.time()
    try:
        for i, r in enumerate(todo, 1):
            for attempt in range(len(BACKOFF) + 1):
                try:
                    t = time.time()
                    out = generate_gist(r)
                    g[_sha1(r["text"])] = {"id": r["id"], **out, "model": os.environ.get("UPSTAGE_CHAT_MODEL", "solar-pro3"),
                                           "sec": round(time.time() - t, 1), "generatedAt": int(time.time() * 1000)}
                    save_gists(g)
                    done += 1
                    fails = 0
                    break
                except Exception as exc:  # noqa: BLE001
                    fails += 1
                    msg = f"{type(exc).__name__}: {str(exc)[:120]}"
                    if fails >= a.max_fail:
                        raise SystemExit(f"연속 실패 {fails}회 — 멈춤. 마지막: {r['id']} {msg}")
                    if attempt == len(BACKOFF):
                        print(f"  건너뜀 {r['id']}: {msg}", flush=True)
                        break
                    print(f"  실패 {r['id']} ({msg}) → {BACKOFF[attempt]}초 쉼", flush=True)
                    time.sleep(BACKOFF[attempt])
            if i % 10 == 0 or i == len(todo):
                el = time.time() - t0
                eta = el / i * (len(todo) - i)
                print(f"  {i}/{len(todo)} 완료 {done} · 경과 {el/60:.1f}분 · 남은 예상 {eta/60:.0f}분", flush=True)
            time.sleep(a.interval)
    finally:
        _keep_awake(False)
    print(f"끝: 생성 {done} / {len(todo)}")


# ── 임베딩 ──────────────────────────────────────────────────────────────────

def embed_text(r: dict, gist: dict | None) -> str:
    head = f"{r['law_name']} 제{r['article_num']}조" + (f"의{r['article_sub']}" if r["article_sub"] else "")
    head += f"({r['title']})" if r["title"] else ""
    parts = [head]
    if gist:
        parts += [f"쟁점: {gist['issue']}", "표현: " + ", ".join(gist["keywords"])]
    body = r["text"][:EMBED_BODY_CHARS]
    return "\n".join(parts) + "\n\n" + body


def _load_emb():
    import numpy as np

    if not EMB.exists():
        return {}, None
    z = np.load(EMB)
    return {k: i for i, k in enumerate(z["keys"].tolist())}, z["vecs"]


def _save_emb(index: dict, vecs) -> None:
    import numpy as np

    keys = sorted(index, key=index.get)
    tmp = EMB.with_suffix(".tmp.npz")
    np.savez(tmp, keys=np.array(keys), vecs=vecs)
    tmp.replace(EMB)


def cmd_embed(a) -> None:
    import numpy as np
    from api import llm
    from api.rag import embeddings

    rows = load_articles(a.laws)
    g = load_gists()
    missing = sum(1 for r in rows if _sha1(r["text"]) not in g)
    if missing and not a.allow_no_gist:
        raise SystemExit(f"쟁점 한 줄 없는 조문 {missing}개 — gist 를 먼저 끝내거나 --allow-no-gist")
    index, vecs = _load_emb()
    texts = [embed_text(r, g.get(_sha1(r["text"]))) for r in rows]
    todo = list(dict.fromkeys(t for t in texts if _sha1(t) not in index))
    print(f"대상 {len(texts)} · 새로 {len(todo)}", flush=True)
    _keep_awake(True)
    try:
        for i in range(0, len(todo), EMBED_BATCH):
            chunk = todo[i : i + EMBED_BATCH]
            for attempt in range(len(BACKOFF) + 1):
                try:
                    resp = llm.bounded_client(TIMEOUT, retries=0).embeddings.create(
                        model=embeddings._passage_model(), input=chunk)
                    new = np.asarray([d.embedding for d in resp.data], dtype=np.float32)
                    if new.shape != (len(chunk), embeddings.EMBED_DIM):
                        raise RuntimeError(f"모양 {new.shape}")
                    break
                except Exception as exc:  # noqa: BLE001
                    if attempt == len(BACKOFF):
                        raise
                    print(f"  재시도 {type(exc).__name__}: {str(exc)[:120]} → {BACKOFF[attempt]}초", flush=True)
                    time.sleep(BACKOFF[attempt])
            base = 0 if vecs is None else len(vecs)
            vecs = new if vecs is None else np.vstack([vecs, new])
            for j, t in enumerate(chunk):
                index[_sha1(t)] = base + j
            _save_emb(index, vecs)
            print(f"  임베딩 {min(i + EMBED_BATCH, len(todo))}/{len(todo)}", flush=True)
            time.sleep(a.interval)
    finally:
        _keep_awake(False)


# ── DB 적재(laws.articles, 0046) ─────────────────────────────────────────────

def cmd_ingest(a) -> None:
    """articles.jsonl 전부(현행·예정·삭제) → laws.articles. 현행·비삭제는 쟁점 한 줄·임베딩이 있어야 한다.
    content_hash = sha1(원문 + 쟁점) — 같고 임베딩 상태도 같으면 재기록 생략. 이번에 없는 행은 archived."""
    from api.rag import laws_store

    rows_all = [json.loads(l) for l in ARTICLES.open(encoding="utf-8")]
    g = load_gists()
    index, vecs = _load_emb()
    have = laws_store.existing_hashes()
    todo, missing = [], 0
    for r in rows_all:
        live = r["version"] == "current" and not r["deleted"]
        gist = g.get(_sha1(r["text"])) if live else None
        vec = None
        if live:
            if not gist:
                missing += 1
                continue
            i = index.get(_sha1(embed_text(r, gist)))
            if i is None:
                missing += 1
                continue
            vec = vecs[i]
        h = _sha1(r["text"] + "\n" + (gist or {}).get("issue", ""))
        if have.get(r["id"]) == (h, vec is not None):
            continue
        todo.append({**{k: r.get(k) for k in ("id", "law_name", "parent_law", "kind", "law_no", "article_no",
                                              "article_num", "article_sub", "title", "heading", "deleted",
                                              "version", "effective_from", "note", "text", "paragraphs",
                                              "source_file")},
                     "law_effective": r.get("law_effective"), "issue": (gist or {}).get("issue"),
                     "keywords": (gist or {}).get("keywords", []), "embedding": vec, "content_hash": h})
    if missing and not a.allow_missing:
        raise SystemExit(f"쟁점 한 줄·임베딩 없는 현행 조문 {missing}개 — gist/embed 를 먼저 끝내거나 --allow-missing")
    print(f"전체 {len(rows_all)} · 새로·바뀜 {len(todo)} · 그대로 {len(rows_all) - len(todo) - missing}", flush=True)
    for i in range(0, len(todo), 100):
        laws_store.upsert_rows(todo[i : i + 100])
        print(f"  적재 {min(i + 100, len(todo))}/{len(todo)}", flush=True)
    gone = laws_store.archive_except({r["id"] for r in rows_all})
    print(f"archived {gone} · DB {laws_store.count()}")


# ── 점검 ────────────────────────────────────────────────────────────────────

def cmd_status(a) -> None:
    rows = load_articles(None)
    g = load_gists()
    index, _ = _load_emb()
    by = {}
    for r in rows:
        s = by.setdefault(r["parent_law"], [0, 0, 0])
        s[0] += 1
        gist = g.get(_sha1(r["text"]))
        s[1] += bool(gist)
        s[2] += _sha1(embed_text(r, gist)) in index
    for k, (n, gi, em) in sorted(by.items()):
        if gi or em or not a.only_started:
            print(f"{k:<20} 조 {n:>5}  쟁점 {gi:>5}  임베딩 {em:>5}")


def cmd_search(a) -> None:
    import numpy as np
    from api.rag import embeddings

    rows = load_articles(a.laws)
    g = load_gists()
    index, vecs = _load_emb()
    cand = [(r, index[_sha1(embed_text(r, g.get(_sha1(r["text"]))))]) for r in rows
            if _sha1(embed_text(r, g.get(_sha1(r["text"])))) in index]
    if not cand:
        raise SystemExit("임베딩된 조문 없음")
    q = np.asarray(embeddings.embed_query(a.query), dtype=np.float32)
    m = vecs[[i for _, i in cand]]
    sims = m @ q / (np.linalg.norm(m, axis=1) * np.linalg.norm(q))
    for j in np.argsort(-sims)[: a.k]:
        r = cand[j][0]
        gi = g.get(_sha1(r["text"]), {})
        print(f"{sims[j]:.3f}  {r['law_name']} 제{r['article_no']}조({r['title']})  — {gi.get('issue', '')}")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("gist")
    p.add_argument("--laws", nargs="*")
    p.add_argument("--limit", type=int, default=0)
    p.add_argument("--interval", type=float, default=2.0, help="호출 사이 쉬는 초")
    p.add_argument("--max-fail", type=int, default=6)
    p.set_defaults(fn=cmd_gist)
    p = sub.add_parser("embed")
    p.add_argument("--laws", nargs="*")
    p.add_argument("--interval", type=float, default=1.0)
    p.add_argument("--allow-no-gist", action="store_true")
    p.set_defaults(fn=cmd_embed)
    p = sub.add_parser("ingest")
    p.add_argument("--allow-missing", action="store_true")
    p.set_defaults(fn=cmd_ingest)
    p = sub.add_parser("status")
    p.add_argument("--only-started", action="store_true")
    p.set_defaults(fn=cmd_status)
    p = sub.add_parser("search")
    p.add_argument("query")
    p.add_argument("--laws", nargs="*")
    p.add_argument("-k", type=int, default=8)
    p.set_defaults(fn=cmd_search)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
