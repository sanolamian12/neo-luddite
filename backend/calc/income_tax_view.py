"""
근로소득세 계산 결과 → 화면 문장 (R2-c, 2026-10-10). 결정론, LLM 호출 없음.

결론 문장·단계표 행·Solar 에 줄 계산 결과 텍스트를 만든다. 단계표는 지금 세그먼트 텍스트(type=application)로
내고(프론트 스키마 변경 없음), 블록(calc_breakdown)으로 낼지는 R2-d 에서 정한다 — 행 구조(text · citations)는 같다.
조문 배지는 행마다 직접 붙인다: 본문 문자열 대조(_attach_citations)는 "소득세법 제51조"가 "제51조의3" 안에서도
걸려 엉뚱한 배지가 붙는다.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from calc.income_tax import RULES, IncomeTaxResult, calculate
from calc.income_tax_slots import Filled


def law_label(law: str, no: str) -> str:
    """law_select.Article.label() 과 같은 꼴 — "소득세법 제51조의3"."""
    num, _, sub = no.partition("의")
    return f"{law} 제{num}조" + (f"의{sub}" if sub else "")


def _laws(*keys: tuple[str, str]) -> str:
    """'(소득세법 제50조·제51조의3)' — 같은 법령이면 법령명을 한 번만."""
    parts, last = [], None
    for law, no in keys:
        lab = law_label(law, no)
        parts.append(lab if law != last else lab.split(" ", 1)[1])
        last = law
    return "(" + "·".join(parts) + ")"


def _w(n: int) -> str:
    return f"{n:,}원"


@dataclass
class Row:
    text: str
    citations: list[str]


def _bracket_rate(result: IncomeTaxResult) -> int:
    base = result.step("tax_base").value
    for upper, _b, (num, den), _lo in RULES[result.version].tax_brackets:
        if upper is None or base <= upper:
            return num * 100 // den
    return 0


def headline(f: Filled, result: IncomeTaxResult) -> str:
    inp = f.inp
    if "dependents" in f.assumed:
        who = "본인 1명(1인 가구)으로 가정하고"
    elif inp.dependents == 0:
        who = "본인 1명(1인 가구)으로 보고"
    else:
        who = f"본인 포함 {1 + inp.dependents}명을 기본공제 대상으로 보고"
    head = f"총급여 {_w(inp.total_salary)}, {who} {RULES[result.version].version}년 시행 세법으로 계산하면"
    if result.total_tax == 0:
        return f"{head} 결정세액이 0원이라 낼 근로소득세가 없습니다."
    return (f"{head} 1년 근로소득세는 {_w(result.determined_tax)}이고, 지방소득세 {_w(result.local_tax)}을 더하면 "
            f"{_w(result.total_tax)}(월 평균 약 {_w(result.total_tax // 12)})입니다.")


def step_rows(result: IncomeTaxResult) -> list[Row]:
    s = {st.key: st for st in result.steps}
    rows: list[Row] = []

    def cites(*keys):
        return [law_label(*k) for k in keys]

    k47 = ("소득세법", "47")
    rows.append(Row(f"① 총급여 {_w(s['total_salary'].value)} − 근로소득공제 {_w(s['earned_income_deduction'].value)} "
                    f"= 근로소득금액 {_w(s['earned_income'].value)} {_laws(k47)}", cites(k47)))

    keys = [("소득세법", "50")]
    parts = [f"기본공제 {_w(s['basic_deduction'].value)}"]
    if "additional_deduction" in s:
        keys.append(("소득세법", "51"))
        parts.append(f"추가공제 {_w(s['additional_deduction'].value)}")
    keys.append(("소득세법", "51의3"))
    parts.append(f"연금보험료공제 {_w(s['pension_deduction'].value)}")
    if "insurance_deduction" in s:
        keys.append(("소득세법", "52"))
        parts.append(f"건강·장기요양·고용보험료 공제 {_w(s['insurance_deduction'].value)}")
    rows.append(Row(f"② 근로소득금액 − " + " − ".join(parts) + f" = 과세표준 {_w(s['tax_base'].value)} {_laws(*keys)}",
                    cites(*keys)))

    k55 = ("소득세법", "55")
    rows.append(Row(f"③ 과세표준에 기본세율({_bracket_rate(result)}% 구간)을 적용하면 산출세액 "
                    f"{_w(s['computed_tax'].value)} {_laws(k55)}", cites(k55)))

    keys = [("소득세법", "59")]
    parts = [f"근로소득세액공제 {_w(s['earned_income_credit'].value)}"]
    if "child_credit" in s:
        keys.append(("소득세법", "59의2"))
        parts.append(f"자녀세액공제 {_w(s['child_credit'].value)}")
    if "standard_credit" in s:
        keys.append(("소득세법", "59의4"))
        parts.append(f"표준세액공제 {_w(s['standard_credit'].value)}")
    rows.append(Row(f"④ 산출세액 − " + " − ".join(parts) + f" = 결정세액 {_w(s['determined_tax'].value)} "
                    f"{_laws(*keys)}", cites(*keys)))

    k_local = ("지방세법", "103의13")
    rows.append(Row(f"⑤ 지방소득세 {_w(s['local_tax'].value)}(결정세액의 10%)를 더하면 합계 "
                    f"{_w(s['total_tax'].value)} {_laws(k_local)}", cites(k_local)))
    return rows


def option_note(result: IncomeTaxResult) -> str:
    chosen = "건강·고용보험료 소득공제" if result.option == "insurance_deduction" else "표준세액공제"
    return (f"건강·고용보험료 소득공제와 표준세액공제 13만원은 둘 중 하나만 받을 수 있어, 세금이 더 적은 "
            f"{chosen} 쪽으로 계산했습니다.")


def trace_text(f: Filled, result: IncomeTaxResult) -> str:
    """Solar 해설용 계산 결과(단계값 + 가정)."""
    lines = [f"{st.label}: {_w(st.value)}" for st in result.steps]
    lines.append("공제 선택: " + ("건강·고용보험료 소득공제" if result.option == "insurance_deduction" else "표준세액공제"))
    if f.assumed:
        lines.append("가정(사용자가 말하지 않음): " + ", ".join(
            {"dependents": "부양가족 없음(1인 가구)", "nontaxable": "비과세 급여 없음",
             "children_credit": "자녀세액공제 대상 없음", "insurance": "4대보험료는 요율로 추정"}[k] for k in f.assumed))
    return "\n".join(lines)


def takehome(gross: int, result: IncomeTaxResult) -> str:
    """연 실수령액(근사) = 총급여(비과세 포함) − 4대보험 본인부담 − 소득세·지방소득세. 매달 받는 돈은 간이세액표
    원천징수라 연말정산 전과 다를 수 있다."""
    ins = result.pension_paid + result.insurance_paid
    take = gross - ins - result.total_tax
    return (f"4대보험료 {_w(ins)}과 세금 {_w(result.total_tax)}을 빼면 1년 실수령액은 약 {_w(take)}, "
            f"월 평균 약 {_w(take // 12)}입니다. 매달 받는 금액은 간이세액표에 따라 미리 떼는 세금 기준이라 "
            f"연말정산 전까지는 조금 다를 수 있습니다.")


def change_line(before: int, f: Filled, result: IncomeTaxResult) -> str:
    """'연봉이 A에서 B로' — 같은 가정으로 A 도 계산해 과세표준 구간·세금 차이를 비교(결정론)."""
    prev = calculate(replace(f.inp, total_salary=before))
    ra, rb = _bracket_rate(prev), _bracket_rate(result)
    moved = ("적용 세율 구간은 그대로입니다" if ra == rb
             else f"적용 세율 구간이 {ra}%에서 {rb}%로 바뀝니다. 다만 높은 세율은 구간을 넘은 금액에만 적용됩니다")
    return (f"총급여 {_w(before)}일 때 과세표준은 {_w(prev.step('tax_base').value)}({ra}% 구간), "
            f"{_w(f.inp.total_salary)}일 때는 {_w(result.step('tax_base').value)}({rb}% 구간)으로 {moved}. "
            f"세금(지방소득세 포함)은 {_w(prev.total_tax)}에서 {_w(result.total_tax)}으로 "
            f"{_w(result.total_tax - prev.total_tax)} 늘어납니다.")
