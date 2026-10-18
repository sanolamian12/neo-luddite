"""A8 dry-run — 세무사 사례 임베딩 텍스트 확장(결론·예외) + 저장 시 조문 연결을 운영 DB 쓰기 없이 본다. backend/ 에서:
   python -X utf8 eval/local/a8_dryrun.py [--answer]

운영 DB 는 읽기만(사례 목록·기존 임베딩·공용 KB3 검색). 사례별로:
  ① 재임베딩 대상인지(지금 청크 텍스트 ≠ 새 expert_embed_text)
  ② 결론 첫 문장으로 검색했을 때 순위 — 옛 벡터(DB) vs 새 벡터(embedding-passage), 경쟁 = 공용 KB3 상위 10 + 다른 사례
  ③ 저장 때 채울 조문(expert_law_articles = LLM3)
  ④ --answer: kb3_store.match_chunks 를 가로채 '재임베딩 + 조문 채움 뒤' 사례를 끼워 넣고 run_clinic 을 돌려
     답변 배지에 그 조문이 붙는지(사실관계를 질문으로)
"""
import json
import logging
import math
import os
import re
import sys

sys.path.insert(0, ".")
sys.stdout.reconfigure(encoding="utf-8")
logging.basicConfig(level=logging.WARNING, format="%(name)s | %(message)s", stream=sys.stdout)
for _l in open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "prod_flags.env"), encoding="utf-8"):
    _k, _, _v = _l.strip().partition("=")
    if _k and _k not in ("CORS_ORIGINS", "AUTH_MODE"):
        os.environ[_k] = _v
os.environ["VEC_MEMORY"] = "off"
from eval.run_demo_eval import load_env  # noqa: E402

load_env()
from api.rag import embeddings, kb3_store  # noqa: E402

STATIC = ["kb3_prec", "kb3_trib", "kb3_qna"]

SYNTHETIC = [
    ("3.3% 떼인 프리랜서 디자이너", "고객은 작년에 여러 업체에서 디자인 외주 대금을 받으며 매번 3.3%를 원천징수당했습니다.",
     "사업소득 원천징수는 기납부세액이고 5월 종합소득세 확정신고로 정산됩니다. 단순경비율 대상이면 경비 부담이 적습니다.",
     "5월에 종합소득세를 신고하면 미리 떼인 3.3%를 정산해 상당 부분을 환급받을 수 있습니다."),
    ("따로 사는 어머니 부양가족 공제", "직장인 고객의 어머니(63세)는 시골에서 따로 사시고 소득은 국민연금 월 40만원뿐입니다.",
     "직계존속은 주거 형편상 별거해도 부양 사실이 있으면 기본공제 대상이고, 연금소득은 공적연금 기준으로 소득금액을 따집니다.",
     "어머니가 만 60세 이상이고 연 소득금액 100만원 이하라면 따로 살아도 연말정산 기본공제 150만원을 받을 수 있습니다."),
    ("카페 개업 첫해 간이과세 선택", "고객은 동네 상가에 작은 카페를 열며 첫해 매출을 약 6천만원으로 예상합니다.",
     "신규 개인사업자는 예상 공급대가가 간이과세 기준 미만이면 간이과세로 등록할 수 있고, 세금계산서 발급 의무와 매입세액 공제 방식이 달라집니다.",
     "첫해 예상 매출이 기준 금액보다 적으면 간이과세자로 등록하는 편이 부가가치세 부담이 작습니다. 다만 인테리어 매입세액 환급은 받지 못합니다."),
]


def cos(a, b):
    a, b = list(a), list(b)
    return sum(x * y for x, y in zip(a, b)) / (math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b)))


def first_sentence(t: str) -> str:
    m = re.search(r"^(.+?(?:다|요|함|음)\.)(\s|$)", t.strip(), re.S)
    return (m.group(1) if m else t.strip())[:300]


