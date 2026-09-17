r"""
L1 사전층 적재 CLI — 프론트 시드 → 청킹 → doc2query → embedding-passage → kbdict.*
(KB통합 3층검색 로드맵 P3, 2026-09-17)

대상: frontend/data/kb/seeds/ 의 glossary · cases · occupations (L1).
      master · frameworks · pitfalls 는 L0(상시 주입, backend/api/prompts/*.md)라 적재하지 않는다.
      시드 6종은 모두 읽는다 — [[위키링크]]를 제목으로 바꾸려면 L0 문서의 제목도 필요하다.

왜 ingest_kb_document()(api/rag/ingest.py) 를 안 쓰나: 그 함수는 문서 통째를 번들 1개로
임베딩한다. KB2 가 피한 정보 희석을 그대로 안으므로 청크(헤딩) 단위로 따로 둔다.

doc2query 산출물은 **파일로 굳힌다** — backend/data/kbdict/doc2query.json, 키 = 청크 본문 sha1.
LLM 산출은 비결정적이라 재적재 때마다 새로 만들면 같은 시드가 적재마다 다른 벡터가 된다.
본문이 바뀐 청크만 새로 생성하고, 나머지는 파일 값을 그대로 쓴다.

사용 (backend/ 에서):
    .\.venv\Scripts\python.exe scripts\kbdict_ingest.py chunks            # 파싱·청킹만(LLM·DB 0회)
    .\.venv\Scripts\python.exe scripts\kbdict_ingest.py doc2query         # 질문 생성·파일 저장만(DB 0회)
    .\.venv\Scripts\python.exe scripts\kbdict_ingest.py ingest            # 생성(누락분) + 임베딩 + upsert
    .\.venv\Scripts\python.exe scripts\kbdict_ingest.py count
    .\.venv\Scripts\python.exe scripts\kbdict_ingest.py search "골프 회원권 비용 처리"
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(_BACKEND / ".env")

SEEDS_DIR = _BACKEND.parent / "frontend" / "data" / "kb" / "seeds"
CACHE_PATH = _BACKEND / "data" / "kbdict" / "doc2query.json"

# frontend/lib/kb-schema.ts KB_CATEGORY_FOLDERS 와 같아야 한다(경로 = 폴더/subPath).
CATEGORY_FOLDERS = {
    "skill-master": "",
    "interpretation-framework": "interpretation-frameworks",
    "occupation": "occupations",
    "case-precedent": "case-precedents",
    "glossary": "glossary",
    "pitfall": "pitfalls",
}
# L1 만 적재. 값 = kbdict.documents.corpus
L1_CORPUS = {"glossary": "glossary", "case-precedent": "case", "occupation": "occupation"}

# 링크 목록뿐인 절 — 위키링크를 제목으로 바꾸면 "실질과세원칙 · 입증책임" 같은 제목 나열만
# 남아 어떤 질문에도 애매하게 걸리는 노이즈가 된다.
DROP_HEADINGS = {"관련", "관련 문서", "상세 가이드"}
# 시드 자신에 대한 메타 안내("본 시드에 없음") — 그 주제 질문에 걸려 들어오면 근거가 아니라 잡음이다.
DROP_HEADING_PREFIXES = ("미커버 영역",)

CHUNK_MIN_CHARS = 150   # 이보다 짧은 절은 다음 절과 묶는다
CHUNK_MAX_CHARS = 450   # 묶을 때 넘지 않을 상한(한 절이 이미 크면 그 절 하나로 둔다)

TIMEOUT_DOC2QUERY = 60


@dataclass
class SeedDoc:
    category: str
    path: str
    title: str
    summary: Optional[str]
    occupation: Optional[str]
    body: str


@dataclass
class Chunk:
    index: int
    heading: str
    content: str
    questions: list[str] = field(default_factory=list)


# ── 시드 파싱 ─────────────────────────────────────────────────────────────────

def _field(block: str, name: str) -> Optional[str]:
    m = re.search(rf'\b{name}:\s*"((?:[^"\\]|\\.)*)"', block)
    return m.group(1).replace('\\"', '"') if m else None


def parse_seeds() -> list[SeedDoc]:
    docs: list[SeedDoc] = []
    for ts in sorted(SEEDS_DIR.glob("*.ts")):
        if ts.name in ("_helpers.ts", "index.ts"):
            continue
        text = ts.read_text(encoding="utf-8")
        for block in text.split("defineSeed({")[1:]:
            category = _field(block, "category")
            sub_path = _field(block, "subPath")
            body_m = re.search(r"\bbody:\s*`((?:\\.|[^`\\])*)`", block, re.S)
            if not (category and sub_path and body_m):
                raise SystemExit(f"시드 파싱 실패: {ts.name} — category/subPath/body 중 누락")
            folder = CATEGORY_FOLDERS[category]
            body = re.sub(r"\\(.)", r"\1", body_m.group(1)).strip()
            docs.append(SeedDoc(
                category=category,
                path=f"{folder}/{sub_path}" if folder else sub_path,
                title=_field(block, "title") or sub_path,
                summary=_field(block, "summary"),
                occupation=_field(block, "occupation"),
                body=body,
            ))
    return docs


def replace_wikilinks(text: str, titles: dict[str, str]) -> str:
    def _sub(m: re.Match) -> str:
        target = m.group(1).strip()
        return titles.get(target, target.rsplit("/", 1)[-1])
    return re.sub(r"\[\[([^\]]+)\]\]", _sub, text)


def chunk_document(doc: SeedDoc, titles: dict[str, str]) -> list[Chunk]:
    """헤딩(##) 단위. H1 은 제목과 같으니 버리고, 요약(frontmatter.summary)은 '개요' 청크로."""
    body = replace_wikilinks(doc.body, titles)
    lines = [ln for ln in body.splitlines() if not re.match(r"^#\s", ln)]
    sections: list[tuple[str, list[str]]] = [("개요", [])]
    for ln in lines:
        m = re.match(r"^##\s+(.+)$", ln)
        if m:
            sections.append((m.group(1).strip(), []))
        else:
            sections[-1][1].append(ln)

    kept: list[tuple[str, str]] = []
    for heading, body_lines in sections:
        text = "\n".join(body_lines).strip()
        if heading == "개요" and doc.summary:
            text = (doc.summary + ("\n" + text if text else "")).strip()
        if not text or heading in DROP_HEADINGS or heading.startswith(DROP_HEADING_PREFIXES):
            continue
        kept.append((heading, text))

    # 헤딩 경계는 지키되, 짧은 절은 다음 절과 묶는다. 시드 절의 절반이 100자 미만이라
    # ("정의: 국세기본법 §15." 20자) 절마다 청크를 만들면 내용 없는 조각이 짧다는 이유만으로
    # 이런저런 질문에 걸린다. 합친 절은 원래 헤딩을 본문에 남겨 경계를 보존한다.
    groups: list[list[tuple[str, str]]] = []
    group: list[tuple[str, str]] = []

    def _size(g: list[tuple[str, str]]) -> int:
        return sum(len(t) for _, t in g)

    for heading, text in kept:
        if group and _size(group) + len(text) > CHUNK_MAX_CHARS:
            groups.append(group)
            group = []
        group.append((heading, text))
        if _size(group) >= CHUNK_MIN_CHARS:
            groups.append(group)
            group = []
    if group:
        if groups and _size(group) < CHUNK_MIN_CHARS // 2:
            groups[-1].extend(group)   # 문서 끝 부스러기는 직전 청크에 붙인다(따로 서면 그 자체가 노이즈)
        else:
            groups.append(group)

    chunks: list[Chunk] = []
    for g in groups:
        heading = " · ".join(h for h, _ in g)
        text = g[0][1] if len(g) == 1 else "\n".join(f"## {h}\n{t}" for h, t in g)
        chunks.append(Chunk(index=len(chunks), heading=heading, content=f"[{doc.title}] {heading}\n{text}"))
    return chunks


def l1_chunks() -> list[tuple[SeedDoc, list[Chunk]]]:
    docs = parse_seeds()
    titles = {d.path: d.title for d in docs}
    return [(d, chunk_document(d, titles)) for d in docs if d.category in L1_CORPUS]


def _sha1(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()


# ── doc2query ────────────────────────────────────────────────────────────────

def load_cache() -> dict:
    if CACHE_PATH.exists():
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    return {}


def save_cache(cache: dict) -> None:
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    ordered = dict(sorted(cache.items(), key=lambda kv: (kv[1].get("sourcePath", ""), kv[1].get("chunkIndex", 0))))
    CACHE_PATH.write_text(json.dumps(ordered, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


_DOC2QUERY_SYSTEM = (
    "당신은 세무 상담 검색 인덱스를 만드는 도우미입니다. 주어진 문단은 세무 상담 AI 의 참고 사전 "
    "한 조각입니다. 병의원 원장 같은 사업자가 상담창에 실제로 입력할 법한 질문 중, **이 문단이 "
    "답의 근거가 되는 질문**을 3~5개 만드세요.\n"
    "- 사용자의 구어체로, 구체적인 상황(누가·무엇에·어떻게 썼는지)을 담아 쓰세요.\n"
    "- 문단에 없는 법령·수치·사건번호를 질문에 넣지 마세요.\n"
    "- '이 문서', '위 내용' 같은 지시어를 쓰지 마세요. 질문끼리 겹치지 않게 관점을 달리하세요.\n"
    "- emit_questions 도구로만 응답하세요."
)


def generate_questions(content: str) -> list[str]:
    from api import llm

    tool = {
        "type": "function",
        "function": {
            "name": "emit_questions",
            "description": "문단이 답이 되는 사용자 질문 3~5개.",
            "parameters": {
                "type": "object",
                "properties": {
                    "questions": {"type": "array", "minItems": 3, "maxItems": 5,
                                  "items": {"type": "string"}},
                },
                "required": ["questions"],
            },
        },
    }
    resp = llm.bounded_client(TIMEOUT_DOC2QUERY).chat.completions.create(
        model=llm._chat_model(),
        messages=[{"role": "system", "content": _DOC2QUERY_SYSTEM},
                  {"role": "user", "content": content}],
        tools=[tool],
        tool_choice={"type": "function", "function": {"name": "emit_questions"}},
        temperature=0.3,
    )
    calls = getattr(resp.choices[0].message, "tool_calls", None)
    if not calls:
        raise RuntimeError("doc2query: tool call 없음")
    qs = [q.strip() for q in json.loads(calls[0].function.arguments).get("questions", []) if q.strip()]
    if not 3 <= len(qs) <= 5:
        raise RuntimeError(f"doc2query: 질문 수 {len(qs)} (3~5 기대)")
    return qs


def fill_questions(items: list[tuple[SeedDoc, list[Chunk]]], cache: dict) -> tuple[int, int]:
    """캐시에 있으면 재사용, 없으면 생성해 즉시 파일에 저장(중간에 죽어도 생성분은 남는다)."""
    reused = generated = 0
    for doc, chunks in items:
        for ch in chunks:
            key = _sha1(ch.content)
            hit = cache.get(key)
            if hit:
                ch.questions = hit["questions"]
                reused += 1
                continue
            for attempt in range(3):
                try:
                    ch.questions = generate_questions(ch.content)
                    break
                except Exception as exc:  # noqa: BLE001
                    if attempt == 2:
                        raise SystemExit(f"doc2query 실패 {doc.path}#{ch.index}: {exc}")
                    time.sleep(2 ** attempt * 2)
            cache[key] = {"sourcePath": doc.path, "chunkIndex": ch.index, "heading": ch.heading,
                          "questions": ch.questions, "model": os.environ.get("UPSTAGE_CHAT_MODEL", "solar-pro3"),
                          "generatedAt": int(time.time() * 1000)}
            save_cache(cache)
            generated += 1
            print(f"  생성 {doc.path}#{ch.index} {ch.heading}: {ch.questions}", flush=True)
    return reused, generated


def embed_text(ch: Chunk) -> str:
    return "\n".join(ch.questions) + "\n\n" + ch.content


# ── 명령 ─────────────────────────────────────────────────────────────────────

def cmd_chunks(_args) -> None:
    items = l1_chunks()
    total = 0
    for doc, chunks in items:
        print(f"\n■ {doc.path} [{L1_CORPUS[doc.category]}] {doc.title} occupation={doc.occupation}")
        for ch in chunks:
            total += 1
            print(f"  #{ch.index} {ch.heading} ({len(ch.content)}자)")
            if _args.verbose:
                print("    " + ch.content.replace("\n", "\n    "))
    print(f"\n문서 {len(items)} · 청크 {total}")


def cmd_doc2query(_args) -> None:
    items = l1_chunks()
    cache = load_cache()
    reused, generated = fill_questions(items, cache)
    print(f"doc2query 재사용 {reused} · 신규 생성 {generated} → {CACHE_PATH}")


def cmd_ingest(_args) -> None:
    from api.rag import embeddings, kbdict_store

    items = l1_chunks()
    cache = load_cache()
    reused, generated = fill_questions(items, cache)
    print(f"doc2query 재사용 {reused} · 신규 생성 {generated}")

    embedded = skipped = 0
    for doc, chunks in items:
        doc_hash = _sha1(json.dumps([doc.title, doc.summary, doc.occupation, doc.body], ensure_ascii=False))
        doc_id = kbdict_store.upsert_document(
            source_path=doc.path, corpus=L1_CORPUS[doc.category], title=doc.title,
            summary=doc.summary, occupation=doc.occupation, content_hash=doc_hash,
        )
        existing = kbdict_store.chunk_hashes(doc_id)
        for ch in chunks:
            text = embed_text(ch)
            h = _sha1(text)
            if existing.get(ch.index, (None,))[0] == h:
                kbdict_store.reactivate_chunk(doc_id, ch.index)
                skipped += 1
                continue
            vec = embeddings.embed_passage(text)
            kbdict_store.upsert_chunk(doc_id, ch.index, ch.heading, ch.content, ch.questions, vec, h)
            embedded += 1
        stale = kbdict_store.archive_chunks_from(doc_id, len(chunks))
        print(f"  {doc.path}: 청크 {len(chunks)}" + (f" · 꼬리 archived {stale}" if stale else ""), flush=True)
    gone = kbdict_store.archive_documents_except([d.path for d, _ in items])
    print(f"임베딩 {embedded} · 변경없음 건너뜀 {skipped} · 시드에서 사라진 문서 archived {gone}")
    print(json.dumps(kbdict_store.counts(), ensure_ascii=False))


def cmd_count(_args) -> None:
    from api.rag import kbdict_store

    print(json.dumps(kbdict_store.counts(), ensure_ascii=False, indent=1))


def cmd_search(args) -> None:
    from api.rag.retriever import KbdictRetriever

    for p in KbdictRetriever(min_score=0.0).retrieve(args.query, k=args.k, occupation="clinic"):
        print(f"{p.score:.4f} [{p.source_kind}] {p.content.splitlines()[0]}")


def main() -> None:
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8")
        except Exception:  # noqa: BLE001
            pass
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("chunks")
    p.add_argument("-v", "--verbose", action="store_true")
    p.set_defaults(fn=cmd_chunks)
    sub.add_parser("doc2query").set_defaults(fn=cmd_doc2query)
    sub.add_parser("ingest").set_defaults(fn=cmd_ingest)
    sub.add_parser("count").set_defaults(fn=cmd_count)
    p = sub.add_parser("search")
    p.add_argument("query")
    p.add_argument("-k", type=int, default=8)
    p.set_defaults(fn=cmd_search)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
