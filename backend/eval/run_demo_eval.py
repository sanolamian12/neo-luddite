r"""데모 질문 세트 러너 — 로드맵 R0 (design/데모대비_챗품질_개선로드맵_1010.md).

시나리오(demo_questions_1010.jsonl)의 턴을 `/api/chat` 에 차례로 흘려 보내고, 턴마다
outcome·상투 문구·지연을 기록한다. 이후 R1~R4 의 완료 판정이 모두 이 러너의 요약표다.

outcome 은 응답에 실리지 않는다 — 파이프라인이 `rag.chat_turns` 에 손으로 붙여 남긴다
(pipeline._recorded 주석: meta 로 되추론하면 지표가 오염된다). 그래서 run 이 끝난 뒤
message_id 로 DB 에서 대조한다. DB 를 못 읽으면 outcome 은 '?' 로 남긴다.

운영에서 돌리면 계측 행이 실제 사용자 행과 섞인다 → conversationId 를 `eval-r0-<run>-<id>`
로 붙여 둔다. 걸러낼 때: `where conversation_id like 'eval-%'`.

Solar 호출 수는 클라이언트에서 보이지 않는다 — outcome 별 분기 경로로 **추정**한다(SOLAR_EST).

사용:
  cd backend
  .\.venv\Scripts\python.exe -m eval.run_demo_eval --base https://158-179-177-51.sslip.io --tag baseline
"""

from __future__ import annotations

import argparse
import json
import os
import re
import statistics
import sys
import time
from collections import Counter
from datetime import datetime
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
REPO = BACKEND.parent
QUESTIONS = HERE / "demo_questions_1010.jsonl"
RAW_DIR = REPO / "docs" / "doing" / "demo_eval_1010"      # 답변 원문 — git 밖
SUMMARY_DIR = REPO / "design" / "demo_eval_1010"          # 요약표 — git 추적

# 스펙 8 의 상투 문구. CANNED = 머리말("규칙엔진의 판정 대상이 아닙니다"), NINE = no_precedent 의
# 9종 목록 나열 + 다시 설명 요구. 둘 다 내부 용어 노출(C4)이라 R1 완료 기준은 0건이다.
CANNED = re.compile(r"규칙엔진의 판정 대상이 아닙니다")
NINE = re.compile(r"판정을 지원하는 지출 유형은")
JARGON = re.compile(r"규칙엔진|규칙 엔진")

# outcome 별 Solar 호출 추정(pipeline.run_clinic 분기 기준, LAW_SELECT on·KB3_ISSUE_GATE on 가정).
#   missing_inputs = 추출+되묻기 / undecided = 추출+결정변수검증+되묻기
#   verdict = 추출+검증+LLM3+작성 / advisory = 추출+쟁점게이트+LLM3+작성
#   law_advisory = 추출+LLM3+작성 / off_issue = 추출+게이트+LLM3 / no_precedent = 추출+LLM3
SOLAR_EST = {
    "handoff_request": 0, "missing_inputs": 2, "undecided": 3, "verdict": 4,
    "advisory": 4, "law_advisory": 3, "off_issue": 3, "no_precedent": 2,
    "congested": 0, "unsupported_occupation": 0,
}


def load_env() -> None:
    p = BACKEND / ".env"
    if not p.exists():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def user_message(text: str, order: int, cid: str) -> dict:
    # 프론트 lib/runtime/remote-chat-send.ts::buildUserMessage 와 같은 모양.
    return {"id": f"u_{cid}_{order}", "role": "user", "order": order,
            "segments": [{"id": f"us_{cid}_{order}", "text": text, "type": "question"}]}


def answer_text(msg: dict) -> str:
    return "\n".join(s.get("text", "") for s in msg.get("segments", []))


