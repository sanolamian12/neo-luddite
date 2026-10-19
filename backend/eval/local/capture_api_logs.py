"""국내 AI 트랙 'API 호출 로그' 제출물 만들기(10/19) — 기능마다 1회 실제 Upstage 호출을 원문 기록 모드로 남긴다. backend/ 에서:
   .venv\\Scripts\\python.exe -m eval.local.capture_api_logs run   <작업폴더>     # 시나리오 실행 → <작업폴더>/raw/<시나리오>/calls.jsonl
   .venv\\Scripts\\python.exe -m eval.local.capture_api_logs build <작업폴더> <출력폴더>   # 기능별 json + zip

운영 플래그(prod_flags.env)·VEC_MEMORY=off·프로세스 안 호출(로컬 uvicorn 없음). DB 쓰기 없음 — 가르치기는 save_expert_case 대신
같은 임베딩·조문 연결 함수를 직접 부르고, 3자 방은 room_agent.answer(DB 쓰기 없음)를 쓴다. 원문 기록 = API_CALL_CAPTURE_DIR(api/usage_log.py).
기능 ↔ fn 라벨 대응은 FEATURES 표 — 작업기지 §7 에 같은 표가 있다."""
import json
import logging
import os
import re
import sys
import time
import zipfile

sys.path.insert(0, ".")
sys.stdout.reconfigure(encoding="utf-8")
logging.basicConfig(level=logging.INFO, format="%(name)s | %(message)s", stream=sys.stdout)
for noisy in ("httpx", "httpcore", "openai"):
    logging.getLogger(noisy).setLevel(logging.WARNING)
HERE = os.path.dirname(os.path.abspath(__file__))
for _l in open(os.path.join(HERE, "prod_flags.env"), encoding="utf-8"):
    _k, _, _v = _l.strip().partition("=")
    if _k and _k not in ("CORS_ORIGINS", "AUTH_MODE"):
        os.environ[_k] = _v
os.environ["VEC_MEMORY"] = "off"

ADV_Q = "상가 건물을 팔 때 양도세랑 부가세 둘 다 내야 하나요?"          # 데모 T03 (사례 판단)
CALC_Q = "연봉 5000인데 내년 소득세 얼마야?"                           # 데모 W01 첫 턴
EXP_TURNS = ["리스 차량 비용 경비 처리돼요?", "월 150만원이요", "업무전용보험 들었고 운행일지도 써요"]   # 데모 E01 계열
LISTEN_Q = "너는 뭘 도와줄 수 있어?"                                  # 데모 O02 첫 턴(근거 0건 → 듣기·서비스 안내)
ROOM_Q = "개원 준비 중인데 의원 인테리어 비용은 어떻게 처리하나요?"
ROOM_AGENT = {"practice": {"introduction": "병의원 개원·운영 세무를 주로 상담합니다.",
                           "policy": {"scope": "병의원 사업소득·경비·부가세", "rules": "근거 조문을 먼저 밝히고, 확인이 필요한 사실은 따로 적습니다.",
                                      "onMissing": True}}}
TEACH_TITLE = "개원의 인테리어 비용의 감가상각"
TEACH_FIELDS = {"facts": "개인의원 개원 시 임차 건물에 인테리어 공사비 1억원을 지출함.",
                "judgment": "임차 건물에 대한 자본적 지출은 시설장치로 보아 감가상각 대상이 됨.",
                "conclusion": "인테리어 비용은 즉시 비용이 아니라 내용연수에 따라 감가상각으로 경비 처리함.",
                "exceptions": "소액 수선비는 즉시 비용 처리 가능.", "keywords": "인테리어 감가상각 개원 시설장치"}

