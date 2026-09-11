"""
kb2 동적 카테고리 재구조화 — 로드맵 4.5단계.

지금까지 kb2.documents 는 backend/api/rag/taxonomy.TAX_CATEGORIES(17개 하드코딩 세목)와
1:1이었다. 이 모듈은 admin이 "AI로 카테고리 재구조화"를 실행하면 Solar Pro가 그 시점
rag.passages(active) 전체를 분석해 카테고리 자체를 새로 제안하도록 한다 — 국내 AI 트랙
취지상 "구조를 만드는 것"도 Upstage 산출물이어야 하기 때문(설계 결정 2026-09-09).

파이프라인: 맵(배치별 후보 카테고리 제안) → 리듀스(통합) → 분류(패시지→카테고리) →
이전 활성 문서·카테고리 보관(archive) → 카테고리별 합성(기존 kb2_synthesis 로직 재사용).
~400여 건 원문을 한 번에 LLM에 넣을 수 없어 맵 단계와 분류 단계 모두 배치로 나눈다
(분류 배치화 2026-09-10 — 그 전엔 건별 순차 호출이라 실측 413건에 ~35분이었다).

진행상황은 kb2.synthesis_jobs 에 기록 — 전체가 수 분 걸릴 수 있어 프론트가 job id로
폴링한다. 실행 경로는 둘: 즉시 실행(POST 가 job 을 running 으로 만들고 백그라운드
태스크로 이 함수 호출)과 야간 예약(kb2_scheduler 폴러가 만기된 job 을 집어 호출).
"""

from __future__ import annotations

from api import llm
from api.rag import kb2_store, store
from api.rag.embeddings import embed_passage
from api.rag.kb2_synthesis import _attribution_for

CHUNK_SIZE = 35  # 맵 단계 배치당 passage 수 — 각 200자 절단 + 시스템프롬프트 감안한 안전 크기

# 분류 단계는 배치를 쓰지 않는다(2026-09-11 되돌림) — 근거는 _classify_all 참고.


def _chunks(items: list, size: int) -> list[list]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def _synthesize_members(label: str, passages: list[dict], job_id: str) -> tuple[list[dict], int]:
    """세목 하나의 원문 **전체**를 합성한다 — 프롬프트 예산 단위로 나눠 여러 번 호출하고
    문장을 이어붙인다. 반환: (문장들, 청크 수).

    이전에는 예산에 안 들어가는 나머지를 그냥 버렸다(2026-09-11 수정). 실측 평균 642자라
    한 프롬프트에 ~17건이 한계여서, 세목이 커질수록 원문이 대량으로 사라졌다 — 40건짜리
    세목이면 57%가 모델에 보이지도 않았다. 맵 프롬프트를 고쳐 카테고리를 넓히면 세목당
    건수가 늘어나므로, 이 수정 없이 프롬프트만 고치면 유실 지점이 '미분류'에서
    '미투입'으로 옮겨갈 뿐 커버리지는 그대로다.

    청크 경계를 넘는 중복 문장은 정규화 후 첫 것만 남기고 출처 id 를 합친다 — 같은
    조항이 두 청크에서 각각 관찰될 수 있는데, 그때 기여도(attribution)까지 쪼개지면
    안 되기 때문이다."""
    sentences: list[dict] = []
    rest = passages
    chunks = 0
    while rest:
        fitted, _ = llm.fit_passages_for_synthesis(rest)
        sentences += llm.synthesize_kb2_sentences(label, fitted)
        rest = rest[len(fitted) :]
        chunks += 1
        # 청크마다 심장박동 — 큰 세목은 여기서만 수 분이라 stale 판정에 걸릴 수 있다.
        kb2_store.update_job(job_id)
    return _dedup_sentences(sentences), chunks


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


