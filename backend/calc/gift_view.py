"""
일반 증여 계산 결과 → 화면 문장·표 (E 확장, 2026-10-26). 결정론, LLM 호출 없음.

주식 갈래(calc.stock_transfer_view)와 같은 골격: 결론 문단(headline + '가정:' 줄) · ■ 증여세(수증자) 절의 단계 표 ·
계산하지 않는 것(NOT_MODELED) · 작문에 줄 trace_text. 단계 표 칸 문구는 stock_transfer_view._calc_text 를 그대로 쓴다.
과세표준이 50만원 미만(세액 0)이어도 표를 보인다 — 왜 0인지가 답이다(S03 '결혼 자금 1억').
부담부증여(10/26 밤): 결론에 받는 분 증여세 + 주는 분 양도소득세(경우)를 함께 · ■ 양도소득세(증여자)·■ 개인지방소득세 절 ·
채무 없이 전부 증여할 때의 증여세 비교 한 줄 · NOT_MODELED_BURDEN.
혼인 공제를 적용한 답에만 §53의2⑤⑥ 확인 문장(MARRIAGE_CHECK — 운영 laws.articles 원문 요지, 10/26 사용자 결정).
"""

from __future__ import annotations

from typing import Optional

from calc import stock_transfer_view as sv
from calc.burden_transfer import HIGH_PRICE
from calc.gift_slots import Burden, GiftFilled, relevant_assumed
from calc.stock_transfer import Section

_DONOR = {"parent": "직계존속(부모)", "grandchild": "조부모", "child": "직계비속(자녀)", "spouse": "배우자",
          "relative": "친족", "other": "친족 아닌 분"}

ASSUMED_TEXT = {
    "relation": "주는 분은 증여재산공제 대상 친족이 아님(공제 없음)",
    "minor": "받는 분은 성년",
    "prior_gifts": "10년 안에 같은 분에게서 받은 다른 증여 없음",
    "marriage": None,                      # 혼인/출산에 따라 assumed_line 이 적는다
    "prior_tax": "앞선 증여 때도 같은 공제를 받고 지금 세율로 산출한 세액을 냈다고 봄",
    "debt_ok": ("넘겨받는 채무는 대출·임대차 계약처럼 객관적으로 확인되고 받는 분이 실제로 갚음(배우자·직계존비속 사이에는 "
                "이를 입증하지 못하면 채무를 빼지 않습니다 — 상속세 및 증여세법 제47조제3항)"),
    "acquisition": None,                   # 양도세를 계산하지 않았다 — 결론 문장이 말한다
    "years": "주는 분은 그 재산을 2년 이상 3년 미만 보유(장기보유 특별공제 없음)",
    "one_house": None,                     # 경우를 나눠 말한다
}

NOT_MODELED = ("부동산·주식 같은 재산의 시가 평가(상속세 및 증여세법 제60조~제66조), 감정평가 수수료 공제, "
               "조부모 증여에 10년 합산이 겹칠 때의 할증 계산은 하지 않았습니다. 증여재산가액은 말씀하신 금액을 그대로 썼습니다"
               "(전세보증금·대출 같은 채무를 함께 넘기는 부담부증여라면 그 금액을 알려 주시면 반영합니다).")
# 10/26 오전 운영본의 고지 — 그 답 뒤의 후속 턴도 증여 계산으로 이어 받는다
_NOT_MODELED_1026 = ("부동산·주식 같은 재산의 시가 평가(상속세 및 증여세법 제60조~제66조), 부담부증여의 채무 인수, 감정평가 수수료 공제, "
                     "조부모 증여에 10년 합산이 겹칠 때의 할증 계산은 하지 않았습니다. 증여재산가액은 말씀하신 금액을 그대로 썼습니다.")
NOT_MODELED_BURDEN = ("부동산의 시가 평가(상속세 및 증여세법 제60조~제66조), 1세대 1주택 비과세 요건(보유·거주 기간) 확인, "
                      "12억원을 넘는 1세대 1주택의 과세 부분, 다주택 중과세율(소득세법 제104조제7항), 취득가액 외 필요경비, "
                      "받는 분의 취득세는 계산하지 않았습니다. 재산 가액과 채무는 말씀하신 금액을 그대로 썼습니다.")
