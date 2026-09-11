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
from api.rag import ingest, kb2_store, kb2_synthesis, store
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
    안 되기 때문이다.

    실제 분할·합성은 kb2_synthesis.synthesize_members 가 한다(레거시 세목 합성 경로와
    공유) — 여기서는 청크마다 job 심장박동만 얹는다. 큰 세목은 이 단계에서만 수 분이라
    갱신이 없으면 stale 판정(kb2_scheduler)에 걸린다."""
    return kb2_synthesis.synthesize_members(
        label, passages, on_chunk=lambda: kb2_store.update_job(job_id)
    )


def _classify_all(
    rows: list, labels: list[str], job_id: str
) -> tuple[dict[str, str], int, dict[str, int], int]:
    """분류 단계 — **건별** 호출. 반환: (배정표, 호출 수, 실패 사유별 건수, 폴백 건수).

    분류기에 넣는 것은 번들 전체가 아니라 **[질문] 부분만**이다(2026-09-11). 그때까지는
    content[:700] 을 그대로 넣었는데, 질문은 대개 한두 줄이라 **읽히는 텍스트의 대부분이
    AI 답변**이었다 — 그리고 이 코퍼스의 AI 답변은 상당수가 질문과 주제가 다르다(그게
    세무사가 코멘트를 단 이유다). 진단기기 리스 질문에 "차량·접대·통신·복리후생 중
    무엇이냐"고 되묻는 답변이 붙어 있으면, 분류기는 진단기기가 아니라 그 되묻기를 읽는다.

    같은 150건·같은 목차 30개·순차 3회 실측:

        번들 전체(601자)          52.7 / 52.0 / 52.0%   평균 52.2%
        질문만(55자)              63.3 / 66.7 / 63.3%   평균 64.4%
        질문+세무사 코멘트(390자)  58.7 / 56.7 / 56.0%   평균 57.1%

    목차를 어떻게 바꿔도 안 되던 52건(A/B/C 실험) 중 **18건(35%)이 질문만으로 구제**됐다
    (번들 전체로는 1건). 목차 축이 소진된 뒤에 남아 있던 축이 이것이었다.

    검색과 합성은 여전히 번들 전체를 쓴다 — 지식은 세무사 코멘트에 있다. 바뀐 건
    "이 상담이 무슨 주제냐"를 묻는 자리 하나뿐이고, 그 질문에는 질문이 답한다.

    파서가 실패하면(번들 형식이 바뀌면) 번들 전체로 조용히 되돌아간다. 조용한 건 위험하니
    폴백 건수를 세어 계측에 남긴다.

    실패 사유를 따로 세는 이유(2026-09-11): llm.classify_dynamic_category 가 예전에는
    API 오류도 '미분류'로 접어서, 호출측에서 "모델이 갈 곳 없다고 판단한 건"과 "호출이
    실패해 사라진 건"이 같아 보였다. 둘은 처방이 정반대라(전자는 목차 품질, 후자는
    재시도·중단) 반드시 갈라야 한다. 이 집계가 곧 _assess_run 의 입력이다.

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
    failures: dict[str, int] = {}
    fallbacks = 0
    for done, (pid, content) in enumerate(rows, start=1):
        question = ingest.question_of(content)
        if not question:
            fallbacks += 1
        category, failure = llm.classify_dynamic_category(question or content, labels)
        assignment[pid] = category
        if failure:
            failures[failure] = failures.get(failure, 0) + 1
        # 건마다 갱신 — 진행률이자 stale job 판정용 심장박동.
        kb2_store.update_job(job_id, completed=done)
    return assignment, len(rows), failures, fallbacks


# ── 나쁜 회차 가드 (2026-09-11) ────────────────────────────────────────────────
# run_dynamic_restructure 는 새 목차를 만든 뒤 archive_all_active_documents() 로
# **멀쩡한 세대를 먼저 내리고** 새로 쌓는다. 분류가 나쁘게 나온 회차에 걸리면 좋은 KB 가
# 빈약한 KB 로 교체되고, 기본 실행 경로는 새벽 3시 예약이라 **아무도 안 보는 중에** 그
# 일이 벌어진다. 그래서 archive 직전에 이번 회차의 분류 결과를 보고 멈출 수 있게 한다.
#
# 되돌리기가 사실상 불가능하다는 점이 설계를 정한다: 좋은 회차를 한 번 놓치는 비용은
# "내일 밤 다시 돌린다"지만, 나쁜 회차를 한 번 통과시키는 비용은 "세대가 사라졌다"다.
# 그래서 애매하면 중단 쪽으로 기운다.

