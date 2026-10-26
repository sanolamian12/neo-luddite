"""
부담부증여의 양도 부분 — 증여자가 내는 양도소득세(E 확장, 2026-10-26 밤). 결정론, LLM 호출 없음.

소득세법 §88①1 후단: 부담부증여 때 수증자가 인수한 채무액 부분은 양도로 본다(증여자 = 양도자).
시행령 §159① 계산식(API 원문 복원 10/26 — laws.articles):
  양도가액 = 평가액(상증법 §60~§66) × 채무액 ÷ 증여가액 · 취득가액 = 취득가액(§97①1) × 채무액 ÷ 증여가액
  — 증여가액을 말씀하신 시가로 쓰므로 양도가액 = 채무액.
그 뒤는 일반 부동산 양도와 같다: 양도차익 − 장기보유 특별공제(§95② 표 1, 3년 이상) − 기본공제 250만(§103) → §104 세율.
  · 보유 2년 이상 = §55① 기본세율 · 1~2년 = 40%(주택 60%) · 1년 미만 = 50%(주택 70%), 기본세율 산출세액이 크면 그것(§104① 후단)
  · 개인지방소득세 = 양도소득세의 10분의 1(지방세법 §103의3)
계산하지 않는 것(문장으로 밝힌다 — calc.gift_view.NOT_MODELED_BURDEN):
  · 1세대 1주택 비과세(§89①3)는 '해당하면 0원'으로 경우를 나눌 뿐 요건(시행령 §154 보유·거주)은 확인하지 않는다
  · 양도 당시 12억원을 넘는 1세대 1주택(고가주택, 시행령 §160)의 과세 부분 · 장기보유 특별공제 표 2(1세대 1주택 거주)
  · 다주택 중과(§104⑦)와 그때의 장기보유 특별공제 배제 · 취득가액 외 필요경비(시행령 §163)
"""

from __future__ import annotations

from typing import Optional

from calc.income_tax import RULES_2026 as INCOME_RULES
from calc.stock_transfer import ITD, ITL, LTL, RULES_2026, Section, Step, _bracket, _mul

HIGH_PRICE = 12 * 100_000_000          # §89①3 고가주택 — 양도 당시 실지거래가액 합계 12억원 초과


def lt_rate(years: Optional[int]) -> tuple:
    """§95② 표 1 — 3년 이상 4년 미만 100분의 6, 1년마다 2씩, 15년 이상 100분의 30."""
    if years is None or years < 3:
        return (0, 100)
    return (min(6 + 2 * (years - 3), 30), 100)


def _short_rate(house: bool, years: int) -> Optional[tuple]:
    if years < 1:
        return (70, 100) if house else (50, 100)
    if years < 2:
        return (60, 100) if house else (40, 100)
    return None


def exempt(value: int, house: bool, one_house: Optional[bool], years: Optional[int] = None) -> bool:
    """1세대 1주택 비과세 경우로 보는가 — 주택이고 1세대 1주택이며 12억원 이하, 보유 2년 미만이라고 말하지 않음
    (시행령 §154① 보유 2년 — 조정대상지역 취득이면 거주 2년도 — 충족은 가정)."""
    return house and one_house is True and value <= HIGH_PRICE and (years is None or years >= 2)


def burden_transfer(value: int, debt: int, acquisition: int, years: Optional[int] = None, house: bool = True,
                    one_house: Optional[bool] = None) -> tuple[Section, Section]:
    """(양도소득세, 개인지방소득세) — value = 증여가액(시가), debt = 수증자가 인수한 채무, acquisition = 증여자 취득가액,
    years = 증여자 보유 연수(None = 2년 이상·3년 미만으로 본다 — 장기보유 특별공제 없음, 기본세율)."""
    debt = min(debt, value)
    if exempt(value, house, one_house, years):
        why = "1세대 1주택 비과세(양도 당시 12억원 이하) — 보유·거주 요건을 갖추면 양도소득세가 없습니다"
        return (Section("capital_gains", "양도소득세", "증여자", False, 0, [], why, ((ITL, "89"), (ITD, "154"))),
                Section("local_tax", "개인지방소득세(양도소득분)", "증여자", False, 0, [], why, ((LTL, "103의3"),)))
    tv = value * debt // value
    acq = acquisition * debt // value
    gain = max(tv - acq, 0)
    lr = lt_rate(years)
    ltd = _mul(gain, lr)
    income = gain - ltd
    bd = min(RULES_2026.basic_deduction, income)
    base = income - bd
    y = 2 if years is None else years
    basic = _bracket(base, INCOME_RULES.tax_brackets)
    short = _short_rate(house, y)
    if short and _mul(base, short) >= basic:
        tax, rate_note = _mul(base, short), f"보유 {'1년 미만' if y < 1 else '1년 이상 2년 미만'} {short[0]}%"
    else:      # 작문이 '1년 이상이면 기본세율'이라 쓴 일(로컬 G13 10/26 밤) — 보유기간 근거를 비고에 적는다
        held = "보유 2년 이상으로 봄" if years is None else f"보유 {years}년"
        tax, rate_note = basic, (f"{held} — 2년 이상 기본세율 6~45%" if y >= 2 else "기본세율 6~45%")
    steps = [
        Step("bg_value", "양도가액", tv, ((ITL, "88"), (ITD, "159")), f"평가액 {value:,}원 × 채무 {debt:,}원 ÷ 증여가액 {value:,}원"),
        Step("bg_acq", "취득가액(채무 비율분)", acq, ((ITD, "159"), (ITL, "97")),
             f"취득가액 {acquisition:,}원 × 채무 {debt:,}원 ÷ 증여가액 {value:,}원"),
        Step("bg_gain", "양도차익", gain, ((ITL, "95"),), "양도가액 − 취득가액"),
    ]
    if ltd:
        steps.append(Step("bg_ltd", "장기보유 특별공제", ltd, ((ITL, "95"),), f"양도차익 × {lr[0]}%(보유 {years}년)"))
    steps += [
        Step("bg_basic", "양도소득 기본공제", bd, ((ITL, "103"),), "연 250만원"),
        Step("bg_base", "과세표준", base, ((ITL, "92"),),
             "양도차익 − 장기보유 특별공제 − 기본공제" if ltd else "양도차익 − 기본공제"),
        Step("bg_tax", "양도소득세", tax, ((ITL, "104"), (ITL, "55")), f"과세표준 × 세율({rate_note})"),
    ]
    cg = Section("capital_gains", "양도소득세", "증여자", tax > 0, tax, steps,
                 "받는 분이 넘겨받은 채무만큼은 증여자가 판 것으로 봅니다(부담부증여)",
                 ((ITL, "88"), (ITD, "159"), (ITL, "104")))
    local = _mul(tax, RULES_2026.local_ratio)
    lt = Section("local_tax", "개인지방소득세(양도소득분)", "증여자", local > 0, local,
                 [Step("local_tax", "개인지방소득세", local, ((LTL, "103의3"),), "양도소득세 × 10분의 1")],
                 "양도소득세와 함께 국세 세율의 10분의 1", ((LTL, "103의3"),))
    return cg, lt
