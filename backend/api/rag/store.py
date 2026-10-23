"""
rag.* 저장소 — Supabase Postgres(pgvector)에 psycopg 로 직결.

남은 일: app_config(rag_enabled 스위치) 읽기 · rag.chat_turns 턴 계측. 옛 검수 흐름의 적재·조회·간선·
수정 제안·통계·철회(절단 S3)와 rag.passages 검색·스위치 쓰기(S5, 10/16)는 지웠다.

2-호스트 토폴로지(마스터 §1): Python 백엔드가 Supabase(Tokyo)로 직접 SQL.
접근은 service role 급 직결 문자열(SUPABASE_DB_URL, 세션/트랜잭션 풀러) 하나로.
프론트는 rag.* 를 만지지 않는다(RLS 로 차단) — 오직 이 백엔드만.

뼈대 원칙: DB 가 설정 안 됐거나 붙지 않으면 예외를 삼키지 말고 명확히 올린다.
단, 호출자(retriever.rag_enabled·pipeline 계측)가 이를 잡아 챗은 계속 동작한다(graceful).
"""

from __future__ import annotations

import logging
import os
from typing import Optional

log = logging.getLogger(__name__)

_conn = None  # 지연 연결(모듈 캐시). 끊기면 재연결.


def _db_url() -> str:
    url = os.environ.get("SUPABASE_DB_URL")
    if not url:
        raise RuntimeError(
            "SUPABASE_DB_URL 이 설정되지 않았습니다. Supabase 대시보드 → Project "
            "Settings → Database → Connection string(풀러)을 backend/.env 에 넣으세요."
        )
    # 비밀번호 특수문자 URL 인코딩 헛수고 방지: SUPABASE_DB_PASSWORD 를 주면 raw 로 받아
    # 자동 인코딩해 URL 의 비밀번호 자리를 채운다. (URL 은 [YOUR-PASSWORD] placeholder 유지 가능)
    raw_pw = os.environ.get("SUPABASE_DB_PASSWORD")
    if raw_pw:
        from urllib.parse import quote

        enc = quote(raw_pw, safe="")
        url = url.replace("[YOUR-PASSWORD]", enc)
        # placeholder 가 없으면 user:pw@ 사이의 비밀번호 구간을 교체
        if "[YOUR-PASSWORD]" not in os.environ["SUPABASE_DB_URL"]:
            import re as _re

            url = _re.sub(r"(://[^:/@]+:)[^@]*(@)", rf"\g<1>{enc}\g<2>", url, count=1)
    return url


def _connect():
    """psycopg3 연결 + pgvector 어댑터 등록. import 는 지연(선택적 의존성)."""
    import psycopg
    from pgvector.psycopg import register_vector

    conn = psycopg.connect(_db_url(), autocommit=True)
    register_vector(conn)
    return conn


def _get_conn():
    global _conn
    if _conn is None or _conn.closed:
        _conn = _connect()
    return _conn


def is_configured() -> bool:
    return bool(os.environ.get("SUPABASE_DB_URL"))


# ── 앱 설정(app_config: key/value) ───────────────────────────────────────────
# freeze_ms 와 같은 서버 단일 소스 설정 테이블. admin RAG on/off 토글도 여기
# (key='rag_enabled', value 1/0)에 산다. 백엔드는 직결(service role)이라 RLS 무관.


def get_app_config(key: str) -> Optional[int]:
    """app_config 값(bigint) 조회. 키가 없거나 DB 미설정이면 None(호출부가 폴백)."""
    if not is_configured():
        return None
    conn = _get_conn()
    with conn.cursor() as cur:
        cur.execute("select value from public.app_config where key = %s", (key,))
        row = cur.fetchone()
    return int(row[0]) if row else None


# ── G3 임팩트 계측 (rag.chat_turns) ──────────────────────────────────────────
# 챗 턴마다 "어느 갈래로 답했는지 + 어느 코퍼스를 봤는지"를 한 줄 남긴다(0027).
# 제품 논지("RAG 는 답할 수 있는 **범위**를 넓힌다")가 kb2 경로에서 숫자로 보인 적이
# 한 번도 없어서, 우선 남길 자리부터 만든 것이다. 분모는 스키마에 안 박았다 — outcome
# 으로 집계 시점에 고른다(마이그레이션 0027 주석).


def record_chat_turn(
    conversation_id: str,
    message_id: str,
    occupation: str,
    outcome: str,
    rag_searched: Optional[bool] = None,
    rag_source: Optional[str] = None,
    rag_requested: Optional[str] = None,
    rag_hits: int = 0,
    follow_up: bool = False,
    advisory: bool = False,
    etype: Optional[str] = None,
    rag_corpus_counts: Optional[dict] = None,
    rag_passages: Optional[list] = None,
    channel: Optional[str] = None,
    tax_topic: Optional[str] = None,
    question_type: Optional[str] = None,
    handoff_reason: Optional[str] = None,
    latency_ms: Optional[int] = None,
) -> None:
    """챗 턴 한 줄 적재. **절대 예외를 올려보내지 않는다.**

    계측은 응답 경로에 얹힌 곁다리다 — DB 가 잠깐 흔들렸다고 사용자가 답을 못 받으면
    본말전도다(같은 이유로 rag_enabled 조회도 폴백을 둔다, retriever.rag_enabled).
    삼킨 실패는 로그에 남긴다: 조용히 0 줄이 쌓이면 "되묻기가 없었다"로 오독된다."""
    if not is_configured():
        return
    import json

    try:
        conn = _get_conn()
        with conn.cursor() as cur:
            cur.execute(
                "insert into rag.chat_turns (conversation_id, message_id, created_at, "
                "occupation, outcome, rag_requested, rag_source, rag_searched, rag_hits, "
                "follow_up, advisory, etype, rag_corpus_counts, rag_passages, "
                "channel, tax_topic, question_type, handoff_reason, latency_ms) values (%s, %s, "
                "(extract(epoch from now()) * 1000)::bigint, %s, %s, %s, %s, %s, %s, %s, %s, %s, "
                "%s::jsonb, %s::jsonb, %s, %s, %s, %s, %s)",
                (conversation_id, message_id, occupation, outcome, rag_requested,
                 rag_source, rag_searched, rag_hits, follow_up, advisory, etype,
                 # None 은 그대로 null 로 — "근거 0건"({})과 "검색 미도달"(null)을 가른다(0033).
                 None if rag_corpus_counts is None else json.dumps(rag_corpus_counts),
                 None if rag_passages is None else json.dumps(rag_passages),
                 # 0063 — 사용 현황 M2. meta 에 이미 실린 값(api/turn_record.fields)
                 channel, tax_topic, question_type, handoff_reason, latency_ms),
            )
    except Exception as exc:  # noqa: BLE001 — 계측 실패가 답변을 막지 않는다
        log.warning("record_chat_turn 적재 실패 (%s/%s): %s", outcome, message_id, exc)


def record_question(conversation_id: str, message_id: str, text_masked: str) -> None:
    """고객 챗 질문 원문 한 줄(0063 analytics.questions — 이미 가린 글, DB 트리거가 한 번 더 가린다). 예외를 올리지 않는다."""
    if not is_configured() or not text_masked:
        return
    try:
        conn = _get_conn()
        with conn.cursor() as cur:
            cur.execute(
                "insert into analytics.questions (conversation_id, message_id, text_masked) values (%s, %s, %s)",
                (conversation_id[:100], message_id[:160], text_masked[:500]),
            )
    except Exception as exc:  # noqa: BLE001 — 계측 실패가 답변을 막지 않는다
        log.warning("record_question 적재 실패 (%s): %s", message_id, exc)
