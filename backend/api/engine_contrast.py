"""
엔진 대조(M4) — 같은 사안을 규칙엔진에도 판정시켜 LLM2 판정과 맞는지 센다. 설계 design/W5_LLM2_답변단계_설계.md §5.

**답·화면에 영향 0.** 결과는 meta.llm2.engine 에만 싣는다. 판정 권위는 LLM2 이고(정본 §1), 엔진은
병의원 9개 유형에서 "정답을 아는 결정적 기준"으로만 남는다(§1-4) — 불일치율이 LLM2 판정 품질의 유일한
객관 지표다.

엔진이 판정하는 조건은 v1 판정 경로와 같다: 추출 → etype 정규화 → 9유형 안 · 필수값(etype·amount) 있음 →
결정변수 검증(날조 제거) → 남은 결정변수 부족 없음 → eng.evaluate. 하나라도 걸리면 대조하지 않는다.

실패는 전부 삼킨다(혼잡 포함) — 대조 때문에 답이 막히면 안 된다. 스위치 V2_ENGINE_CONTRAST=off.
"""

from __future__ import annotations

import logging
import os

log = logging.getLogger("api.engine_contrast")

# 엔진 Verdict 값 → LLM2 판정 어휘(llm2.VERDICTS)
_MAP = {"전부 인정": "인정", "안분 인정": "일부 인정", "부인": "부인", "조건부 (증빙 보완 시 인정)": "조건부"}


def enabled() -> bool:
    return os.environ.get("V2_ENGINE_CONTRAST", "on").strip().lower() not in ("0", "false", "no", "off")


def run(history: list, user_text: str) -> dict:
    """→ {"status": compared|out_of_scope|undecided|failed, ...}. llm2 판정과의 일치는 호출자가 채운다."""
    import clinic_expense_engine as eng

    from api import engine_adapter as adapter
    from api import llm

    try:
        extracted = llm.extract_engine_inputs(history, user_text, adapter.build_extraction_tool()) or {}
        if extracted:
            adapter.normalize_etype(extracted)
        etype = extracted.get("etype")
        if etype not in adapter.SUPPORTED_ETYPES:
            return {"status": "out_of_scope", "etype": etype}
        if adapter.missing_required(extracted):
            return {"status": "undecided", "etype": etype, "missing": adapter.missing_required(extracted)}
        filled = [k for k in adapter.DECISIVE_FIELDS if extracted.get(k) is not None]
        grounded = set(llm.verify_decisive(history, user_text, filled))
        for k in filled:
            if k not in grounded:
                extracted.pop(k, None)
        undecided = adapter.missing_decisive(extracted, profile_hint=extracted)
        if undecided:
            return {"status": "undecided", "etype": etype, "missing": undecided}
        profile, expense = adapter.to_engine_inputs(extracted)
        result = eng.evaluate(profile, expense)
        return {"status": "compared", "etype": etype, "engineVerdict": _MAP.get(result.verdict.value,
                                                                                result.verdict.value)}
    except Exception as exc:  # noqa: BLE001 — UpstageCongested 포함. 대조는 답을 막지 않는다
        log.warning("엔진 대조 실패: %s: %s", type(exc).__name__, exc)
        return {"status": "failed", "error": type(exc).__name__}
