"""
주식 양도 복합 사안 계산 결과 → 화면 문장·표 (E단계, 2026-10-19). 결정론, LLM 호출 없음.

설계 `design/E단계_주식양도_복합사안_설계_1014.md` §2-2 골격의 숫자 자리를 채운다:
  · 결론 문단: headline(누가 어떤 세금을 얼마) + summary_table(세목 | 납세자 | 세액) + assumed_line('가정: …')
  · ■ 세목·납세자별: section_rows → step_table(단계 | 계산 | 결과 | 근거) — calc.income_tax_view 와 같은 표 꼴
  · NOT_MODELED: 계산하지 않는 것(평가·최대주주 할증·농특세·10년 합산)
값은 전부 calc.stock_transfer 결과 그대로(새 계산 없음). 조문 배지는 행마다 직접 붙인다(income_tax_view 와 같은 이유).
"""

from __future__ import annotations

from typing import Iterable

from calc.income_tax_view import Row, law_label
from calc.stock_transfer import RULES_2026, Section, Step, StockTransferResult


def _w(n: int) -> str:
    return f"{n:,}원"


def _laws(keys: Iterable[tuple[str, str]]) -> str:
    """'소득세법 제97조·시행령 …' 대신 income_tax_view 처럼 같은 법령이면 이름을 한 번만 — 괄호 없이(표 칸)."""
    parts, last = [], None
    for law, no in dict.fromkeys(keys):
        lab = law_label(law, no)
        parts.append(lab if law != last else lab[len(law) + 1:])   # '상속세 및 증여세법' 처럼 띄어 쓴 이름도
        last = law
    return "·".join(parts)


def _cell(t: str) -> str:
    return t.replace("|", "\\|")


# 납세자 칸 — 계산기의 taxpayer 는 '양도자(증권회사·…징수)' 처럼 설명이 붙을 수 있다 → 표엔 머리말만.
def _payer(s: Section) -> str:
    return s.taxpayer.split("(", 1)[0]


# ── 결론 문단 ────────────────────────────────────────────────────────────────

def applied(result: StockTransferResult) -> list[Section]:
    return [s for s in result.sections if s.applies and s.tax > 0]


def headline(result: StockTransferResult) -> str:
    """'양도자는 양도소득세 …원·개인지방소득세 …원·증권거래세 …원을, 양수자는 증여세 …원을 냅니다(합계 …원).'"""
    secs = applied(result)
    if not secs:
        return "주어진 사실관계로는 이 양도에서 낼 세금이 없습니다."
    by_payer: dict[str, list[Section]] = {}
    for s in secs:
        by_payer.setdefault(_payer(s), []).append(s)
    parts = [f"{who}는 " + "·".join(f"{s.title} {_w(s.tax)}" for s in ss) + "을"
             for who, ss in by_payer.items()]
    tail = f"(합계 {_w(result.total)})" if len(secs) > 1 else ""
    return ", ".join(parts) + f" 냅니다{tail}."


def summary_table(result: StockTransferResult) -> str:
    """합계 표(Markdown) — 세목 | 납세자 | 세액. 과세되지 않는 세목도 한 줄('없음')로 보여 준다(왜 없는지는 세목 절)."""
    lines = ["| 세목 | 납세자 | 세액 |", "| --- | --- | ---: |"]
    for s in result.sections:
        lines.append(f"| {s.title} | {_payer(s)} | {_w(s.tax) if s.applies and s.tax else '없음'} |")
    lines.append(f"| **합계** |  | **{_w(result.total)}** |")
    return "\n".join(lines)


# 가정 문구 — 계산기(result.assumed)와 슬롯(calc.stock_transfer_slots, Filled.assumed)이 남긴 키. 결과에 영향이 있을 때만 적는다.
ASSUMED_TEXT = {
    "market_value": "시가는 거래가와 같다고 봄",
    "market": None,                          # assumed_line 이 시장 이름으로 적는다
    "on_market": None,                       # 상장일 때만 — assumed_line 이 거래 방식으로 적는다
    "size": "중소기업이 아님",
    "major": None,                           # 대주주 판정 문장(계산기 major_reason)을 쓴다
    "holding_months": "1년 이상 보유",
    "relation": "양도자와 양수자는 특수관계가 아님",
    "buyer_minor": "증여받는 사람은 성년",
    "prior_deduction_used": "10년 안에 같은 쪽(직계존속 등)에게서 받은 다른 증여 없음",
}


def _gift(result: StockTransferResult) -> Section | None:
    return next((s for s in result.sections if s.key == "gift_tax" and s.applies), None)