# §53의2⑤·⑥ (운영 laws.articles 원문 — 10/26 확인) · 혼인 공제(①)를 적용한 답에만
MARRIAGE_CHECK = ("혼인 공제를 받은 뒤 약혼자의 사망 등 부득이한 사유로 그 사유가 생긴 달의 말일부터 3개월 안에 증여재산을 "
                  "돌려드리면 처음부터 증여가 없었던 것으로 봅니다. 혼인 전에 공제를 받고 증여일부터 2년 안에 혼인하지 않으면, "
                  "2년이 되는 날이 속하는 달의 말일부터 3개월 안에 수정신고나 기한 후 신고를 해야 가산세를 면제받고 이자상당액만 "
                  "더해 냅니다(상속세 및 증여세법 제53조의2제5항·제6항).")
CONTEXT_MARKS = (NOT_MODELED, NOT_MODELED_BURDEN, _NOT_MODELED_1026)   # 직전 답이 증여 계산이었나(pipeline._gift_context)


def _w(n: int) -> str:
    return f"{n:,}원"


def _step(sec: Section, key: str):
    return next((s for s in sec.steps if s.key == key), None)


def headline(f: GiftFilled, sec: Section, b: Optional[Burden] = None) -> str:
    who = _DONOR.get(f.donor, "주는 분")
    total_ded = sum(s.amount for s in sec.steps if s.key in ("gift_deduction", "gift_marriage"))
    if b is not None:
        return _burden_headline(f, sec, b, who, total_ded)
    head = f"{who}에게서 {_w(f.value)}을 증여받으면"
    if not sec.applies:
        return (f"{head} 공제 합계 {_w(total_ded)}을 빼고 남는 과세표준이 50만원 미만이라 낼 증여세가 없습니다"
                f"(신고 의무는 남습니다 — 상속세 및 증여세법 제68조).")
    base = _step(sec, "gift_base").amount
    extra = " · 10년 안 앞선 증여 합산" if _step(sec, "gift_prior") else ""
    return (f"{head} 받는 분이 낼 증여세는 {_w(sec.tax)}입니다"
            f"(공제 {_w(total_ded)} 뒤 과세표준 {_w(base)}{extra} · 기한 내 신고 시).")


def _burden_headline(f: GiftFilled, sec: Section, b: Burden, who: str, total_ded: int) -> str:
    head = f"{who}에게서 {_w(f.value)} 재산을 채무 {_w(b.debt)}과 함께 넘겨받으면(부담부증여)"
    taxable = _step(sec, "gift_taxable").amount
    if sec.applies:
        gift = (f"받는 분의 증여세는 {_w(sec.tax)}입니다(채무를 뺀 과세가액 {_w(taxable)} · 공제 {_w(total_ded)} 뒤 "
                f"과세표준 {_w(_step(sec, 'gift_base').amount)} · 기한 내 신고 시)")
    else:
        gift = (f"채무를 뺀 과세가액 {_w(taxable)}에서 공제 {_w(total_ded)}을 빼면 과세표준이 50만원 미만이라 "
                "받는 분의 증여세는 없습니다")
    part = f"채무 {_w(b.debt)} 부분은 주는 분이 판 것으로 보아(소득세법 제88조제1호) 주는 분에게 양도소득세가 따로 붙습니다"
    if b.high_house:
        cg = part + " — 양도 당시 12억원을 넘는 1세대 1주택의 양도소득세는 이 계산에 넣지 않았습니다."
    elif b.exempt_only:
        cg = (f"채무 {_w(b.debt)} 부분은 주는 분이 판 것으로 보지만(소득세법 제88조제1호) 1세대 1주택 비과세(12억원 이하)에 "
              "해당하면 양도소득세가 없습니다.")
    elif b.no_acq:
        cg = part + (" — 1세대 1주택 비과세(12억원 이하)에 해당하면 0원이고, 아니면" if b.exempt_case else " —")             + " 주는 분이 그 재산을 산 가격(취득가액)을 알려 주시면 계산해 드립니다."
    else:
        tot = b.cg.tax + b.lt.tax
        cg = (part + f": 양도소득세 {_w(b.cg.tax)} + 지방소득세 {_w(b.lt.tax)} = {_w(tot)}"
              + (" — 1세대 1주택 비과세(12억원 이하)에 해당하면 0원입니다." if b.exempt_case else "."))
        if f.house and f.one_house is None and f.value > HIGH_PRICE:
            cg += " 1세대 1주택이라면 12억원을 넘는 부분만 과세되는데, 그 계산은 하지 않았습니다."
    return f"{head} {gift}. {cg}"


