"""
Upstage Solar 벌크 질의 스크립트 (credigraph 파이프라인 미경유, 순수 LLM Q&A).

질문 리스트(txt, 한 줄 = 한 질문)를 읽어 각 질문을 Upstage `solar-pro3`에 직접
물어보고, 답변을 CSV(UTF-8-BOM, Excel 호환) + TXT 로 저장한다.

특징:
  · 이어하기(resume): 출력 CSV 에 이미 있는 질문은 건너뛴다 → 중간에 끊겨도 재실행 OK
  · 재시도(backoff): 일시적 오류/레이트리밋 시 지수 백오프
  · 동시호출(--workers): 순서는 보존하면서 병렬로 속도 확보

사용:
  cd backend
  python bulk_ask.py                     # 기본 경로 사용
  python bulk_ask.py --in "질문.txt" --out "답변.csv" --workers 4
"""

from __future__ import annotations

import argparse
import csv
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from openai import OpenAI

# ── 경로 기본값 ──────────────────────────────────────────────────────────────────
_HOME = Path(os.path.expanduser("~"))
DEFAULT_IN = _HOME / "Desktop" / "upstage bulk 질문 리스트.txt"
DEFAULT_OUT = _HOME / "Desktop" / "upstage bulk 답변.csv"

# 세무 상담 페르소나 — 질문이 전부 병의원 비용처리/세무이므로 이 프롬프트를 씀.
# (원하는 톤/역할로 자유롭게 수정하세요.)
SYSTEM_PROMPT = (
    "당신은 한국의 병의원(치과·의원 등) 전문 세무사입니다. "
    "원장님의 비용처리·세무 질문에 대해, 관련 법령·판례 근거를 들어 "
    "실무적으로 명확하게 답변하세요. 인정/부인 여부와 필요한 증빙, 주의점을 함께 제시하세요."
)


def load_env(env_path: Path) -> None:
    """backend/.env 를 읽어 환경변수로 로드 (python-dotenv 의존 없이 최소 파서)."""
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


def parse_questions(path: Path) -> list[str]:
    """한 줄 = 한 질문. 빈 줄 제거, 양끝 따옴표 정리, 중복 유지(순서 그대로)."""
    text = path.read_text(encoding="utf-8")
    out = []
    for raw in text.splitlines():
        q = raw.strip().strip('"').strip("'").strip()
        if q:
            out.append(q)
    return out


def ask(client: OpenAI, model: str, question: str, retries: int = 5) -> str:
    """단일 질문 호출 + 지수 백오프 재시도."""
    for attempt in range(retries):
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": question},
                ],
                temperature=0.3,
            )
            return (resp.choices[0].message.content or "").strip()
        except Exception as e:  # noqa: BLE001 — 벌크 실행 안정성 우선
            if attempt == retries - 1:
                return f"[ERROR] {type(e).__name__}: {e}"
            time.sleep(2 ** attempt)  # 1,2,4,8s
    return "[ERROR] unknown"


def load_done(out_csv: Path) -> set[str]:
    """이미 답변이 저장된 질문 집합 (resume 용). ERROR 로 끝난 건은 미완료로 취급."""
    if not out_csv.exists():
        return set()
    done = set()
    with out_csv.open("r", encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            ans = (row.get("answer") or "")
            if ans and not ans.startswith("[ERROR]"):
                done.add(row.get("question", ""))
    return done


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="inp", default=str(DEFAULT_IN))
    ap.add_argument("--out", dest="out", default=str(DEFAULT_OUT))
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    # Windows 콘솔에서 한글 로그가 깨지지 않도록 UTF-8 로 맞춤 (파일 저장과 무관)
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:  # noqa: BLE001
            pass

    here = Path(__file__).resolve().parent
    load_env(here / ".env")

    key = os.environ.get("UPSTAGE_API_KEY")
    if not key:
        print("UPSTAGE_API_KEY 없음 — backend/.env 확인", file=sys.stderr)
        return 1
    base_url = os.environ.get("UPSTAGE_BASE_URL", "https://api.upstage.ai/v1")
    model = os.environ.get("UPSTAGE_CHAT_MODEL", "solar-pro3")
    client = OpenAI(api_key=key, base_url=base_url)

    in_path, out_path = Path(args.inp), Path(args.out)
    questions = parse_questions(in_path)
    done = load_done(out_path)
    todo = [(i, q) for i, q in enumerate(questions, 1) if q not in done]
    print(f"총 {len(questions)}문 · 이미완료 {len(done)} · 이번실행 {len(todo)} "
          f"· 모델 {model} · 워커 {args.workers}")

    # 병렬 호출 (순서 보존은 결과 정렬로 처리)
    results: dict[int, str] = {}
    t0 = time.time()
    from concurrent.futures import as_completed
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(ask, client, model, q): (i, q) for i, q in todo}
        completed = 0
        for fut in as_completed(futs):
            i, q = futs[fut]
            results[i] = fut.result()
            completed += 1
            print(f"  [{completed}/{len(todo)}] Q{i} 완료", flush=True)

    # 기존 CSV 병합 후 전체 재작성 (질문 순서대로)
    prev: dict[str, str] = {}
    if out_path.exists():
        with out_path.open("r", encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                prev[row.get("question", "")] = row.get("answer", "")

    with out_path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["no", "question", "answer"])
        for i, q in enumerate(questions, 1):
            ans = results.get(i) or prev.get(q, "")
            w.writerow([i, q, ans])

    # 사람이 읽기 좋은 TXT 도 같이 저장
    txt_path = out_path.with_suffix(".txt")
    with txt_path.open("w", encoding="utf-8") as f:
        for i, q in enumerate(questions, 1):
            ans = results.get(i) or prev.get(q, "")
            f.write(f"[{i}] Q: {q}\nA: {ans}\n\n{'-'*60}\n\n")

    errs = sum(1 for v in results.values() if v.startswith("[ERROR]"))
    print(f"완료 · {time.time()-t0:.0f}s · 오류 {errs}건")
    print(f"  CSV: {out_path}")
    print(f"  TXT: {txt_path}")
    if errs:
        print("  ※ 오류건은 재실행하면 자동 재시도됩니다(resume).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
