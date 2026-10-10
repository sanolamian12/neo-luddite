"""
근로소득세 슬롯 값 읽기 (R2-c, 2026-10-10) — 사용자 발화에서 결정론으로. LLM 호출 없음.

추출기(Solar)도 같은 필드를 채우지만 금액 단위를 틀리거나 말하지 않은 값을 지어낸다(경비 결정변수 실측 —
R1-f verify_decisive). 그래서 ① 발화에서 정규식으로 직접 읽은 값을 먼저 쓰고 ② Solar 값은 발화의 수로
설명될 때만(금액) · 가족 낱말이 있을 때만(인원) 받는다. 뒤 발화가 앞 발화를 고친다("아 연봉 6천이에요").

금액 표기: "연봉 5000" = 5,000만원(단위 없는 10만 미만 수는 만원 단위로 본다) · "4천" = 4천만원 ·
"1억2천" = 1억2천만원 · "5,000만원" · "50,000,000원" · "월급 400만원"(×12). numeric_guard 가 "연봉 4천"을
4,000만원으로 못 읽은 전례(Y02)가 있어 그 파서를 쓰지 않는다.
"""

from __future__ import annotations

import re
from typing import Iterable, Optional

_NUM = r"\d[\d,]*(?:\.\d+)?"
# 금액 덩어리: 억/천만/백만/만/천/백 단위가 섞인 수 + 선택 '원'. 단위 없는 맨 수도 받는다(문맥 낱말이 앞에 있을 때만 쓴다).
_AMOUNT = rf"(?:{_NUM}\s*(?:억|천만|백만|만|천|백)\s*)+(?:{_NUM})?\s*원?|{_NUM}\s*원?"
_ANNUAL_KW = r"연봉|총급여|세전\s*연봉|연\s*소득|연소득|연\s*수입|연수입|1년\s*(?:에|동안)?\s*(?:급여|월급)?|일\s?년에?|세전"
# '월' 단독은 앞에 숫자가 없을 때만(“10월 5000만원”의 월은 달력) — read_salary 에서 거른다.
_MONTHLY_KW = r"월급|월\s*급여|월급여|월\s*소득|월소득|월\s*실수령|한\s*달에?|매달|월에?"
_SALARY = re.compile(rf"(?P<kw>{_ANNUAL_KW}|{_MONTHLY_KW})\s*(?:은|는|이|가|이요|으로|로|을|를|이\s*)?\s*"
                     rf"(?:약|대략|한|세전|정도)?\s*(?P<amt>{_AMOUNT})")
_MONTHLY_RX = re.compile(_MONTHLY_KW)
_NONTAX = re.compile(rf"(?P<kw>식대|식비|비과세|자가운전\s*보조금|차량\s*유지비)\s*(?:은|는|이|가|로|으로|가\s*)?\s*"
                     rf"(?P<per>월|한\s*달|연|1년)?\s*(?:에)?\s*(?P<amt>{_AMOUNT})")
_NO_NONTAX = re.compile(r"(?:비과세|식대)\D{0,6}(?:없|안\s*받|0\s*원)")

_KNUM = {"한": 1, "하나": 1, "두": 2, "둘": 2, "세": 3, "셋": 3, "네": 4, "넷": 4, "다섯": 5, "여섯": 6}
_COUNT = r"(\d+|한|하나|두|둘|세|셋|네|넷|다섯|여섯)"
_DEPENDENTS = re.compile(rf"부양\s*가족\D{{0,4}}?{_COUNT}\s*(?:명|분)")
_HOUSEHOLD = re.compile(rf"{_COUNT}\s*인\s*가구|{_COUNT}\s*식구|가족\s*(?:이|은|은\s*)?\s*{_COUNT}\s*명")
_SINGLE = re.compile(r"혼자\s*(?:살|사는|살아)|1인\s*가구|싱글|미혼|부양\s*가족\D{0,4}(?:없|0\s*명)")
# 조사만 사이에 허용 — "애매하게 두 번"을 자녀 2명으로 읽지 않게.
_CHILDREN = re.compile(rf"(?:자녀|아이|애|아들|딸)(?:\s*(?:가|이|는|은|도))?\s*{_COUNT}(?:\s*명|(?=\s|$|이|예|요|있))")
_NO_CHILD = re.compile(r"(?:자녀|아이|애)\D{0,4}(?:없|0\s*명)")
_FAMILY_WORD = re.compile(r"부양|가족|가구|식구|배우자|아내|남편|와이프|자녀|아이|애|아들|딸|부모|어머니|아버지|혼자|싱글|미혼")