def _size_matters(result: StockTransferResult) -> bool:
    inp, cg = result.inp, result.section("capital_gains")
    short = inp.holding_months is not None and inp.holding_months < 12
    if inp.market == "kotc" and not result.major:
        return True                          # K-OTC 소액주주 — 중소·중견이면 비과세
    return cg.applies and (not result.major or short)


def relevant_assumed(result: StockTransferResult, assumed: Iterable[str] = ()) -> list[str]:
    """가정한 키(슬롯 + 계산기) 중 이번 결과에 영향이 있는 것만, 순서 유지."""
    inp, out = result.inp, []
    for k in dict.fromkeys(list(assumed) + list(result.assumed)):
        if k == "holding_months" and not (result.major and inp.size != "sme"):
            continue                         # 보유기간은 대주주·중소기업 외에서만 세율을 바꾼다
        if k in ("buyer_minor", "prior_deduction_used") and _gift(result) is None:
            continue
        if k == "size" and (inp.size == "sme" or not _size_matters(result)):
            continue
        if k == "on_market" and inp.market not in ("kospi", "kosdaq", "konex"):
            continue
        if k == "relation" and inp.relation != "unrelated":
            continue
        out.append(k)
    return out


def assumed_line(result: StockTransferResult, assumed: Iterable[str] = ()) -> str:
    """'가정: …' 한 줄(결론 문단 끝). 사용자가 말하지 않아 기본값을 쓴 사실 중 이번 결과에 영향이 있는 것만."""
    inp, out = result.inp, []
    for k in relevant_assumed(result, assumed):
        if k == "on_market":
            out.append("증권시장(장내) 거래" if inp.on_market else "증권시장 밖(장외) 직접 거래")
        elif k == "major":
            out.append(result.major_reason)
        elif k == "market":
            out.append({"kospi": "유가증권시장 상장주식", "kosdaq": "코스닥 상장주식", "konex": "코넥스 상장주식",
                        "kotc": "K-OTC 거래 주식"}.get(inp.market, "비상장주식"))
        elif ASSUMED_TEXT.get(k):
            out.append(ASSUMED_TEXT[k])
    return ("가정: " + " · ".join(out) + ".") if out else ""


NOT_MODELED = ("비상장주식의 시가 평가(순손익·순자산가치 보충적 평가), 최대주주 할증 평가, 농어촌특별세, 10년 안의 다른 증여 합산, "
               "같은 해 다른 주식 양도와의 기본공제·세율 합산은 계산하지 않았습니다. 시가는 말씀하신 금액을 그대로 썼습니다.")


# ── 세목별 단계 표 ────────────────────────────────────────────────────────────

def _gift_rate(base: int) -> int:
    for hi, _b, (n, d), _lo in RULES_2026.gift_brackets:
        if hi is None or base <= hi:
            return n * 100 // d
    return 0


def _calc_text(sec: Section, st: Step, prev: dict[str, Step]) -> tuple[str, str]:
    """(계산, 결과) 칸. prev = 같은 절에서 앞서 나온 단계(key → Step)."""
    k, a = st.key, st.amount
    if k == "transfer_value":
        return st.note, f"양도가액 {_w(a)}"
    if k == "expenses":
        return st.note, f"필요경비 {_w(a)}"
    if k == "gain":
        return "양도가액 − 필요경비", f"양도차익 {_w(a)}"
    if k == "basic_deduction":
        return "연 250만원(같은 해 주식 양도소득 합산 한도)", f"기본공제 {_w(a)}"
    if k == "tax_base":
        return "양도차익 − 기본공제", f"과세표준 {_w(a)}"
    if k == "cg_tax":
        return f"과세표준 × 세율({st.note})", f"양도소득세 {_w(a)}"
    if k == "local_tax":
        return "양도소득세 × 10분의 1", f"개인지방소득세 {_w(a)}"
    if k == "stt_base":
        return st.note, f"과세표준 {_w(a)}"
    if k == "stt":
        return f"과세표준 × {st.note}", f"증권거래세 {_w(a)}"
    if k == "gift_gap":
        inp_note = "시가 − 대가" if sec.taxpayer.startswith("양수자") else "대가 − 시가"
        return inp_note, f"차액 {_w(a)}"
    if k == "gift_value":
        gap = prev.get("gift_gap")
        if gap is not None:
            return f"차액 − 기준금액 {_w(gap.amount - a)}", f"증여재산가액 {_w(a)}"
        return "증여받은 재산", f"증여재산가액 {_w(a)}"
    if k == "gift_deduction":
        return st.note, f"증여재산공제 {_w(a)}"
    if k == "gift_base":
        calc = "증여재산가액 − 증여재산공제" + (f"({st.note})" if st.note else "")
        return calc, f"과세표준 {_w(a)}"
    if k == "gift_computed":
        base = prev["gift_base"].amount
        return f"과세표준 × 세율({_gift_rate(base)}% 구간)", f"산출세액 {_w(a)}"
    if k == "gen_skip":
        return f"세대생략 할증 — {st.note}", f"할증 {_w(a)}"
    if k == "filing_credit":
        return ("(산출세액 + 할증) × 3%" if "gen_skip" in prev else "산출세액 × 3%") + " — 기한 내 신고 시", \
            f"신고세액공제 {_w(a)}"
    if k == "gift_tax":
        return ("산출세액 + 할증 − 신고세액공제" if "gen_skip" in prev else "산출세액 − 신고세액공제"), f"**증여세 {_w(a)}**"
    return st.note, f"{st.label} {_w(a)}"