def run_scenario(client: httpx.Client, base: str, sc: dict, run_id: str, occupation: str) -> list[dict]:
    cid = f"eval-r0-{run_id}-{sc['id']}"
    history: list[dict] = []
    rows = []
    for ti, text in enumerate(sc["turns"]):
        body = {"conversationId": cid, "occupation": occupation, "history": history,
                "userInput": {"text": text}}
        t0 = time.perf_counter()
        err = None
        try:
            r = client.post(f"{base}/api/chat", json=body)
            r.raise_for_status()
            data = r.json()
        except Exception as exc:  # noqa: BLE001 — 한 턴 실패가 세트 전체를 멈추면 안 된다
            data, err = None, f"{type(exc).__name__}: {exc}"[:300]
        ms = int((time.perf_counter() - t0) * 1000)
        row = {"scenario": sc["id"], "cat": sc["cat"], "short_reply": sc["short_reply"],
               "turn": ti + 1, "user": text, "latency_ms": ms, "error": err}
        if data:
            msg, meta = data["message"], data.get("meta", {})
            txt = answer_text(msg)
            row.update({
                "message_id": msg["id"], "answer": txt,
                "ui_blocks": [b.get("kind") for b in (msg.get("uiBlocks") or [])],
                "follow_up": meta.get("followUp", False), "advisory": meta.get("advisory", False),
                "handoff": meta.get("handoff"), "rag_hits": meta.get("ragHits", 0),
                "etype": (meta.get("extracted") or {}).get("etype"),
                "canned": bool(CANNED.search(txt)), "nine_list": bool(NINE.search(txt)),
                "jargon": bool(JARGON.search(txt)),
                "citations": sum(len(s.get("citations") or []) for s in msg.get("segments", [])),
            })
            history = history + [user_message(text, len(history), cid), msg]
        else:
            # 실패한 턴 뒤로는 대화가 어긋난다 — 이 시나리오는 여기서 멈춘다.
            rows.append(row)
            break
        rows.append(row)
        print(f"  {sc['id']} t{ti + 1} {ms:>6}ms canned={row.get('canned')} {txt[:50]!r}", flush=True)
    return rows


def attach_outcomes(rows: list[dict]) -> bool:
    ids = [r["message_id"] for r in rows if r.get("message_id")]
    db = os.environ.get("SUPABASE_DB_URL")
    if not ids or not db:
        return False
    import psycopg

    try:
        with psycopg.connect(db, connect_timeout=15) as conn, conn.cursor() as cur:
            cur.execute("select message_id, outcome from rag.chat_turns where message_id = any(%s)", (ids,))
            got = dict(cur.fetchall())
    except Exception as exc:  # noqa: BLE001
        print(f"[warn] chat_turns 조회 실패: {exc}", file=sys.stderr)
        return False
    for r in rows:
        if r.get("message_id"):
            r["outcome"] = got.get(r["message_id"], "?")
            r["solar_est"] = SOLAR_EST.get(r["outcome"])
    return True


def pct(n: int, d: int) -> str:
    return f"{n}/{d} ({(100 * n / d) if d else 0:.0f}%)"


