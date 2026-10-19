"""
주식 양도 슬롯 (E단계, 2026-10-19) — 무엇을 묻고 무엇을 가정하나. 결정론, LLM 호출 없음.

설계 §2-4(10/19 변경): 근로소득세와 같게 **가정을 밝히고 바로 계산 + 끝에 결과를 바꾸는 정보를 청하는 한 문장**.
먼저 묻기는 없다. 단 거래가·취득가처럼 없으면 계산 자체가 안 되는 값만 그것을 묻는다(근로소득세의 총급여).
시가는 특수관계인 거래일 때만 필수다(부당행위·§35 판정이 시가에 달림). 특수관계가 없으면 시가 = 거래가로 가정한다.

가정 기본값(사용자가 말하지 않음 → Filled.assumed):
  · market: 비상장 · 상장이라고만 하면 유가증권시장 · on_market: 상장 + 특수관계 없음 = 장내, 특수관계 = 장외 직거래
  · size: 중소기업 아님(세금이 더 나오는 쪽 — 소액주주 20%) · relation: 특수관계 없음
  · buyer_minor: 성년 · prior_deduction_used: 10년 안의 다른 증여 없음
  · 지분율(대주주)·보유기간은 계산기가 가정한다(result.assumed — 대주주 아님 · 1년 이상 보유)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from calc import stock_transfer_view as view
from calc.stock_transfer import MARKETS, RELATIONS, SIZES, StockTransferInput, StockTransferResult

QUESTION = {
    "price": "실제로 주고받는(받기로 한) 거래 금액",
    "acquisition": "그 주식을 처음 취득한 금액(취득가)",
    "market_value": "양도일 무렵 그 주식의 시가(평가액)",
}
ASK_ORDER = ("price", "acquisition", "market_value")

# 결과를 바꾸는 정보 → 청하기 문장에 넣을 말(가정했고 이번 결과에 영향이 있는 것만, assumed_keys 순서대로).
INVITE_WORDS = {
    "market": "상장 여부(시장)",
    "on_market": "증권시장(장내)에서 파는지 여부",
    "size": "회사 규모(중소기업 여부)",
    "major": "보유 지분율",
    "holding_months": "보유기간",
    "relation": "사는 사람과의 관계",
    "buyer_minor": "증여받는 사람의 나이(성년 여부)",
    "prior_deduction_used": "10년 안에 같은 쪽에게서 받은 다른 증여",
    "market_value": "시가(평가액)",
}


@dataclass
class Filled:
    inp: Optional[StockTransferInput]       # None = 필수 값이 없어 계산 못 함
    missing_required: list[str]
    assumed: list[str] = field(default_factory=list)


def _int(v) -> Optional[int]:
    if v is None or isinstance(v, bool):
        return None
    try:
        n = int(v)
    except (TypeError, ValueError):
        return None
    return n if n >= 0 else None


def fill(ex: dict) -> Filled:
    """추출 값(calc.stock_transfer_extract.read_slots) + 기본값 → 계산 입력."""
    price, acq, mv = _int(ex.get("price")), _int(ex.get("acquisition")), _int(ex.get("market_value"))
    relation = ex.get("relation") if ex.get("relation") in RELATIONS else None
    related = relation not in (None, "unrelated")
    missing = [k for k, v in (("price", price), ("acquisition", acq)) if v is None]
    if related and mv is None:
        missing.append("market_value")
    if missing:
        return Filled(None, missing)

    assumed = []
    if mv is None:
        mv = price
        assumed.append("market_value")
    market = ex.get("market")
    if market not in MARKETS:
        if market == "listed":
            market = "kospi"
            assumed.append("market")
        else:
            if market != "unlisted":
                assumed.append("market")
            market = None
    on_market = ex.get("on_market")
    if not isinstance(on_market, bool):
        on_market = market in ("kospi", "kosdaq", "konex") and not related
        if market in ("kospi", "kosdaq", "konex"):
            assumed.append("on_market")
    size = ex.get("size")
    if size not in SIZES:
        size = "large"
        assumed.append("size")
    if relation is None:
        relation = "unrelated"
        assumed.append("relation")
    minor = ex.get("buyer_minor")
    if not isinstance(minor, bool):
        minor = False
        assumed.append("buyer_minor")
    prior = _int(ex.get("prior_deduction_used"))
    if prior is None:
        prior = 0
        assumed.append("prior_deduction_used")
    share = ex.get("share_pct")
    share = float(share) if isinstance(share, (int, float)) and not isinstance(share, bool) and share >= 0 else None
    months = _int(ex.get("holding_months"))
    inp = StockTransferInput(market_value=mv, price=price, acquisition=acq, market=market, on_market=on_market,
                             size=size, share_pct=share, holding_value=_int(ex.get("holding_value")),
                             holding_months=months, relation=relation, buyer_minor=minor,
                             prior_deduction_used=prior)
    return Filled(inp, [], assumed)


def missing_question(f: Filled) -> str:
    """필수 값이 없을 때 한 문장으로 묻는다(질문 하나 — 되묻기 상한 안)."""
    words = [QUESTION[k] for k in ASK_ORDER if k in f.missing_required]
    if not words:
        return ""
    return ("주식 양도 세금을 계산하려면 " + ", ".join(words) + "을 알려 주세요. "
            "상장 여부·회사 규모·지분율·사는 사람과의 관계도 함께 알려 주시면 더 정확해집니다.")


def invite(f: Filled, result: StockTransferResult) -> str:
    """계산 답 끝 — 가정한 것 중 이번 결과를 바꾸는 정보만 모아 한 문장으로 청한다(근로소득세 INVITE 와 같은 꼴)."""
    keys = view.relevant_assumed(result, f.assumed)
    words = list(dict.fromkeys(INVITE_WORDS[k] for k in keys if k in INVITE_WORDS))
    if not words:
        return ""
    return "·".join(words) + "처럼 세액을 바꾸는 정보를 알려주시면 반영해 다시 계산해 드리겠습니다."