# (파일명, 보고서 위치, 시나리오, fn 라벨, 추가 조건, 호출 지점 설명)
FEATURES = [
    ("①-1_질문분석_유형분류·결정변수추출", "2.3 ① 질문 유형 분류 · ③ 결정변수 추출", "adv", "_extract_call", None, "backend/api/llm.py extract_engine_inputs → _extract_call"),
    ("①-2_사례·법령검색_질의임베딩", "2.3 ① 사례 검색 · ② 법령 벡터 후보", "adv", "_embed", "embedding-query", "backend/api/rag/embeddings.py embed_query → _embed"),
    ("①-3_쟁점적합성판정", "2.3 ① 사례 검색(쟁점 적합성) · ④", "adv", "judge_issue_fit", None, "backend/api/llm.py judge_issue_fit"),
    ("①-4_자문답변작성", "2.3 ① 갈래 분기 — 자문 작문", "adv", "write_advisory", None, "backend/api/llm.py write_advisory"),
    ("①-5_되묻기질문작성", "2.3 ① 되묻기 상한", "exp", "write_followup", None, "backend/api/llm.py write_followup"),
    ("①-6_근거부족_쟁점확인응답", "2.3 ① 근거 없음 시 쟁점 확인 질문", "listen", "write_listening", None, "backend/api/llm.py write_listening"),
    ("②-1_법령조문선택", "2.3 ② 조문 선택(LLM이 후보 중 선택)", "adv", "select", None, "backend/api/law_select.py select"),
    ("③-1_근로소득세계산_답변작성", "2.3 ③ 근로소득세 계산기(설명 작문)", "calc", "write_calc", None, "backend/api/llm.py write_calc"),
    ("③-2_경비판정_발화인용대조", "2.3 ③ 결정변수 발화 인용 대조", "exp", "verify_decisive", None, "backend/api/llm.py verify_decisive"),
    ("③-3_경비판정_답변작성", "2.3 ③ 병의원 경비 규칙엔진 판정 카드 작문", "exp", "write_segments", None, "backend/api/llm.py write_segments"),
    ("⑤-1_3자상담방_세무사AI응대", "2.3 ⑤ 3자 상담방 세무사 AI", "room", "write_*", None, "backend/api/room_agent.py answer → pipeline.run_clinic(room_mode)"),
    ("⑥-1_세무사가르치기_사례임베딩", "2.3 ⑥ 가르치기 → 세무사 개인 RAG 적재", "teach", "_embed", "embedding-passage", "backend/api/main.py save_my_expert_case → embeddings.embed_passage"),
    ("⑥-2_세무사가르치기_근거법령자동연결", "2.3 ⑥ 근거 법령 자동 연결(조문 배지)", "teach", "select", None, "backend/api/rag/kb3_store.py expert_law_articles → law_select.select"),
    ("B-1_공용베이스_심판례카드구조화요약", "2.3 ① 심판례를 Solar로 요약한 카드(공용 베이스 구축, 오프라인)", "trib", "format_case", None, "backend/scripts/kb3_trib_format.py format_case"),
    ("B-2_공용베이스_법령조문요지생성", "2.3 ② 법령 DB 조문 요지(공용 베이스 구축, 오프라인)", "gist", "generate_gist", None, "backend/scripts/law_ingest.py generate_gist"),
    ("B-3_공용베이스_문서임베딩", "2.3 ①② 공용 베이스 문서 임베딩 적재(오프라인)", "ingest", "_embed_batch", None, "backend/scripts/kb3_ingest.py _embed_batch"),
]

FIELD_GUIDE = {
    "request.requested_at_kst": "요청 시각(KST, 요청 직전)", "request.endpoint": "엔드포인트(도메인 포함)",
    "request.model": "요청 모델", "request.body": "요청 내용(모델에 보낸 전체 메시지·도구 정의·파라미터)",
    "response.responded_at_kst": "응답 시각(KST, 수신 직후)", "response.body": "응답 본문(응답 ID·모델명·답변·토큰 사용량)",
    "fn": "호출 지점(코드 함수 라벨)", "channel": "chat=상담 챗 · room=3자 상담방 · eval=평가 실행 · bg=대화 밖(적재·배치)",
    "conversation": "대화 id 해시 12자(비식별)",
}


def _scenario(work: str, name: str):
    d = os.path.join(work, "raw", name)
    os.makedirs(d, exist_ok=True)
    os.environ["API_CALL_CAPTURE_DIR"] = d
    from api import usage_log
    usage_log.bind(None)   # 앞 시나리오(3자 방 등)의 대화가 오프라인 호출에 붙지 않게 — 대화 시나리오는 run_clinic 이 다시 붙인다
    print(f"\n###### 시나리오 {name} → {d}", flush=True)


def cmd_run(work: str, only: list[str]) -> None:
    from eval.run_demo_eval import load_env, user_message
    load_env()
    from api import pipeline, room_agent
    from api.schema import Message

    tag = time.strftime("%m%d%H%M")

    def chat(name, turns):
        _scenario(work, name)
        cid, hist = f"eval-cap-{name}-{tag}", []
        for t in turns:
            resp = pipeline.run_clinic(cid, hist, t)
            print("  >", t, "|", " / ".join(s.text[:80] for s in resp.message.segments[:3]), flush=True)
            hist = hist + [Message.model_validate(user_message(t, len(hist), cid)), resp.message]

    steps = {
        "adv": lambda: chat("adv", [ADV_Q]),
        "calc": lambda: chat("calc", [CALC_Q]),
        "exp": lambda: chat("exp", EXP_TURNS),
        "listen": lambda: chat("listen", [LISTEN_Q]),
    }

    def room():
        _scenario(work, "room")
        print("  >", room_agent.answer(f"cap{tag}", [], "user", ROOM_Q, ROOM_AGENT, None)[:200])

    def teach():
        _scenario(work, "teach")
        from api.rag import embeddings, kb3_store
        text = kb3_store.expert_embed_text(TEACH_TITLE, TEACH_FIELDS)
        print("  > dim", len(embeddings.embed_passage(text)))
        print("  > 조문", kb3_store.expert_law_articles(TEACH_TITLE, TEACH_FIELDS))

    def trib():
        _scenario(work, "trib")
        from scripts import kb3_trib_format as tf
        with open(tf.DEFAULT_CASES, encoding="utf-8") as f:
            for line in f:
                case = json.loads(line)
                if tf.in_scope(case)[0] and len(case.get("full_text") or "") < 6000:
                    break
        card = tf.format_case(case)
        print("  >", case.get("id") or case.get("case_number"), "|", list(card)[:8])

    def gist():
        _scenario(work, "gist")
        from scripts import law_ingest
        with open(os.path.join("data", "laws", "articles.jsonl"), encoding="utf-8") as f:
            for line in f:
                r = json.loads(line)
                if r["law_name"] == "소득세법" and r["article_no"] == "12" and r["version"] == "current":
                    break
        print("  >", law_ingest.generate_gist(r))

    def ingest():
        _scenario(work, "ingest")
        from scripts import kb3_ingest
        vecs = kb3_ingest._embed_batch([kb3_store_text()])
        print("  > dim", len(vecs[0]))

    steps.update(room=room, teach=teach, trib=trib, gist=gist, ingest=ingest)
    for name, fn in steps.items():
        if only and name not in only:
            continue
        fn()
    os.environ.pop("API_CALL_CAPTURE_DIR", None)


