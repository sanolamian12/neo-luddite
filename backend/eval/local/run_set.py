"""한 질문을 프로세스 안에서 run_clinic 으로 돌리며 단계별 로그(INFO)·작문 원문을 본다. backend/ 에서:
   python trace_one.py "<질문>"   (운영 플래그 env 를 줘서 실행)"""
import logging, sys, os
sys.path.insert(0, ".")
sys.stdout.reconfigure(encoding="utf-8")
logging.basicConfig(level=logging.INFO, format="%(name)s | %(message)s", stream=sys.stdout)
for noisy in ("httpx", "httpcore", "openai"):
    logging.getLogger(noisy).setLevel(logging.WARNING)

import os
for _l in open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"prod_flags.env"),encoding="utf-8"):
    _k,_,_v=_l.strip().partition("=")
    if _k and _k not in ("CORS_ORIGINS","AUTH_MODE"): os.environ[_k]=_v
os.environ["VEC_MEMORY"]="off"
from eval.run_demo_eval import load_env
load_env()
from api import llm, pipeline

import json, time
qs=[json.loads(l) for l in open(sys.argv[1],encoding="utf-8") if l.strip()]
for q in qs:
    print("\n######", q["id"], q["q"])
    t0=time.time()
    resp = pipeline.run_clinic("eval-cmp-"+q["id"]+"-"+sys.argv[2], [], q["q"])
    print("elapsed", round(time.time()-t0,1))
    for s in resp.message.segments:
        print("  -", s.type, "|", s.text, s.citations or "")
