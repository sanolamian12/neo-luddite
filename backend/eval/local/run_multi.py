"""데모 세트 시나리오를 프로세스 안 run_clinic 으로 대화째 돌린다. backend/ 에서:
   python run_multi.py <태그> S02 X05 E01 ...      (운영 플래그 env 적용, VEC_MEMORY=off)"""
import logging, sys, os, json, time
sys.path.insert(0, ".")
sys.stdout.reconfigure(encoding="utf-8")
logging.basicConfig(level=logging.INFO, format="%(name)s | %(message)s", stream=sys.stdout)
for noisy in ("httpx", "httpcore", "openai"):
    logging.getLogger(noisy).setLevel(logging.WARNING)
here = os.path.dirname(os.path.abspath(__file__))
for _l in open(os.path.join(here, "prod_flags.env"), encoding="utf-8"):
    _k, _, _v = _l.strip().partition("=")
    if _k and _k not in ("CORS_ORIGINS", "AUTH_MODE"):
        os.environ[_k] = _v
os.environ["VEC_MEMORY"] = "off"
from eval.run_demo_eval import load_env, user_message
load_env()
from api import pipeline
from api.schema import Message

tag, ids = sys.argv[1], sys.argv[2:]
sets = {json.loads(l)["id"]: json.loads(l) for l in open("eval/demo_questions_1010.jsonl", encoding="utf-8") if l.strip()}
out = open(os.path.join(here, f"multi_{tag}.jsonl"), "a", encoding="utf-8")
for sid in ids:
    sc = sets[sid]
    cid = f"eval-loc-{tag}-{sid}-{int(time.time())}"
    hist = []
    for ti, text in enumerate(sc["turns"]):
        print(f"\n###### {sid} t{ti+1}: {text[:60]}")
        t0 = time.time()
        resp = pipeline.run_clinic(cid, hist, text)
        el = round(time.time() - t0, 1)
        ex = resp.meta.extracted or {}
        print(f"elapsed {el} | kind={ex.get('turn_kind')} topic={ex.get('tax_topic')} etype={ex.get('etype')} qtype={ex.get('question_type')} blocks={[b.kind for b in resp.message.uiBlocks or []]}")
        for s in resp.message.segments:
            print("  -", s.type, "|", s.text[:160], s.citations or "")
        out.write(json.dumps({"sid": sid, "turn": ti + 1, "user": text, "el": el, "kind": ex.get("turn_kind"),
                              "etype": ex.get("etype"), "topic": ex.get("tax_topic"),
                              "blocks": [b.kind for b in resp.message.uiBlocks or []],
                              "segs": [[s.type, s.text, s.citations or []] for s in resp.message.segments]},
                             ensure_ascii=False) + "\n")
        hist = hist + [Message.model_validate(user_message(text, len(hist), cid)), resp.message]
