r"""위임 시행령 후보 확장(A5) 오프라인 A/B — LLM3 후보·선택만 돌려, 고른 조문에 시행령이 함께 들어가는지 본다(10/13).

근거 카드(KB3) 없이 질문 임베딩 검색 + 위임 확장만 — 확장의 순효과를 본다. 결과(10/13): off·on 모두 10/10 — 임베딩 검색만으로도
LLM3 가 시행령을 함께 골라 확장은 되돌렸다(LAW_DELEGATE 는 이제 없는 스위치, 이 스크립트의 on·off 는 같다).
사용 (backend/ 에서): .\.venv\Scripts\python.exe -m eval.a5_delegate_offline
"""
from __future__ import annotations

import os
import sys

QUESTIONS = [
    "간이과세자 기준금액이 얼마예요?",
    "이번에 새롭게 제조업을 창업하려 합니다. 간이과세자를 적용받으려면 어떤 요건이 충족되어야 하나요",
    "월세 세액공제 받으려면 조건이 뭐예요?",
    "개원의인데 성실신고확인대상자 기준이 어떻게 되나요?",
    "일시적 2주택 비과세 조건이 뭐예요?",
    "부모님 기본공제 받으려면 소득 요건이 어떻게 돼요?",
    "중소기업 취업자 소득세 감면 대상 나이 기준이 뭐예요?",
    "업무용승용차 운행기록부 안 쓰면 경비 한도가 얼마예요?",
    "개인사업자 접대비 한도는 어떻게 정해져 있어요?",
    "통합고용세액공제 받으려면 상시근로자 기준이 뭐예요?",
]


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    os.environ.setdefault("LAW_STORE", "file")
    os.environ["UPSTAGE_CHAT_MODEL"] = os.environ.get("UPSTAGE_CHAT_MODEL_EVAL", "solar-pro4")
    from eval.run_demo_eval import load_env
    load_env()
    from api import law_select as L
    from api.rag import embeddings

    st = L.store()
    tot = {"off": 0, "on": 0}
    for q in QUESTIONS:
        qvec = embeddings.embed_query(q)
        line = [q[:28]]
        for mode in ("off", "on"):
            os.environ["LAW_DELEGATE"] = mode
            cands = L.candidates(q, [], qvec=qvec, st=st)
            picks = L.select(q, cands) or []
            dec = [p.article.label() for p in picks if p.article.law.endswith("시행령")]
            tot[mode] += bool(dec)
            line.append(f"{mode}: 후보 {len(cands)}(위임 {sum(c.source == '위임' for c in cands)}) 선택 "
                        f"{[p.article.label() for p in picks]}")
        print(" | ".join(line))
    print(f"시행령 함께 인용(선택) — off {tot['off']}/{len(QUESTIONS)} · on {tot['on']}/{len(QUESTIONS)}")


if __name__ == "__main__":
    main()
