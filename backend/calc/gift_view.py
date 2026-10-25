"""
일반 증여 계산 결과 → 화면 문장·표 (E 확장, 2026-10-26). 결정론, LLM 호출 없음.

주식 갈래(calc.stock_transfer_view)와 같은 골격: 결론 문단(headline + '가정:' 줄) · ■ 증여세(수증자) 절의 단계 표 ·
계산하지 않는 것(NOT_MODELED) · 작문에 줄 trace_text. 단계 표 칸 문구는 stock_transfer_view._calc_text 를 그대로 쓴다.
과세표준이 50만원 미만(세액 0)이어도 표를 보인다 — 왜 0인지가 답이다(S03 '결혼 자금 1억').
"""

from __future__ import annotations

from calc import stock_transfer_view as sv
from calc.gift_slots import GiftFilled, relevant_assumed
from calc.stock_transfer import Section

_DONOR = {"parent": "직계존속(부모)", "grandchild": "조부모", "child": "직계비속(자녀)", "spouse": "배우자",
          "relative": "친족", "other": "친족 아닌 분"}

ASSUMED_TEXT = {
    "relation": "주는 분은 증여재산공제 대상 친족이 아님(공제 없음)",
    "minor": "받는 분은 성년",
    "prior_gifts": "10년 안에 같은 분에게서 받은 다른 증여 없음",
    "marriage": None,                      # 혼인/출산에 따라 assumed_line 이 적는다
    "prior_tax": "앞선 증여 때도 같은 공제를 받고 지금 세율로 산출한 세액을 냈다고 봄",
}

NOT_MODELED = ("부동산·주식 같은 재산의 시가 평가(상속세 및 증여세법 제60조~제66조), 부담부증여의 채무 인수, 감정평가 수수료 공제, "
               "조부모 증여에 10년 합산이 겹칠 때의 할증 계산은 하지 않았습니다. 증여재산가액은 말씀하신 금액을 그대로 썼습니다.")


def _w(n: int) -> str:
    return f"{n:,}원"


def _step(sec: Section, key: str):
    return next((s for s in sec.steps if s.key == key), None)


def headline(f: GiftFilled, sec: Section) -> str:
    who = _DONOR.get(f.donor, "주는 분")
    total_ded = sum(s.amount for s in sec.steps if s.key in ("gift_deduction", "gift_marriage"))
    head = f"{who}에게서 {_w(f.value)}을 증여받으면"
    if not sec.applies:
        return (f"{head} 공제 합계 {_w(total_ded)}을 빼고 남는 과세표준이 50만원 미만이라 낼 증여세가 없습니다"
                f"(신고 의무는 남습니다 — 상속세 및 증여세법 제68조).")
    base = _step(sec, "gift_base").amount
    extra = " · 10년 안 앞선 증여 합산" if _step(sec, "gift_prior") else ""
    return (f"{head} 받는 분이 낼 증여세는 {_w(sec.tax)}입니다"
            f"(공제 {_w(total_ded)} 뒤 과세표준 {_w(base)}{extra} · 기한 내 신고 시).")


def assumed_line(f: GiftFilled, sec: Section) -> str:
    out = []
    for k in relevant_assumed(f, sec):
        if k == "marriage":
            out.append("혼인신고일 전후 2년 안에 받는 증여이고 혼인·출산 공제를 처음 받음" if f.marriage == "marriage"
                       else "자녀 출생·입양일부터 2년 안에 받는 증여이고 혼인·출산 공제를 처음 받음")
        elif ASSUMED_TEXT.get(k):
            out.append(ASSUMED_TEXT[k])
    if f.sum_skipped:
        out.append("조부모에게서 받은 앞선 증여는 합산하지 않고 공제 한도에서만 뺐음")
    return ("가정: " + " · ".join(out) + ".") if out else ""


def conclusion_parts(f: GiftFilled, sec: Section) -> list[tuple[str, str]]:
    parts = [("headline", headline(f, sec))]
    a = assumed_line(f, sec)
    if a:
        parts.append(("assume", a))
    return parts


def step_table(sec: Section) -> str:
    rows = sv.section_rows(sec)
    lines = ["| 단계 | 계산 | 결과 | 근거 |", "| --- | --- | ---: | --- |"]
    lines += [f"| {sv._cell(st.label)} | {sv._cell(r.calc)} | {sv._cell(r.result)} | {sv._cell(r.law)} |"
              for st, r in zip(sec.steps, rows)]
    return "\n".join(lines)


def section_lead(sec: Section) -> str:
    if not sec.applies:
        return "공제를 빼면 과세표준이 50만원 미만이라 증여세가 없습니다."
    return f"받는 분(수증자)이 낼 증여세는 {_w(sec.tax)}입니다."


def sections_markdown(sec: Section) -> list[tuple[Section, str, str]]:
    """_calc_finish 가 쓰는 (Section, 첫 문장, 단계 표) 목록 — 세목 하나. 세액 0이어도 표를 낸다."""
    return [(sec, section_lead(sec), step_table(sec))]


def calc_citation_keys(sec: Section) -> set[tuple[str, str]]:
    return set(sec.basis) | {b for st in sec.steps for b in st.basis}


def trace_text(f: GiftFilled, sec: Section) -> str:
    """작문(Solar)에 줄 계산 결과 — 숫자 출처(numeric_guard)이자 '세액은 계산기 값만' 재료."""
    lines = [f"[증여세 · 수증자] {'과세' if sec.applies else '과세표준 50만원 미만 — 세액 없음'}"]
    lines += [f"  {st.label}: {_w(st.amount)}" + (f" ({st.note})" if st.note else "") for st in sec.steps]
    a = assumed_line(f, sec)
    if a:
        lines.append(a)
    return "\n".join(lines)
