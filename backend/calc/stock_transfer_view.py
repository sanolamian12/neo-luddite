"""
주식 양도 복합 사안 계산 결과 → 화면 문장·표 (E단계, 2026-10-19). 결정론, LLM 호출 없음.

설계 `design/E단계_주식양도_복합사안_설계_1014.md` §2-2 골격의 숫자 자리를 채운다:
  · 결론 문단: headline(누가 어떤 세금을 얼마) + summary_table(세목 | 납세자 | 세액) + assumed_line('가정: …')
  · ■ 세목·납세자별: section_rows → step_table(단계 | 계산 | 결과 | 근거) — calc.income_tax_view 와 같은 표 꼴
  · NOT_MODELED: 계산하지 않는 것(평가·최대주주 할증·농특세·10년 합산)
값은 전부 calc.stock_transfer 결과 그대로(새 계산 없음). 조문 배지는 행마다 직접 붙인다(income_tax_view 와 같은 이유).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from calc.income_tax_view import Row, law_label
from calc.stock_transfer import EOK, RULES_2026, Section, Step, StockTransferResult, major_rule


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
        if k == "buyer_minor" and _gift(result).taxpayer == "양도자":
            continue                         # 고가 양도 — 이익을 얻은 쪽이 양도자라 양수자 나이는 계산에 안 쓴다
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


NOT_MODELED = ("비상장주식의 시가 평가(순손익·순자산가치 보충적 평가), 최대주주 할증 평가(상속세 및 증여세법 제63조제3항 — "
               "양도소득세의 대주주와 다른 기준), 농어촌특별세, 10년 안의 다른 증여 합산, "
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
    if k == "gift_prior":                                  # 일반 증여 10년 합산(10/26) — 주식 §35 경로엔 없는 단계
        return f"10년 안 앞선 증여 — {st.note}", f"가산액 {_w(a)}"
    if k == "gift_taxable":
        calc = "이번 증여재산가액" + (" − 인수 채무" if "gift_debt" in prev else "") + (" + 가산액" if "gift_prior" in prev else "")
        return calc, f"과세가액 {_w(a)}"
    if k == "gift_debt":                                   # 부담부증여(10/26 밤) — 채무 부분은 증여자 양도(소득세법 §88①)
        return st.note, f"인수 채무 {_w(a)}"
    if k == "gift_deduction":
        return st.note, f"증여재산공제 {_w(a)}"
    if k == "gift_marriage":
        return st.note, f"혼인·출산 공제 {_w(a)}"
    if k == "gift_base":
        calc = (("증여세 과세가액" if "gift_taxable" in prev else "증여재산가액")
                + (" − 증여재산공제 − 혼인·출산 공제" if "gift_marriage" in prev else " − 증여재산공제")
                + (f"({st.note})" if st.note else ""))
        return calc, f"과세표준 {_w(a)}"
    if k == "prior_credit":
        return st.note, f"납부세액공제 {_w(a)}"
    if k == "gift_computed":
        base = prev["gift_base"].amount
        return f"과세표준 × 세율({_gift_rate(base)}% 구간)", f"산출세액 {_w(a)}"
    if k == "gen_skip":
        return f"세대생략 할증 — {st.note}", f"할증 {_w(a)}"
    if k == "filing_credit" and "prior_credit" in prev:
        return "(산출세액 − 납부세액공제) × 3% — 기한 내 신고 시", f"신고세액공제 {_w(a)}"
    if k == "gift_tax" and "prior_credit" in prev:
        return "산출세액 − 납부세액공제 − 신고세액공제", f"**증여세 {_w(a)}**"
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


# ── 경우 나누기(설계 §2-4 10/20 변경) ─────────────────────────────────────────
# 대주주 여부·회사 규모를 모르면 calc.stock_transfer_slots.scenarios 가 조합마다 계산해 양도소득세 결과가 같은 것을 합친다.
# 여기선 그 목록을 결론 문단·경우별 표·양도소득세 절(세율 행만 경우별)로 바꾼다. 경우가 1개면 위 함수들 그대로(출력 동일).

@dataclass
class Scenario:
    terms: list[dict]                # '또는'으로 묶인 조건들 — 조건 = {"major": bool, "size": "sme"|"large"} 의 일부
    result: StockTransferResult      # 그 묶음의 대표 계산(묶음 안은 양도소득세가 같고 다른 세목은 경우와 무관)


_NOUN = {("major", True): "대주주", ("major", False): "대주주 아님", ("size", "sme"): "중소기업", ("size", "large"): "중소기업 아님"}
_STEM = {("major", True): "대주주이", ("major", False): "대주주가 아니", ("size", "sme"): "중소기업이",
         ("size", "large"): "중소기업이 아니"}


def case_label(sc: Scenario) -> str:
    """표 '경우' 칸 — '대주주 아님 · 중소기업'. 조건 없음 = '모든 경우'."""
    return " 또는 ".join(" · ".join(_NOUN[(d, v)] for d, v in t.items()) or "모든 경우" for t in sc.terms)


def case_clause(sc: Scenario, first: bool = False) -> str:
    """문장 조건절 — '대주주가 아니고 중소기업이면' · '대주주이거나 중소기업이 아니면'. first = 문단 첫 '대주주'에 '소득세법상'."""
    out = "거나 ".join("고 ".join(_STEM[(d, v)] for d, v in t.items()) for t in sc.terms) + "면"
    return ("소득세법상 " + out) if first and out.startswith("대주주") else out


def split_dims(scens: list[Scenario]) -> list[str]:
    """경우를 실제로 가른 값(조건에 한 번이라도 나온 차원) — 청하기 문장 재료."""
    if len(scens) < 2:
        return []
    return [d for d in ("major", "size") if any(d in t for sc in scens for t in sc.terms)]


def major_rule_text(result: StockTransferResult) -> str:
    """'대주주'를 쓸 때 늘 함께 — 조문 기준(상장 시행령 §157 · 비상장 §167의8)."""
    rule, basis = major_rule(result.inp)
    return f"{law_label(*basis[0])} — 본인과 특수관계인(기타주주) 합산 {rule}, 직전 사업연도 말 기준"


def _cg_pair(r: StockTransferResult) -> tuple[Section, Section]:
    return r.section("capital_gains"), r.section("local_tax")


def short_rate(r: StockTransferResult) -> str:
    """경우별 표 '적용 세율' 칸 — 과세표준이 3억원 이하면 대주주 누진도 '20%'."""
    cg = r.section("capital_gains")
    if not cg.applies:
        return "과세 대상 아님"
    note = cg.steps[-1].note
    if "3억원 이하 20%" in note:
        base = next(st.amount for st in cg.steps if st.key == "tax_base")
        return "20%" if base <= 3 * EOK else "20%(3억원 초과분 25%)"
    return note.rsplit(" ", 1)[-1]


def _common(r: StockTransferResult) -> list[Section]:
    return [s for s in r.sections if s.key not in ("capital_gains", "local_tax")]


def case_headline(scens: list[Scenario]) -> str:
    """결론 첫 문장 — 합계를 경우별로. 다음 문장 = 대주주 기준(조문) · 경우와 무관한 세금."""
    if len(scens) == 1:
        return headline(scens[0].result)
    out = ", ".join(f"{case_clause(sc, i == 0)} 합계 {_w(sc.result.total)}" for i, sc in enumerate(scens)) + "입니다."
    if "major" in split_dims(scens):
        out += f" 대주주 기준은 {major_rule_text(scens[0].result)}입니다."
    common = [s for s in _common(scens[0].result) if s.applies and s.tax > 0]
    if common:
        by_payer: dict[str, list[Section]] = {}
        for s in common:
            by_payer.setdefault(_payer(s), []).append(s)
        out += " 어느 경우든 " + ", ".join(f"{who}는 " + "·".join(f"{s.title} {_w(s.tax)}" for s in ss) + "을"
                                       for who, ss in by_payer.items()) + " 냅니다."
    return out


def case_table(scens: list[Scenario]) -> str:
    """경우별 표 — 경우 | 적용 세율 | 양도소득세+지방소득세 | 합계."""
    lines = ["| 경우 | 적용 세율 | 양도소득세+지방소득세 | 합계 |", "| --- | --- | ---: | ---: |"]
    for sc in scens:
        cg, lt = _cg_pair(sc.result)
        both = cg.tax + lt.tax if cg.applies else 0
        lines.append(f"| {_cell(case_label(sc))} | {short_rate(sc.result)} | {_w(both) if both else '없음'} | "
                     f"{_w(sc.result.total)} |")
    return "\n".join(lines)


def common_table(scens: list[Scenario]) -> str:
    """경우와 무관한 세목 — 세목 | 납세자 | 세액, 양도소득세는 '경우별(위 표)' 한 줄."""
    lines = ["| 세목 | 납세자 | 세액 |", "| --- | --- | ---: |",
             "| 양도소득세·개인지방소득세(양도소득분) | 양도자 | 경우별(위 표) |"]
    for s in _common(scens[0].result):
        lines.append(f"| {s.title} | {_payer(s)} | {_w(s.tax) if s.applies and s.tax else '없음'} |")
    return "\n".join(lines)


def relevant_assumed_cases(scens: list[Scenario], assumed: Iterable[str] = ()) -> list[str]:
    assumed = list(assumed)
    return list(dict.fromkeys(k for sc in scens for k in relevant_assumed(sc.result, assumed)))


def assumed_line_cases(scens: list[Scenario], assumed: Iterable[str] = ()) -> str:
    """경우 여럿 — 어느 경우에서든 결과에 영향이 있는 가정(대주주·규모는 경우로 나눴으니 빼고)."""
    assumed = list(assumed)
    if len(scens) == 1:
        return assumed_line(scens[0].result, assumed)
    out = []
    for k in relevant_assumed_cases(scens, assumed):
        if k in ("major", "size"):
            continue
        rep = next(sc.result for sc in scens if k in relevant_assumed(sc.result, assumed))   # 그 가정이 영향을 주는 경우
        line = assumed_line(rep, [k])
        if line:
            out.append(line[len("가정: "):-1])
    return ("가정: " + " · ".join(out) + ".") if out else ""


def conclusion_parts(scens: list[Scenario], assumed: Iterable[str] = ()) -> list[tuple[str, str]]:
    """결론 문단(summary 자리) 조각 [(kind, text)] — kind = headline | table | assumed.
    경우 1개 = headline + 합계 표 + 가정 줄(기존과 같음), 2개+ = 경우별 문장 + 경우별 표 + 공통 표 + 가정 줄."""
    assumed = list(assumed)
    if len(scens) == 1:
        r = scens[0].result
        parts = [("headline", headline(r)), ("table", summary_table(r)), ("assumed", assumed_line(r, assumed))]
    else:
        parts = [("headline", case_headline(scens)), ("table", case_table(scens)), ("table", common_table(scens)),
                 ("assumed", assumed_line_cases(scens, assumed))]
    return [(k, t) for k, t in parts if t]


def conclusion_markdown(scens: list[Scenario], assumed: Iterable[str] = ()) -> str:
    return "\n\n".join(t for _, t in conclusion_parts(scens, assumed))


def calc_citation_keys(scens: list[Scenario]) -> set[tuple[str, str]]:
    """계산 표가 다는 조문 키 전부 — 답의 허용 조문(배지 대조)에 더한다."""
    return {b for sc in scens for s in sc.result.sections for b in list(s.basis) + [k for st in s.steps for k in st.basis]}


def _case_cg_lead(scens: list[Scenario]) -> str:
    rep = scens[0].result
    unfair = rep.section("capital_gains").reason.split(" · ")[0] if rep.unfair else ""
    cases = []
    for sc in scens:
        cg = sc.result.section("capital_gains")
        if cg.applies:
            cases.append(f"{case_clause(sc)} {short_rate(sc.result)}로 {_w(cg.tax)}")
        else:
            cases.append(f"{case_clause(sc)} 과세 대상이 아니어서 없음")
    return ((unfair + ". ") if unfair else "") + "양도소득세 세율은 대주주 여부·회사 규모에 따라 갈립니다 — " + ", ".join(cases) + "."


def _case_cg_table(scens: list[Scenario]) -> str:
    """양도소득세 단계 표 — 과세표준까지 공통, 세율·지방소득세 행만 경우별."""
    rep = next((sc.result for sc in scens if sc.result.section("capital_gains").applies), None)
    if rep is None:
        return ""
    cg = rep.section("capital_gains")
    lines = ["| 단계 | 계산 | 결과 | 근거 |", "| --- | --- | ---: | --- |"]
    lines += [f"| {_cell(st.label)} | {_cell(r.calc)} | {_cell(r.result)} | {_cell(r.law)} |"
              for st, r in zip(cg.steps, section_rows(cg)) if st.key != "cg_tax"]
    for sc in scens:
        c, lt = _cg_pair(sc.result)
        lab = _cell(case_label(sc))
        if not c.applies:
            lines.append(f"| 양도소득세 — {lab} | {_cell(c.reason.rstrip('.'))} | 없음 | {_laws(c.basis)} |")
            continue
        st = c.steps[-1]
        rate = short_rate(sc.result) if len(sc.terms) > 1 else st.note   # '대주주 또는 중소기업 아님' — 묶음 공통 세율만
        lines.append(f"| 양도소득세 — {lab} | 과세표준 × 세율({_cell(rate)}) | **양도소득세 {_w(c.tax)}** | {_laws(st.basis)} |")
        lines.append(f"| 개인지방소득세 — {lab} | 양도소득세 × 10분의 1 | {_w(lt.tax)} | {_laws(lt.basis)} |")
    return "\n".join(lines)


def sections_markdown_cases(scens: list[Scenario]) -> list[tuple[Section, str, str]]:
    """sections_markdown 의 경우별 판 — 양도소득세 절만 바뀌고 다른 절은 대표 계산 그대로."""
    out = sections_markdown(scens[0].result)
    if len(scens) == 1:
        return out
    return [(s, _case_cg_lead(scens), _case_cg_table(scens)) if s.key == "capital_gains" else (s, lead, t)
            for s, lead, t in out]


def trace_text_cases(scens: list[Scenario], assumed: Iterable[str] = ()) -> str:
    """작문 숫자 출처 — 경우 여럿이면 대표 계산 + 경우별 양도소득세·합계 + 대주주 기준."""
    assumed = list(assumed)
    if len(scens) == 1:
        return trace_text(scens[0].result, assumed)
    lines = [trace_text(scens[0].result, assumed), "경우별(대주주 여부·회사 규모를 몰라 나눔):"]
    for sc in scens:
        cg, lt = _cg_pair(sc.result)
        lines.append(f"  [{case_label(sc)}] 양도소득세 {_w(cg.tax if cg.applies else 0)} · 개인지방소득세 "
                     f"{_w(lt.tax if lt.applies else 0)} · 합계 {_w(sc.result.total)}")
    lines.append(f"대주주 기준: {major_rule_text(scens[0].result)}")
    return "\n".join(lines)