# ── 임계값의 실측 근거 (2026-09-11) ───────────────────────────────────────────
# 값을 감으로 정하지 않기 위해 **회차 편차부터 쟀다**. 같은 150건·같은 목차(현 활성
# 30개)·temperature=0 으로, 제품 경로와 동일하게 **순차** 4회:
#
#     52.0% / 53.3% / 53.3% / 51.3%   (배정률, 호출 실패 0/600건)
#
# 편차는 절대 2.0%p, 최고 대비 상대 3.8% 다. 즉 **제품 경로에서 회차 편차는 거의 없다.**
#
# 이게 직전 세션(9/12) 기록과 다르다. 거기서는 같은 조건 3회에 미분류 40/38/**75%** 로
# "회차가 통째로 무너진다"고 봤는데, 이번에 같은 측정을 **8워커 병렬**로 재현하니 그
# 붕괴가 그대로 나왔고 — 원인은 `RateLimitError` 였다(표본 100건에 16건). 당시
# classify_dynamic_category 가 `except Exception: return "미분류"` 라 429 가 전부
# '미분류'로 접혀서, 호출 실패가 모델의 판정처럼 보였던 것이다. 전체 413건을 8워커로
# 돌린 판에서는 배정률이 27.4% / 14.5% 까지 내려갔다.
#
# 그래서 가드는 두 축을 따로 본다: 진짜 위험은 "모델이 이상하게 판단한 회차"보다
# **"호출이 실패한 회차"** 쪽이었다.

GUARD_MAX_FAILURE_RATIO = 0.02
"""분류 호출 실패(429·타임아웃·도구 미호출) 허용 비율. 실패는 '미분류'와 달리 모델의
판단이 아니라 우리가 원문을 못 본 것이라, 그 상태로 세대를 갈아치우면 안 된다.

순차 실행 실측은 600호출 0건이라 **0 이 평시값**이다. 2% 로 둔 건 산발적인 429 한둘까지
중단시키면 오탐이 잦아서이고, 위에서 실제로 본 사태(16%)와는 자릿수가 다르다."""

GUARD_MAX_RELATIVE_DROP = 0.25
"""직전 세대 대비 배정률이 이만큼 넘게 떨어지면 중단.

관측된 회차 간 상대 편차가 3.8% 이므로 25% 는 그 6배 이상 — 정상 회차를 헛되이 막을
여지는 사실상 없다. 직전 세대 58% 기준으로는 43.5% 아래가 중단선이다. 느슨해 보여도
가드의 목적은 '미세한 열화 감지'가 아니라 **'세대가 통째로 무너진 판을 막는 것'**이고,
실제로 막아야 했던 판(27%·14%)은 전부 이 선 아래에 있다."""

GUARD_MIN_ASSIGNED_RATIO = 0.35
"""기준선이 없어도(최초 실행, 또는 계측 이전 세대) 이 밑이면 중단하는 절대 하한.
관측 최저 51.3% 의 약 2/3 — 정상 회차가 여기까지 내려온 적은 없다."""


