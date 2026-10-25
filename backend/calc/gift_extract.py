"""
일반 증여(주식 아님) 슬롯 값 읽기 (E 확장, 2026-10-26) — 사용자 발화에서 결정론으로. LLM 호출 없음.

calc.stock_transfer_extract 와 같은 원칙: 정규식으로 직접 읽고, 뒤 발화가 앞 발화를 고친다(마지막 값이 이긴다).
금액은 같은 parse_amount 를 쓰되 **단위(억·만·천·원)가 붙은 것만** 금액으로 본다('10년'·'17살'의 수를 만원으로 읽지 않게).

읽는 키(없으면 dict 에 넣지 않는다 — calc.gift_slots 가 가정한다):
  value(증여재산가액) · relation(받는 사람이 주는 사람에게 누구인가 — child·grandchild·parent·spouse·relative·unrelated) ·
  minor(받는 사람 미성년) · marriage('marriage'|'birth') · prior_gifts(10년 안 앞선 증여 합계) · prior_tax(앞선 증여세)
"""

from __future__ import annotations

import re
from typing import Iterable, Optional

from calc.income_tax_extract import _AMOUNT, parse_amount
from calc.stock_transfer_extract import _ADULT, _AGE, _FROM, _MINOR, _NO_PRIOR, _REL_WORDS, _TO

_MONEY = re.compile(rf"(?P<amt>{_AMOUNT})")
_UNIT = re.compile(r"억|만|천|원")
_MV = re.compile(rf"(?:시가|시세|평가액|감정가|공시\s*가격?)\s*(?:은|는|이|가)?\s*(?:약|대략|한)?\s*(?P<amt>{_AMOUNT})")
# 앞선 증여 — '5년 전에 3천만원 받았어요' · '작년에도 2천만원을 증여받았' (stock _PRIOR 과 같은 꼴, '도' 허용)
_PRIOR = re.compile(rf"(?:\d+\s*년\s*)?(?:안에|이내에?|전에|예전에|이전에|작년에|재작년에)\s*(?:도|에도)?\D{{0,12}}?"
                    rf"(?P<amt>{_AMOUNT})\s*(?:을|를|정도)?\s*(?:현금\s*)?(?:으로\s*)?(?:증여|받)")
_PRIOR_TAX = re.compile(rf"(?:증여세|세금)\s*(?:를|은|는|로|으로)?\s*(?P<amt>{_AMOUNT})\s*(?:을|를|정도)?\s*(?:냈|내었|납부)")
# 혼인 공제(§53의2)는 혼인일 전후 2년 — '결혼한 아들'처럼 지난 상태만 말한 것은 잡지 않는다(가정 줄·청하기로 묻는다)
_MARRY = re.compile(r"결혼\s*(?:자금|비용|준비|예정|계획|할|하면|하는|하게|식|선물|축하|전|후|앞두|을\s*앞)|혼인\s*(?:신고|예정|자금|하)"
                    r"|웨딩|신혼|예식|결혼하")
_NOT_MARRY = re.compile(r"미혼|결혼\s*(?:안|않|못|계획\s*없)|혼인\s*(?:안|않)")
_BIRTH = re.compile(r"출산|자녀\s*출생|아이를?\s*낳|아기를?\s*낳|입양")
_GRANDPARENT = r"외?할아버지|외?할머니|외?조부모님?|외?조부|외?조모"
_GIVE = re.compile(r"\s*(?:님)?\s*(?:이|가|께서)\s*\S{0,10}?\s*(?:주|줘|증여하|증여해|물려)")
_RECEIVE_AFTER = re.compile(r"\s*(?:님)?\s*(?:께|에게|한테)[^.?!,]{0,16}?받")   # '아버지께 1억을 증여받았는데
_INVERSE = {"child": "parent", "grandchild": "grandparent", "parent": "child", "grandparent": "grandchild",
            "spouse": "spouse", "relative": "relative", "unrelated": "unrelated", "other_related": "unrelated"}


def _amount(s: str) -> Optional[int]:
    return parse_amount(s) if _UNIT.search(s) else None


def _hits(t: str) -> list[tuple[int, str, str]]:
    """(위치, 관계 낱말이 가리키는 사람, 방향) — 'to' = 그 사람이 받는다, 'from' = 그 사람이 준다, '' = 모름."""
    words = (("grandparent", _GRANDPARENT),) + _REL_WORDS
    hits, taken = [], []
    for rel, pat in words:
        for m in re.finditer(pat, t):
            if any(a <= m.start() < b for a, b in taken):      # '할아버지' 안의 '아버지'를 다시 읽지 않게
                continue
            taken.append((m.start(), m.end()))
            tail = t[m.end():m.end() + 30]
            if re.match(_FROM, tail) or _RECEIVE_AFTER.match(tail) or _GIVE.match(tail):
                way = "from"                                   # '부모님께 1억 받으면' — '께'라도 뒤에 '받'이면 주는 사람
            elif re.match(_TO, tail):
                way = "to"
            else:
                way = ""
            hits.append((m.start(), rel, way))
    return sorted(hits)


def read_relation(texts: Iterable[str]) -> Optional[str]:
    """받는 사람이 주는 사람에게 누구인가. 방향이 드러난 언급이 이기고 같은 종류끼리는 마지막이 이긴다.
    방향을 모르면 받는 사람으로 본다('아들 증여세' — 가장 흔한 꼴)."""
    directed = plain = None
    for t in texts:
        for _pos, rel, way in _hits(t or ""):
            if rel == "unrelated":
                directed = rel
            elif way == "from":
                directed = _INVERSE.get(rel, rel)
            elif way == "to":
                directed = "grandchild" if rel == "grandparent" else rel
            else:
                plain = _INVERSE[rel] if rel == "grandparent" else rel
    rel = directed or plain
    return "unrelated" if rel == "other_related" else rel


def read_slots(texts: Iterable[str]) -> dict:
    texts = [t or "" for t in texts]
    out: dict = {}
    for t in texts:
        prior_spans = [m.span() for rx in (_PRIOR, _PRIOR_TAX) for m in rx.finditer(t)]
        mv = [m for m in _MV.finditer(t) if not any(a <= m.start() < b for a, b in prior_spans)]
        cands = [m for m in _MONEY.finditer(t) if not any(a <= m.start() < b for a, b in prior_spans)]
        v = next((_amount(m.group("amt")) for m in mv if _amount(m.group("amt"))), None)
        if v is None:
            v = next((x for x in (_amount(m.group("amt")) for m in cands) if x), None)
        if v:
            out["value"] = v
        if _NO_PRIOR.search(t):
            out["prior_gifts"] = 0
        p = [x for x in (_amount(m.group("amt")) for m in _PRIOR.finditer(t)) if x]
        if p:
            out["prior_gifts"] = sum(p)
        pt = [x for x in (_amount(m.group("amt")) for m in _PRIOR_TAX.finditer(t)) if x is not None]   # '0원 냈어요'도 값
        if pt:
            out["prior_tax"] = sum(pt)
        if _NOT_MARRY.search(t):
            out.pop("marriage", None)
        elif _MARRY.search(t):
            out["marriage"] = "marriage"
        if _BIRTH.search(t):
            out["marriage"] = "birth"
        if _MINOR.search(t):
            out["minor"] = True
        elif _ADULT.search(t):
            out["minor"] = False
        for x in _AGE.finditer(t):
            n = int(x.group("n"))
            if n <= 30:
                out["minor"] = n < 19
    rel = read_relation(texts)
    if rel:
        out["relation"] = rel
    return out
