"""
지식베이스2(kb2) 합성 오케스트레이션 — admin 트리거 진입점(설계 아티팩트 §02).

세목별로 rag.passages(active) 를 모아 Solar Pro 에 투입, 조항형 문장으로 응축해
kb2.sentences 에 적재한다. locked_by_auditor=true 인 문장(세무사가 손댄 적 있는)은
재합성 대상에서 제외 — 재실행해도 사람이 고친 문장은 보호된다.
"""

from __future__ import annotations

from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
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


SYNTHESIS_WORKERS = 4  # 한 세목 안의 합성 청크 동시 호출 수(오프라인 측정에서 6까지 무탈)


def synthesize_members(
    label: str, passages: list[dict], on_chunk: Callable[[], None] | None = None
) -> tuple[list[dict], int]:
    """세목 하나의 원문 **전체**를 합성한다 — 프롬프트 예산 단위로 나눠 병렬 호출하고
    문장을 이어붙인다. 반환: (문장들, 청크 수).

    두 합성 경로(동적 재구조화 kb2_taxonomy, 레거시 17세목 synthesize)가 공유한다.
    전에는 이 분할이 재구조화 쪽에만 있어서, 레거시 경로는 세목 전체를 한 프롬프트에
    밀어넣고 예산을 넘는 나머지를 조용히 버렸다 — 예산을 12000 에서 6000 으로 줄인
    2026-09-11 에 그 유실이 두 배가 되므로 여기서 함께 쓰게 합쳤다.

    청크 경계를 넘는 중복 문장은 정규화 후 첫 것만 남기고 출처 id 를 합친다 — 같은
    조항이 두 청크에서 각각 관찰될 수 있는데, 그때 기여도(attribution)까지 쪼개지면
    안 되기 때문이다. on_chunk 는 청크가 끝날 때마다 불린다(진행률·심장박동용)."""
    packed: list[list[dict]] = []
    rest = passages
    while rest:
        fitted, _ = llm.fit_passages_for_synthesis(rest)
        packed.append(fitted)
        rest = rest[len(fitted) :]

    # 청크는 서로 독립이라 병렬로 호출한다(2026-09-11). 예산을 반으로 줄여 청크 수가
    # 2배가 됐는데, 합성은 이미 파이프라인에서 제일 긴 단계(30세목 32분)라 순차로 두면
    # 그대로 배가 된다. 결과는 제출 순서대로 되돌려 문장 순서를 결정적으로 유지한다.
    results: list[list[dict]] = [[] for _ in packed]
    with ThreadPoolExecutor(max_workers=SYNTHESIS_WORKERS) as pool:
        futures = {
            pool.submit(llm.synthesize_kb2_sentences, label, chunk): i
            for i, chunk in enumerate(packed)
        }
        for future in as_completed(futures):
            index = futures[future]
            sentences = future.result()
            # 빈 반환은 그 청크의 원문이 통째로 사라졌다는 뜻이라 한 번 더 물어본다
            # (2026-09-11). synthesize_kb2_sentences 는 타임아웃·도구호출 누락을 모두
            # 빈 리스트로 삼키는데, 실측에서 48건짜리 세목의 한 청크가 그렇게 날아가
            # 인용률이 96% → 81% 로 내려앉았다.
            if not sentences:
                sentences = llm.synthesize_kb2_sentences(label, packed[index])
            results[index] = sentences
            if on_chunk is not None:
                on_chunk()

    return _dedup_sentences([s for chunk in results for s in chunk]), len(packed)


def _dedup_sentences(sentences: list[dict]) -> list[dict]:
    """내용이 같은(공백만 다른) 문장을 하나로 접고 출처 id 를 합집합으로 모은다."""
    merged: dict[str, dict] = {}
    for s in sentences:
        key = " ".join(s["content"].split())
        hit = merged.get(key)
        if hit is None:
            merged[key] = {"content": s["content"], "source_passage_ids": list(s["source_passage_ids"])}
            continue
        known = set(hit["source_passage_ids"])
        hit["source_passage_ids"] += [sid for sid in s["source_passage_ids"] if sid not in known]
    return list(merged.values())


def _synthesize_category(tax_category: str) -> CategorySynthesisResult:
    rows = store.list_active_passage_contents_by_category(tax_category)
    if not rows:
        return CategorySynthesisResult(taxCategory=tax_category, documentId=None, created=0, lockedSkipped=0)

    passages = [{"id": pid, "content": content} for pid, content in rows]
    sentences, _chunks = synthesize_members(tax_category, passages)
    if not sentences:
        return CategorySynthesisResult(taxCategory=tax_category, documentId=None, created=0, lockedSkipped=0)

    document_id = kb2_store.upsert_document(tax_category, title=f"{tax_category} 정책 사전")
    locked = [s for s in kb2_store.list_sentences(document_id) if s.locked_by_auditor]
    kb2_store.delete_unlocked_sentences(document_id)

    valid_ids = {pid for pid, _ in rows}
    created = 0
    for order_index, sentence in enumerate(sentences, start=len(locked)):
        # Solar가 sourcePassageIds를 실제 id와 살짝 다르게(오타/환각) 낼 수 있어, 이번
        # 배치에 실제로 넣은 id 집합과 교집합만 신뢰한다 — 아니면 uuid[] insert가 깨진
        # 문자열 때문에 실패한다(2026-09-09, 동적 재구조화 검증 중 발견).
        valid_source_ids = [sid for sid in sentence["source_passage_ids"] if sid in valid_ids]
        embedding = embed_passage(sentence["content"])
        attribution = _attribution_for(valid_source_ids)
        kb2_store.create_sentence(
            document_id=document_id,
            order_index=order_index,
            content=sentence["content"],
            embedding=embedding,
            source_passage_ids=valid_source_ids,
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
