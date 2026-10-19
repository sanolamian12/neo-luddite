"""
주식 양도 복합 사안 계산(E단계 1차, 2026-10-19) — 설계 `design/E단계_주식양도_복합사안_설계_1014.md` §2-1. 순수 함수, LLM 호출 없음.

한 번의 주식 양도(양도자 → 양수자)에서 생기는 세금을 세목·납세자별로 낸다.
  ① 대주주 판정(소득세법 시행령 §157·§167의8) → 양도소득세 과세 대상(§94①3호)
  ② 양도 부당행위(소득세법 §101, 시행령 §167③④⑦) → 양도가액 = 시가 의제
  ③ 증권거래세(증권거래세법 §7·§8, 시행령 §5) — 저가 양도가 인정되면 과세표준 = 시가액(§7①2호가목1)
  ④ 양도소득세(소득세법 §97·§103·§104①11호) + 개인지방소득세(지방세법 §103의3①11호 — 국세 세율의 1/10)
     필요경비 = 취득가액 + 그 밖 경비 + 증권거래세(시행령 §163⑤1호가목)
  ⑤ 저가 양수·고가 양도 증여(상증법 §35, 시행령 §26②③④) → 증여세(§53 공제·§55② 과세최저한·§56→§26 세율·
     §57 세대생략 할증·§69② 신고세액공제 3%)
  ⑥ 일반 증여세 — 증여재산가액만 넣어도 쓴다(gift_tax)

상수는 전부 로컬 laws.articles 현행 원문에서 읽어 옮겼다(10/19 재대조). 부록 B 와 다른 점: 상장 탄력세율은 현행 시행령 §5 가
유가증권 1만분의 5 · 코넥스 1만분의 10 · 코스닥·K-OTC 1만분의 20 이다(부록 B 의 '영·15' 는 옛 값).
계산하지 않는 것(문장으로만): 비상장 보충적 평가(상증법 §63·시행령 §54 — 시가는 입력값) · 최대주주 할증(§63③) ·
농어촌특별세(법령 DB 밖) · 10년 내 다른 증여 합산(이미 공제받은 금액만 입력으로 받는다) · 같은 해 다른 양도와의 기본공제 합산.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field, replace
from typing import Optional

MAN = 10_000
EOK = 100_000_000

ITL = "소득세법"
ITD = "소득세법 시행령"
LTL = "지방세법"
GTL = "상속세 및 증여세법"
GTD = "상속세 및 증여세법 시행령"
STL = "증권거래세법"
STD = "증권거래세법 시행령"

MARKETS = ("kospi", "kosdaq", "konex", "kotc")   # kotc = K-OTC(한국금융투자협회 장외매매, 비상장)
SIZES = ("sme", "mid", "large")                  # 중소기업 · 중견기업 · 그 밖
RELATIONS = ("spouse", "parent", "child", "grandchild", "relative", "other_related", "unrelated")


@dataclass(frozen=True)
class Rules:
    version: str
    # 대주주 — 상장(시행령 §157①1호·②): 시장별 (지분율 %, 시가총액) · 비상장(§167의8①2호)
    major_listed: dict
    major_unlisted: tuple            # (지분율 %, 시가총액, K-OTC 벤처 시가총액)
    # 부당행위(시행령 §167③ 단서): 차액 기준
    unfair_gap: int
    unfair_gap_rate: tuple
    # 증권거래세(법 §8① · 시행령 §5)
    stt_base_rate: tuple
    stt_market_rate: dict
    # 양도소득 기본공제(법 §103①2호)
    basic_deduction: int
    # 주식 양도세율(법 §104①11호)
    major_short_rate: tuple          # 대주주 · 1년 미만 · 중소기업 외
    major_brackets: tuple            # (상한, 누진 기본세액, 세율, 하한)
    minor_sme_rate: tuple            # 대주주 아닌 자 · 중소기업
    minor_other_rate: tuple
    local_ratio: tuple               # 지방세법 §103의3①11호 — 1천분의 = 국세 세율의 1/10
    # 증여(상증법 시행령 §26② · ③ · ④)
    gift_related_rate: tuple
    gift_related_cap: int
    gift_unrelated_rate: tuple
    gift_unrelated_deduct: int
    # 증여재산공제(§53)
    gift_deduction: dict
    gift_deduction_minor_parent: int
    gift_min_base: int               # §55② 과세최저한
    gift_brackets: tuple             # §26 (§56 준용)
    gen_skip_rate: tuple             # §57① 30%
    gen_skip_minor_big_rate: tuple   # §57① 40% (미성년 + 증여재산가액 20억 초과)
    gen_skip_big: int
    filing_credit_rate: tuple        # §69② 3%


RULES_2026 = Rules(
    version="2026",
    major_listed={"kospi": (1, 50 * EOK), "kosdaq": (2, 50 * EOK), "konex": (4, 50 * EOK)},
    major_unlisted=(4, 10 * EOK, 40 * EOK),
    unfair_gap=3 * EOK,
    unfair_gap_rate=(5, 100),
    stt_base_rate=(35, 10_000),
    stt_market_rate={"kospi": (5, 10_000), "konex": (10, 10_000), "kosdaq": (20, 10_000), "kotc": (20, 10_000)},
    basic_deduction=250 * MAN,
    major_short_rate=(30, 100),
    major_brackets=((3 * EOK, 0, (20, 100), 0), (None, 6_000 * MAN, (25, 100), 3 * EOK)),
    minor_sme_rate=(10, 100),
    minor_other_rate=(20, 100),
    local_ratio=(1, 10),
    gift_related_rate=(30, 100),
    gift_related_cap=3 * EOK,
    gift_unrelated_rate=(30, 100),
    gift_unrelated_deduct=3 * EOK,
    gift_deduction={"spouse": 6 * EOK, "parent": 5_000 * MAN, "child": 5_000 * MAN, "grandchild": 5_000 * MAN,
                    "relative": 1_000 * MAN},
    gift_deduction_minor_parent=2_000 * MAN,
    gift_min_base=50 * MAN,
    gift_brackets=(
        (1 * EOK, 0, (10, 100), 0),
        (5 * EOK, 1_000 * MAN, (20, 100), 1 * EOK),
        (10 * EOK, 9_000 * MAN, (30, 100), 5 * EOK),
        (30 * EOK, 24_000 * MAN, (40, 100), 10 * EOK),
        (None, 104_000 * MAN, (50, 100), 30 * EOK),
    ),
    gen_skip_rate=(30, 100),
    gen_skip_minor_big_rate=(40, 100),
    gen_skip_big=20 * EOK,
    filing_credit_rate=(3, 100),
)


@dataclass(frozen=True)
class StockTransferInput:
    """금액 = 원. relation = 양수자가 양도자에게 누구인가가 아니라 **증여 방향의 증여자 → 수증자 관계**를
    단순화해 '양수자 기준 양도자'로 받는다: child = 양수자가 양도자의 자녀(부모 → 자녀 양도)."""

    market_value: int                      # 시가(평가액) — 계산하지 않고 입력(상증법 §60~§66 평가는 세무사 확인)
    price: int                             # 실제 거래가(대가)
    acquisition: int                       # 취득가액(실지거래가액)
    market: Optional[str] = None           # None = 비상장 · MARKETS
    on_market: bool = False                # 증권시장(거래소)에서 거래 — 특수관계 직거래는 보통 장외
    size: str = "sme"
    share_pct: Optional[float] = None      # 양도자(+기타주주) 지분율 % — 직전 사업연도 말
    holding_value: Optional[int] = None    # 양도자(+기타주주) 보유 주식 시가총액
    venture_kotc: bool = False
    holding_months: Optional[int] = None   # None = 1년 이상으로 본다(가정)
    expenses: int = 0                      # 증권거래세 외 양도비용(시행령 §163⑤)
    relation: str = "unrelated"
    buyer_minor: bool = False              # 수증자(이익을 얻은 자)가 미성년
    prior_deduction_used: int = 0          # 수증자가 같은 공제 묶음으로 10년 안에 이미 공제받은 금액
    justified: bool = False                # 비특수관계 — 거래 관행상 정당한 사유(§35②)


@dataclass(frozen=True)
class Step:
    key: str
    label: str
    amount: int
    basis: tuple = ()          # ((법령, 조), ...)
    note: str = ""


@dataclass
class Section:
    key: str                   # securities_tax | capital_gains | local_tax | gift_tax
    title: str
    taxpayer: str              # 양도자 | 양수자
    applies: bool
    tax: int
    steps: list[Step] = field(default_factory=list)
    reason: str = ""           # 적용·비적용 판정 한 줄
    basis: tuple = ()


@dataclass
class StockTransferResult:
    inp: StockTransferInput
    rules_version: str
    major: bool
    major_reason: str
    unfair: bool
    transfer_value: int        # 양도가액(부당행위면 시가)
    sections: list[Section]
    assumed: list[str]

    @property
    def total(self) -> int:
        return sum(s.tax for s in self.sections if s.applies)

    def section(self, key: str) -> Section:
        return next(s for s in self.sections if s.key == key)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["total"] = self.total
        return d


def _mul(amount: int, rate: tuple) -> int:
    return amount * rate[0] // rate[1]


def _bracket(x: int, table: tuple) -> int:
    for hi, base, rate, lo in table:
        if hi is None or x <= hi:
            return base + _mul(x - lo, rate)
    raise AssertionError


def _pct(rate: tuple) -> str:
    n, d = rate
    return f"{n * 100 / d:g}%"


RELATED = ("spouse", "parent", "child", "grandchild", "relative", "other_related")


# ── ① 대주주 ─────────────────────────────────────────────────────────────────

def major_shareholder(inp: StockTransferInput, r: Rules = RULES_2026) -> tuple[bool, str, tuple]:
    pct, val = inp.share_pct, inp.holding_value
    if inp.market in r.major_listed:
        p, v = r.major_listed[inp.market]
        basis = ((ITD, "157"),)
        yes = (pct is not None and pct >= p) or (val is not None and val >= v)
        rule = f"지분 {p}% 이상 또는 시가총액 {v // EOK}억원 이상"
    else:
        p, v, vk = r.major_unlisted
        v = vk if inp.venture_kotc else v
        basis = ((ITD, "167의8"),)
        yes = (pct is not None and pct >= p) or (val is not None and val >= v)
        rule = f"지분 {p}% 이상 또는 시가총액 {v // EOK}억원 이상"
    if pct is None and val is None:
        return False, f"지분율·보유 시가총액을 몰라 대주주가 아닌 것으로 봤습니다(대주주 기준: {rule})", basis
    return yes, f"대주주{'' if yes else '가 아님'}({rule} — 직전 사업연도 말 기준)", basis


def taxable_transfer(inp: StockTransferInput, major: bool) -> tuple[bool, str]:
    """양도소득세 과세 대상(소득세법 §94①3호)."""
    if inp.market in ("kospi", "kosdaq", "konex"):
        if major:
            return True, "상장주식 대주주 양도는 과세 대상"
        if inp.on_market:
            return False, "상장주식 소액주주가 증권시장에서 양도하면 양도소득세 과세 대상이 아닙니다"
        return True, "상장주식이라도 소액주주가 증권시장 밖(장외)에서 양도하면 과세 대상"
    if inp.market == "kotc" and not major and inp.size in ("sme", "mid"):
        return False, "대주주가 아닌 자가 K-OTC 에서 양도하는 중소·중견기업 주식은 과세 대상이 아닙니다"
    return True, "비상장주식 양도는 과세 대상"


# ── ② 부당행위 ───────────────────────────────────────────────────────────────

def unfair_transfer(inp: StockTransferInput, r: Rules = RULES_2026) -> tuple[bool, str]:
    if inp.relation not in RELATED or inp.price >= inp.market_value:
        return False, ""
    gap = inp.market_value - inp.price
    if inp.market in ("kospi", "kosdaq", "konex"):
        # 시행령 §167⑦ — 상장주식은 차액 기준(③ 단서)을 적용하지 않는다
        return True, f"특수관계인에게 시가보다 {gap:,}원 낮게 양도(상장주식은 차액 기준 없이 적용)"
    floor = min(r.unfair_gap, _mul(inp.market_value, r.unfair_gap_rate))
    if gap >= floor:
        return True, (f"특수관계인에게 시가보다 {gap:,}원 낮게 양도 — 차액이 3억원 또는 시가의 5%({_mul(inp.market_value, r.unfair_gap_rate):,}원) "
                      "이상이라 양도가액을 시가로 봅니다")
    return False, f"차액 {gap:,}원이 3억원·시가의 5% 에 못 미쳐 부당행위계산 대상이 아닙니다"


# ── ③ 증권거래세 ─────────────────────────────────────────────────────────────

def securities_tax(inp: StockTransferInput, unfair: bool, gift_low: bool, r: Rules = RULES_2026) -> Section:
    low_deemed = (unfair or gift_low) and inp.price < inp.market_value
    base = inp.market_value if low_deemed else inp.price
    if inp.on_market and inp.market in r.stt_market_rate or inp.market == "kotc":
        rate = r.stt_market_rate[inp.market]
        basis = ((STL, "8"), (STD, "5"))
        where = {"kospi": "유가증권시장", "kosdaq": "코스닥시장", "konex": "코넥스시장", "kotc": "K-OTC"}[inp.market]
        rate_note = f"{where} 탄력세율 1만분의 {rate[0] * 10_000 // rate[1]}"
        payer = "양도자(증권회사·예탁결제원이 거래 때 징수)"
    else:
        rate = r.stt_base_rate
        basis = ((STL, "8"),)
        rate_note = "1만분의 35"
        payer = "양도자"
    tax = _mul(base, rate)
    steps = [Step("stt_base", "과세표준", base, ((STL, "7"),),
                  "저가 양도가 인정되어 시가액" if low_deemed else "양도가액"),
             Step("stt", "증권거래세", tax, basis, rate_note)]
    return Section("securities_tax", "증권거래세", payer, True, tax, steps,
                   f"주식 양도에는 증권거래세가 붙습니다({rate_note})", basis + ((STL, "7"), (STL, "3")))


# ── ④ 양도소득세 ─────────────────────────────────────────────────────────────

def capital_gains(inp: StockTransferInput, major: bool, unfair: bool, stt: int,
                  r: Rules = RULES_2026) -> tuple[Section, Section]:
    taxable, why = taxable_transfer(inp, major)
    if not taxable:
        none = Section("capital_gains", "양도소득세", "양도자", False, 0, [], why, ((ITL, "94"),))
        return none, Section("local_tax", "개인지방소득세(양도소득분)", "양도자", False, 0, [], why, ((LTL, "103의3"),))
    value = inp.market_value if unfair else inp.price
    expense = inp.acquisition + inp.expenses + stt
    gain = max(value - expense, 0)
    base = max(gain - r.basic_deduction, 0)
    short = inp.holding_months is not None and inp.holding_months < 12
    if major and short and inp.size != "sme":
        tax, rate_note = _mul(base, r.major_short_rate), "대주주 1년 미만 보유·중소기업 외 30%"
    elif major:
        tax, rate_note = _bracket(base, r.major_brackets), "대주주 — 3억원 이하 20%, 초과분 25%"
    elif inp.size == "sme":
        tax, rate_note = _mul(base, r.minor_sme_rate), "대주주 아닌 자 · 중소기업 10%"
    else:
        tax, rate_note = _mul(base, r.minor_other_rate), "대주주 아닌 자 · 중소기업 외 20%"
    steps = [
        Step("transfer_value", "양도가액", value, ((ITL, "101"), (ITD, "167")) if unfair else ((ITL, "96"),),
             "부당행위계산 — 시가" if unfair else "실제 거래가"),
        Step("expenses", "필요경비", expense, ((ITL, "97"), (ITD, "163")),
             f"취득가액 {inp.acquisition:,}원 + 증권거래세 {stt:,}원" + (f" + 양도비용 {inp.expenses:,}원" if inp.expenses else "")),
        Step("gain", "양도차익", gain, ((ITL, "95"),)),
        Step("basic_deduction", "양도소득 기본공제", min(r.basic_deduction, gain), ((ITL, "103"),), "연 250만원"),
        Step("tax_base", "과세표준", base, ((ITL, "92"),)),
        Step("cg_tax", "양도소득세", tax, ((ITL, "104"),), rate_note),
    ]
    local = _mul(tax, r.local_ratio)
    cg = Section("capital_gains", "양도소득세", "양도자", True, tax, steps, why + f" · {rate_note}",
                 ((ITL, "94"), (ITL, "104"), (ITL, "105")))
    lt = Section("local_tax", "개인지방소득세(양도소득분)", "양도자", True, local,
                 [Step("local_tax", "개인지방소득세", local, ((LTL, "103의3"),), "양도소득세 세율의 10분의 1")],
                 "양도소득세와 함께 국세 세율의 10분의 1", ((LTL, "103의3"),))
    return cg, lt


# ── ⑤·⑥ 증여세 ──────────────────────────────────────────────────────────────

def gift_value_35(inp: StockTransferInput, r: Rules = RULES_2026) -> tuple[int, str, str]:
    """(증여재산가액, 이익을 얻은 자, 판정 한 줄). 상장주식 장내 거래는 §35 대상 재산이 아니다(시행령 §26①2호)."""
    gap = abs(inp.market_value - inp.price)
    if gap == 0:
        return 0, "", ""
    if inp.market in ("kospi", "kosdaq", "konex") and inp.on_market:
        return 0, "", "증권시장에서 거래된 상장주식은 저가 양수·고가 양도 증여 대상이 아닙니다"
    who = "양수자" if inp.price < inp.market_value else "양도자"
    if inp.relation in RELATED:
        threshold = min(_mul(inp.market_value, r.gift_related_rate), r.gift_related_cap)
        if gap < threshold:
            return 0, who, f"차액 {gap:,}원이 기준금액(시가 30%와 3억원 중 적은 {threshold:,}원)에 못 미칩니다"
        return gap - threshold, who, (f"특수관계인 간 {'저가 양수' if who == '양수자' else '고가 양도'} — 차액 {gap:,}원에서 "
                                      f"기준금액 {threshold:,}원(시가 30%와 3억원 중 적은 것)을 뺀 금액이 {who}의 증여재산가액입니다")
    if inp.justified:
        return 0, who, "특수관계가 없고 거래 관행상 정당한 사유가 있으면 증여로 보지 않습니다"
    threshold = _mul(inp.market_value, r.gift_unrelated_rate)
    if gap < threshold:
        return 0, who, f"특수관계가 없고 차액이 시가의 30%({threshold:,}원)에 못 미칩니다"
    return max(gap - r.gift_unrelated_deduct, 0), who, (f"특수관계 없는 자 간 현저한 저가·고가 거래 — 차액 {gap:,}원에서 "
                                                        f"3억원을 뺀 금액이 {who}의 증여재산가액입니다(정당한 사유가 없을 때)")


def gift_deduction(relation: str, minor: bool, prior_used: int = 0, r: Rules = RULES_2026) -> int:
    """증여재산공제(§53) — relation 은 **수증자에게 증여자가 누구인가**: parent = 직계존속에게서 받음."""
    cap = r.gift_deduction.get(relation, 0)
    if relation == "parent" and minor:
        cap = r.gift_deduction_minor_parent
    return max(cap - prior_used, 0)


def gift_tax(value: int, donor: str, minor: bool = False, prior_used: int = 0, generation_skip: bool = False,
             r: Rules = RULES_2026) -> Section:
    """일반 증여세 — donor = 수증자에게 증여자가 누구인가(spouse·parent·child·relative·other)."""
    deduction = min(gift_deduction(donor, minor, prior_used, r), value)
    base = value - deduction
    steps = [Step("gift_value", "증여재산가액", value, ((GTL, "31"),)),
             Step("gift_deduction", "증여재산공제", deduction, ((GTL, "53"),), _deduction_note(donor, minor, prior_used))]
    if base < r.gift_min_base:
        steps.append(Step("gift_base", "과세표준", base, ((GTL, "55"),), "50만원 미만이라 부과하지 않음"))
        return Section("gift_tax", "증여세", "수증자", False, 0, steps,
                       "과세표준이 50만원 미만이라 증여세가 없습니다", ((GTL, "55"),))
    computed = _bracket(base, r.gift_brackets)
    steps += [Step("gift_base", "과세표준", base, ((GTL, "55"),)),
              Step("gift_computed", "산출세액", computed, ((GTL, "56"), (GTL, "26")), "상속세 세율 준용")]
    surcharge = 0
    if generation_skip:
        rate = r.gen_skip_minor_big_rate if (minor and value > r.gen_skip_big) else r.gen_skip_rate
        surcharge = _mul(computed, rate)
        steps.append(Step("gen_skip", "세대생략 할증", surcharge, ((GTL, "57"),), f"산출세액의 {_pct(rate)}"))
    credit = _mul(computed + surcharge, r.filing_credit_rate)
    tax = computed + surcharge - credit
    steps += [Step("filing_credit", "신고세액공제", credit, ((GTL, "69"),), "기한 내 신고 시 3%"),
              Step("gift_tax", "납부할 증여세", tax, ((GTL, "56"),))]
    return Section("gift_tax", "증여세", "수증자", True, tax, steps, "",
                   ((GTL, "53"), (GTL, "56"), (GTL, "26"), (GTL, "68"), (GTL, "69")))


def _deduction_note(donor: str, minor: bool, prior_used: int) -> str:
    who = {"spouse": "배우자", "parent": "직계존속", "child": "직계비속", "grandchild": "직계존속(조부모)",
           "relative": "4촌 이내 혈족·3촌 이내 인척"}.get(donor)
    if who is None:
        return "증여재산공제 대상 관계가 아님"
    s = f"{who}에게서 받은 증여" + (" · 미성년" if minor and donor in ("parent", "grandchild") else "")
    return s + (f" · 10년 안에 이미 공제받은 {prior_used:,}원 차감" if prior_used else "") + " (10년 합산 한도)"


# 양도 거래에서 '양수자 기준 양도자가 누구인가'(relation) → 증여세 수증자 기준 증여자
def _donor_of(relation: str, gainer: str) -> tuple[str, bool]:
    """(수증자에게 증여자가 누구인가, 세대생략 여부). gainer = 이익을 얻은 자(양수자/양도자)."""
    if gainer == "양수자":   # 양도자 → 양수자에게 이익 — relation 은 양수자가 양도자의 child 등
        donor = {"child": "parent", "grandchild": "grandchild", "parent": "child", "spouse": "spouse",
                 "relative": "relative"}.get(relation, "other")
        return donor, relation == "grandchild"
    donor = {"child": "child", "grandchild": "child", "parent": "parent", "spouse": "spouse",
             "relative": "relative"}.get(relation, "other")
    return donor, False


def calculate(inp: StockTransferInput, r: Rules = RULES_2026) -> StockTransferResult:
    if inp.market is not None and inp.market not in MARKETS:
        raise ValueError(f"market: {inp.market}")
    assumed = []
    if inp.holding_months is None:
        assumed.append("holding_months")
    if inp.share_pct is None and inp.holding_value is None:
        assumed.append("major")
    major, major_reason, _ = major_shareholder(inp, r)
    unfair, unfair_reason = unfair_transfer(inp, r)
    gift_val, gainer, gift_reason = gift_value_35(inp, r)

    stt = securities_tax(inp, unfair, gift_val > 0 and gainer == "양수자", r)
    cg, lt = capital_gains(inp, major, unfair, stt.tax, r)
    if unfair_reason:
        cg.reason = unfair_reason + " · " + cg.reason if cg.applies else cg.reason
    sections = [cg, lt, stt]
    if gift_val > 0:
        donor, skip = _donor_of(inp.relation, gainer)
        minor = inp.buyer_minor if gainer == "양수자" else False
        g = gift_tax(gift_val, donor, minor, inp.prior_deduction_used, skip, r)
        g.taxpayer, g.reason = gainer, gift_reason
        g.basis = ((GTL, "35"), (GTD, "26")) + g.basis
        g.steps[0] = replace(g.steps[0], basis=((GTL, "35"), (GTD, "26")))   # 증여재산가액 = §35 이익
        g.steps.insert(0, Step("gift_gap", "시가와 대가의 차액", abs(inp.market_value - inp.price), ((GTL, "35"),)))
        sections.append(g)
    elif gift_reason:
        sections.append(Section("gift_tax", "증여세", gainer or "양수자", False, 0, [], gift_reason, ((GTL, "35"),)))
    return StockTransferResult(inp, r.version, major, major_reason, unfair,
                               inp.market_value if unfair else inp.price, sections, assumed)