def summarize(rows: list[dict], meta: dict) -> str:
    ok = [r for r in rows if not r.get("error")]
    errs = [r for r in rows if r.get("error")]
    lat = [r["latency_ms"] for r in ok]
    later = [r for r in ok if r["turn"] >= 2]          # 되묻기에 답한 턴 — C1 의 자리
    oc = Counter(r.get("outcome", "?") for r in ok)
    solar = [r["solar_est"] for r in ok if r.get("solar_est") is not None]

    out = [f"# 데모 질문 세트 계측 — {meta['tag']} ({meta['started']})", "",
           f"- 대상: `{meta['base']}` · occupation=`{meta['occupation']}` · run_id=`{meta['run_id']}`",
           f"- 시나리오 {meta['scenarios']}개 · 턴 {len(rows)}개(성공 {len(ok)} · 실패 {len(errs)})",
           f"- conversationId 접두 `eval-r0-{meta['run_id']}-` — 운영 계측에서 걸러낼 때 `like 'eval-%'`",
           f"- 원문: `docs/doing/demo_eval_1010/{meta['raw_name']}` (git 밖)", "",
           "## 핵심 지표", "", "| 지표 | 값 |", "|---|---|",
           f"| **상투 문구**(\"규칙엔진의 판정 대상이 아닙니다\") 발생 턴 | {pct(sum(r['canned'] for r in ok), len(ok))} |",
           f"| 9종 목록 나열(no_precedent 고정문) | {pct(sum(r['nine_list'] for r in ok), len(ok))} |",
           f"| 내부 용어 \"규칙엔진\" 노출 | {pct(sum(r['jargon'] for r in ok), len(ok))} |",
           f"| 2턴 이후(되묻기 답) 턴의 상투 문구 | {pct(sum(r['canned'] for r in later), len(later))} |",
           f"| 1턴(첫 질문)의 상투 문구 | {pct(sum(r['canned'] for r in ok if r['turn'] == 1), sum(1 for r in ok if r['turn'] == 1))} |",
           f"| no_precedent 비율 | {pct(oc.get('no_precedent', 0), len(ok))} |",
           f"| 인용 배지 1개 이상 턴 | {pct(sum(1 for r in ok if r['citations']), len(ok))} |",
           f"| 지연 평균 / 중앙 / 최대 | {statistics.mean(lat) / 1000:.1f}s / {statistics.median(lat) / 1000:.1f}s / {max(lat) / 1000:.1f}s |" if lat else "| 지연 | - |",
           f"| Solar 호출 추정 평균(턴당) | {statistics.mean(solar):.2f} |" if solar else "| Solar 호출 추정 | - |",
           "", "## outcome 분포", "", "| outcome | 턴 | 비율 |", "|---|---|---|"]
    for k, v in oc.most_common():
        out.append(f"| {k} | {v} | {100 * v / len(ok):.0f}% |")

    out += ["", "## 카테고리별", "", "| 카테고리 | 턴 | 상투 | no_precedent | 평균 지연 |", "|---|---|---|---|---|"]
    for cat in dict.fromkeys(r["cat"] for r in ok):
        rs = [r for r in ok if r["cat"] == cat]
        out.append(f"| {cat} | {len(rs)} | {sum(r['canned'] for r in rs)} | "
                   f"{sum(r.get('outcome') == 'no_precedent' for r in rs)} | "
                   f"{statistics.mean(r['latency_ms'] for r in rs) / 1000:.1f}s |")

    out += ["", "## 턴별 결과", "", "| 시나리오 | 턴 | 사용자 | outcome | 상투 | 지연 | 답변 앞부분 |",
            "|---|---|---|---|---|---|---|"]
    for r in rows:
        head = (r.get("answer") or r.get("error") or "").replace("\n", " ").replace("|", "／")[:60]
        out.append(f"| {r['scenario']} | {r['turn']} | {r['user'][:30]} | {r.get('outcome', '-')} | "
                   f"{'●' if r.get('canned') else ''} | {r['latency_ms'] / 1000:.1f}s | {head} |")
    out.append("")
    return "\n".join(out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="https://158-179-177-51.sslip.io")
    ap.add_argument("--tag", default="baseline")
    ap.add_argument("--occupation", default="clinic")
    ap.add_argument("--only", help="쉼표로 구분한 시나리오 id 만")
    ap.add_argument("--timeout", type=float, default=180.0)
    args = ap.parse_args()
    load_env()

    scenarios = [json.loads(l) for l in QUESTIONS.read_text(encoding="utf-8").splitlines() if l.strip()]
    if args.only:
        keep = set(args.only.split(","))
        scenarios = [s for s in scenarios if s["id"] in keep]
    started = datetime.now()
    run_id = started.strftime("%m%d%H%M")
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    SUMMARY_DIR.mkdir(parents=True, exist_ok=True)
    raw_name = f"{args.tag}_{run_id}.jsonl"

    rows: list[dict] = []
    # 순차 실행 — 운영 Upstage 게이트(k=3)를 러너가 스스로 막으면 지연 기준선이 부풀어 오른다.
    with httpx.Client(timeout=args.timeout) as client:
        for sc in scenarios:
            rows += run_scenario(client, args.base.rstrip("/"), sc, run_id, args.occupation)

    if not attach_outcomes(rows):
        print("[warn] outcome 대조 못 함 — '?' 로 남긴다", file=sys.stderr)
    with (RAW_DIR / raw_name).open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    md = summarize(rows, {"tag": args.tag, "started": started.strftime("%Y-%m-%d %H:%M"),
                          "base": args.base, "occupation": args.occupation, "run_id": run_id,
                          "scenarios": len(scenarios), "raw_name": raw_name})
    out = SUMMARY_DIR / f"{args.tag}_{run_id}.md"
    out.write_text(md, encoding="utf-8")
    print(f"\n요약: {out}\n원문: {RAW_DIR / raw_name}")


if __name__ == "__main__":
    main()
