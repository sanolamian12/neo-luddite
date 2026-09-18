"""
작문 결과의 날조 수치 사후 검출 (로드맵 P8 C, 2026-09-18).

판정형·자문 답변이 질문·엔진 판정·근거·규범 **어디에도 없는 수**를 쓴다. 대부분 법정 기준 수치다 —
접대비 한도를 64회 중 23회 말했는데 기본한도가 1,000만/1,200만/1천만/100만/300만원, 비례율이
0.1/0.2/10/20%로 회차마다 달랐다(서로 모순이라 최소 대부분은 틀림). 자문 경로는 규칙 2("수치를
지어내지 마세요")가 이미 있는데도 96회 중 10회(귀속연도·신고기한 등). 프롬프트 규칙만으론 solar-pro3 가
잘 안 따른다(P8 A) — 그래서 **출력에서 걸러낸다.**

판정: 답변 문장의 수치 토큰(금액·인원·비율·기간)을 (종류, 값)으로 정규화해 출처 집합과 대조한다.
  · 출처에 같은 값이 있으면 통과 — 금액은 원 단위로 환산("200만원" = "2,000,000원")
  · 출처 수로 종류를 지킨 산술이 되면 통과 — 인정·부인 금액 차, 금액×비율, 금액÷인원, 100−비율 등
  · 둘 다 아니면 **그 문장을 뺀다**. 하나라도 뺐으면 끝에 기준 수치는 세무사 확인이 필요하다는
    결정적 문장을 한 번 붙인다(한도를 말하던 자리가 비어 버리지 않게).
조문 번호(제N조·항·호)와 달력 날짜의 '일'(3월 31일의 31일)은 수치 토큰으로 안 본다.
문장 단위로 빼는 이유: 숫자만 지우면 "기본 한도( )와" 같은 깨진 문장이 남는다.

한계(측정 스크립트 docs/doing/P8B_측정자료_260918/c_fabricated_numbers.py 와 같은 규칙):
산술 통과가 우연히 맞는 틀린 수를 놓칠 수 있고(피연산자를 사용자·엔진 수로 좁혀 줄였다), 출처에 있는 수를
엉뚱한 자리에 쓴 것(혼입)은 이 가드의 대상이 아니다(P4·P7 지표).
"""

from __future__ import annotations

import logging
import re

log = logging.getLogger("api.numeric_guard")

UNSOURCED_NUMBER_NOTE = ("한도·세율·기한 같은 기준 수치는 사업자 유형·수입금액·과세연도에 따라 달라지므로, "
                         "적용 금액은 세무사 확인이 필요합니다.")

_UNIT = {"억": 10**8, "천만": 10**7, "백만": 10**6, "만": 10**4, "천": 10**3}
_AMOUNT = re.compile(r"(?:\d[\d,]*(?:\.\d+)?\s*(?:억|천만|백만|만|천)\s*)+(?:\d[\d,]*\s*)?원?"
                     r"|\d[\d,]*(?:\.\d+)?\s*원")
_PART = re.compile(r"(\d[\d,]*(?:\.\d+)?)\s*(억|천만|백만|만|천)?")
_COUNT = re.compile(r"(?<![\d,.])(\d+)\s*(명|인|곳|건|개소|대)")
_PCT = re.compile(r"(?<![\d,.])(\d+(?:\.\d+)?)\s*(%|퍼센트)")
_PERIOD = re.compile(r"(?<![\d,.])(?<!월\s)(?<!월)(\d+)\s*(년|개월|박|일|시간)")
_BARE = re.compile(r"(?<![\d,.])(\d{1,3}(?:,\d{3})+|\d{4,})(?![\d,])")   # "2,000,000 / ..." 같은 단위 없는 금액


def _won(s: str) -> float | None:
    total, any_unit = 0.0, False
    for num, unit in _PART.findall(s):
        v = float(num.replace(",", "") or 0)
        if unit:
            total += v * _UNIT[unit]
            any_unit = True
        else:
            total += v
    return total if (any_unit or "원" in s) else None