def kb3_store_text() -> str:
    """공용 베이스 적재 단위 예시 — 질의회신 카드 꼴(제목·요지·회신)."""
    return ("[국세청 질의회신] 임차 건물 인테리어 비용의 감가상각 여부\n"
            "요지: 사업자가 임차한 건물에 지출한 인테리어 비용은 자본적 지출로서 감가상각 대상 자산에 해당함\n"
            "회신: 임차인이 임차 건물에 지출한 시설개체·개량 비용은 해당 사업자의 감가상각자산으로 계상하여 상각함")


# ── 마스킹(가이드 유의사항) — 개인정보 꼴 문자열만 가린다. 평가 질문은 내부 제작이라 대상 없음이 정상 ──────────────
_PII = [
    (re.compile(r"\b\d{6}-?[1-4]\d{6}\b"), "******-*******"),                    # 주민등록번호
    (re.compile(r"\b01[016789]-?\d{3,4}-?\d{4}\b"), "010-****-****"),             # 휴대전화
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "***@***"),                          # 이메일
    (re.compile(r"\b\d{3}-\d{2}-\d{5}\b"), "***-**-*****"),                        # 사업자등록번호
    (re.compile(r"(?i)\b(up_[A-Za-z0-9]{8,}|sk-[A-Za-z0-9]{8,}|bearer\s+\S+)"), "***"),   # 키·토큰
]


def _mask(obj, hits: list):
    if isinstance(obj, str):
        for pat, rep in _PII:
            for m in pat.findall(obj):
                hits.append(m if isinstance(m, str) else m[0])
            obj = pat.sub(rep, obj)
        return obj
    if isinstance(obj, list):
        return [_mask(x, hits) for x in obj]
    if isinstance(obj, dict):
        return {k: _mask(v, hits) for k, v in obj.items()}
    return obj


def _load(work: str, scenario: str) -> list[dict]:
    p = os.path.join(work, "raw", scenario, "calls.jsonl")
    return [json.loads(l) for l in open(p, encoding="utf-8") if l.strip()] if os.path.exists(p) else []


def _pick(recs: list[dict], fn: str, model: str | None) -> dict | None:
    for r in recs:
        if not r["response"]["ok"]:
            continue
        if fn == "write_*" and not r["fn"].startswith("write_"):
            continue
        if fn != "write_*" and r["fn"] != fn:
            continue
        if model and r["request"]["model"] != model:
            continue
        return r
    return None


def cmd_build(work: str, out: str) -> None:
    os.makedirs(out, exist_ok=True)
    rows, written = [], []
    for name, where, sc, fn, model, site in FEATURES:
        rec = _pick(_load(work, sc), fn, model)
        if rec is None:
            rows.append((name, fn, "누락"))
            continue
        hits: list = []
        rec = _mask(rec, hits)
        doc = {
            "기능명": name.split("_", 1)[1], "보고서_위치": where, "호출_지점": site, "fn_라벨": rec["fn"],
            "AI_API_제공사": "Upstage (국내 AI 연계 기업)", "호출_건수": 1,
            "마스킹": f"개인정보 꼴 {len(hits)}건 가림" if hits else "해당 없음(내부 제작 평가 질문·공개 원문 — 개인정보 없음)",
            "항목_설명": FIELD_GUIDE,
            "로그": [rec],
        }
        path = os.path.join(out, f"{name}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, indent=2)
        written.append(path)
        rows.append((name, rec["fn"], f"{rec['request']['requested_at_kst']} · {rec['request']['model']}→{(rec['response']['body'] or {}).get('model')} · 마스킹 {len(hits)}"))
    zpath = os.path.join(out, "국내AI_API_호출로그_Neo-Luddite.zip")
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for p in written:
            z.write(p, os.path.basename(p))
    for r in rows:
        print(" | ".join(r))
    print("zip", zpath, len(written), "files")


if __name__ == "__main__":
    cmd, *rest = sys.argv[1:]
    if cmd == "run":
        cmd_run(rest[0], rest[1:])
    else:
        cmd_build(rest[0], rest[1])
