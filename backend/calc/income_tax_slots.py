"""
근로소득세 슬롯 (R2-b, 2026-10-10) — 무엇을 묻고 무엇을 가정하나. 결정론, LLM 호출 없음.

원칙 (로드맵 §6 · 세무사 피드백 10/10, R1-f 와 같은 원칙):
  · 가정은 보수적으로(세금이 더 나오는 쪽) 하고 가정 문장은 코드가 넣는다(Solar 가 쓰지 않는다).
  · 근로소득세는 1인 가구(본인 1명)로 가정하고 "부양가족이 있으면 소득공제·세액공제가 늘어난다"를 붙인다.
  · 되묻기는 결과를 바꾸는 질문만, 턴당 최대 2개. 총급여가 없으면 그것 1개만 묻는다.
  · '갖추면 →' 문장(R1-f F-1 과 같은 꼴)은 계산을 다시 돌린 값으로 쓴다.

슬롯 값은 추출 결과(dict, 연액·원 단위)에서 읽는다. 키:
  total_salary(필수) · dependents · children_credit · nontaxable · elderly70 · disabled · pension_paid · insurance_paid
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from calc.income_tax import IncomeTaxInput, IncomeTaxResult, calculate

REQUIRED = "required"      # 없으면 계산하지 않고 이것만 묻는다
DEFAULT = "default"        # 기본값으로 계산하고 가정 문장을 붙인다 · 결과를 바꾸면 되묻는다
OPTIONAL = "optional"      # 말하면 반영, 안 말하면 묻지도 가정 문장도 없음


@dataclass(frozen=True)
class Slot:
    key: str
    kind: str
    label: str
    default: Optional[int] = None
    question: str = ""


SLOTS: tuple[Slot, ...] = (
    Slot("total_salary", REQUIRED, "총급여",
         question="세전 연봉(연간 총급여)이 얼마인가요? 월급으로 알려주셔도 됩니다."),
    Slot("dependents", DEFAULT, "부양가족 수", 0,
         question="본인 외에 기본공제를 받을 부양가족(연 소득 100만원 이하인 배우자·자녀·부모 등)이 몇 명인가요?"),
    Slot("nontaxable", DEFAULT, "비과세 급여", 0,
         question="연봉 중 식대·자가운전보조금 같은 비과세 급여가 있나요? 있다면 한 달에 얼마인가요?"),
    Slot("children_credit", DEFAULT, "자녀세액공제 대상 자녀 수", 0,
         question="부양가족 중 자녀세액공제 대상 자녀가 몇 명인가요?"),
    Slot("pension_paid", DEFAULT, "국민연금 납부액"),          # 기본값 = 총급여로 추정(calc.income_tax)
    Slot("insurance_paid", DEFAULT, "건강·고용보험료 납부액"),  # 기본값 = 총급여로 추정
    Slot("elderly70", OPTIONAL, "70세 이상 부양가족 수", 0),
    Slot("disabled", OPTIONAL, "장애인 부양가족 수", 0),
)
SLOT = {s.key: s for s in SLOTS}

# 되묻기 순서 — 결과를 가장 크게 바꾸는 것부터. 자녀는 부양가족이 있다고 확인된 뒤에만 묻는다.
ASK_ORDER = ("dependents", "nontaxable", "children_credit")

# 가정 문장(결정론). 세무사 원칙 문구 그대로.
ASSUME_DEPENDENTS = "본인 1명(1인 가구)으로 가정해 계산했습니다. 부양가족이 있으면 소득공제·세액공제가 늘어납니다."
ASSUME_NONTAXABLE = ("연봉 전액을 과세 대상 급여로 보고 계산했습니다. 식대 같은 비과세 급여가 있으면 "
                     "그만큼 세금이 줄어듭니다.")
ASSUME_CHILDREN = "자녀세액공제는 넣지 않았습니다. 공제 대상 자녀가 있으면 세액이 더 줄어듭니다."
ASSUME_INSURANCE = ("국민연금·건강보험·장기요양·고용보험료는 2026년 요율로 추정했습니다. "
                    "실제 납부액에 따라 달라질 수 있습니다.")
NOT_MODELED = ("신용카드·의료비·교육비·보험료·기부금·월세 같은 다른 공제는 넣지 않았습니다. "
               "해당하면 세금이 더 줄어듭니다.")


@dataclass
class Filled:
    inp: Optional[IncomeTaxInput]           # None = 총급여가 없어 계산 못 함
    missing_required: list[str]
    assumed: list[str] = field(default_factory=list)   # 기본값을 쓴 DEFAULT 슬롯


def _int(v) -> Optional[int]:
    if v is None or isinstance(v, bool):
        return None
    try:
        n = int(v)
    except (TypeError, ValueError):
        return None
    return n if n >= 0 else None


def fill(extracted: dict) -> Filled:
    """추출 값 + 기본값 → 계산 입력. 사용자가 말한 값은 그대로, 안 말한 DEFAULT 슬롯만 assumed 에 남긴다."""
    v = {s.key: _int(extracted.get(s.key)) for s in SLOTS}
    if not v["total_salary"]:
        return Filled(None, ["total_salary"])
    assumed = [k for k in ("dependents", "nontaxable") if v[k] is None]
    # 자녀 수는 부양가족이 있다고 확인됐을 때만 가정 대상이다(1인 가구 가정이면 자녀 0 은 따로 말할 것이 없다).
    if v["children_credit"] is None and (v["dependents"] or 0) > 0:
        assumed.append("children_credit")
    if v["pension_paid"] is None or v["insurance_paid"] is None:
        assumed.append("insurance")

    dependents = v["dependents"] or 0
    people = 1 + dependents                                   # 기본공제대상자(본인 포함)
    salary = max(v["total_salary"] - (v["nontaxable"] or 0), 0)
    inp = IncomeTaxInput(
        total_salary=salary,
        dependents=dependents,
        elderly70=min(v["elderly70"] or 0, people),
        disabled=min(v["disabled"] or 0, people),
        children_credit=min(v["children_credit"] or 0, dependents),
        pension_paid=v["pension_paid"],
        insurance_paid=v["insurance_paid"],
    )
    return Filled(inp, [], assumed)


def followup_questions(extracted: dict, asked: set[str] = frozenset()) -> list[Slot]:
    """이번 턴에 물을 질문(최대 2개). 총급여가 없으면 그것만. 이미 물은 슬롯은 다시 묻지 않는다
    (답을 안 했으면 기본값 그대로 — R1-f 처럼 되묻기가 계산을 막지 않게)."""
    f = fill(extracted)
    if f.missing_required:
        return [SLOT[k] for k in f.missing_required]
    order = [k for k in ASK_ORDER if k in f.assumed and k not in asked]
    return [SLOT[k] for k in order[:2]]


def _won(n: int) -> str:
    return f"{n:,}원"


def what_if_lines(f: Filled, base: IncomeTaxResult) -> list[str]:
    """'갖추면 →' 문장 — 가정한 슬롯을 하나씩 바꿔 다시 계산한 차이(합계 = 소득세+지방소득세)."""
    if f.inp is None:
        return []
    lines = []

    def diff(**kw) -> int:
        alt = calculate(IncomeTaxInput(**{**f.inp.__dict__, **kw}))
        return base.total_tax - alt.total_tax

    if "dependents" in f.assumed:
        d = diff(dependents=f.inp.dependents + 1)
        if d > 0:
            lines.append(f"부양가족이 1명 있으면 기본공제 150만원이 더해져 세금이 {_won(d)} 줄어듭니다.")
    if "nontaxable" in f.assumed:
        monthly = 200_000                         # 식사대 비과세 월 20만원 이하(소득세법 §12 3호 러목)
        d = diff(total_salary=max(f.inp.total_salary - monthly * 12, 0))
        if d > 0:
            lines.append(f"식대 비과세가 월 20만원이면 세금이 {_won(d)} 줄어듭니다.")
    return lines


def assumption_segments(f: Filled, result: IncomeTaxResult) -> list[dict]:
    """가정 문장(결정론, Solar 0) — 화면 세그먼트 dict({text, type}). 숫자 가드 뒤에 붙인다(계산값이라 가드 대상 아님)."""
    out: list[dict] = []
    if "dependents" in f.assumed:
        out.append({"text": ASSUME_DEPENDENTS, "type": "caveat"})
    if "nontaxable" in f.assumed:
        out.append({"text": ASSUME_NONTAXABLE, "type": "caveat"})
    if "children_credit" in f.assumed:
        out.append({"text": ASSUME_CHILDREN, "type": "caveat"})
    if "insurance" in f.assumed:
        out.append({"text": ASSUME_INSURANCE, "type": "caveat"})
    out.append({"text": NOT_MODELED, "type": "caveat"})
    out += [{"text": t, "type": "application"} for t in what_if_lines(f, result)]
    return out