def _classify_all(rows: list, labels: list[str], job_id: str) -> tuple[dict[str, str], int]:
    """분류 단계 — **건별** 호출. 반환: (배정표, 호출 수).

    2026-09-10 에 이 단계를 20건 배치로 접었다가 2026-09-11 에 되돌렸다. 배치화의 명분은
    "정확도는 그대로 두고 시간만 줄인다"였는데, 같은 표본 100건·같은 목차 30개로 재보니
    그렇지 않았다:

        배치 20건 + 기존 프롬프트 → 미분류 84%   (100건 중 서로 다른 세목 10개만 사용)
        건별   + 기존 프롬프트 → 미분류 45%
        건별   + 동적목차 프롬프트 → 미분류 28%

    배치는 한 번에 20건 × 700자를 넣고 id별 배정을 받아오는데, 모델이 앞쪽 몇 건만
    성실히 읽고 나머지를 '미분류'로 흘렸다(실측: 100건에 서로 다른 세목 2개만 쓴 조합도
    있었다). kb2 에서 미분류는 어느 문서에도 안 실리고 사라지는 값이라, 이 손실이 곧
    커버리지다. 절약분은 413건 기준 5.7분 → 2.6분, 약 3분이었다 — 전체 14분 파이프라인에서
    3분을 아끼려고 코퍼스 절반을 버린 셈이라 되돌린다.

    (배치 도입 근거였던 "건별이면 35분"도 실측과 맞지 않았다 — 건당 0.83초, 413건에
    5.7분이다.)"""
    kb2_store.update_job(job_id, stage="classifying_passages", total=len(rows), completed=0)
    assignment: dict[str, str] = {}
    for done, (pid, content) in enumerate(rows, start=1):
        assignment[pid] = llm.classify_dynamic_category(content, labels)
        # 건마다 갱신 — 진행률이자 stale job 판정용 심장박동.
        kb2_store.update_job(job_id, completed=done)
    return assignment, len(rows)