def _assess_run(rows: list, assignment: dict[str, str], failures: dict[str, int]) -> dict:
    """이번 회차의 분류 품질을 직전 세대와 비교해 적재 여부를 판정한다.

    기준선은 kb2_store.get_latest_generation_job() — 지금 활성 세대를 만든 회차,
    곧 이번 회차가 덮어쓰려는 대상이다. 기준선이 없으면(최초 실행, 또는 계측 도입 이전
    세대) 절대 하한만 본다."""
    total = len(rows)
    assigned = sum(1 for pid, _ in rows if assignment.get(pid) not in (None, "미분류"))
    ratio = assigned / total if total else 0.0
    failed = sum(failures.values())
    failure_ratio = failed / total if total else 0.0

    baseline_job = kb2_store.get_latest_generation_job()
    baseline_ratio = None
    baseline_coverage = (baseline_job.result or {}).get("coverage") if baseline_job else None
    if baseline_coverage and baseline_coverage.get("passagesTotal"):
        baseline_ratio = baseline_coverage["assigned"] / baseline_coverage["passagesTotal"]

    floor = GUARD_MIN_ASSIGNED_RATIO
    if baseline_ratio is not None:
        floor = max(floor, baseline_ratio * (1 - GUARD_MAX_RELATIVE_DROP))

    verdict = {
        "assigned": assigned, "passagesTotal": total, "assignedRatio": round(ratio, 4),
        "classifyFailures": failed, "classifyFailureKinds": failures,
        "baselineJobId": baseline_job.id if baseline_job else None,
        "baselineAssignedRatio": round(baseline_ratio, 4) if baseline_ratio is not None else None,
        "requiredRatio": round(floor, 4),
        "abort": False, "reason": None,
    }

    # ① 호출 실패 먼저 본다. 실패가 많으면 배정률이 낮은 이유 자체가 "모델이 그렇게
    #    판단해서"가 아니라 "물어보지도 못해서"라, 배정률 비교가 의미를 잃는다.
    if failure_ratio > GUARD_MAX_FAILURE_RATIO:
        verdict["abort"] = True
        verdict["reason"] = (
            f"분류 호출 실패 {failed}건({failure_ratio:.1%})이 허용치 "
            f"{GUARD_MAX_FAILURE_RATIO:.0%}를 넘어 적재를 중단했습니다 — 원문을 못 읽은 채로 "
            f"세대를 교체할 수 없습니다. 사유: {failures}. 기존 세대는 그대로입니다."
        )
        return verdict

    # ② 배정률. 직전 세대보다 크게 나쁘면 그 세대를 내릴 이유가 없다.
    if ratio < floor:
        baseline_text = (
            f"직전 세대 {baseline_ratio:.1%}" if baseline_ratio is not None else "기준선 없음"
        )
        verdict["abort"] = True
        verdict["reason"] = (
            f"분류 배정률 {ratio:.1%}(요구 {floor:.1%}, {baseline_text})가 너무 낮아 적재를 "
            f"중단했습니다 — 나쁜 회차가 기존 세대를 덮어쓰는 것을 막았습니다. "
            f"기존 세대는 그대로이니 다시 실행하면 됩니다."
        )
    return verdict


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
        assignment, classify_calls, classify_failures, classify_fallbacks = _classify_all(
            rows, labels, job_id
        )

        # ⚠️ 여기가 되돌릴 수 없는 지점의 직전이다 — 아래 archive 가 실행되는 순간
        # 활성 세대가 내려간다. 가드는 반드시 그 앞에 있어야 하고, 중단 시에는 아직
        # 아무것도 안 건드린 상태다(카테고리 생성도 archive 뒤에 일어난다).
        guard = _assess_run(rows, assignment, classify_failures)
        if guard["abort"]:
            kb2_store.update_job(
                job_id, status="error", stage="aborted", error=guard["reason"],
                # 중단된 회차도 계측은 남긴다 — "왜 막혔는지"를 화면에서 봐야
                # 다시 돌릴지 목차를 고칠지 판단할 수 있다.
                result={"guard": guard, "categoriesCreated": 0, "documentsArchived": 0},
            )
            return

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
                    # 통과한 회차에도 남긴다 — 0 이 정상이고, 0 이 아닌데 통과했다면
                    # 허용치 안에서 원문이 몇 건 샜다는 뜻이라 눈에 보여야 한다.
                    "classifyFailures": sum(classify_failures.values()),
                    "classifyFailureKinds": classify_failures,
                    # 번들에서 [질문]을 못 찾아 번들 전체로 되돌아간 건수(2026-09-11).
                    # 0 이 정상 — 0 이 아니면 번들 형식이 바뀌었고, 그만큼은 분류가
                    # 예전(더 나쁜) 입력으로 돌아갔다는 뜻이다.
                    "classifyInputFallbacks": classify_fallbacks,
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
