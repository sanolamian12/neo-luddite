"""
주식 양도 슬롯 (E단계, 2026-10-19) — 무엇을 묻고 무엇을 가정하나. 결정론, LLM 호출 없음.

설계 §2-4(10/19 변경): 근로소득세와 같게 **가정을 밝히고 바로 계산 + 끝에 결과를 바꾸는 정보를 청하는 한 문장**.
먼저 묻기는 없다. 단 거래가·취득가처럼 없으면 계산 자체가 안 되는 값만 그것을 묻는다(근로소득세의 총급여).
시가는 특수관계인 거래일 때만 필수다(부당행위·§35 판정이 시가에 달림). 특수관계가 없으면 시가 = 거래가로 가정한다.

가정 기본값(사용자가 말하지 않음 → Filled.assumed):
  · market: 비상장 · 상장이라고만 하면 유가증권시장 · on_market: 상장 + 특수관계 없음 = 장내, 특수관계 = 장외 직거래
  · relation: 특수관계 없음 · buyer_minor: 성년 · prior_deduction_used: 10년 안의 다른 증여 없음
  · 보유기간은 계산기가 가정한다(result.assumed — 1년 이상 보유)

경우 나누기(설계 §2-4 10/20 변경 — 세무사 의견 → 사용자 결정): 대주주 여부(지분율·시가총액 모름)·회사 규모(중소기업 여부 모름)는
가정하지 않는다 → Filled.split 에 남기고 scenarios() 가 조합마다 계산한 뒤 양도소득세 결과가 같은 경우를 합친다(최대 3줄 —
두 값은 양도소득세 세율만 바꾸고 증권거래세·부당행위·§35 증여세는 공통). 금액만 바꾸는 값(특수관계·성년·10년 이력·보유기간·장내외)은
위처럼 가정을 밝히고 청한다.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from itertools import product
from typing import Optional

from calc import stock_transfer_view as view
from calc.stock_transfer import MARKETS, RELATIONS, SIZES, StockTransferInput, StockTransferResult, calculate
from calc.stock_transfer_view import Scenario

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
    "major": "지분율(본인과 특수관계인 합산, 직전 사업연도 말)",
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
    split: list[str] = field(default_factory=list)   # 경우를 나눌 값(SPLIT 키) — 모른다


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
    split = []
    size = ex.get("size")
    if size not in SIZES:
        size = "large"                       # 자리표시 — scenarios() 가 경우마다 바꾼다
        split.append("size")
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
    holding_value = _int(ex.get("holding_value"))
    if share is None and holding_value is None:
        split.insert(0, "major")
    inp = StockTransferInput(market_value=mv, price=price, acquisition=acq, market=market, on_market=on_market,
                             size=size, share_pct=share, holding_value=holding_value,
                             holding_months=months, relation=relation, buyer_minor=minor,
                             prior_deduction_used=prior)
    return Filled(inp, [], assumed, split)


# 경우를 나눌 값 → 후보(앞이 먼저 보인다). size 의 'large' = 중소기업 아님(중견 포함 — K-OTC 소액 중견 비과세는 말해야 반영).
SPLIT = {"major": (True, False), "size": ("sme", "large")}
MAX_CASES = 3


def _implicants(group: list[dict], dims: list[str]) -> list[dict]:
    """경우 묶음(조합 목록)을 가장 짧은 조건들의 '또는'으로 — 2값 차원 둘이라 전수로 충분하다."""
    members = {tuple(m[d] for d in dims) for m in group}
    cands = []
    for pick in product(*[(None,) + SPLIT[d] for d in dims]):
        cover = set(product(*[SPLIT[d] if v is None else (v,) for d, v in zip(dims, pick)]))
        if cover <= members:
            cands.append((pick, cover))
    prime = [(p, c) for p, c in cands if not any(c < c2 for _, c2 in cands)]
    prime.sort(key=lambda pc: -len(pc[1]))
    terms, left = [], set(members)
    for pick, cover in prime:
        if cover & left:
            terms.append({d: v for d, v in zip(dims, pick) if v is not None})
            left -= cover
    order = [tuple(m[d] for d in dims) for m in group]
    terms.sort(key=lambda t: min(i for i, k in enumerate(order) if all(k[dims.index(d)] == v for d, v in t.items())))
    return terms


def scenarios(f: Filled) -> list[Scenario]:
    """모르는 값(f.split)의 조합마다 계산 → 양도소득세(적용 여부·세액)가 같은 경우를 합친다. 모르는 값이 없으면 1개."""
    if f.inp is None:
        return []
    dims = [d for d in f.split if d in SPLIT]
    groups: dict[tuple, list[tuple[dict, StockTransferResult]]] = {}
    for combo in product(*[SPLIT[d] for d in dims]):
        m = dict(zip(dims, combo))
        r = calculate(replace(f.inp, **m))
        cg = r.section("capital_gains")
        groups.setdefault((cg.applies, cg.tax), []).append((m, r))
    out = [Scenario(_implicants([m for m, _ in g], dims) if dims else [{}], g[0][1]) for g in groups.values()]
    if len(out) > MAX_CASES:                 # 2값 차원 둘 = 최대 4 — 결과가 다 다르면 세금이 큰 쪽부터 3
        out = sorted(out, key=lambda s: -s.result.total)[:MAX_CASES]
    return out


def missing_question(f: Filled) -> str:
    """필수 값이 없을 때 한 문장으로 묻는다(질문 하나 — 되묻기 상한 안)."""
    words = [QUESTION[k] for k in ASK_ORDER if k in f.missing_required]
    if not words:
        return ""
    return ("주식 양도 세금을 계산하려면 " + ", ".join(words) + "을 알려 주세요. "
            "상장 여부·회사 규모·지분율·사는 사람과의 관계도 함께 알려 주시면 더 정확해집니다.")


def invite(f: Filled, result: StockTransferResult | list[Scenario]) -> str:
    """계산 답 끝 — 가정한 것 중 이번 결과를 바꾸는 정보만 모아 한 문장으로 청한다(근로소득세 INVITE 와 같은 꼴).
    경우를 나눴으면(scenarios 가 2개+) 나눈 값을 먼저 — '…를 알려주시면 한 가지로 계산해 드리고, …'."""
    scens = result if isinstance(result, list) else [Scenario([{}], result)]
    keys = view.relevant_assumed_cases(scens, f.assumed)
    words = list(dict.fromkeys(INVITE_WORDS[k] for k in keys if k in INVITE_WORDS))
    split = [INVITE_WORDS[d] for d in view.split_dims(scens)]
    if split:
        head = ("·".join(split) + ("을" if view.split_dims(scens)[-1] == "major" else "를")
                + " 알려주시면 한 가지로 계산해 드리겠습니다")
        if not words:
            return head + "."
        return head + ". " + "·".join(words) + "처럼 세액을 바꾸는 정보도 알려주시면 반영하겠습니다."
    if not words:
        return ""
    return "·".join(words) + "처럼 세액을 바꾸는 정보를 알려주시면 반영해 다시 계산해 드리겠습니다."
