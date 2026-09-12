"""
지식베이스2(kb2) 합성 오케스트레이션 — admin 트리거 진입점(설계 아티팩트 §02).

세목별로 rag.passages(active) 를 모아 Solar Pro 에 투입, 조항형 문장으로 응축해
kb2.sentences 에 적재한다. locked_by_auditor=true 인 문장(세무사가 손댄 적 있는)은
재합성 대상에서 제외 — 재실행해도 사람이 고친 문장은 보호된다.
"""

from __future__ import annotations

import time
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

CHUNK_ATTEMPTS = 3
"""빈 청크를 몇 번까지 다시 물어볼지(첫 호출 포함). 1+1 → 1+2 (2026-09-11).

근거는 실측이다. 고정된 304건을 순차 3회 합성했더니 매 회차 `APITimeoutError` 가 났고,
**두 번 다 실패해서 통째로 날아간 청크**가 회차당 0~2개였다. 그런데 같은 세목이 다른
회차에서는 한 번에 성공한다(`개원비용` 6/16 → 15/16, `광고·경품` 5/17 → 16/17) — 즉
이 실패는 그 원문이 합성 불가라서가 아니라 Upstage 쪽 산발적 정체다. 한 번 더 묻는
비용은 타임아웃 한 번이고, 안 물으면 원문 ~10건이 그 회차 내내 미인용으로 남는다."""


@dataclass
class ChunkFailures:
    """합성 청크 호출의 실패 집계 — 계측·가드용(2026-09-11).

    lostChunks 가 핵심이다: 실패해도 재시도로 건진 청크는 결과가 온전하지만, 시도를
    다 쓰고도 빈 청크는 그 안의 원문이 전부 미인용이 된다. 인용률만 보면 둘이 같아
    보이는데 처방은 정반대다(전자는 그냥 느린 회차, 후자는 원문 유실)."""

    calls: int = 0
    failedCalls: dict[str, int] = field(default_factory=dict)
    lostChunks: int = 0
    lostPassages: int = 0
    # 호출별 소요(ms) — 성공과 실패를 나눠 담는다(2026-09-12). TIMEOUT_SYNTHESIZE 를
    # 감으로 낮추면 정상 호출까지 자르게 되므로, 값을 건드리기 전에 **성공 호출의
    # 소요 분포**부터 봐야 한다. 실측 회차에서 호출의 12.7% 가 타임아웃이었고 한 번에
    # 240초를 붙들어 회차가 3002초까지 늘었다 — 그 240초가 정상 호출의 몇 배인지를
    # 알아야 상한 하향·백오프·청크 재분할 중 무엇이 처방인지 정할 수 있다.
    successMs: list[int] = field(default_factory=list)
    failedMs: list[int] = field(default_factory=list)

    def merge(self, other: "ChunkFailures") -> None:
        self.calls += other.calls
        self.lostChunks += other.lostChunks
        self.lostPassages += other.lostPassages
        self.successMs += other.successMs
        self.failedMs += other.failedMs
        for kind, n in other.failedCalls.items():
            self.failedCalls[kind] = self.failedCalls.get(kind, 0) + n


def synthesize_members(
    label: str, passages: list[dict], on_chunk: Callable[[], None] | None = None
) -> tuple[list[dict], int, ChunkFailures]:
    """세목 하나의 원문 **전체**를 합성한다 — 프롬프트 예산 단위로 나눠 병렬 호출하고
    문장을 이어붙인다. 반환: (문장들, 청크 수, 실패 집계).

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
    failures = ChunkFailures()
    with ThreadPoolExecutor(max_workers=SYNTHESIS_WORKERS) as pool:
        futures = {
            pool.submit(_synthesize_chunk, label, chunk): i
            for i, chunk in enumerate(packed)
        }
        for future in as_completed(futures):
            index = futures[future]
            sentences, chunk_failures = future.result()
            results[index] = sentences
            failures.merge(chunk_failures)
            if on_chunk is not None:
                on_chunk()

    return _dedup_sentences([s for chunk in results for s in chunk]), len(packed), failures


def _synthesize_chunk(label: str, chunk: list[dict]) -> tuple[list[dict], ChunkFailures]:
    """청크 하나 — 빈 반환이면 시도를 다 쓸 때까지 다시 물어본다(2026-09-11).

    빈 반환은 그 청크의 원문이 통째로 사라졌다는 뜻이다. 실측에서 48건짜리 세목의 한
    청크가 그렇게 날아가 인용률이 96% → 81% 로 내려앉았다."""
    out = ChunkFailures(calls=0)
    for _ in range(CHUNK_ATTEMPTS):
        out.calls += 1
        started = time.monotonic()
        sentences, failure = llm.synthesize_kb2_sentences(label, chunk)
        elapsed_ms = int((time.monotonic() - started) * 1000)
        if failure:
            out.failedCalls[failure] = out.failedCalls.get(failure, 0) + 1
            out.failedMs.append(elapsed_ms)
        else:
            out.successMs.append(elapsed_ms)
        if sentences:
            return sentences, out
    # 시도를 다 썼는데도 빈 청크 — 여기 실린 원문은 이번 회차에서 근거로 쓰이지 못한다.
    out.lostChunks += 1
    out.lostPassages += len(chunk)
    return [], out


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
    sentences, _chunks, _failures = synthesize_members(tax_category, passages)
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
