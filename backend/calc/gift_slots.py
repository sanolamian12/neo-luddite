"""
일반 증여 슬롯 (E 확장, 2026-10-26) — 무엇을 묻고 무엇을 가정하나. 결정론, LLM 호출 없음.

설계 §2-4(주식과 같은 방식): **가정을 밝히고 바로 계산 + 끝에 결과를 바꾸는 정보를 청하는 한 문장**.
필수 = 증여재산가액 하나(없으면 그것만 묻는다 — 근로소득세의 총급여, 주식의 거래가와 같은 자리).

가정 기본값(사용자가 말하지 않음 → GiftFilled.assumed):
  · relation: 증여재산공제 대상 친족이 아님(공제 없음 — 결과가 가장 큰 쪽)
  · minor: 받는 사람은 성년(주식 갈래와 같은 기본값)
  · prior_gifts: 10년 안에 같은 분에게서 받은 다른 증여 없음
  · marriage 를 말했으면: 혼인신고일 전후 2년(출산이면 출생일부터 2년) 안에 받는 증여이고 혼인·출산 공제를 처음 받는다
  · 앞선 증여가 있는데 낸 세액을 모르면: 그때도 같은 공제를 받고 지금 세율로 산출했다고 본다(calc.stock_transfer.prior_gift_tax)
조부모 증여(세대생략)에 10년 합산이 겹치면 시행령 §46의3② 로 할증에서 종전 할증을 뺀다(10/26 밤 — 계산식 API 원문 복원).

부담부증여(10/26 밤 — 사용자 결정: 증여세 + 조건부 양도세):
  · 채무 금액을 말하면 증여세 과세가액에서 뺀다(§47①). 인수가 인정된다고 가정한다(§47③ — 배우자·직계존비속 간 추정 뒤집기).
  · 채무 낱말은 있는데 금액을 못 읽으면 채무 금액만 묻는다(필수 — 빼지 않고 계산하면 과대).
  · 증여자 양도세(calc.burden_transfer)는 증여자 취득가액이 있을 때만 계산. 1세대 1주택인지 모르면 비과세/과세 두 경우를 말하고,
    1세대 1주택 + 12억원 초과(고가주택)는 계산하지 않는다. 보유 연수를 모르면 2년 이상 3년 미만(장기보유 특별공제 없음)으로 본다.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Optional

from calc import burden_transfer as bt
from calc.stock_transfer import RULES_2026, Section, gift_deduction, gift_tax

# 받는 사람이 주는 사람에게 누구인가(gift_extract.read_relation) → gift_tax 의 donor(받는 사람에게 주는 사람이 누구인가)·세대생략
DONOR = {"child": ("parent", False), "grandchild": ("grandchild", True), "parent": ("child", False),
         "spouse": ("spouse", False), "relative": ("relative", False), "unrelated": ("other", False)}
LINEAL_UP = ("parent", "grandchild")      # donor 가 직계존속(부모·조부모)

MISSING_HEAD = "증여세를 계산하려면"
MISSING_QUESTION = (MISSING_HEAD + " 증여받는(주시려는) 재산의 금액을 알려 주세요(현금이면 그 금액, 부동산·주식이면 시가). "
                    "주는 분과 받는 분의 관계, 받는 분의 나이(성년 여부), 10년 안에 같은 분에게서 받은 다른 증여도 함께 "
                    "알려 주시면 더 정확해집니다.")
DEBT_QUESTION = (MISSING_HEAD + " 받는 분이 함께 넘겨받는 채무(전세보증금·대출 등)의 금액을 알려 주세요. 부담부증여는 그 채무를 "
                 "증여세에서 빼고, 채무 부분은 주는 분이 판 것으로 보아 양도소득세를 따로 계산합니다. 주는 분이 그 재산을 산 가격과 "
                 "시기도 함께 알려 주시면 양도소득세까지 계산해 드립니다.")

INVITE_WORDS = {
    "relation": "주는 분과 받는 분의 관계",
    "minor": "받는 분의 나이(성년 여부)",
    "prior_gifts": "10년 안에 같은 분(부모님이면 두 분 모두)에게서 받은 다른 증여",
    "marriage": "혼인신고일(또는 자녀 출생일)과 이미 받은 혼인·출산 공제",
    "prior_tax": "앞선 증여 때 신고한 증여세",
    "acquisition": "주는 분이 그 재산을 산 가격(취득가액)과 산 시기",
    "years": "주는 분이 그 재산을 산 시기(보유기간)",
    "one_house": "주는 분 세대가 가진 주택이 그 한 채뿐인지(1세대 1주택)",
}


@dataclass
class GiftFilled:
    value: Optional[int]                   # None = 필수 값이 없어 계산 못 함
    donor: str = "other"
    minor: bool = False
    skip: bool = False                     # 세대생략(조부모 → 손자녀)
    marriage: Optional[str] = None
    prior_gifts: int = 0
    prior_tax: Optional[int] = None
    prior_used: int = 0                    # 합산 문턱(1천만) 밑 앞선 증여가 이미 쓴 §53 공제
    assumed: list[str] = field(default_factory=list)
    # 부담부증여(10/26 밤)
    debt: int = 0
    debt_missing: bool = False             # 채무 낱말만 있고 금액이 없음 → 그것을 묻는다
    acquisition: Optional[int] = None      # 증여자 취득가액 — None 이면 양도세는 계산하지 않고 청한다
    years: Optional[int] = None
    house: bool = True
    one_house: Optional[bool] = None

    @property
    def missing(self) -> bool:
        return self.value is None or self.debt_missing


def _int(v) -> Optional[int]:
    if v is None or isinstance(v, bool):
        return None
    try:
        n = int(v)
    except (TypeError, ValueError):
        return None
    return n if n >= 0 else None


def fill(ex: dict) -> GiftFilled:
    """추출 값(calc.gift_extract.read_slots) + 기본값 → 계산 입력."""
    value = _int(ex.get("value"))
    if not value:
        return GiftFilled(None)
    assumed = []
    rel = ex.get("relation")
    if rel not in DONOR:
        rel = "unrelated"
        assumed.append("relation")
    donor, skip = DONOR[rel]
    minor = ex.get("minor")
    if not isinstance(minor, bool):
        minor = False
        if donor in LINEAL_UP:             # 미성년 공제(2천만)·세대생략 40% 는 직계존속에게서 받을 때만 갈린다
            assumed.append("minor")
    marriage = ex.get("marriage") if ex.get("marriage") in ("marriage", "birth") else None
    if marriage and donor in LINEAL_UP:
        assumed.append("marriage")
    prior = _int(ex.get("prior_gifts"))
    if prior is None:
        prior = 0
        assumed.append("prior_gifts")
    prior_tax = _int(ex.get("prior_tax"))
    f = GiftFilled(value, donor, minor, skip, marriage, prior, prior_tax, assumed=assumed)
    debt = _int(ex.get("debt"))
    if debt:
        f.debt = min(debt, value)
        f.acquisition = _int(ex.get("acquisition"))
        f.years = _int(ex.get("years"))
        f.house = ex.get("house") is not False
        f.one_house = ex.get("one_house") if isinstance(ex.get("one_house"), bool) else None
        assumed.append("debt_ok")
        if f.acquisition is None:
            assumed.append("acquisition")
        elif f.years is None:
            assumed.append("years")
        if f.house and f.one_house is None:
            assumed.append("one_house")
    elif ex.get("debt_said"):
        f.debt_missing = True
    if 0 < prior < RULES_2026.gift_sum_min:          # 합산하지 않는 작은 앞선 증여 — 공제 한도는 그만큼 썼다고 본다
        f.prior_used = min(prior, gift_deduction(donor, minor, 0))
        f.prior_gifts = 0
    elif prior and prior_tax is None:
        assumed.append("prior_tax")
    return f


def compute(f: GiftFilled) -> Section:
    return gift_tax(f.value, f.donor, f.minor, f.prior_used, f.skip, marriage=f.marriage,
                    prior_gifts=f.prior_gifts, prior_tax=f.prior_tax, debt=f.debt)


@dataclass
class Burden:
    """부담부증여의 증여자 몫. cg·lt = 과세 경우(1세대 1주택 아님)의 양도소득세·지방소득세 — 취득가액이 없거나 고가주택이면 None."""
    debt: int
    cg: Optional[Section] = None
    lt: Optional[Section] = None
    exempt_only: bool = False              # 1세대 1주택 · 12억원 이하 → 비과세 경우만
    exempt_case: bool = False              # 1세대 1주택인지 모름 · 주택 · 12억원 이하 → 비과세 경우도 말한다
    high_house: bool = False               # 1세대 1주택 · 12억원 초과 → 계산하지 않음
    no_acq: bool = False                   # 취득가액 없음 → 양도가액(= 채무)까지만
    whole_tax: int = 0                     # 채무 없이 전부 증여했을 때의 증여세(비교 한 줄)


def compute_burden(f: GiftFilled) -> Optional[Burden]:
    if not f.debt:
        return None
    b = Burden(f.debt, whole_tax=gift_tax(f.value, f.donor, f.minor, f.prior_used, f.skip, marriage=f.marriage,
                                          prior_gifts=f.prior_gifts, prior_tax=f.prior_tax).tax)
    high = f.house and f.value > bt.HIGH_PRICE
    if f.house and f.one_house is True and high:
        b.high_house = True
        return b
    if bt.exempt(f.value, f.house, f.one_house, f.years):
        b.exempt_only = True
        b.cg, b.lt = bt.burden_transfer(f.value, f.debt, f.acquisition or 0, f.years, f.house, True)
        return b
    b.exempt_case = f.house and f.one_house is None and not high and (f.years is None or f.years >= 2)
    if f.acquisition is None:
        b.no_acq = True
        return b
    b.cg, b.lt = bt.burden_transfer(f.value, f.debt, f.acquisition, f.years, f.house, False)
    return b


def missing_question(f: GiftFilled) -> str:
    if f.value is None:
        return MISSING_QUESTION
    return DEBT_QUESTION if f.debt_missing else ""


def relevant_assumed(f: GiftFilled, sec: Section) -> list[str]:
    """가정한 것 중 이번 결과를 바꿀 수 있는 것만."""
    out = []
    for k in f.assumed:
        if k == "minor" and compute(replace(f, minor=True)).tax == sec.tax:
            continue                       # 미성년이어도 세액이 같다(S03 — 혼인 공제로 0 그대로)
        if k == "one_house" and (f.value > bt.HIGH_PRICE or (f.years is not None and f.years < 2)):
            continue                       # 12억원 초과·2년 미만 보유면 1세대 1주택이어도 이 계산 범위에서 비과세 경우가 없다
        out.append(k)
    return out


def invite(f: GiftFilled, sec: Section) -> str:
    words = [INVITE_WORDS[k] for k in relevant_assumed(f, sec) if k in INVITE_WORDS]
    if not words:
        return ""
    return "·".join(words) + "처럼 세액을 바꾸는 정보를 알려주시면 반영해 다시 계산해 드리겠습니다."
