"""
근로소득세 계산 (R2-a, 2026-10-10) — 근로소득만 있는 거주자 1인의 연간 결정세액. 순수 함수, LLM 호출 없음.

순서 (소득세법 §15 · §14②):
  총급여 → 근로소득공제(§47) → 근로소득금액(§20②) → 인적공제(§50·§51) → 연금보험료공제(§51의3)
  → 특별소득공제 중 보험료(§52①) → 과세표준(§14②) → 기본세율(§55①) → 근로소득세액공제(§59, 한도 §59②)
  → 자녀세액공제(§59의2①) → 표준세액공제(§59의4⑨1) → 결정세액(§15 2호) → 지방소득세(지방세법 §103의13)

표준세액공제 13만원은 §52⑧ 의 공제(§52① 건강·고용보험료 포함)를 신청하지 않을 때만 된다(§59의4⑨1).
그래서 두 갈래(보험료 소득공제 / 표준세액공제)를 모두 계산해 결정세액이 작은 쪽을 고른다 — 가정이 아니라
납세자가 고를 수 있는 선택이라 유리한 쪽을 쓴다.

표 값 대조 (10/10, laws.articles 현행 = 소득세법 법률 제21221호 · 시행 2026.7.1):
  §47①·§55①·§59① 의 표는 laws.articles 본문에서 빠져 있다(PDF 표 추출 누락). 원본 PDF
  `네오러다이트 법령/소득세법/소득세법(법률)(제21221호)(20260701).pdf` 29·35·38쪽 표를 직접 읽어 옮겼다.
  나머지(§50·§51·§59②·§59의2①·§59의4⑨)는 laws.articles 본문과 같다.
  laws.articles 의 시행 예정본(version=future)에는 이 조문들이 없다 = 개정 예정 없음.
4대보험 요율은 법령 DB 밖(국민연금법·국민건강보험법 시행령 등) — 공식 발표로 대조:
  국민연금 9.5%(근로자 4.75%) · 기준소득월액 상·하한 2026.1~6 637만/40만원, 2026.7~ 659만/41만원 (국민연금공단)
  건강보험 7.19%(근로자 3.595%) (보건복지부 2025.8.28 보도자료) · 장기요양 0.9448%(건보료 × 0.9448/7.19, 건보공단)
  고용보험 실업급여 1.8%(근로자 0.9%) (고용보험 및 산업재해보상보험의 보험료징수 등에 관한 법률 시행령 §12)
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Optional

MAN = 10_000

ITL = "소득세법"
LTL = "지방세법"


@dataclass(frozen=True)
class Rules:
    """한 적용 연도의 표 값. 금액 = 원, 비율 = (분자, 분모)."""

    version: str
    # §47① 근로소득공제: (구간 상한, 기본 공제액, 초과분 비율, 구간 하한) — 상한 None = 끝 구간
    earned_deduction: tuple
    earned_deduction_cap: int
    # §50① 기본공제 1명당 · §51① 추가공제
    basic_per_person: int
    elderly70_per_person: int
    disabled_per_person: int
    # §55① 기본세율: (과세표준 상한, 누진 기본세액, 세율, 구간 하한)
    tax_brackets: tuple
    # §59① 근로소득세액공제
    earned_credit_threshold: int
    earned_credit_low_rate: tuple
    earned_credit_base: int
    earned_credit_high_rate: tuple
    # §59② 한도: (총급여 상한, 시작 한도, 차감 기준 총급여, 차감 비율, 최저 한도)
    earned_credit_limits: tuple
    # §59의2① 자녀세액공제(1명 · 2명 · 3명째부터 1명당)
    child_credit_1: int
    child_credit_2: int
    child_credit_extra: int
    # §59의4⑨1 표준세액공제(근로소득자)
    standard_credit: int
    # 지방세법 §103의13 — 원천징수 소득세의 10/100
    local_rate: tuple
    # 4대보험 근로자 부담(월 보수 기준)
    pension_rate: tuple
    pension_caps: tuple          # ((개월 수, 하한, 상한), ...) 합계 12개월
    health_rate: tuple
    ltc_over_health: tuple       # 장기요양 = 건강보험료 × 0.9448/7.19
    employment_rate: tuple


RULES_2026 = Rules(
    version="2026",
    earned_deduction=(
        (500 * MAN, 0, (70, 100), 0),
        (1_500 * MAN, 350 * MAN, (40, 100), 500 * MAN),
        (4_500 * MAN, 750 * MAN, (15, 100), 1_500 * MAN),
        (10_000 * MAN, 1_200 * MAN, (5, 100), 4_500 * MAN),
        (None, 1_475 * MAN, (2, 100), 10_000 * MAN),
    ),
    earned_deduction_cap=2_000 * MAN,
    basic_per_person=150 * MAN,
    elderly70_per_person=100 * MAN,
    disabled_per_person=200 * MAN,
    tax_brackets=(
        (1_400 * MAN, 0, (6, 100), 0),
        (5_000 * MAN, 84 * MAN, (15, 100), 1_400 * MAN),
        (8_800 * MAN, 624 * MAN, (24, 100), 5_000 * MAN),
        (15_000 * MAN, 1_536 * MAN, (35, 100), 8_800 * MAN),
        (30_000 * MAN, 3_706 * MAN, (38, 100), 15_000 * MAN),
        (50_000 * MAN, 9_406 * MAN, (40, 100), 30_000 * MAN),
        (100_000 * MAN, 17_406 * MAN, (42, 100), 50_000 * MAN),
        (None, 38_406 * MAN, (45, 100), 100_000 * MAN),
    ),
    earned_credit_threshold=130 * MAN,
    earned_credit_low_rate=(55, 100),
    earned_credit_base=715_000,
    earned_credit_high_rate=(30, 100),
    earned_credit_limits=(
        (3_300 * MAN, 74 * MAN, 0, (0, 1), 74 * MAN),
        (7_000 * MAN, 74 * MAN, 3_300 * MAN, (8, 1000), 66 * MAN),
        (12_000 * MAN, 66 * MAN, 7_000 * MAN, (1, 2), 50 * MAN),
        (None, 50 * MAN, 12_000 * MAN, (1, 2), 20 * MAN),
    ),
    child_credit_1=25 * MAN,
    child_credit_2=55 * MAN,
    child_credit_extra=40 * MAN,
    standard_credit=13 * MAN,
    local_rate=(10, 100),
    pension_rate=(475, 10_000),
    pension_caps=((6, 400_000, 6_370_000), (6, 410_000, 6_590_000)),
    health_rate=(3_595, 100_000),
    ltc_over_health=(9_448, 71_900),
    employment_rate=(9, 1_000),
)

RULES = {"2026": RULES_2026}
DEFAULT_VERSION = "2026"


@dataclass(frozen=True)
class IncomeTaxInput:
    total_salary: int                       # 총급여(비과세 제외), 원 — 필수
    dependents: int = 0                     # 본인 외 기본공제대상자 수(§50①2·3호)
    elderly70: int = 0                      # 기본공제대상자 중 70세 이상(§51①1호)
    disabled: int = 0                       # 기본공제대상자 중 장애인(§51①2호)
    children_credit: int = 0                # 자녀세액공제 대상 자녀 수(§59의2①)
    pension_paid: Optional[int] = None      # 국민연금 본인부담 연액 — None 이면 총급여로 추정
    insurance_paid: Optional[int] = None    # 건강·장기요양·고용보험 본인부담 연액 — None 이면 추정
    version: str = DEFAULT_VERSION


@dataclass(frozen=True)
class Step:
    key: str
    label: str
    value: int
    basis: tuple = ()        # ((법령명, 조번호), ...) — Article.no 형식("59", "51의3")
    note: str = ""


@dataclass
class IncomeTaxResult:
    version: str
    steps: list[Step]
    determined_tax: int          # 소득세 결정세액
    local_tax: int               # 지방소득세
    total_tax: int               # 합계
    option: str                  # "insurance_deduction" | "standard_credit"
    other_option_tax: int        # 고르지 않은 갈래의 소득세 결정세액(비교용)
    estimated: list[str] = field(default_factory=list)   # 추정값을 쓴 입력 이름
    pension_paid: int = 0        # 계산에 쓴 국민연금 본인부담 연액(입력 또는 추정)
    insurance_paid: int = 0      # 계산에 쓴 건강·장기요양·고용보험 본인부담 연액(입력 또는 추정)

    def step(self, key: str) -> Step:
        return next(s for s in self.steps if s.key == key)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["steps"] = [dict(asdict(s), basis=[list(b) for b in s.basis]) for s in self.steps]
        return d


def _mul(amount: int, rate: tuple) -> int:
    """원 미만 절사."""
    num, den = rate
    return amount * num // den


def _floor10(amount: int) -> int:
    return amount // 10 * 10


def _bracket(x: int, table: tuple) -> int:
    for upper, base, rate, lower in table:
        if upper is None or x <= upper:
            return base + _mul(x - lower, rate)
    raise AssertionError("구간표 끝 구간이 없음")


def earned_income_deduction(total_salary: int, r: Rules = RULES_2026) -> int:
    """§47① 표 · 단서 2천만원 상한 · §47③ 총급여 초과 불가."""
    return min(_bracket(total_salary, r.earned_deduction), r.earned_deduction_cap, total_salary)


def basic_tax(tax_base: int, r: Rules = RULES_2026) -> int:
    """§55① 기본세율."""
    return _bracket(max(tax_base, 0), r.tax_brackets)


def earned_income_credit(computed_tax: int, total_salary: int, r: Rules = RULES_2026) -> int:
    """§59① 공제액, §59② 총급여 구간별 한도."""
    if computed_tax <= r.earned_credit_threshold:
        credit = _mul(computed_tax, r.earned_credit_low_rate)
    else:
        credit = r.earned_credit_base + _mul(computed_tax - r.earned_credit_threshold, r.earned_credit_high_rate)
    for upper, start, pivot, rate, floor in r.earned_credit_limits:
        if upper is None or total_salary <= upper:
            limit = max(start - _mul(total_salary - pivot, rate), floor)
            break
    return min(credit, limit)


def child_credit(n: int, r: Rules = RULES_2026) -> int:
    """§59의2① 자녀세액공제."""
    if n <= 0:
        return 0
    if n == 1:
        return r.child_credit_1
    return r.child_credit_2 + (n - 2) * r.child_credit_extra


def estimate_social_insurance(total_salary: int, r: Rules = RULES_2026) -> tuple[int, int]:
    """(국민연금, 건강+장기요양+고용) 본인부담 연액 추정 — 월 보수 = 총급여/12 균등 가정.
    국민연금·건강·장기요양은 월 보험료 10원 미만 절사, 고용은 원 미만 절사."""
    monthly = total_salary // 12
    pension = sum(months * _floor10(_mul(min(max(monthly, lo), hi), r.pension_rate))
                  for months, lo, hi in r.pension_caps)
    health_m = _floor10(_mul(monthly, r.health_rate))
    ltc_m = _floor10(_mul(health_m, r.ltc_over_health))
    emp_m = _mul(monthly, r.employment_rate)
    return pension, 12 * (health_m + ltc_m + emp_m)


def _branch(inp: IncomeTaxInput, r: Rules, earned_income: int, personal: int, pension: int,
            insurance: int, use_insurance: bool) -> tuple[list[Step], int]:
    """보험료 소득공제 갈래(use_insurance=True) 또는 표준세액공제 갈래의 과세표준 ~ 결정세액."""
    steps: list[Step] = []
    # §51④·§51의3③·§52⑧ — 각 공제는 남은 종합소득금액을 넘지 못한다
    remaining = earned_income - personal
    pension_d = min(pension, max(remaining, 0))
    remaining -= pension_d
    steps.append(Step("pension_deduction", "연금보험료공제", pension_d, ((ITL, "51의3"),),
                      "국민연금 본인부담분"))
    ins_d = 0
    if use_insurance:
        ins_d = min(insurance, max(remaining, 0))
        remaining -= ins_d
        steps.append(Step("insurance_deduction", "특별소득공제(건강·장기요양·고용보험료)", ins_d, ((ITL, "52"),)))
    tax_base = max(remaining, 0)
    steps.append(Step("tax_base", "과세표준", tax_base, ((ITL, "14"),)))
    computed = basic_tax(tax_base, r)
    steps.append(Step("computed_tax", "산출세액", computed, ((ITL, "55"),)))
    earned_c = earned_income_credit(computed, inp.total_salary, r)
    steps.append(Step("earned_income_credit", "근로소득세액공제", earned_c, ((ITL, "59"),)))
    credits = earned_c
    if inp.children_credit > 0:
        cc = child_credit(inp.children_credit, r)
        steps.append(Step("child_credit", "자녀세액공제", cc, ((ITL, "59의2"),)))
        credits += cc
    if not use_insurance:
        steps.append(Step("standard_credit", "표준세액공제", r.standard_credit, ((ITL, "59의4"),),
                          "건강·고용보험료 소득공제를 받지 않는 경우"))
        credits += r.standard_credit
    determined = max(computed - credits, 0)
    steps.append(Step("determined_tax", "결정세액(소득세)", determined, ((ITL, "15"),)))
    return steps, determined


def calculate(inp: IncomeTaxInput) -> IncomeTaxResult:
    if inp.total_salary < 0:
        raise ValueError("총급여는 0 이상")
    if min(inp.dependents, inp.elderly70, inp.disabled, inp.children_credit) < 0:
        raise ValueError("인원 수는 0 이상")
    r = RULES[inp.version]

    est_pension, est_insurance = estimate_social_insurance(inp.total_salary, r)
    estimated = []
    pension = inp.pension_paid
    if pension is None:
        pension, estimated = est_pension, estimated + ["pension_paid"]
    insurance = inp.insurance_paid
    if insurance is None:
        insurance, estimated = est_insurance, estimated + ["insurance_paid"]

    deduction = earned_income_deduction(inp.total_salary, r)
    earned_income = inp.total_salary - deduction
    basic = (1 + inp.dependents) * r.basic_per_person
    additional = inp.elderly70 * r.elderly70_per_person + inp.disabled * r.disabled_per_person
    personal = min(basic + additional, earned_income)     # §51④

    head = [
        Step("total_salary", "총급여", inp.total_salary, ((ITL, "20"),), "비과세 소득 제외"),
        Step("earned_income_deduction", "근로소득공제", deduction, ((ITL, "47"),)),
        Step("earned_income", "근로소득금액", earned_income, ((ITL, "20"),)),
        Step("basic_deduction", "기본공제", min(basic, earned_income), ((ITL, "50"),),
             f"본인 포함 {1 + inp.dependents}명 × 150만원"),
    ]
    if additional:
        head.append(Step("additional_deduction", "추가공제", min(additional, max(earned_income - basic, 0)),
                         ((ITL, "51"),)))

    a_steps, a_tax = _branch(inp, r, earned_income, personal, pension, insurance, use_insurance=True)
    b_steps, b_tax = _branch(inp, r, earned_income, personal, pension, insurance, use_insurance=False)
    if a_tax <= b_tax:
        option, steps, tax, other = "insurance_deduction", a_steps, a_tax, b_tax
    else:
        option, steps, tax, other = "standard_credit", b_steps, b_tax, a_tax

    local = _mul(tax, r.local_rate)
    tail = [
        Step("local_tax", "지방소득세", local, ((LTL, "103의13"),), "소득세의 10%"),
        Step("total_tax", "합계(소득세+지방소득세)", tax + local),
    ]
    return IncomeTaxResult(r.version, head + steps + tail, tax, local, tax + local, option, other, estimated,
                           pension, insurance)