_UNIT = {"억": 10**8, "천만": 10**7, "백만": 10**6, "만": 10**4, "천": 10**3, "백": 10**2}
_PART = re.compile(rf"({_NUM})\s*(억|천만|백만|만|천|백)?")


def parse_amount(s: str) -> Optional[int]:
    """금액 표기 → 원. 만원 단위 생략 관행: 억 뒤 남은 수와 단위 없는/천·백만 붙은 10만 미만 수는 만원 단위."""
    s = s.strip()
    if not s:
        return None
    won_suffix = s.endswith("원")
    has_man = "만" in s
    total_eok, rest = 0.0, 0.0
    for num, unit in _PART.findall(s):
        v = float(num.replace(",", "") or 0)
        if unit == "억":
            total_eok += v * _UNIT["억"]
        elif unit:
            rest += v * _UNIT[unit]
        else:
            rest += v
    if not has_man and rest and rest < 100_000 and not (won_suffix and total_eok == 0 and rest >= 1_000):
        # "연봉 5000" · "4천" · "1억2천" · "월급 400" → 만원 단위. "3000원" 같은 진짜 원 표기는 문맥상 급여가 아니라 제외.
        rest *= 10_000
    value = int(total_eok + rest)
    return value or None


def _count(tok: str) -> Optional[int]:
    return int(tok) if tok.isdigit() else _KNUM.get(tok)


def _first_group(m: re.Match) -> Optional[int]:
    return next((_count(g) for g in m.groups() if g), None)


_CHANGE = re.compile(rf"(?P<a>{_AMOUNT})\s*에서\s*(?P<b>{_AMOUNT})\s*(?:으로|로)")


def read_salary_change(texts: Iterable[str]) -> Optional[tuple[int, int]]:
    """'연봉이 3800에서 4500으로' — (전, 후) 연액. 급여 낱말이 같은 문장에 있을 때만."""
    found = None
    for t in texts:
        t = t or ""
        if not re.search(_ANNUAL_KW + "|" + _MONTHLY_KW, t):
            continue
        for m in _CHANGE.finditer(t):
            a, b = parse_amount(m.group("a")), parse_amount(m.group("b"))
            if a and b and 1_000_000 <= a <= 10_000_000_000 and 1_000_000 <= b <= 10_000_000_000:
                found = (a, b)
    return found


def read_salary(texts: Iterable[str]) -> Optional[int]:
    """총급여(연액, 원). 마지막에 말한 값이 이긴다. 월급은 ×12. 'A에서 B로'는 B."""
    texts = list(texts)
    found = None
    for t in texts:
        for m in _SALARY.finditer(t or ""):
            v = parse_amount(m.group("amt"))
            if not v:
                continue
            kw = m.group("kw").strip()
            if kw.startswith("월") and m.start() > 0 and (t[m.start() - 1].isdigit()):
                continue                                      # "10월 5000만원" — 달력의 월
            monthly = kw.startswith(("월", "한", "매"))
            annual = v * 12 if monthly else v
            if 1_000_000 <= annual <= 10_000_000_000:          # 연 100만원 ~ 100억원 밖은 급여로 안 본다
                found = annual
    change = read_salary_change(texts)
    return change[1] if change else found


def read_nontaxable(texts: Iterable[str]) -> Optional[int]:
    """비과세 급여(연액, 원). 식대 등은 월액이 관행 → '연'·'1년'이 붙지 않으면 ×12. '없다'면 0."""
    found = None
    for t in texts:
        t = t or ""
        if _NO_NONTAX.search(t):
            found = 0
        for m in _NONTAX.finditer(t):
            v = parse_amount(m.group("amt"))
            if v is None:
                continue
            per = (m.group("per") or "").replace(" ", "")
            found = v if per in ("연", "1년") else v * 12
    return found


def read_dependents(texts: Iterable[str]) -> Optional[int]:
    """본인 외 기본공제대상자 수. 'N인 가구'·'식구 N명' = N−1, '혼자'·'1인 가구' = 0."""
    found = None
    for t in texts:
        t = t or ""
        if _SINGLE.search(t):
            found = 0
        for m in _HOUSEHOLD.finditer(t):
            n = _first_group(m)
            if n:
                found = n - 1
        for m in _DEPENDENTS.finditer(t):
            n = _first_group(m)
            if n is not None:
                found = n
    return found


