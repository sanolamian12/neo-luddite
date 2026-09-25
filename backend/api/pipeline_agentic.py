"""
v2(LLM1 역할 축소) 파이프라인 — 골격. 설계 design/LLM1v2_역할축소_구현설계.md §3·§4.

    턴1  LLM1 추출(known/missing, 최대 3) → missing 있으면 ask(상위 2) · 없으면 proceed
    턴2  LLM1 닫힌 대조(물은 사실만) → stated=filled · 모르겠어요=D3 · 남으면 ask
    상한  D4 로직 — 되묻기 2턴 뒤 무조건 진행, 빈 사실은 proceed_with_gap

지금(단계 1)은 **v1 `pipeline.run_clinic` 으로 위임**만 한다. 응답이 어느 파이프라인을 탔는지는
`meta.pipeline` 으로 드러낸다(v1 응답에는 이 필드가 없다 — exclude_none).

격리 규칙(docs/doing/v2격리_원복설계.md §2): `pipeline.py`·`llm.py`·`handoff.py` 는 고치지 않는다.
공유 파일(`schema.py` 등)은 선택 필드 추가만.
"""

from __future__ import annotations

import logging
import os

from api import pipeline
from api.schema import ChatResponse, Message

log = logging.getLogger("api.pipeline_agentic")

PIPELINES = ("v1", "v2")


def selected(override: str | None) -> str:
    """이 요청이 탈 파이프라인. `?pipeline=` 이 env `CHAT_PIPELINE` 을 이긴다(`?rag=`·`RAG_ENABLED`
    와 같은 모양). 모르는 값은 v1 — 오타 하나로 v2 에 들어가지 않게."""
    raw = (override or os.environ.get("CHAT_PIPELINE") or "v1").strip().lower()
    if raw not in PIPELINES:
        log.warning("알 수 없는 pipeline 값 %r → v1", raw)
        return "v1"
    return raw


def run_clinic(conversation_id: str, history: list[Message], user_text: str,
               rag_override: bool | None = None, rag_source_override: str | None = None) -> ChatResponse:
    # TODO(단계 2·3): LLM1 추출 → ask/proceed/proceed_with_gap + D4 카운터. 그 전까지는 v1 위임.
    resp = pipeline.run_clinic(conversation_id, history, user_text,
                               rag_override=rag_override, rag_source_override=rag_source_override)
    resp.meta.pipeline = "v2"
    return resp
