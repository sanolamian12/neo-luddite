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
    # 어느 코퍼스(= 권위 층)에서 왔나: "rag" | "kb2" | "kbdict". source_kind 는 rag 안에서도
    # feedback/case_seed/session_eval 로 갈려 층 식별자가 못 된다(P2 §3.2-1). 프롬프트가
    # 검수 선례와 참고 사전을 블록으로 가르는 기준이 이 값이다(로드맵 P4).
    corpus: Optional[str] = None
    # 원본 행의 id(rag.passages / kb2.sentences / kbdict.chunks). 프롬프트에는 안 쓰인다 —
    # 계측 전용이다(로드맵 P7 A): 어떤 턴에 **어느 청크가** 근거였는지를 rag.chat_turns 에
    # 남겨야, 답변이 이상할 때 그 턴을 근거까지 되짚을 수 있다. 세 store 가 이미 id 를
    # 돌려주고 있어 싣는 비용은 0이다.
    id: Optional[str] = None


class Retriever(Protocol):
    # qvec: 이미 만든 query 임베딩. 주어지면 갈래가 임베딩을 다시 부르지 않는다 — 여러 갈래를
    # 묶는 검색기(Fusion·Hybrid)가 한 번 만든 벡터를 나눠 주는 통로다(로드맵 P8 A-b).
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


def _needs_embedding(arms) -> bool:
    """묶인 갈래 중 실제로 벡터를 쓰는 것이 하나라도 있나. 전부 NullRetriever(DB 미설정)면
    임베딩을 부르지 않는다 — 공유 전과 같은 호출 수(0회)."""
    return any(not isinstance(a, NullRetriever) for a in arms)


