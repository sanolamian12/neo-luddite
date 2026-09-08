"""
지식베이스2(kb2) 합성 오케스트레이션 — admin 트리거 진입점(설계 아티팩트 §02).

세목별로 rag.passages(active) 를 모아 Solar Pro 에 투입, 조항형 문장으로 응축해
kb2.sentences 에 적재한다. locked_by_auditor=true 인 문장(세무사가 손댄 적 있는)은
재합성 대상에서 제외 — 재실행해도 사람이 고친 문장은 보호된다.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from api import llm
from api.rag import kb2_store, store
from api.rag.embeddings import embed_passage
from api.rag.taxonomy import TAX_CATEGORIES


@dataclass
class CategorySynthesisResult:
    taxCategory: str
    documentId: str | None
    created: int
    lockedSkipped: int


@dataclass
class Kb2SynthesisResult:
    results: list[CategorySynthesisResult] = field(default_factory=list)
    dbConfigured: bool = True


def _attribution_for(passage_ids: list[str]) -> list[dict]:
    """source passage 들의 auditor_id 집합 → 균등 가중치 attribution. 합성 직후엔
    원 세무사가 RAG 크레딧과 KB 크레딧을 동시에 보유(설계 §06, 의도된 설계)."""
    if not passage_ids:
        return []
    passages = store.get_passages_by_ids(passage_ids)
    auditor_ids = sorted({p.auditor_id for p in passages if p.auditor_id})
    if not auditor_ids:
        return []
    weight = round(1.0 / len(auditor_ids), 4)
    return [{"auditorId": aid, "weight": weight} for aid in auditor_ids]


def _synthesize_category(tax_category: str) -> CategorySynthesisResult:
    rows = store.list_active_passage_contents_by_category(tax_category)
    if not rows:
        return CategorySynthesisResult(taxCategory=tax_category, documentId=None, created=0, lockedSkipped=0)

    passages = [{"id": pid, "content": content} for pid, content in rows]
    sentences = llm.synthesize_kb2_sentences(tax_category, passages)
    if not sentences:
        return CategorySynthesisResult(taxCategory=tax_category, documentId=None, created=0, lockedSkipped=0)

    document_id = kb2_store.upsert_document(tax_category, title=f"{tax_category} 정책 사전")
    locked = [s for s in kb2_store.list_sentences(document_id) if s.locked_by_auditor]
    kb2_store.delete_unlocked_sentences(document_id)

    created = 0
    for order_index, sentence in enumerate(sentences, start=len(locked)):
        embedding = embed_passage(sentence["content"])
        attribution = _attribution_for(sentence["source_passage_ids"])
        kb2_store.create_sentence(
            document_id=document_id,
            order_index=order_index,
            content=sentence["content"],
            embedding=embedding,
            source_passage_ids=sentence["source_passage_ids"],
            attribution=attribution,
        )
        created += 1

    return CategorySynthesisResult(
        taxCategory=tax_category, documentId=document_id, created=created, lockedSkipped=len(locked)
    )


def synthesize(tax_category: str | None = None) -> Kb2SynthesisResult:
    """관리자 전용 트리거. tax_category=None 이면 전체 세목 순회."""
    if not store.is_configured() or not kb2_store.is_configured():
        return Kb2SynthesisResult(results=[], dbConfigured=False)

    targets = [tax_category] if tax_category else TAX_CATEGORIES
    results = [_synthesize_category(cat) for cat in targets]
    return Kb2SynthesisResult(results=results, dbConfigured=True)
