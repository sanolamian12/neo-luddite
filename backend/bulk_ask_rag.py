r"""
Upstage Solar 벌크 질의 — **RAG ON** 판 (bulk_ask.py 의 A/B 짝).

bulk_ask.py 와 **모델·SYSTEM_PROMPT·temperature 를 동일하게 유지**하고, 오직
"검색된 KB passage 를 프롬프트에 주입하는지"만 다르다. 그래야 두 열의 차이를
RAG 하나로 귀속시킬 수 있다(순수 A/B).

  bulk_ask.py     : [system, user(question)]                    → C열
  bulk_ask_rag.py : [system, user(참고지식 + question)]          → D열

검색 경로는 제품과 동일하다: Upstage `embedding-query` 로 질의 벡터화 →
`rag.match_passages` 코사인 top-k → `RAG_MIN_SCORE` 컷. 컷을 넘는 게 없으면
근거 없이 그대로 답한다(retriever.py 의 graceful 원칙). 그 경우 hits=0 으로
기록되어 "RAG 가 손을 못 댄 건"을 사후에 분리할 수 있다.

입출력은 4열 CSV 한 장을 in-place 로 갱신한다:
  no | question | answer (RAG OFF) | answer (RAG ON)
C열은 절대 건드리지 않고 D열만 채운다. 검색 진단(hits/score/source_kind)은
CSV 를 4열로 유지하기 위해 사이드카 파일에 따로 남긴다.

사용:
  cd backend
  .\.venv\Scripts\python.exe bulk_ask_rag.py --csv "…/upstage bulk 답변.csv"
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from openai import OpenAI

# bulk_ask.py 의 자산을 그대로 재사용 — 페르소나가 갈리면 A/B 가 오염된다.
from bulk_ask import SYSTEM_PROMPT, load_env

COL_Q = 1          # question
COL_OFF = 2        # answer (RAG OFF)  ← 읽기 전용
COL_ON = 3         # answer (RAG ON)   ← 이 스크립트가 채우는 곳


# ── 오염 전파 차단 ──────────────────────────────────────────────────────────────
# KB 번들은 ingest.build_bundle_text 가 만든 고정 형식이다:
#     [질문] … / [AI 답변] … / [세무사 코멘트] … / (태그: …)
# 여기서 [AI 답변] 은 **세무사가 오류를 지적한 그 답변**이다. 이 블록을 그대로 주입하면
# 모델이 그 안의 가짜 조문·판례(소득세법 §35, 조심2025구1960)를 권위 있는 근거로
# 착각해 재생산한다(실측: 100건 중 3건). 즉 원문 주입은 교정 지식과 함께 **오류까지
# 같이 주입**한다.
# → 주입 직전에 번들을 파싱해 각 블록의 극성을 명시적으로 뒤집는다. 모델의 추론에
#   맡기지 않고 데이터 층에서 라벨을 박는 게 핵심.
_BLOCK = re.compile(
    r"\[질문\]\s*(?P<q>.*?)"
    r"(?:\n\[AI 답변\]\s*(?P<a>.*?))?"
    r"(?:\n\[세무사 코멘트\]\s*(?P<c>.*?))?"
    r"(?:\n\(태그:\s*(?P<t>.*?)\))?$",
    re.S,
)


def reshape_passage(raw: str) -> str:
    """KB 번들 → 극성이 명시된 학습자료. 파싱 실패 시 원문 그대로(graceful)."""
    m = _BLOCK.match(raw.strip())
    if not m or not (m.group("c") or "").strip():
        return raw.strip()          # 코멘트 없는 case_seed/kb_document 는 그대로 참고자료
    q = (m.group("q") or "").strip()
    a = (m.group("a") or "").strip()
    c = (m.group("c") or "").strip()
    t = (m.group("t") or "").strip()

    out = [f"■ 유사 사례: {q}"]
    if a:
        out.append(
            "  [✗ 잘못된 답변 — 세무사가 오류로 지적한 내용입니다. "
            "여기 등장하는 조문·판례·수치는 실재하지 않을 수 있으니 절대 인용하지 마세요]\n"
            f"  {a}"
        )
    out.append(f"  [✓ 세무사 교정 의견 — 이것만을 근거로 삼으세요]\n  {c}")
    if t:
        out.append(f"  (지적 유형: {t})")
    return "\n".join(out)


def build_user_prompt(question: str, passages: list[str]) -> str:
    """교정된 사례 블록 + 질문.

    passages 가 비면 질문만 보낸다 → 그 행은 사실상 RAG OFF 와 같은 조건이 되고,
    hits=0 으로 남아 나중에 분리 집계된다.
    """
    if not passages:
        return question
    joined = "\n\n".join(reshape_passage(p) for p in passages)
    return (
        "아래는 같은 분야의 과거 상담에서 **세무사가 직접 남긴 교정 의견**입니다. "
        "당신이 이미 알고 있는 실무 지식으로 취급하세요.\n\n"
        f"{joined}\n\n"
        "── 답변 작성 규칙 ──\n"
        "1. ✓ 세무사 교정 의견만 근거로 쓰세요. ✗ 블록의 조문·판례·수치는 "
        "실재하지 않을 수 있으므로 절대 인용하지 마세요.\n"
        "2. 위 자료에 없는 법령·판례·수치를 지어내지 마세요. 근거가 없으면 "
        "'확인이 필요하다'고 쓰세요.\n"
        "3. **'참고 지식', '제공된 자료', '세무사 코멘트에 따르면' 같은 표현을 쓰지 마세요.** "
        "자료를 인용하는 게 아니라, 당신의 지식으로 원장님께 직접 상담하듯 쓰세요.\n"
        "4. '[질문]', '[AI 답변]' 같은 자료의 형식 표시를 답변에 옮기지 마세요.\n"
        "5. 결론이 개인사업자/의료법인, 임원/직원 등으로 갈리면 단정하지 말고 되물으세요.\n\n"
        f"── 원장님 질문 ──\n{question}"
    )


def retrieve(question: str, k: int, min_score: float) -> tuple[list[str], list[dict]]:
    """제품과 동일 경로 검색. 실패해도 예외를 올리지 않는다(graceful)."""
    from api.rag import embeddings, store

    try:
        qvec = embeddings.embed_query(question)
        rows = store.search(qvec, k=k, occupation="clinic")
    except Exception as exc:  # noqa: BLE001 — 검색 실패로 벌크가 멈추면 안 된다
        return [], [{"error": f"{type(exc).__name__}: {exc}"}]
    kept = [r for r in rows if r.score >= min_score]
    diag = [
        {"score": round(r.score, 4), "source_kind": r.source_kind,
         "reviewer": r.reviewer, "kept": r.score >= min_score}
        for r in rows
    ]
    return [r.content for r in kept], diag


def ask(client: OpenAI, model: str, question: str, k: int, min_score: float,
        retries: int = 5) -> tuple[str, int, list[dict]]:
    """검색 → 주입 → 호출. 반환: (답변, 채택 passage 수, 검색 진단)."""
    passages, diag = retrieve(question, k, min_score)
    user_prompt = build_user_prompt(question, passages)

    for attempt in range(retries):
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.3,   # bulk_ask.py 와 동일
            )
            return (resp.choices[0].message.content or "").strip(), len(passages), diag
        except Exception as e:  # noqa: BLE001
            if attempt == retries - 1:
                return f"[ERROR] {type(e).__name__}: {e}", len(passages), diag
            time.sleep(2 ** attempt)
    return "[ERROR] unknown", len(passages), diag


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True, help="4열 CSV (D열을 채운다)")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--limit", type=int, default=0, help="앞 N건만 (스모크용, 0=전체)")
    args = ap.parse_args()

    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:  # noqa: BLE001
            pass

    here = Path(__file__).resolve().parent
    sys.path.insert(0, str(here))
    load_env(here / ".env")

    key = os.environ.get("UPSTAGE_API_KEY")
    if not key:
        print("UPSTAGE_API_KEY 없음 — backend/.env 확인", file=sys.stderr)
        return 1
    if not os.environ.get("SUPABASE_DB_URL"):
        print("SUPABASE_DB_URL 없음 — RAG 검색 불가. RAG ON 실행 중단", file=sys.stderr)
        return 1

    model = os.environ.get("UPSTAGE_CHAT_MODEL", "solar-pro3")
    base_url = os.environ.get("UPSTAGE_BASE_URL", "https://api.upstage.ai/v1")
    k = int(os.environ.get("RAG_TOP_K", "5"))
    min_score = float(os.environ.get("RAG_MIN_SCORE", "0.0"))
    client = OpenAI(api_key=key, base_url=base_url)

    csv_path = Path(args.csv)
    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    header, body = rows[0], rows[1:]

    # resume: D열이 이미 정상 답변이면 건너뛴다 (ERROR 는 재시도 대상)
    todo = [
        (i, r[COL_Q]) for i, r in enumerate(body)
        if not (r[COL_ON].strip() and not r[COL_ON].startswith("[ERROR]"))
    ]
    if args.limit:
        todo = todo[: args.limit]

    print(f"총 {len(body)}행 · 이번실행 {len(todo)} · 모델 {model} "
          f"· top_k {k} · min_score {min_score} · 워커 {args.workers}")

    results: dict[int, tuple[str, int, list[dict]]] = {}
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(ask, client, model, q, k, min_score): i for i, q in todo}
        done = 0
        for fut in as_completed(futs):
            i = futs[fut]
            results[i] = fut.result()
            done += 1
            ans, hits, _ = results[i]
            flag = "ERR" if ans.startswith("[ERROR]") else f"hits={hits}"
            print(f"  [{done}/{len(todo)}] no.{body[i][0]} {flag}", flush=True)

    for i, (ans, _hits, _diag) in results.items():
        body[i][COL_ON] = ans

    with csv_path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(body)

    # 검색 진단 사이드카 — CSV 를 4열로 유지하면서 hits/score 를 보존한다.
    diag_path = csv_path.with_name(csv_path.stem + "_rag_diag.json")
    prev = {}
    if diag_path.exists():
        prev = {d["no"]: d for d in json.loads(diag_path.read_text(encoding="utf-8"))}
    for i, (_ans, hits, diag) in results.items():
        prev[body[i][0]] = {"no": body[i][0], "question": body[i][COL_Q],
                            "hits_kept": hits, "retrieved": diag}
    diag_path.write_text(
        json.dumps([prev[k2] for k2 in sorted(prev, key=lambda x: int(x))],
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    errs = sum(1 for a, _, _ in results.values() if a.startswith("[ERROR]"))
    zero = sum(1 for _, h, _ in results.values() if h == 0)
    print(f"완료 · {time.time()-t0:.0f}s · 오류 {errs}건 · 근거0건 {zero}건")
    print(f"  CSV : {csv_path}")
    print(f"  진단: {diag_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