class SupabaseRetriever:
    """Upstage embedding-query 로 질의 벡터화 → rag.match_passages 코사인 top-k."""

    def __init__(self, min_score: float = 0.0):
        # min_score: 이 코사인 유사도 미만은 버림(노이즈 컷). 0 = 컷 없음(뼈대 기본).
        self.min_score = min_score

    def retrieve(self, query, k=5, occupation=None, tax_category=None, qvec=None) -> list[Passage]:
        from api.rag import embeddings, store

        try:
            if qvec is None:
                qvec = embeddings.embed_query(query)
            rows = store.search(qvec, k=k, occupation=occupation, tax_category=tax_category)
        except Exception as exc:  # DB 미설정/장애/임베딩 오류 → 챗은 계속(graceful)
            log.warning("RAG retrieve 실패 — 근거 없이 진행: %s", exc)
            return []
        return [
            Passage(
                content=r.content, score=r.score, source_kind=r.source_kind,
                reviewer=r.reviewer, case_refs=r.case_refs,
                law_articles=r.law_articles, tax_category=r.tax_category, corpus="rag",
                id=r.id,
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

    def retrieve(self, query, k=5, occupation=None, tax_category=None, qvec=None) -> list[Passage]:
        from api.rag import embeddings, kb2_store

        try:
            if qvec is None:
                qvec = embeddings.embed_query(query)
            rows = kb2_store.match_sentences(qvec, k=k, tax_category=tax_category)
        except Exception as exc:  # DB 미설정/장애/임베딩 오류 → 챗은 계속(graceful)
            log.warning("KB2 retrieve 실패 — 근거 없이 진행: %s", exc)
            return []
        return [
            Passage(content=r.content, score=r.score, source_kind="kb2", corpus="kb2", id=r.id)
            for r in rows
            if r.score >= self.min_score
        ]


class KbdictRetriever:
    """Upstage embedding-query 로 질의 벡터화 → kbdict.match_chunks 코사인 top-k.

    L1 사전층(glossary·cases·occupations 시드, 로드맵 P3) — 세무사가 사안별로 확인한 내용이
    아닌 일반 법리·용어라 권위 서열 최하위다. fusion 갈래로만 들어간다.
    occupation 은 필터로 쓴다: 업종 무관 문서는 항상, 업종 playbook 은 일치할 때만.
    스키마 없음(0029 미적용)·빈 테이블도 빈 결과로 흡수한다."""

    def __init__(self, min_score: float = 0.0):
        self.min_score = min_score

    def retrieve(self, query, k=5, occupation=None, tax_category=None, qvec=None) -> list[Passage]:
        from api.rag import embeddings, kbdict_store

        try:
            if qvec is None:
                qvec = embeddings.embed_query(query)
            rows = kbdict_store.match_chunks(qvec, k=k, occupation=occupation)
        except Exception as exc:  # 스키마 없음/DB 장애/임베딩 오류 → 챗은 계속(graceful)
            log.warning("KBDICT retrieve 실패 — 근거 없이 진행: %s", exc)
            return []
        return [
            Passage(content=r.content, score=r.score, source_kind="kbdict", corpus="kbdict",
                    id=r.id)
            for r in rows
            if r.score >= self.min_score
        ]


class HybridRetriever:
    """kb2 우선 검색, 결과가 없으면 rag 로 폴백(설계 §03) — KB2 가 아직 못 채운
    세목/질문 범위는 기존 RAG 가 그대로 받쳐준다."""

    def __init__(self, primary: Retriever, fallback: Retriever):
        self.primary = primary
        self.fallback = fallback

    def retrieve(self, query, k=5, occupation=None, tax_category=None, qvec=None) -> list[Passage]:
        if qvec is None and _needs_embedding([self.primary, self.fallback]):
            qvec = _shared_query_vector(query)
            if qvec is None:
                return []
        hits = self.primary.retrieve(query, k=k, occupation=occupation, tax_category=tax_category,
                                     qvec=qvec)
        if hits:
            return hits
        return self.fallback.retrieve(query, k=k, occupation=occupation, tax_category=tax_category,
                                      qvec=qvec)


def _shared_query_vector(query: str) -> Optional[list[float]]:
    """묶음 검색기용 query 임베딩 1회. 실패하면 None — 호출자가 빈 결과로 접는다(graceful).

    공유 전에는 갈래마다 같은 텍스트를 같은 모델로 따로 임베딩했다(fusion 턴당 3회). 결과
    벡터가 같으니 검색 결과는 불변이고, 줄어드는 건 Upstage 호출 수뿐이다 — 전시 동시 부하에서
    같은 키에 쌓이는 호출을 턴당 2회 덜어낸다(로드맵 P8 A-b). 한 갈래만 임베딩에 실패하던
    경우는 이제 없다: 공유 전에도 같은 호출이 갈래마다 따로 실패할 수 있었을 뿐이다."""
    from api.rag import embeddings

    try:
        return embeddings.embed_query(query)
    except Exception as exc:  # noqa: BLE001 — 임베딩 오류 → 근거 없이 진행
        log.warning("query 임베딩 실패 — 근거 없이 진행: %s", exc)
        return None


class FusionRetriever:
    """코퍼스별 top-k → RRF(순위 합산) → 자리 쿼터 (KB통합 3층검색 로드맵 P2, 2026-09-16).

    HybridRetriever 는 "kb2 에 한 건이라도 있으면 rag 는 안 본다"는 경쟁이다. 그래서 어느
    코퍼스가 이기는지가 KB2_MIN_SCORE 와 RAG_MIN_SCORE 의 **상대** 값에 달려 있었다 —
    점수 분포가 다른 두 코퍼스를 같은 자로 잰 셈이다. 여기서는 점수를 비교하지 않고
    각 갈래 안의 **순위**만 쓴다: score(d) = Σ_arm 1 / (rrf_k + rank_arm(d)).

    - 갈래별 min_score 는 그대로 남는다. 그건 "이 코퍼스 안에서 무관한 것을 버리는" 노이즈
      컷이지 코퍼스끼리 순서를 정하는 값이 아니다 — 후자의 역할이 RRF 로 넘어왔다.
    - 코퍼스가 서로 겹치지 않으면(rag·kb2 가 그렇다) 같은 문서가 두 갈래에 동시에 나올 일이
      없어 RRF 는 **순위 교차 배치**와 같아진다. 동률은 갈래 순서(= 권위 서열, 앞이 높다)로
      끊는다. RRF 의 합산 효과는 같은 코퍼스를 두 방식(벡터 + pg_trgm 등)으로 찾을 때 난다.
    - quotas: 갈래 이름 → 최대 자리 수. 한 코퍼스의 독식을 막는다. 없는 갈래는 k 까지.
    - 갈래는 이름으로 구분한다. rag 쪽 Passage.source_kind 는 feedback/case_seed 등으로
      갈리므로 코퍼스 식별자로 못 쓴다.
    - Passage.score 는 원래 코사인 값을 그대로 둔다(화면·로그가 해석할 수 있는 값). 순서가 곧
      융합 결과다.

    query 임베딩은 한 번만 만들어 갈래에 나눠 준다(P8 A-b — 공유 전엔 갈래마다 따로 불러
    턴당 3회였다). 갈래는 병렬로 부른다 — 순차면 DB 왕복이 갈래 수만큼 쌓인다. 한 갈래가 실패해도
    각 Retriever 가 이미 빈 리스트로 흡수하고, 스레드 자체의 예외도 여기서 빈 결과로 접는다."""

    def __init__(self, arms: list[tuple[str, Retriever]], quotas: Optional[dict[str, int]] = None,
                 rrf_k: int = 60, per_arm_k: Optional[int] = None):
        self.arms = arms
        self.quotas = quotas or {}
        self.rrf_k = rrf_k
        self.per_arm_k = per_arm_k

    def retrieve(self, query, k=5, occupation=None, tax_category=None, qvec=None) -> list[Passage]:
        from concurrent.futures import ThreadPoolExecutor

        fetch_k = self.per_arm_k or k
        # 임베딩은 갈래를 펼치기 전에 한 번 — 갈래는 DB 왕복만 병렬로 한다.
        if qvec is None and _needs_embedding([r for _, r in self.arms]):
            qvec = _shared_query_vector(query)
            if qvec is None:
                return []

        def _one(arm: Retriever) -> list[Passage]:
            try:
                return arm.retrieve(query, k=fetch_k, occupation=occupation, tax_category=tax_category,
                                    qvec=qvec)
            except Exception as exc:  # noqa: BLE001 — graceful: 갈래 하나가 죽어도 나머지로 간다
                log.warning("Fusion 갈래 실패 — 그 갈래 없이 진행: %s", exc)
                return []

        with ThreadPoolExecutor(max_workers=max(1, len(self.arms))) as ex:
            results = list(ex.map(_one, [r for _, r in self.arms]))

        fused: dict[str, tuple[float, int, int, str, Passage]] = {}
        for arm_idx, ((name, _), hits) in enumerate(zip(self.arms, results)):
            for rank, p in enumerate(hits, start=1):
                key = p.content
                gain = 1.0 / (self.rrf_k + rank)
                if key in fused:
                    s, a, r, n, keep = fused[key]
                    fused[key] = (s + gain, min(a, arm_idx), min(r, rank), n, keep)
                else:
                    fused[key] = (gain, arm_idx, rank, name, p)

        ordered = sorted(fused.values(), key=lambda t: (-t[0], t[1], t[2]))
        taken: dict[str, int] = {}
        picked: list[int] = []
        for i, (_, _, _, name, _) in enumerate(ordered):
            if len(picked) >= k:
                break
            if taken.get(name, 0) >= self.quotas.get(name, k):
                continue
            taken[name] = taken.get(name, 0) + 1
            picked.append(i)
        # 쿼터는 독식 방지이지 자리 비워두기가 아니다 — 다른 갈래가 못 채운 자리는 융합 순서대로
        # 마저 채운다. 안 그러면 kb2 가 빈 질문에서 fusion 이 rag 단독보다 근거를 덜 받는다.
        if len(picked) < k:
            chosen = set(picked)
            picked += [i for i in range(len(ordered)) if i not in chosen][: k - len(picked)]
            picked.sort()
        return [ordered[i][4] for i in picked]


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
    코퍼스 선택(main.py `?ragSource=` 또는 RAG_SOURCE env, 설계 §03). "rag"(또는 미인식 값)면
    **기존과 완전히 동일한 분기** — 대조군·논문 비교축은 `?ragSource=rag` 명시로 언제든 부른다.
    "kb2"/"hybrid" 는 지식베이스2 신설 경로, "fusion" 은 RRF 융합(3층검색 로드맵 P2).
    코드 기본값은 "rag" 이고, **프로덕션 디폴트는 서버 `.env` 의 RAG_SOURCE 가 정한다** — 2026-09-18
    fusion 으로 전환(로드맵 P8 A: 판정형·자문 경로 혼입 측정 근거). 되돌리기는 그 한 줄."""
    from api.rag import kb2_store, kbdict_store, store

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

    def _kbdict() -> Retriever:
        # 0.45 = 엄격 채점 2회에서 등급2 가 등급0 을 확실히 넘기 시작하는 구간(2026-09-17, 110문항).
        # 그 아래(0.35~0.45)는 등급0 이 45~58%. 기본 채점은 사전 청크에 점수와 무관하게 관대해 못 썼다.
        # 이 컷에서 fusion 대비 지표는 중립(이득 미입증·무해 확인) — history/260917 P3 기록 참조.
        min_score = float(os.environ.get("KBDICT_MIN_SCORE", "0.45"))
        return KbdictRetriever(min_score=min_score) if kbdict_store.is_configured() else NullRetriever()

    if resolved == "kb2":
        return _kb2()
    if resolved == "hybrid":
        return HybridRetriever(primary=_kb2(), fallback=_rag())
    if resolved == "fusion":
        # 갈래 순서 = 권위 서열(로드맵 §2.1: L2 검수 선례 > 원본 KB > L1 사전). 동률 타이브레이크에 쓰인다.
        # FUSION_QUOTA_KBDICT=0 이면 L1 갈래를 붙이지 않는다 = P2 의 2갈래 fusion 과 동일.
        arms: list[tuple[str, Retriever]] = [("kb2", _kb2()), ("rag", _rag())]
        quotas = {"kb2": int(os.environ.get("FUSION_QUOTA_KB2", "3")),
                  "rag": int(os.environ.get("FUSION_QUOTA_RAG", "3"))}
        kbdict_quota = int(os.environ.get("FUSION_QUOTA_KBDICT", "2"))
        if kbdict_quota > 0:
            arms.append(("kbdict", _kbdict()))
            quotas["kbdict"] = kbdict_quota
        return FusionRetriever(arms=arms, quotas=quotas)
    return _rag()  # "rag" 및 미인식 값 — 기존 동작