def compare_line(f: GiftFilled, sec: Section, b: Optional[Burden]) -> str:
    if b is None or b.whole_tax == sec.tax:
        return ""
    return f"참고로 채무 없이 전부 증여하면 받는 분의 증여세는 {_w(b.whole_tax)}입니다."


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


def conclusion_parts(f: GiftFilled, sec: Section, b: Optional[Burden] = None) -> list[tuple[str, str]]:
    parts = [("headline", headline(f, sec, b))]
    c = compare_line(f, sec, b)
    if c:
        parts.append(("compare", c))
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


def _burden_sections(b: Optional[Burden]) -> list[tuple[Section, str, str]]:
    if b is None or b.cg is None:
        return []
    if b.exempt_only:
        return [(b.cg, "1세대 1주택 비과세(양도 당시 12억원 이하)에 해당하면 채무 부분의 양도소득세가 없습니다"
                       "(소득세법 제89조제1항제3호 — 보유 2년 등 요건은 확인이 필요합니다).", "")]
    if_case = "1세대 1주택 비과세에 해당하지 않으면 " if b.exempt_case else ""
    lead = (f"{if_case}채무 {_w(b.debt)} 부분에 대해 주는 분(증여자)이 낼 양도소득세는 {_w(b.cg.tax)}입니다."
            if b.cg.applies else f"{if_case}채무 부분의 양도차익이 없어 양도소득세가 없습니다.")
    out = [(b.cg, lead, sv.step_table(b.cg))]
    if b.lt.applies:
        out.append((b.lt, f"개인지방소득세는 양도소득세의 10분의 1인 {_w(b.lt.tax)}입니다.", sv.step_table(b.lt)))
    return out


def sections_markdown(sec: Section, b: Optional[Burden] = None) -> list[tuple[Section, str, str]]:
    """_calc_finish 가 쓰는 (Section, 첫 문장, 단계 표) 목록 — 증여세 + (부담부증여면) 양도소득세·지방소득세.
    증여세는 세액 0이어도 표를 낸다."""
    return [(sec, section_lead(sec), step_table(sec))] + _burden_sections(b)


def calc_citation_keys(sec: Section, b: Optional[Burden] = None) -> set[tuple[str, str]]:
    secs = [sec] + ([x for x in (b.cg, b.lt) if x is not None] if b else [])
    keys = {k for x in secs for k in x.basis} | {k for x in secs for st in x.steps for k in st.basis}
    if b is not None:
        keys |= {("소득세법", "88"), ("소득세법", "89"), ("상속세 및 증여세법", "47")}   # 결론·가정·절 문장이 단다
    return keys


def marriage_applied(sec: Section) -> bool:
    """혼인 공제(§53의2①)를 적용했나 — 출산(②)은 ⑤⑥ 대상이 아니다. 단계 비고로 안다(calc.stock_transfer.gift_tax)."""
    st = next((s for s in sec.steps if s.key == "gift_marriage"), None)
    return st is not None and st.amount > 0 and st.note.startswith("혼인신고일")


def marriage_check(sec: Section) -> str:
    return MARRIAGE_CHECK if marriage_applied(sec) else ""


def trace_text(f: GiftFilled, sec: Section, b: Optional[Burden] = None) -> str:
    """작문(Solar)에 줄 계산 결과 — 숫자 출처(numeric_guard)이자 '세액은 계산기 값만' 재료."""
    lines = [f"[증여세 · 수증자] {'과세' if sec.applies else '과세표준 50만원 미만 — 세액 없음'}"]
    lines += [f"  {st.label}: {_w(st.amount)}" + (f" ({st.note})" if st.note else "") for st in sec.steps]
    if b is not None:
        lines.append(f"[부담부증여 · 증여자] 채무 {_w(b.debt)} 부분은 증여자의 양도(소득세법 제88조제1호)")
        if b.cg is not None and not b.exempt_only:
            lines += [f"  {st.label}: {_w(st.amount)}" + (f" ({st.note})" if st.note else "")
                      for x in (b.cg, b.lt) for st in x.steps]
        else:
            lines.append("  양도소득세: " + ("1세대 1주택 비과세 경우" if b.exempt_only else "계산하지 않음"))
    a = assumed_line(f, sec)
    if a:
        lines.append(a)
    return "\n".join(lines)