def read_children(texts: Iterable[str]) -> Optional[int]:
    found = None
    for t in texts:
        t = t or ""
        if _NO_CHILD.search(t):
            found = 0
        for m in _CHILDREN.finditer(t):
            n = _first_group(m)
            if n:
                found = n
    return found


def _numbers(texts: Iterable[str]) -> set[int]:
    """발화의 모든 수를 금액 해석 후보로(원 · 만원 · 월→연). Solar 금액 검증용."""
    out: set[int] = set()
    for t in texts:
        for m in re.finditer(_AMOUNT, t or ""):
            v = parse_amount(m.group(0))
            raw = re.sub(r"[^\d.]", "", m.group(0).split("원")[0])
            cands = {v} if v else set()
            if raw.replace(".", "").isdigit():
                n = float(raw)
                cands |= {int(n), int(n * 10_000)}
            for c in cands:
                out |= {c, c * 12}
    return out


def merge_slots(solar: dict, user_texts: list[str]) -> dict:
    """계산 슬롯 dict(연액·원). 결정론 파서 값 우선, Solar 값은 발화로 설명될 때만."""
    out: dict = {}
    for key, reader in (("total_salary", read_salary), ("nontaxable", read_nontaxable)):
        v = reader(user_texts)
        if v is not None:
            out[key] = v

    def ok_count(v) -> bool:
        return isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 10

    # 부양가족: 'N인 가구'·'부양가족 N명' 같은 직접 표현 > Solar(가족 낱말이 있을 때만) > 자녀 언급 수(하한).
    # 자녀 언급("애 하나")은 부양가족 수의 하한으로만 쓴다. 자녀세액공제는 나이 요건(§59의2①)이 있어 말만으로
    # 넣으면 보수 가정이 아니다 — 대상 자녀 수를 물어 답한 경우(read_reply)나 '자녀세액공제'를 직접 말한 경우만.
    family = any(_FAMILY_WORD.search(t or "") for t in user_texts)
    said = read_dependents(user_texts)
    kids = read_children(user_texts) or 0
    solar_dep = solar.get("dependents") if family and ok_count(solar.get("dependents")) else None
    if said is not None:
        out["dependents"] = said
    elif solar_dep is not None or kids:
        out["dependents"] = max(solar_dep or 0, kids)

    nums = _numbers(user_texts)
    for key in ("total_salary", "nontaxable"):
        v = solar.get(key)
        if key not in out and isinstance(v, int) and not isinstance(v, bool) and v > 0 and v in nums:
            out[key] = v
    credit_said = any("자녀세액공제" in (t or "") for t in user_texts)
    for key in ("children_credit", "elderly70", "disabled"):
        v = solar.get(key)
        if not (family and ok_count(v)) or (key == "children_credit" and not credit_said):
            continue
        out[key] = v
    return out


_BARE_COUNT = re.compile(rf"^\s*(?:네\s*,?\s*)?{_COUNT}\s*(?:명|분)")
_BARE_NONE = re.compile(r"^\s*(?:네\s*,?\s*)?(?:(?:둘\s*다|모두|전부)\s*)?(?:없|0\s*명|안\s*받|아니)")
# 단위(만·천·원)가 붙은 금액만 — "1인 가구예요"의 1을 비과세 1만원으로 읽은 일(W01 2턴 로컬 실측).
_BARE_AMOUNT = re.compile(rf"^\s*(?:월\s*|한\s*달에?\s*)?(?P<amt>(?:{_NUM}\s*(?:만|천)\s*)+(?:{_NUM})?\s*원?|{_NUM}\s*원)")


def read_reply(text: str, asked: list[str]) -> dict:
    """되묻기에 대한 짧은 답 — 직전에 물은 슬롯에 붙인다(낱말 없이 "2명이요"·"없어요"·"20만원이요"만 오는 답).
    수는 물은 인원 슬롯 중 첫째, '없다'는 물은 슬롯 전부 0, 금액은 비과세(월액 → ×12)."""
    out: dict = {}
    t = text or ""
    counts = [k for k in asked if k in ("dependents", "children_credit")]
    m = _BARE_COUNT.match(t)
    if m and counts:
        n = _first_group(m)
        if n is not None:
            out[counts[0]] = n
            return out
    if _BARE_NONE.match(t):
        return {k: 0 for k in asked if k in ("dependents", "children_credit", "nontaxable")}
    m = _BARE_AMOUNT.match(t)
    if m and "nontaxable" in asked:
        v = parse_amount(m.group("amt"))
        if v and v < 10_000_000:                               # 월 1천만원 넘는 비과세는 답으로 안 본다
            out["nontaxable"] = v * 12
    return out
