r"""질문 유형 분류(A2) 오프라인 점검 — 추출 호출만 데모 세트 전 턴에 돌려 라벨과 대조한다(10/13).

운영 배포 전에 스키마 설명을 다듬는 용도. 이전 턴의 assistant 답은 지난 운영 계측 원자료(--raw)에서 가져와
이력을 운영과 같은 모양으로 만든다(추출은 이력 앞·뒤만 보므로 답 내용 차이의 영향은 작다).
배포 후 판정은 운영 계측(run_demo_eval → report_check 의 '질문 유형 분류' 행)으로 한다.

사용 (backend/ 에서):
    .\.venv\Scripts\python.exe -m eval.qtype_offline --raw ..\docs\doing\demo_eval_1010\r4c_prod_10131558.jsonl
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

from eval.run_demo_eval import QUESTIONS, load_env


def _msg(role: str, text: str):
    return SimpleNamespace(role=role, segments=[SimpleNamespace(text=text)])


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", help="이전 턴 답을 가져올 운영 계측 jsonl(없으면 자리표시 답)")
    ap.add_argument("--questions", default=str(QUESTIONS), help="라벨 붙은 질문 세트(기본 = 데모 세트)")
    ap.add_argument("--model", default="solar-pro4")
    ap.add_argument("--only", nargs="*")
    a = ap.parse_args()
    os.environ["UPSTAGE_CHAT_MODEL"] = a.model     # 로컬 .env 는 Pro 3 — 운영과 같은 모델로
    load_env()
    from api import engine_adapter as adapter, llm

    answers = {}
    for line in (open(a.raw, encoding="utf-8") if a.raw else []):
        r = json.loads(line)
        answers[(r["scenario"], r["turn"])] = r.get("answer") or ""
    scenarios = [json.loads(l) for l in open(a.questions, encoding="utf-8")]
    if a.only:
        scenarios = [s for s in scenarios if s["id"] in a.only]
    tool = adapter.build_extraction_tool()

    from api import pipeline

    def run_scenario(sc) -> list[tuple]:
        """턴은 차례로 — 짧은 답의 유형 이어 받기(pipeline._settle_question_type)가 운영과 같게 돈다."""
        out, hist, cid = [], [], f"qtype-offline-{sc['id']}"
        pipeline._QTYPE_MEMORY.pop(cid, None)
        for i, (text, label) in enumerate(zip(sc["turns"], sc["qtype"]), 1):
            try:
                ex = llm.extract_engine_inputs(hist, text, tool) or {}
                if ex:
                    adapter.normalize_question_type(ex)
                    pipeline._settle_question_type(cid, hist, text, ex)
                got = ex.get("question_type")
            except Exception as exc:  # noqa: BLE001
                got = f"ERR {exc.__class__.__name__}"
            out.append((sc["id"], i, label, got))
            hist += [_msg("user", text), _msg("assistant", answers.get((sc["id"], i), "")
                                              or "(앞 질문에 대한 안내) 정확히 안내드리려면 몇 가지를 더 여쭤볼게요.")]
        return out

    with ThreadPoolExecutor(max_workers=3) as ex:
        results = [r for rs in ex.map(run_scenario, scenarios) for r in rs]

    scored = [r for r in results if r[2] is not None]
    ok = [r for r in scored if r[2] == r[3]]
    print(f"정확도 {len(ok)}/{len(scored)} = {len(ok) / len(scored) * 100:.1f}%  (라벨 없는 턴 {len(results) - len(scored)}개 제외)")
    conf = Counter((r[2], r[3]) for r in scored if r[2] != r[3])
    for (want, got), n in conf.most_common():
        print(f"  {want} → {got}: {n}")
    for sid, turn, label, got in results:
        mark = "·" if label is None else ("✅" if label == got else "❌")
        print(f"{mark} {sid}-{turn} 라벨={label} 추출={got}")


if __name__ == "__main__":
    main()
