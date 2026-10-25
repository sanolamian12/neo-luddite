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
조부모 증여(세대생략)에 10년 합산이 겹치면 합산은 계산하지 않는다(시행령 §46의3 계산식이 DB 원문에 없음 — 문장으로 밝힌다).
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Optional

from calc.stock_transfer import RULES_2026, Section, gift_deduction, gift_tax

# 받는 사람이 주는 사람에게 누구인가(gift_extract.read_relation) → gift_tax 의 donor(받는 사람에게 주는 사람이 누구인가)·세대생략
DONOR = {"child": ("parent", False), "grandchild": ("grandchild", True), "parent": ("child", False),
         "spouse": ("spouse", False), "relative": ("relative", False), "unrelated": ("other", False)}
LINEAL_UP = ("parent", "grandchild")      # donor 가 직계존속(부모·조부모)

MISSING_HEAD = "증여세를 계산하려면"
MISSING_QUESTION = (MISSING_HEAD + " 증여받는(주시려는) 재산의 금액을 알려 주세요(현금이면 그 금액, 부동산·주식이면 시가). "
                    "주는 분과 받는 분의 관계, 받는 분의 나이(성년 여부), 10년 안에 같은 분에게서 받은 다른 증여도 함께 "
                    "알려 주시면 더 정확해집니다.")

INVITE_WORDS = {
    "relation": "주는 분과 받는 분의 관계",
    "minor": "받는 분의 나이(성년 여부)",
    "prior_gifts": "10년 안에 같은 분(부모님이면 두 분 모두)에게서 받은 다른 증여",
    "marriage": "혼인신고일(또는 자녀 출생일)과 이미 받은 혼인·출산 공제",
    "prior_tax": "앞선 증여 때 신고한 증여세",
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
    sum_skipped: bool = False              # 세대생략이라 10년 합산을 하지 않음
    assumed: list[str] = field(default_factory=list)

    @property
    def missing(self) -> bool:
        return self.value is None


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
    if 0 < prior < RULES_2026.gift_sum_min:          # 합산하지 않는 작은 앞선 증여 — 공제 한도는 그만큼 썼다고 본다
        f.prior_used = min(prior, gift_deduction(donor, minor, 0))
        f.prior_gifts = 0
    elif prior and skip:
        f.sum_skipped = True
        f.prior_used = min(prior, gift_deduction(donor, minor, 0))
        f.prior_gifts = 0
    elif prior and prior_tax is None:
        assumed.append("prior_tax")
    return f


def compute(f: GiftFilled) -> Section:
    return gift_tax(f.value, f.donor, f.minor, f.prior_used, f.skip, marriage=f.marriage,
                    prior_gifts=f.prior_gifts, prior_tax=f.prior_tax)


def missing_question(f: GiftFilled) -> str:
    return MISSING_QUESTION if f.missing else ""


def relevant_assumed(f: GiftFilled, sec: Section) -> list[str]:
    """가정한 것 중 이번 결과를 바꿀 수 있는 것만."""
    out = []
    for k in f.assumed:
        if k == "minor" and compute(replace(f, minor=True)).tax == sec.tax:
            continue                       # 미성년이어도 세액이 같다(S03 — 혼인 공제로 0 그대로)
        out.append(k)
    return out


def invite(f: GiftFilled, sec: Section) -> str:
    words = [INVITE_WORDS[k] for k in relevant_assumed(f, sec) if k in INVITE_WORDS]
    if not words:
        return ""
    return "·".join(words) + "처럼 세액을 바꾸는 정보를 알려주시면 반영해 다시 계산해 드리겠습니다."