def run_dynamic_restructure(job_id: str) -> None:
    """전체 파이프라인. 실패 시 job.status='error' + error 메시지 기록(예외를 삼켜
    백그라운드 태스크가 조용히 죽지 않게 한다)."""
    try:
        kb2_store.update_job(job_id, stage="discovering_categories")
        rows = store.list_active_passage_contents()  # [(id, content), ...]

        # 맵 — 배치별 후보 카테고리.
        # 배치마다 job 을 갱신한다(2026-09-10). 이전에는 맵 단계 전체가 무소식이라
        # "정상 진행 중"과 "한 배치가 폭주 중"이 화면에서 구분되지 않았다 — 실제로
        # 그 상태로 12분을 보고 나서야 이상을 눈치챘다. 이 갱신은 진행률 표시일 뿐
        # 아니라 stale job 판정(kb2_scheduler)의 심장박동 역할도 한다.
        map_batches = _chunks(rows, CHUNK_SIZE)
        kb2_store.update_job(
            job_id, stage="discovering_categories", total=len(map_batches), completed=0
        )
        candidates: list[dict] = []
        for done, chunk in enumerate(map_batches, start=1):
            batch = [{"id": pid, "content": content} for pid, content in chunk]
            candidates += llm.propose_categories_batch(batch)
            kb2_store.update_job(job_id, completed=done)

        # 리듀스 — 통합(원문 없이 label+description만, 가벼움)
        kb2_store.update_job(job_id, stage="merging_categories")
        categories = llm.merge_categories(candidates)

        if not categories:
            kb2_store.update_job(
                job_id, status="done", stage="done",
                result={"categoriesCreated": 0, "documentsArchived": 0, "note": "제안된 카테고리 없음"},
            )
            return

        # 분류 — 각 passage를 최종 카테고리 중 하나로. 배치 처리(2026-09-10).
        labels = [c["label"] for c in categories]
        assignment, classify_calls = _classify_all(rows, labels, job_id)

        kb2_store.update_job(job_id, stage="synthesizing", total=len(categories), completed=0)
        archived_count = kb2_store.archive_all_active_documents()
        # 문서와 함께 지난 회차 카테고리 레이블도 보관 — 안 그러면 재실행마다 쌓인다.
        kb2_store.archive_all_active_categories()

        # 계측(2026-09-11) — 커버리지 20% 문제의 원인을 단계별로 가려내기 위한 깔때기.
        # 413건이 어디서 새는지 지금까지 측정 자체가 불가능했다(분류 결과를 저장하지
        # 않아서). 각 세목마다 배정 → 프롬프트 투입 → 실제 인용 세 지점을 세어 남긴다.
        category_stats: list[dict] = []
        cited_all: set[str] = set()
        hallucinated_dropped = 0
        fed_total = 0
        truncated_total = 0

        completed = 0
        for cat in categories:
            cat_id = kb2_store.create_category(cat["label"], cat["description"])
            members = [(pid, content) for pid, content in rows if assignment.get(pid) == cat["label"]]
            stat = {"label": cat["label"], "assigned": len(members), "fed": 0,
                    "truncated": 0, "chunks": 0, "sentences": 0, "cited": 0}
            category_stats.append(stat)
            if members:
                passages = [{"id": pid, "content": content} for pid, content in members]
                valid_ids = {pid for pid, _ in members}
                # 청크화 이후로는 배정된 원문이 전부 투입된다 — truncated 는 0 이 정상이고,
                # 0 이 아니면 어딘가 계약이 깨졌다는 신호로 남겨둔다.
                sentences, chunks = _synthesize_members(cat["label"], passages, job_id)
                stat["fed"] = len(passages)
                stat["chunks"] = chunks
                fed_total += len(passages)
                if sentences:
                    stat["sentences"] = len(sentences)
                    cited_here: set[str] = set()
                    doc_id = kb2_store.create_document(cat_id, cat["label"], title=f"{cat['label']} 정책 사전")
                    for order_index, sentence in enumerate(sentences):
                        # Solar가 sourcePassageIds를 실제 id와 살짝 다르게(오타/환각) 낼 수
                        # 있어, 이번 배치에 실제로 넣은 id 집합과 교집합만 신뢰한다 —
                        # 아니면 uuid[] insert 자체가 깨진 문자열 때문에 실패한다.
                        valid_source_ids = [sid for sid in sentence["source_passage_ids"] if sid in valid_ids]
                        hallucinated_dropped += len(sentence["source_passage_ids"]) - len(valid_source_ids)
                        cited_here.update(valid_source_ids)
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
                        # 문장마다 심장박동(updated_at 만 갱신). 카테고리 하나가 문장
                        # 수십 개면 합성+임베딩만으로 십수 분이 될 수 있어, 카테고리
                        # 단위 갱신만으로는 stale 판정선(15분)에 걸릴 수 있다.
                        kb2_store.update_job(job_id)
                    stat["cited"] = len(cited_here)
                    cited_all.update(cited_here)
            completed += 1
            kb2_store.update_job(job_id, completed=completed)

        assigned_total = sum(1 for pid, _ in rows if assignment.get(pid) not in (None, "미분류"))
        total = len(rows)
        kb2_store.update_job(
            job_id, status="done", stage="done",
            result={
                "categoriesCreated": len(categories),
                "documentsArchived": archived_count,
                # 깔때기: 원본 → 분류 배정 → 프롬프트 투입 → 실제 인용.
                # 셋 중 어디서 크게 줄어드는지가 곧 개선해야 할 단계다.
                "coverage": {
                    "passagesTotal": total,
                    "assigned": assigned_total,
                    "unclassified": total - assigned_total,
                    "classifyCalls": classify_calls,
                    "fed": fed_total,
                    "truncated": truncated_total,  # 청크화 이후 0 이 정상
                    "synthesisChunks": sum(s["chunks"] for s in category_stats),
                    "sentences": sum(s["sentences"] for s in category_stats),
                    "cited": len(cited_all),
                    "citedRatio": round(len(cited_all) / total, 4) if total else 0,
                    "hallucinatedIdsDropped": hallucinated_dropped,
                },
                "categoryStats": category_stats,
            },
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
