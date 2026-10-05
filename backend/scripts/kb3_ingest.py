r"""
KB3 적재 CLI — 판례 요지(kb3_gist.jsonl) · 국세청 질의회신(kb3_qna.jsonl) → passage → embedding-passage
(KB3 요지수집 설계 §7 단계 4, 2026-09-27)

precision 은 메모리 안 검색(MemoryKb3Retriever)으로 잰다(bench_fusion.py 의 kb3 갈래). 벡터는 파일로 굳힌다 —
data/kb3/embeddings.npz, 키 = 임베딩 텍스트 sha1. `ingest` 는 같은 벡터를 그대로 kb3.documents(0041)에 싣는다
(W5 설계 §8 — **프로덕션 적재는 사용자 확인 후**, `--write` 없으면 dry-run).

한 건 = 한 passage (청크 없음): 질의회신 요지+회신 중앙 326자·최대 1,352자, 판례 요지 중앙 127자·최대 429자.
임베딩 텍스트 = 제목 + 본문(머리표 없이). 프롬프트용 content = 머리표(출처 종류·세법·문서번호·일자) + 제목 + 본문.

범위(scope) — 적재 후보를 이름으로 부른다:
  prec_all   판례 전량 487
  prec_hit   요지 키워드 적중 307
  prec_core  적중 ∧ 근사중복 아님 267
  prec_tax   prec_core − 국세징수(302, 국가가 원고인 사해행위취소 등 민사) = 253
  qna_all    질의회신 전량 1,995
  qna_core   근사중복 아님 1,825

사용 (backend/ 에서):
    .\.venv\Scripts\python.exe scripts\kb3_ingest.py stats
    .\.venv\Scripts\python.exe scripts\kb3_ingest.py embed               # 누락분만 임베딩(DB 0회)
    .\.venv\Scripts\python.exe scripts\kb3_ingest.py search "월세 세액공제 전입신고" --scope qna_core,prec_core
    .\.venv\Scripts\python.exe scripts\kb3_ingest.py ingest [--write]    # LOAD_SCOPES → kb3.documents
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(_BACKEND / ".env")

GIST_PATH = _BACKEND / "data" / "processed" / "kb3_gist.jsonl"
QNA_PATH = _BACKEND / "data" / "processed" / "kb3_qna.jsonl"
CACHE_PATH = _BACKEND / "data" / "kb3" / "embeddings.npz"   # .gitignore — 40MB 급

EMBED_BATCH = 16

# 적재 범위(새RAG_KB3_구축설계, 2026-10-05 벤치 run1 합격): 질의회신 qna_core 1,825 + 심판례 trib_sit 3,276
# (검색 단위 = Solar 사실관계 청크). 옛 판례 prec_tax 253 은 빠졌다 — 요지+상세내용으로 다시 모은 뒤 따로 계측(D3).
# 검색 컷 0.40 · fusion 쿼터 2 (KB3_MIN_SCORE / FUSION_QUOTA_KB3 로 배선할 값). 9/27 값과 같다(run1 에서 쿼터 3 = 2).
LOAD_SCOPES = ["qna_core", "trib_sit"]
DEFAULT_MIN_SCORE = 0.40
DEFAULT_QUOTA = 2

# 권위 층 = corpus 값. 프롬프트가 블록을 가르는 기준이 이 값이다(llm.py P4 관례 — source_kind 가 아니라 corpus).
CORPUS_PREC = "kb3_prec"   # 법원·심판 결정의 요지 — 다른 사건
CORPUS_QNA = "kb3_qna"     # 국세청 행정 해석 — 법원 판단과 다를 수 있음
CORPUS_TRIB = "kb3_trib"   # 조세심판원 심판례 카드(새RAG_KB3_구축설계, 2026-10-05)
_KIND_LABEL = {CORPUS_PREC: "판례 요지", CORPUS_QNA: "국세청 질의회신", CORPUS_TRIB: "조세심판원 심판례"}

# 심판례(새RAG_KB3_구축설계 §2·§4): 카드 = scripts/kb3_trib_format.py 산출 중 기계 검사 합격분(3,276).
# 검색 단위(청크)를 두 가지로 재 본다 — 카드(프롬프트 주입 모양)는 같다.
#   trib_sit   Solar 가 정리한 사실관계 1청크
#   trib_fact  팀이 결정문 원문에서 코드로 잘라 둔 처분개요 청크(fact_chunks.jsonl, 사건당 1~3)
TRIB_CARDS_PATH = _BACKEND / "data" / "kb3" / "trib_cards" / "cards.jsonl"
TRIB_FACT_CHUNKS_PATH = Path(r"C:\Users\user\credigraph\data\rag\fact-clarification-v3-20260930\fact_chunks.jsonl")
TRIB_SCOPES = ("trib_sit", "trib_fact")

SCOPES = {
    "prec_all":  lambda r: r["source"] == "nts_taxlaw",
    "prec_hit":  lambda r: r["source"] == "nts_taxlaw" and bool(r.get("gist_keyword_hit")),
    "prec_core": lambda r: r["source"] == "nts_taxlaw" and bool(r.get("gist_keyword_hit")) and not r.get("near_dup_of"),
    "prec_tax":  lambda r: SCOPES["prec_core"](r) and r.get("tax_law_code") != "302",
    "qna_all":   lambda r: r["source"] == "nts_qna",
    "qna_core":  lambda r: r["source"] == "nts_qna" and not r.get("near_dup_of"),
}


@dataclass
class Kb3Doc:
    case_id: str
    corpus: str
    case_number: str
    title: str
    body: str
    tax_law: str
    tax_category: Optional[str]
    decision_date: Optional[str]
    source_url: str
    law_articles: list[str]
    raw: dict
    chunk_texts: Optional[list[str]] = None   # 검색 단위가 여럿이면(심판례) — 없으면 embed_text 하나
    section: Optional[str] = None             # 0042 kb3.chunks.section — qna · situation · fact_base

    @property
    def embed_text(self) -> str:
        return f"{self.title}\n{self.body}"

    @property
    def embed_texts(self) -> list[str]:
        return self.chunk_texts or [self.embed_text]

    @property
    def content(self) -> str:
        """프롬프트·채점에 들어가는 모양. 머리표가 출처 종류·세법을 말해 준다(세목 17개는 병의원 관점이라
        시민 세법이 '소득세·법인전환·개원폐업'·'기타'로 몰린다 → 세법 이름을 병기)."""
        meta = " · ".join(x for x in (_KIND_LABEL[self.corpus], self.tax_law or None, self.case_number,
                                      self.decision_date) if x)
        return f"[{meta}] {self.title}\n{self.body}"


def _doc(r: dict) -> Kb3Doc:
    is_qna = r["source"] == "nts_qna"
    body = f"요지: {r['summary']}\n회신: {r['full_text']}" if is_qna and r.get("full_text") else r["summary"]
    return Kb3Doc(
        case_id=r["case_id"], corpus=CORPUS_QNA if is_qna else CORPUS_PREC,
        case_number=r["case_number"], title=r["title"], body=body, tax_law=r.get("tax_law") or "",
        tax_category=r.get("tax_category"), decision_date=r.get("decision_date"),
        source_url=r["source_url"], law_articles=r.get("law_articles") or [], raw=r,
        section="qna" if is_qna else None,
    )


def _trib_body(card: dict, summary: str) -> str:
    """심판례 카드 본문 — Solar 필드(D9: 문장은 Solar 산출 그대로) + 원문 결정요지. 결정유형은 머리표에."""
    parts = [f"사실관계: {card['situation']}", f"쟁점: {card['issue']}", f"판단: {card['judgment']}"]
    if summary:
        parts.append(f"결정요지(원문): {summary}")
    if card.get("law_articles"):
        parts.append("조문: " + ", ".join(card["law_articles"]))
    return "\n".join(parts)


def load_trib_docs(mode: str) -> list[Kb3Doc]:
    """trib_cards 의 사건별 마지막 시도 중 기계 검사 합격분만. mode = trib_sit | trib_fact."""
    import importlib

    fmt = importlib.import_module("scripts.kb3_trib_format") if "scripts" in sys.modules else None
    if fmt is None:
        sys.path.insert(0, str(_BACKEND / "scripts"))
        fmt = importlib.import_module("kb3_trib_format")
    latest, _ = fmt._latest(TRIB_CARDS_PATH)
    rows = [r for r in latest.values() if fmt._ok(r)]
    facts: dict[str, list[str]] = {}
    if mode == "trib_fact":
        for line in TRIB_FACT_CHUNKS_PATH.open(encoding="utf-8"):
            c = json.loads(line)
            facts.setdefault(c["case_id"], []).append(c["embedding_text"])
    docs = []
    for r in rows:
        card = r["card"]
        chunks = ([f"{r['title']}\n{card['situation']}"] if mode == "trib_sit" else facts.get(r["case_id"]))
        if not chunks:
            continue
        meta_law = r.get("tax_category") or ""
        docs.append(Kb3Doc(
            case_id=r["case_id"], corpus=CORPUS_TRIB, case_number=r["case_number"], title=r["title"],
            body=_trib_body(card, r.get("summary") or ""), tax_law=f"{meta_law} · {r['decision_type']}",
            tax_category=r.get("tax_category"), decision_date=r.get("decision_date"),
            source_url=r["source_url"], law_articles=card.get("law_articles") or [],
            raw={**r, "source": "tt_tribunal_v3"}, chunk_texts=chunks,
            section="situation" if mode == "trib_sit" else "fact_base"))
    return docs


def load_docs(scopes: Optional[list[str]] = None) -> list[Kb3Doc]:
    trib = [s for s in (scopes or []) if s in TRIB_SCOPES]
    rest = [s for s in (scopes or []) if s not in TRIB_SCOPES]
    out: list[Kb3Doc] = []
    if rest or not scopes:
        rows = []
        for p in (GIST_PATH, QNA_PATH):
            rows += [json.loads(line) for line in p.read_text(encoding="utf-8").splitlines() if line.strip()]
        if rest:
            preds = [SCOPES[s] for s in rest]
            rows = [r for r in rows if any(f(r) for f in preds)]
        out += [_doc(r) for r in rows]
    for mode in trib:
        out += load_trib_docs(mode)
    return out


def _sha1(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


# ── 벡터 캐시 ────────────────────────────────────────────────────────────────

def load_cache():
    import numpy as np

    if not CACHE_PATH.exists():
        return {}, None
    z = np.load(CACHE_PATH)
    keys = [str(k) for k in z["keys"]]
    return {k: i for i, k in enumerate(keys)}, z["vecs"]


def save_cache(index: dict, vecs) -> None:
    import numpy as np

    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    keys = sorted(index, key=index.get)
    tmp = CACHE_PATH.with_suffix(".tmp.npz")
    np.savez(tmp, keys=np.array(keys), vecs=vecs)
    tmp.replace(CACHE_PATH)


def _embed_batch(texts: list[str]) -> list[list[float]]:
    from api import llm
    from api.rag import embeddings

    for attempt in range(4):
        try:
            resp = llm.bounded_client(60).embeddings.create(model=embeddings._passage_model(), input=texts)
            vecs = [d.embedding for d in resp.data]
            if len(vecs) != len(texts) or any(len(v) != embeddings.EMBED_DIM for v in vecs):
                raise RuntimeError("임베딩 개수·차원 불일치")
            return vecs
        except Exception as exc:  # noqa: BLE001
            if attempt == 3:
                raise
            print(f"  재시도 {attempt + 1}: {type(exc).__name__}: {exc}", flush=True)
            time.sleep(2 ** attempt * 2)
    raise AssertionError


def fill_embeddings(docs: list[Kb3Doc]) -> tuple[int, int]:
    import numpy as np

    index, vecs = load_cache()
    todo: list[str] = []
    seen = set(index)
    texts = [t for d in docs for t in d.embed_texts]
    for t in texts:
        h = _sha1(t)
        if h not in seen:
            seen.add(h)
            todo.append(t)
    reused = len(texts) - len(todo)
    for i in range(0, len(todo), EMBED_BATCH):
        chunk = todo[i:i + EMBED_BATCH]
        new = np.asarray(_embed_batch(chunk), dtype=np.float32)
        base = 0 if vecs is None else len(vecs)
        vecs = new if vecs is None else np.vstack([vecs, new])
        for j, t in enumerate(chunk):
            index[_sha1(t)] = base + j
        save_cache(index, vecs)   # 중간에 죽어도 받은 만큼은 남는다
        print(f"  임베딩 {min(i + EMBED_BATCH, len(todo))}/{len(todo)}", flush=True)
    return reused, len(todo)


# ── 메모리 검색기 (벤치 전용 — 제품 경로 아님) ─────────────────────────────────

class MemoryKb3Retriever:
    """kb3 후보를 DB 없이 검색. Retriever 프로토콜(retriever.py)과 같은 모양이라 FusionRetriever 갈래로
    그대로 끼운다. 적재 전에 precision 을 재는 용도 — 적재 후엔 kb3_store 가 이 자리를 대신한다."""

    def __init__(self, scopes: list[str], min_score: float = 0.0):
        import numpy as np

        self.docs = load_docs(scopes)
        index, vecs = load_cache()
        missing = [d.case_id for d in self.docs for t in d.embed_texts if _sha1(t) not in index]
        if missing:
            raise SystemExit(f"임베딩 없음 {len(missing)}건 — 먼저 `kb3_ingest.py embed`")
        # 청크 행렬 + 청크 → 문서 번호. 검색은 청크로 하고 문서(사건) 단위로 접는다(0042 match_chunks 와 같은 동작).
        self.owner = np.asarray([i for i, d in enumerate(self.docs) for _ in d.embed_texts])
        m = vecs[[index[_sha1(t)] for d in self.docs for t in d.embed_texts]]
        self.mat = m / np.linalg.norm(m, axis=1, keepdims=True)
        self.min_score = min_score

    def retrieve(self, query, k=5, occupation=None, tax_category=None, qvec=None):
        import numpy as np

        from api.rag import embeddings
        from api.rag.retriever import Passage

        if qvec is None:
            qvec = embeddings.embed_query(query)
        q = np.asarray(qvec, dtype=np.float32)
        chunk_sims = self.mat @ (q / np.linalg.norm(q))
        sims = np.full(len(self.docs), -1.0, dtype=np.float32)
        np.maximum.at(sims, self.owner, chunk_sims)
        out = []
        for i in np.argsort(-sims)[:k]:
            if sims[i] < self.min_score:
                break
            d = self.docs[i]
            out.append(Passage(content=d.content, score=float(sims[i]), source_kind=d.corpus,
                               law_articles=d.law_articles, tax_category=d.tax_category,
                               case_refs=[d.case_number], corpus=d.corpus, id=d.case_id))
        return out


# ── 명령 ─────────────────────────────────────────────────────────────────────

def cmd_stats(_args) -> None:
    import collections

    for name in SCOPES:
        docs = load_docs([name])
        lens = sorted(len(d.body) for d in docs)
        laws = collections.Counter(d.tax_law or "(없음)" for d in docs).most_common(6)
        print(f"{name:10s} {len(docs):5d}건 · 본문 중앙 {lens[len(lens)//2]}자 최대 {lens[-1]}자 · {laws}")


def cmd_embed(args) -> None:
    docs = load_docs(args.scope.split(",") if args.scope else None)
    reused, made = fill_embeddings(docs)
    print(f"대상 {len(docs)} · 캐시 재사용 {reused} · 신규 {made} → {CACHE_PATH}")


def cmd_search(args) -> None:
    r = MemoryKb3Retriever(args.scope.split(","))
    for p in r.retrieve(args.query, k=args.k):
        print(f"{p.score:.4f} {p.content.splitlines()[0]}")


def _doc_hash(d: Kb3Doc) -> str:
    """문서 멱등 키 — 카드(content)와 청크 텍스트를 함께 덮는다. 청크 구성만 바뀌어도 다시 쓴다."""
    return _sha1(d.content + "\x1f" + "\x1f".join(d.embed_texts))


def _doc_fields(d: Kb3Doc) -> dict:
    """Kb3Doc → kb3.documents 칸(0042). 문장 출처(formatted_by)는 D9 기록이다:
    심판례 카드 = solar-pro3 산출, 질의회신 = 원문 그대로(source)."""
    r = d.raw
    if d.corpus == CORPUS_TRIB:
        card = {k: r["card"].get(k) for k in ("situation", "issue", "claimant", "authority", "judgment",
                                              "law_articles")}
        card["situation_quotes"] = r["checks"]["situation_quotes"]
        card["judgment_quotes"] = r["checks"]["judgment_quotes"]
        checks = {k: v for k, v in r["checks"].items() if not k.endswith("_quotes")}
        return dict(origin=r["source"], tax_law=None, decision_type=r.get("decision_type"),
                    law_articles=r.get("law_articles_src") or [], summary=r.get("summary"), card=card,
                    formatted_by=r["card"].get("_meta", {}).get("model", "solar-pro3"), format_checks=checks)
    return dict(origin=r["source"], tax_law=d.tax_law or None, decision_type=None, law_articles=d.law_articles,
                summary=r.get("summary"), card={}, formatted_by="source", format_checks=None)


def cmd_ingest(args) -> None:
    """LOAD_SCOPES → kb3.documents + kb3.chunks(0042). 벡터는 캐시에서만 가져온다(없으면 멈춤 — 먼저 embed).
    case_id 멱등: _doc_hash 가 같고 active 면 건너뛴다. 범위 밖 기존 행은 archived(삭제 아님) — 단 이 스크립트가
    다루는 corpus 안에서만(세무사 사례는 건드리지 않는다). --write 없이는 DB 를 읽기만 하고 할 일만 센다."""
    from api.rag import kb3_store

    docs = load_docs(LOAD_SCOPES)
    index, vecs = load_cache()
    missing = [d.case_id for d in docs for t in d.embed_texts if _sha1(t) not in index]
    if missing:
        raise SystemExit(f"임베딩 없음 {len(missing)}건 — 먼저 `kb3_ingest.py embed --scope {','.join(LOAD_SCOPES)}`")
    if len({d.case_id for d in docs}) != len(docs):
        raise SystemExit("case_id 중복 — 적재 멱등 키가 깨진다")
    if any(d.section is None for d in docs):
        raise SystemExit("청크 section 이 정해지지 않은 문서가 있다(판례 요지는 0042 section 이 아직 없다)")
    if not kb3_store.is_configured():
        raise SystemExit("DB 미설정(SUPABASE_DB_URL)")

    try:
        have = kb3_store.existing_hashes()
    except Exception as exc:  # noqa: BLE001 — 스키마 없음(0042 미적용)
        if args.write:
            raise SystemExit(f"kb3.documents 조회 실패 — 0042 적용 먼저: {exc}")
        print(f"(kb3.documents 조회 실패 — 0042 미적용으로 보고 빈 DB 가정: {type(exc).__name__})")
        have = {}
    todo = [d for d in docs if have.get(d.case_id) != (_doc_hash(d), "active")]
    keep = {d.case_id for d in docs}
    corpora = sorted({d.corpus for d in docs})
    stale = [cid for cid, (_, status) in have.items() if status == "active" and cid not in keep]
    by_corpus: dict[str, int] = {}
    for d in docs:
        by_corpus[d.corpus] = by_corpus.get(d.corpus, 0) + 1
    n_chunks = sum(len(d.embed_texts) for d in docs)
    print(f"범위 {len(docs)}건 {by_corpus} · 청크 {n_chunks} · DB 기존 {len(have)} · 기록할 것 {len(todo)} "
          f"· archived 로 내릴 후보 {len(stale)}(corpus {corpora} 안의 것만 실제로 내림)")
    if not args.write:
        print("dry-run — 쓰려면 --write")
        return

    for i, d in enumerate(todo, 1):
        chunks = [kb3_store.ChunkRow(chunk_index=j, section=d.section, content=t,
                                     embedding=vecs[index[_sha1(t)]].tolist(), content_hash=_sha1(t))
                  for j, t in enumerate(d.embed_texts)]
        kb3_store.upsert_document(
            case_id=d.case_id, corpus=d.corpus, case_number=d.case_number, title=d.title,
            tax_category=d.tax_category, decision_date=d.decision_date, source_url=d.source_url,
            content=d.content, content_hash=_doc_hash(d), chunks=chunks, **_doc_fields(d))
        if i % 200 == 0 or i == len(todo):
            print(f"  기록 {i}/{len(todo)}", flush=True)
    archived = kb3_store.archive_except(sorted(keep), corpora)
    print(f"완료 · archived {archived} · 현재 {kb3_store.counts()}")


def main() -> None:
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8")
        except Exception:  # noqa: BLE001
            pass
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("stats").set_defaults(fn=cmd_stats)
    p = sub.add_parser("embed")
    p.add_argument("--scope", default="", help="쉼표 구분. 비우면 전량")
    p.set_defaults(fn=cmd_embed)
    p = sub.add_parser("search")
    p.add_argument("query")
    p.add_argument("--scope", default=",".join(LOAD_SCOPES))
    p.add_argument("-k", type=int, default=8)
    p.set_defaults(fn=cmd_search)
    p = sub.add_parser("ingest")
    p.add_argument("--write", action="store_true", help="없으면 dry-run(읽기만)")
    p.set_defaults(fn=cmd_ingest)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