def main():
    answer = "--answer" in sys.argv
    conn = kb3_store._get_conn()
    with conn.cursor() as cur:
        cur.execute("set transaction read only")
        cur.execute("select d.id, d.title, d.card, d.law_articles, d.publish_state, d.share_state, d.expert_id, "
                    "c.content, c.embedding, d.content from kb3.documents d join kb3.chunks c on c.document_id = d.id "
                    "where d.corpus = 'kb3_expert' and d.status = 'active' order by d.updated_at")
        rows = cur.fetchall()
    conn.rollback() if not conn.autocommit else None
    print(f"active 세무사 사례 {len(rows)}건\n")
    cases = []
    if "--synthetic" in sys.argv:   # 주제가 다른 합성 사례(메모리만, DB 안 씀) — 옛 텍스트 = 결론·예외 뺀 0043 방식
        rows = []
        for i, (title, facts, judgment, conclusion) in enumerate(SYNTHETIC):
            f = {"facts": facts, "judgment": judgment, "conclusion": conclusion, "exceptions": "", "keywords": ""}
            old = "\n".join((title, facts, judgment))
            cases.append(dict(id=f"syn-{i}", title=title, f=f, laws_now=[], state="synthetic", expert="",
                              old_text=old, old_vec=embeddings.embed_passage(old),
                              new_text=kb3_store.expert_embed_text(title, f),
                              content=kb3_store.expert_card_content("시험", title, f)))
    for r in rows:
        card = r[2] or {}
        f = {k: card.get(k) or "" for k in kb3_store.EXPERT_FIELDS}
        new_text = kb3_store.expert_embed_text(r[1], f)
        cases.append(dict(id=str(r[0]), title=r[1], f=f, laws_now=list(r[3] or []), state=f"{r[4]}/{r[5]}",
                          expert=str(r[6]), old_text=r[7], old_vec=list(r[8]), new_text=new_text, content=r[9]))
    for c in cases:
        c["new_vec"] = embeddings.embed_passage(c["new_text"]) if c["new_text"] != c["old_text"] else c["old_vec"]
    summary = {"reembed": 0, "rank1_old": 0, "rank1_new": 0, "laws": 0}
    for c in cases:
        q = first_sentence(c["f"]["conclusion"])
        qv = embeddings.embed_query(q)
        static = kb3_store._match_chunks_sql(qv, 10, STATIC, None, None)
        others_old = [cos(qv, o["old_vec"]) for o in cases if o is not c]
        others_new = [cos(qv, o["new_vec"]) for o in cases if o is not c]
        s_old, s_new = cos(qv, c["old_vec"]), cos(qv, c["new_vec"])
        rank_old = 1 + sum(m.score > s_old for m in static) + sum(s > s_old for s in others_old)
        rank_new = 1 + sum(m.score > s_new for m in static) + sum(s > s_new for s in others_new)
        c["laws"] = kb3_store.expert_law_articles(c["title"], c["f"])
        changed = c["new_text"] != c["old_text"]
        summary["reembed"] += int(changed)
        summary["rank1_old"] += int(rank_old == 1)
        summary["rank1_new"] += int(rank_new == 1)
        summary["laws"] += int(bool(c["laws"]))
        print(f"■ {c['title']} ({c['state']}) 재임베딩 {'예' if changed else '아니오'}")
        print(f"  결론 질의: {q}")
        print(f"  순위 옛 {rank_old} (점수 {s_old:.3f}) → 새 {rank_new} ({s_new:.3f}) · 공용 1위 {static[0].score:.3f} "
              f"{static[0].case_number}" if static else "")
        print(f"  조문: 지금 {c['laws_now']} → 채울 것 {c['laws']}")
    print("\n요약", json.dumps(summary, ensure_ascii=False), f"/ {len(cases)}건")

    if not answer:
        return
    from api import pipeline

    orig = kb3_store.match_chunks
    for c in cases:
        if not c["laws"]:
            continue

        def patched(query_embedding, k=5, corpora=None, preview_expert_id=None, agent_expert_id=None, _c=c):
            out = [m for m in orig(query_embedding, k, STATIC if corpora is None else
                                   [x for x in corpora if x != "kb3_expert"] or STATIC)]
            out.append(kb3_store.MatchedDocument(
                id=_c["id"], case_id="dryrun", corpus="kb3_expert", case_number="세무사사례-dryrun",
                content=_c["content"], law_articles=_c["laws"], tax_category=None, source_url=None,
                score=cos(query_embedding, _c["new_vec"]), section="expert"))
            out.sort(key=lambda m: -m.score)
            return out[:k]

        kb3_store.match_chunks = patched
        q = c["f"]["facts"].strip().rstrip(".") + " 어떻게 되나요?"
        resp = pipeline.run_clinic(f"eval-a8-{c['id'][:8]}", [], q)
        kb3_store.match_chunks = orig
        used = [p for p in (resp.meta.ragPassages or []) if p.get("corpus") == "kb3_expert"]
        cites = sorted({x for s in resp.message.segments for x in (s.citations or [])})
        hit = [lab for lab in c["laws"] if any(lab.replace(" ", "") in x.replace(" ", "") for x in cites)]
        print(f"\n▶ 답변 시험 — {c['title']}\n  질문: {q}\n  사례 근거 사용: {bool(used)} · 배지 {cites}\n  채운 조문 배지 적중: {hit}")


if __name__ == "__main__":
    main()
