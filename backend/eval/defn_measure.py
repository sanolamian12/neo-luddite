r"""A5 정의 조항 측정(10/19) — 정의형 질문마다 LLM3 블록·답 인용에 그 법의 정의 조문이 실리는지. 로컬 파이프라인 직접 호출.
실행: cd backend && OUT=<결과.json> .venv\Scripts\python.exe eval/defn_measure.py [0,2,…]"""
import json, logging, os, re, sys, time
sys.path.insert(0, ".")
sys.stdout.reconfigure(encoding="utf-8")
os.environ.setdefault("VEC_MEMORY", "off")
os.environ.setdefault("LAW_SELECT", "on")
os.environ.setdefault("LAW_ONLY", "on")
logging.basicConfig(level=logging.WARNING, stream=sys.stdout)
from eval.run_demo_eval import load_env
load_env()
from api import pipeline, law_select

# (질문, 기대 정의 조문 (법, 조))
QS = [
    ("부가가치세법에서 간이과세자가 뭔가요?", ("부가가치세법", "2")),
    ("세법에서 말하는 특수관계인이 무엇인가요?", ("국세기본법", "2")),
    ("양도소득세에서 주택이란 무엇을 말하나요?", ("소득세법", "88")),
    ("거주자와 비거주자는 어떻게 구분하나요?", ("소득세법", "1의2")),
    ("법인세법상 내국법인이란 무엇인가요?", ("법인세법", "2")),
    ("세법에서 증여의 뜻이 뭔가요?", ("상속세 및 증여세법", "2")),
]
if len(sys.argv) > 1:
    QS = [QS[int(i)] for i in sys.argv[1].split(",")]

seen_block = []
orig = law_select.law_block
def spy(picks, cap=law_select.ARTICLE_CHARS):
    seen_block.append([p.article.key for p in picks])
    return orig(picks, cap)
law_select.law_block = spy

rows = []
for q, want in QS:
    seen_block.clear()
    t0 = time.time()
    resp = pipeline.run_clinic(f"eval-defn-{int(t0)}", [], q)
    dt = time.time() - t0
    ex = resp.meta.extracted or {}
    keys = seen_block[-1] if seen_block else []
    text = "\n".join(s.text for s in resp.message.segments)
    cits = [c for s in resp.message.segments for c in (s.citations or [])]
    num = want[1].replace("의", "조의") if "의" in want[1] else want[1] + "조"
    in_block = tuple(want) in keys
    in_answer = bool(re.search(rf"제{re.escape(num)}(?!\d)", text)) and want[0].split()[0] in text
    rows.append(dict(q=q, want=want, qtype=ex.get("question_type"), block=keys, in_block=in_block,
                     in_answer=in_answer, cits=[str(c)[:80] for c in cits], sec=round(dt, 1), answer=text[:900]))
    print(f"\n### {q}  [{ex.get('question_type')}] {dt:.1f}s")
    print("  block:", keys)
    print("  정의 조문 블록:", in_block, "· 답 인용:", in_answer)
    print("  답:", text[:600].replace("\n", " / "))
json.dump(rows, open(os.environ.get("OUT", "defn_out.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("\n요약: 블록", sum(r["in_block"] for r in rows), "/", len(rows), "· 답", sum(r["in_answer"] for r in rows), "/", len(rows))