def _tokens(text: str) -> list[tuple[str, float]]:
    out, spans = [], []
    for m in _AMOUNT.finditer(text):
        v = _won(m.group(0))
        if v:
            out.append(("won", v))
            spans.append(m.span())
    for rx, kind in ((_COUNT, "count"), (_PCT, "pct"), (_PERIOD, "period")):
        for m in rx.finditer(text):
            if any(a <= m.start() < b for a, b in spans):
                continue
            out.append((kind if kind != "period" else f"period:{m.group(2)}", float(m.group(1))))
    return out


class _Sources:
    """known = 출처 전체의 수. 산술 피연산자(won·count·pct)는 **사용자·엔진의 수만** —
    근거(남의 사안)의 수로 계산이 맞아떨어지면 우연이다(실측: 틀린 "20명"이 근거 속 다른 병원의
    "1인당 10만원"으로 2,000,000÷100,000 이 돼 통과했다)."""

    def __init__(self, texts: list[str], derive_from: list[str]) -> None:
        self.known: set[tuple[str, float]] = set()
        self.won: set[float] = set()
        self.count: set[float] = set()
        self.pct: set[float] = set()
        for t in texts:
            self.known.update(self._values(t))
        for t in derive_from:
            for k, v in self._values(t):
                self.known.add((k, v))
                {"won": self.won, "count": self.count, "pct": self.pct}.get(k, set()).add(v)

    @staticmethod
    def _values(t: str) -> list[tuple[str, float]]:
        if not t:
            return []
        vals = _tokens(t)
        vals += [("won", float(m.group(1).replace(",", ""))) for m in _BARE.finditer(t)]
        return vals

    def derivable(self, kind: str, v: float) -> bool:
        eq = lambda a: abs(a - v) < 1e-6 * max(1.0, abs(v))  # noqa: E731
        W, C, P = self.won, self.count, self.pct
        if kind == "won":
            return (any(eq(a + b) or eq(a - b) for a in W for b in W if a != b)
                    or any(eq(a * p / 100) or eq(a * (100 - p) / 100) for a in W for p in P)
                    or any(eq(a / c) for a in W for c in C if c))
        if kind == "count":
            return (any(eq(a / b) for a in W for b in W if b and a > b)
                    or any(eq(a + b) or eq(a - b) for a in C for b in C))
        if kind == "pct":
            return any(eq(100 - p) for p in P) or any(eq(100 * a / b) for a in W for b in W if b and a < b)
        return False

    def unsourced(self, text: str) -> list[tuple[str, float]]:
        return [(k, v) for k, v in _tokens(text)
                if (k, v) not in self.known and not self.derivable(k, v)]


def drop_unsourced_numbers(raw: list[dict], sources: list[str], derive_from: list[str],
                           where: str = "") -> list[dict]:
    """출처 없는 수치가 든 세그먼트를 빼고, 뺐으면 확인 안내 한 문장을 붙인다.

    sources     그대로 인용해도 되는 수의 출처(질문·엔진·규범·근거 전부)
    derive_from 산술의 피연산자가 될 수 있는 수의 출처(사용자 발화·엔진 판정만)
    다 빠지면(그럴 일은 드물다) 원문을 그대로 돌려준다 — 빈 답변보다 낫고, 로그로 센다."""
    src = _Sources(sources, derive_from)
    kept, dropped = [], []
    for seg in raw:
        bad = src.unsourced(seg.get("text") or "")
        (dropped if bad else kept).append((seg, bad))
    if not dropped:
        return raw
    log.warning("출처 없는 수치 문장 제거 %d/%d (%s): %s", len(dropped), len(raw), where,
                [b for _, b in dropped])
    if not kept:
        return raw
    return [s for s, _ in kept] + [{"text": UNSOURCED_NUMBER_NOTE, "type": "caveat"}]
