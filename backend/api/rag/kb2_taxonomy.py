"""
kb2 동적 카테고리 재구조화 — 로드맵 4.5단계.

지금까지 kb2.documents 는 backend/api/rag/taxonomy.TAX_CATEGORIES(17개 하드코딩 세목)와
1:1이었다. 이 모듈은 admin이 "AI로 카테고리 재구조화"를 실행하면 Solar Pro가 그 시점
rag.passages(active) 전체를 분석해 카테고리 자체를 새로 제안하도록 한다 — 국내 AI 트랙
취지상 "구조를 만드는 것"도 Upstage 산출물이어야 하기 때문(설계 결정 2026-09-09).

파이프라인: 맵(배치별 후보 카테고리 제안) → 리듀스(통합) → 분류(패시지→카테고리) →
이전 활성 문서 전체 보관(archive) → 카테고리별 합성(기존 kb2_synthesis 로직 재사용).
~400여 건 원문을 한 번에 LLM에 넣을 수 없어 맵 단계만 새로 배치 처리한다.

진행상황은 kb2.synthesis_jobs 에 기록 — 전체가 수 분 걸릴 수 있어 프론트가 job id로
폴링한다(POST 가 즉시 반환, 백그라운드로 이 함수가 실행됨).
"""

from __future__ import annotations

from api import llm
from api.rag import kb2_store, store
from api.rag.embeddings import embed_passage
from api.rag.kb2_synthesis import _attribution_for

CHUNK_SIZE = 35  # 맵 단계 배치당 passage 수 — 각 200자 절단 + 시스템프롬프트 감안한 안전 크기


def _chunks(items: list, size: int) -> list[list]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def run_dynamic_restructure(job_id: str) -> None:
    """전체 파이프라인. 실패 시 job.status='error' + error 메시지 기록(예외를 삼켜
    백그라운드 태스크가 조용히 죽지 않게 한다)."""
    try:
        kb2_store.update_job(job_id, stage="discovering_categories")
        rows = store.list_active_passage_contents()  # [(id, content), ...]

        # 맵 — 배치별 후보 카테고리
        candidates: list[dict] = []
        for chunk in _chunks(rows, CHUNK_SIZE):
            batch = [{"id": pid, "content": content} for pid, content in chunk]
            candidates += llm.propose_categories_batch(batch)

        # 리듀스 — 통합(원문 없이 label+description만, 가벼움)
        categories = llm.merge_categories(candidates)
        kb2_store.update_job(job_id, stage="classifying_passages", total=len(categories))

        if not categories:
            kb2_store.update_job(
                job_id, status="done", stage="done",
                result={"categoriesCreated": 0, "documentsArchived": 0, "note": "제안된 카테고리 없음"},
            )
            return

        # 분류 — 각 passage를 최종 카테고리 중 하나로 (기존 classify_tax_category 재사용,
        # 실패 시 '미분류')
        labels = [c["label"] for c in categories]
        assignment: dict[str, str] = {}
        for pid, content in rows:
            assignment[pid] = llm.classify_tax_category(content, labels)

        kb2_store.update_job(job_id, stage="synthesizing")
        archived_count = kb2_store.archive_all_active_documents()

        completed = 0
        for cat in categories:
            cat_id = kb2_store.create_category(cat["label"], cat["description"])
            members = [(pid, content) for pid, content in rows if assignment.get(pid) == cat["label"]]
            if members:
                valid_ids = {pid for pid, _ in members}
                passages = [{"id": pid, "content": content} for pid, content in members]
                sentences = llm.synthesize_kb2_sentences(cat["label"], passages)
                if sentences:
                    doc_id = kb2_store.create_document(cat_id, cat["label"], title=f"{cat['label']} 정책 사전")
                    for order_index, sentence in enumerate(sentences):
                        # Solar가 sourcePassageIds를 실제 id와 살짝 다르게(오타/환각) 낼 수
                        # 있어, 이번 배치에 실제로 넣은 id 집합과 교집합만 신뢰한다 —
                        # 아니면 uuid[] insert 자체가 깨진 문자열 때문에 실패한다.
                        valid_source_ids = [sid for sid in sentence["source_passage_ids"] if sid in valid_ids]
                        embedding = embed_passage(sentence["content"])
                        attribution = _attribution_for(valid_source_ids)
                        kb2_store.create_sentence(
                            document_id=doc_id,
                            order_index=order_index,
                            content=sentence["content"],
                            embedding=embedding,
                            source_passage_ids=valid_source_ids,
                            attribution=attribution,
                            editor_id="system:kb2_restructure",
                        )
            completed += 1
            kb2_store.update_job(job_id, completed=completed)

        kb2_store.update_job(
            job_id, status="done", stage="done",
            result={"categoriesCreated": len(categories), "documentsArchived": archived_count},
        )
    except Exception as e:  # noqa: BLE001 — 백그라운드 태스크, job 테이블에 기록해야 함
        kb2_store.update_job(job_id, status="error", error=str(e))


def auto_group_ungrouped_documents() -> dict:
    """"미분류" 세목(group_id is null)만 골라 Solar Pro에게 표준 세무 대분류로 묶어달라고
    요청하고 그대로 적용한다 — 이미 사람이 대목을 지정해둔 세목은 건드리지 않는다(로드맵
    4.6단계 후속). 17개 안팎이라 map-reduce 없이 한 번에 처리. 반환:
    {"groupsCreated": int, "documentsGrouped": int}."""
    documents = [d for d in kb2_store.list_documents(status="active") if not d.group_id]
    if not documents:
        return {"groupsCreated": 0, "documentsGrouped": 0}

    proposals = llm.propose_document_groups([{"id": d.id, "title": d.title} for d in documents])
    groups_created = 0
    documents_grouped = 0
    for proposal in proposals:
        group_id = kb2_store.create_group(proposal["label"])
        groups_created += 1
        for document_id in proposal["documentIds"]:
            kb2_store.set_document_group(document_id, group_id)
            documents_grouped += 1
    return {"groupsCreated": groups_created, "documentsGrouped": documents_grouped}
