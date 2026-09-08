"""
Retriever 경계(마스터 §3-3) + get_retriever() 팩토리.

pipeline.py 는 이 인터페이스 하나만 안다 → 저장소·임베딩 구현이 바뀌어도 국소 변경.
그래서 향후 graph/agentic 업그레이드(§1 RAG 방침)도 이 경계 뒤에서 흡수된다.

**Graceful 원칙(뼈대 핵심)**: KB 가 비었거나(제품 출발 상태!) DB 미설정/장애면
retrieve() 는 빈 리스트를 반환하고 챗은 정상 동작한다. RAG 는 "있으면 근거를 더하는"
증강이지, 판정의 전제가 아니다(판정은 규칙엔진이 권위 — 마스터 §2).
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Optional, Protocol

log = logging.getLogger("api.rag")


@dataclass
class Passage:
    """검색된 지식 한 조각. 챗 근거(citations)·프롬프트 그라운딩에 쓰인다."""
    content: str
    score: float
    source_kind: str
    reviewer: Optional[str] = None
    case_refs: list[str] = field(default_factory=list)
    law_articles: list[str] = field(default_factory=list)
    tax_category: Optional[str] = None


class Retriever(Protocol):
    def retrieve(
        self, query: str, k: int = 5,
        occupation: Optional[str] = None, tax_category: Optional[str] = None,
    ) -> list[Passage]:
        ...


class NullRetriever:
    """RAG off / DB 미설정 / KB 비어있음 — 근거 없이 통과. 임팩트 측정의 baseline."""

    def retrieve(self, query, k=5, occupation=None, tax_category=None) -> list[Passage]:
        return []


class SupabaseRetriever:
    """Upstage embedding-query 로 질의 벡터화 → rag.match_passages 코사인 top-k."""

    def __init__(self, min_score: float = 0.0):
        # min_score: 이 코사인 유사도 미만은 버림(노이즈 컷). 0 = 컷 없음(뼈대 기본).
        self.min_score = min_score

    def retrieve(self, query, k=5, occupation=None, tax_category=None) -> list[Passage]:
        from api.rag import embeddings, store

        try:
            qvec = embeddings.embed_query(query)
            rows = store.search(qvec, k=k, occupation=occupation, tax_category=tax_category)
        except Exception as exc:  # DB 미설정/장애/임베딩 오류 → 챗은 계속(graceful)
            log.warning("RAG retrieve 실패 — 근거 없이 진행: %s", exc)
            return []
        return [
            Passage(
                content=r.content, score=r.score, source_kind=r.source_kind,
                reviewer=r.reviewer, case_refs=r.case_refs,
                law_articles=r.law_articles, tax_category=r.tax_category,
            )
            for r in rows
            if r.score >= self.min_score
        ]


class Kb2Retriever:
    """Upstage embedding-query 로 질의 벡터화 → kb2.match_sentences 코사인 top-k.

    지식베이스2(설계 §01~02) — rag.passages 를 세목별로 응축한 조항형 문장 사전.
    occupation 은 kb2.documents 에 없는 축이라 무시. case_refs/law_articles/reviewer/
    tax_category 는 Passage 기본값 그대로 둔다 — write_segments/write_advisory 는
    .content 만 프롬프트에 쓰므로 rag 결과와 섞여도 그대로 동작한다."""

    def __init__(self, min_score: float = 0.0):
        self.min_score = min_score

    def retrieve(self, query, k=5, occupation=None, tax_category=None) -> list[Passage]:
        from api.rag import embeddings, kb2_store

        try:
            qvec = embeddings.embed_query(query)
            rows = kb2_store.match_sentences(qvec, k=k, tax_category=tax_category)
        except Exception as exc:  # DB 미설정/장애/임베딩 오류 → 챗은 계속(graceful)
            log.warning("KB2 retrieve 실패 — 근거 없이 진행: %s", exc)
            return []
        return [
            Passage(content=r.content, score=r.score, source_kind="kb2")
            for r in rows
            if r.score >= self.min_score
        ]


class HybridRetriever:
    """kb2 우선 검색, 결과가 없으면 rag 로 폴백(설계 §03) — KB2 가 아직 못 채운
    세목/질문 범위는 기존 RAG 가 그대로 받쳐준다."""

    def __init__(self, primary: Retriever, fallback: Retriever):
        self.primary = primary
        self.fallback = fallback

    def retrieve(self, query, k=5, occupation=None, tax_category=None) -> list[Passage]:
        hits = self.primary.retrieve(query, k=k, occupation=occupation, tax_category=tax_category)
        if hits:
            return hits
        return self.fallback.retrieve(query, k=k, occupation=occupation, tax_category=tax_category)


def rag_enabled() -> bool:
    """RAG on/off 스위치 — 임팩트 측정(with-KB vs without-KB)의 손잡이.

    우선순위: **admin 토글(app_config.rag_enabled 1/0)** → 값이 있으면 그것을 따른다.
    키가 없거나(초기) DB 미설정·장애면 `RAG_ENABLED` env 폴백(기본 on). 이렇게 해서
    admin 화면의 ON/OFF 버튼이 서버 재시작 없이 즉시(요청 단위로) 반영된다.
    """
    from api.rag import store

    try:
        toggle = store.get_app_config("rag_enabled")
    except Exception as exc:  # noqa: BLE001 — 설정 조회 실패는 env 로 폴백(챗은 계속)
        log.warning("rag_enabled: app_config 조회 실패 — env 폴백: %s", exc)
        toggle = None
    if toggle is not None:
        return toggle != 0
    return os.environ.get("RAG_ENABLED", "1").strip().lower() not in ("0", "false", "no", "off")


def get_retriever(force_enabled: Optional[bool] = None, source: Optional[str] = None) -> Retriever:
    """팩토리. force_enabled 로 요청 단위 on/off 오버라이드(main.py `?rag=`), source 로
    코퍼스 선택(main.py `?ragSource=` 또는 RAG_SOURCE env, 설계 §03). source 가 없거나
    "rag"(또는 미인식 값)면 **기존과 완전히 동일한 분기** — 디폴트 동작은 절대 안 바뀐다.
    "kb2"/"hybrid" 는 지식베이스2 신설 경로."""
    from api.rag import kb2_store, store

    enabled = rag_enabled() if force_enabled is None else force_enabled
    if not enabled:
        return NullRetriever()
    resolved = (source or os.environ.get("RAG_SOURCE", "rag")).strip().lower()

    def _rag() -> Retriever:
        min_score = float(os.environ.get("RAG_MIN_SCORE", "0.0"))
        return SupabaseRetriever(min_score=min_score) if store.is_configured() else NullRetriever()

    def _kb2() -> Retriever:
        # kb2 문장은 rag 번들보다 짧고 응축돼 있어 코사인 점수 분포 자체가 낮게 형성된다
        # (실측 2026-09-09: 명백히 관련 있는 매치도 0.50 미만) — RAG_MIN_SCORE 를 그대로
        # 쓰면 kb2 쪽이 부당하게 걸러진다. 그래서 별도 임계값을 둔다.
        min_score = float(os.environ.get("KB2_MIN_SCORE", "0.35"))
        return Kb2Retriever(min_score=min_score) if kb2_store.is_configured() else NullRetriever()

    if resolved == "kb2":
        return _kb2()
    if resolved == "hybrid":
        return HybridRetriever(primary=_kb2(), fallback=_rag())
    return _rag()  # "rag" 및 미인식 값 — 기존 동작
