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

from api.upstage_gate import UpstageCongested

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
    # 어느 코퍼스(= 권위 층)에서 왔나: "kb3_prec" | "kb3_trib" | "kb3_qna" | "kb3_expert".
    # 프롬프트가 근거를 층별 블록으로 가르는 기준이 이 값이다(llm.KB3_LAYERS).
    corpus: Optional[str] = None
    # 원본 행의 id(kb3 문서). 프롬프트에는 안 쓰인다 — 계측 전용이다(로드맵 P7 A): 어떤 턴에
    # **어느 근거가** 쓰였는지를 rag.chat_turns 에 남겨야, 답변이 이상할 때 그 턴을 근거까지 되짚을 수 있다.
    id: Optional[str] = None


class Retriever(Protocol):
    # qvec: 이미 만든 query 임베딩. 주어지면 다시 임베딩하지 않는다.
    def retrieve(
        self, query: str, k: int = 5,
        occupation: Optional[str] = None, tax_category: Optional[str] = None,
        qvec: Optional[list[float]] = None,
    ) -> list[Passage]:
        ...


class NullRetriever:
    """RAG off / DB 미설정 / KB 비어있음 — 근거 없이 통과. 임팩트 측정의 baseline."""

    def retrieve(self, query, k=5, occupation=None, tax_category=None, qvec=None) -> list[Passage]:
        return []


class Kb3Retriever:
    """Upstage embedding-query 로 질의 벡터화 → kb3.match_chunks(청크로 찾아 사건 단위 카드) top-k.

    판례(kb3_prec)·심판례(kb3_trib)·국세청 질의회신(kb3_qna)·세무사 사례(kb3_expert, 게시분) — LLM2 답변 근거
    (새RAG_KB3_구축설계, 0042). 갈래는 하나이고 권위 층은 Passage.corpus 로 가른다(프롬프트 블록이 이 값을 본다).
    case_refs 에 문서번호를 실어 인용 대조·화면 근거 목록에 쓴다.
    스키마 없음(0042 미적용)·빈 테이블도 빈 결과로 흡수한다."""

    def __init__(self, min_score: float = 0.0, agent_expert_id: Optional[str] = None,
                 preview_expert_id: Optional[str] = None):
        self.min_score = min_score
        # 세무사 사례 범위(0043): agent = 그 세무사에게 연결된 대화(게시분) · preview = 스튜디오 시험칸(초안까지)
        self.agent_expert_id = agent_expert_id
        self.preview_expert_id = preview_expert_id

    def retrieve(self, query, k=5, occupation=None, tax_category=None, qvec=None) -> list[Passage]:
        from api.rag import embeddings, kb3_store

        try:
            if qvec is None:
                qvec = embeddings.embed_query(query)
            rows = kb3_store.match_chunks(qvec, k=k, preview_expert_id=self.preview_expert_id,
                                          agent_expert_id=self.agent_expert_id)
        except UpstageCongested:
            raise
        except Exception as exc:  # 스키마 없음/DB 장애/임베딩 오류 → 챗은 계속(graceful)
            log.warning("KB3 retrieve 실패 — 근거 없이 진행: %s", exc)
            return []
        return [
            Passage(content=r.content, score=r.score, source_kind=r.corpus, corpus=r.corpus,
                    case_refs=[r.case_number] if r.case_number else [], law_articles=r.law_articles,
                    tax_category=r.tax_category, id=r.id)
            for r in rows
            if r.score >= self.min_score
        ]


def rag_enabled() -> bool:
    """RAG on/off 스위치 — 임팩트 측정(with-KB vs without-KB)의 손잡이.

    우선순위: **app_config.rag_enabled(1/0)** → 값이 있으면 그것을 따른다(0 이면 KB3 까지 막힌다).
    키가 없거나 DB 미설정·장애면 `RAG_ENABLED` env 폴백(기본 on). DB 값은 요청 단위로 읽어 재시작 없이 반영된다.
    (쓰던 관리자 토글 API 는 절단 S5 에서 지웠다 — 바꿀 땐 DB 에서.)
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


def get_retriever(force_enabled: Optional[bool] = None,
                  agent_expert_id: Optional[str] = None, preview_expert_id: Optional[str] = None) -> Retriever:
    """팩토리 — 답변 근거 검색은 **KB3 하나**다(판례·심판례·질의회신·세무사 사례). force_enabled 로 요청 단위
    on/off 오버라이드(main.py `?rag=`). 꺼져 있거나 DB 미설정이면 NullRetriever.

    옛 갈래(rag.passages·kb2·hybrid·fusion·v2·kbdict)는 옛 검수 흐름 절단 S5(10/16)에서 지웠다 — 운영은
    10/6 부터 RAG_SOURCE=kb3 단독이었고, 그 env 와 `?ragSource=` 는 더 이상 갈래를 고르지 않는다."""
    from api.rag import kb3_store

    enabled = rag_enabled() if force_enabled is None else force_enabled
    if not enabled or not kb3_store.is_configured():
        return NullRetriever()
    # 0.40 = KB3 4a 확정(2026-09-27, strict 벤치 run2). 0.45 에선 판례 요지가 사실상 안 들어온다
    # (요지가 짧아 코사인이 낮다). 근거 design/KB3_요지수집_설계.md §10.
    min_score = float(os.environ.get("KB3_MIN_SCORE", "0.40"))
    return Kb3Retriever(min_score=min_score, agent_expert_id=agent_expert_id,
                        preview_expert_id=preview_expert_id)