def section_rows(sec: Section) -> list[Row]:
    rows, prev = [], {}
    for st in sec.steps:
        calc, res = _calc_text(sec, st, prev)
        prev[st.key] = st
        law = _laws(st.basis)
        rows.append(Row(f"{st.label}: {calc} = {res}" + (f" ({law})" if law else ""),
                        [law_label(*b) for b in dict.fromkeys(st.basis)], calc, res, law))
    if rows and sec.key in ("capital_gains", "securities_tax") and sec.applies:
        last = rows[-1]
        last.result = f"**{last.result}**"
    return rows


def step_table(sec: Section) -> str:
    """세목 하나의 단계 표(Markdown) — 단계 | 계산 | 결과 | 근거. 과세되지 않으면 빈 문자열(절 문장이 사유를 말한다)."""
    rows = section_rows(sec)
    if not rows or not sec.applies:
        return ""
    lines = ["| 단계 | 계산 | 결과 | 근거 |", "| --- | --- | ---: | --- |"]
    lines += [f"| {_cell(st.label)} | {_cell(r.calc)} | {_cell(r.result)} | {_cell(r.law)} |"
              for st, r in zip(sec.steps, rows)]
    return "\n".join(lines)


def section_citations(sec: Section) -> list[str]:
    keys = list(sec.basis) + [b for st in sec.steps for b in st.basis]
    return [law_label(*k) for k in dict.fromkeys(keys)]


def section_head(sec: Section) -> str:
    """■ 머리 — '■ 양도소득세(양도자)'. 작문 골격(llm 복합 사안 형식)의 머리와 같은 꼴."""
    return f"■ {sec.title}({_payer(sec)})"


def section_lead(sec: Section) -> str:
    """절 첫 문장 — 적용 여부 판정(계산기 reason) + 세액."""
    reason = sec.reason.rstrip(".")
    if not sec.applies:
        return reason + "." if reason else f"{sec.title}는 없습니다."
    return (reason + ". " if reason else "") + f"{_payer(sec)}가 낼 {sec.title}는 {_w(sec.tax)}입니다."


def sections_markdown(result: StockTransferResult) -> list[tuple[Section, str, str]]:
    """세목 절마다 (Section, 첫 문장, 단계 표). 지방소득세는 양도소득세 절에 붙여 따로 절을 만들지 않는다."""
    out = []
    for s in result.sections:
        if s.key == "local_tax":
            continue
        table = step_table(s)
        if s.key == "capital_gains" and s.applies:
            lt = result.section("local_tax")
            table += f"\n| 개인지방소득세 | 양도소득세 × 10분의 1 | {_w(lt.tax)} | {_laws(lt.basis)} |"
        out.append((s, section_lead(s), table))
    return out


def trace_text(result: StockTransferResult, assumed: Iterable[str] = ()) -> str:
    """작문(Solar)에 줄 계산 결과 — 숫자 출처(numeric_guard)이자 '세액은 계산기 값만' 재료."""
    lines = [f"대주주 판정: {result.major_reason}", f"양도가액(세법상): {_w(result.transfer_value)}"]
    for s in result.sections:
        lines.append(f"[{s.title} · {_payer(s)}] {'적용' if s.applies else '적용 안 됨'} — {s.reason}")
        lines += [f"  {st.label}: {_w(st.amount)}" + (f" ({st.note})" if st.note else "") for st in s.steps]
    lines.append(f"합계: {_w(result.total)}")
    a = assumed_line(result, assumed)
    if a:
        lines.append(a)
    return "\n".join(lines)

