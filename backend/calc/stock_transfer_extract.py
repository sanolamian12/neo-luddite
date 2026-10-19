"""
주식 양도 슬롯 값 읽기 (E단계, 2026-10-19) — 사용자 발화에서 결정론으로. LLM 호출 없음.

calc.income_tax_extract 와 같은 원칙: 발화에서 정규식으로 직접 읽고, 뒤 발화가 앞 발화를 고친다(마지막 값이 이긴다).
금액 표기는 같은 parse_amount("10억" · "1억2천" · "3,000만원" · 단위 없는 10만 미만 수 = 만원 단위)를 쓴다.

읽는 키(calc.stock_transfer.StockTransferInput 과 같은 이름, 없으면 dict 에 넣지 않는다 — 슬롯이 가정한다):
  market_value · price · acquisition · market('unlisted' 또는 MARKETS) · on_market · size · share_pct ·
  holding_months · relation(양수자가 양도자에게 누구인가 — calc.stock_transfer.RELATIONS) · buyer_minor ·
  prior_deduction_used
"""

from __future__ import annotations

import re
from typing import Iterable, Optional

from calc.income_tax_extract import _AMOUNT, parse_amount

_P = r"(?:은|는|이|가|을|를|도)?\s*(?:약|대략|한|정도)?\s*"
# ── 금액 ─────────────────────────────────────────────────────────────────────
# 산 때(과거) = 취득가 · 살 때(앞으로) = 거래가. '산'은 '산다'(앞으로)를 뺀다.
_BOUGHT = r"(?:샀|사서|사\s*둔|산(?!다)|사들|매수했|매수한|매입했|매입한|취득했|취득한|취득|구입했|구입한)"
_WILL_BUY = r"(?:사려|사면|살\s*(?:때|계획|예정|생각)|사기로|사고\s*싶|매수하려|매수하면|인수하려|인수하면|양수하려|양수하면|넘겨\s*받으려|넘겨\s*받으면)"
_MV = re.compile(rf"(?:시가|시세|평가액|평가\s*금액|감정가|시장\s*가격){_P}(?P<amt>{_AMOUNT})")
_ACQ = re.compile(rf"(?:취득\s*가(?:액)?|매입\s*가(?:액)?|매수\s*가(?:액)?|산\s*가격|구입\s*가(?:액)?|취득\s*원가){_P}(?P<amt>{_AMOUNT})"
                  rf"|(?P<amt2>{_AMOUNT})\s*(?:에|을|를|으로|로|주고)\s*(?:처음\s*)?{_BOUGHT}")
_PRICE = re.compile(rf"(?:거래\s*가(?:액)?|양도\s*가(?:액)?|매매\s*(?:가(?:액)?|대금)|매도\s*가(?:액)?|대가|판\s*가격|파는\s*가격){_P}"
                    rf"(?P<amt>{_AMOUNT})"
                    rf"|(?P<amt2>{_AMOUNT})\s*(?:에|을|를|으로|로|만)\s*(?:받고\s*)?(?:주식을?\s*)?"
                    rf"(?:양도|팔|판|넘기|넘겨|매도|판매|처분|넘긴|넘길)"
                    rf"|(?P<amt3>{_AMOUNT})\s*(?:을|를)?\s*받고"
                    rf"|(?P<amt4>{_AMOUNT})\s*(?:에|으로|로)\s*(?:주식을?\s*)?{_WILL_BUY}")
_AT_MARKET = re.compile(r"시가(?:대로|에|로|\s*그대로|와\s*같은\s*가격에)\s*[^.?!,\d]{0,12}?(?:양도|팔|판|넘기|넘겨|매도|판매|처분|사려|사면|매수)")

# ── 지분 · 보유기간 ───────────────────────────────────────────────────────────
_SHARE = re.compile(r"(?:지분(?:율)?|보유\s*비율|주식)\D{0,6}?(?P<p>\d+(?:\.\d+)?)\s*(?:%|퍼센트|프로)"
                    r"|(?P<p2>\d+(?:\.\d+)?)\s*(?:%|퍼센트|프로)\s*(?:의\s*)?(?:지분|를?\s*보유|를?\s*가진|가지고|주주)")
# '3년 전에 1억에 샀' 처럼 사이에 금액이 끼어도 받는다(문장 안 16자까지). 증여 이력('5년 전에 증여')은 동사가 달라 안 걸린다.
_HOLD_VERB = r"[^.?!\n]{0,16}?(?:보유|가지고|갖고|들고|샀|사서|사\s*둔|산(?!다)|매수했|매입했|취득)"
_HOLD_Y = re.compile(rf"(?P<n>\d+)\s*년\s*(?:전에?|동안|간|째|넘게|이상)?{_HOLD_VERB}")
_HOLD_M = re.compile(rf"(?P<n>\d+)\s*개월\s*(?:전에?|동안|간|째)?{_HOLD_VERB}")
_HOLD_SHORT = re.compile(r"1\s*년\s*(?:미만|이\s*안\s*(?:된|됐|되)|도\s*안\s*(?:된|됐|되))")

# ── 시장 · 거래 방식 · 규모 ───────────────────────────────────────────────────
_MARKET = (
    ("unlisted", re.compile(r"비상장")),
    ("kotc", re.compile(r"K\s*-?\s*OTC|케이\s*오티씨", re.I)),
    ("konex", re.compile(r"코넥스")),
    ("kosdaq", re.compile(r"코스닥")),
    ("kospi", re.compile(r"코스피|유가증권\s*시장")),
)
_LISTED = re.compile(r"(?<!비)상장(?:\s*주식|\s*회사|사|된|\s*기업)?")
_ON = re.compile(r"장내|증권\s*시장에서|거래소에서|주식\s*시장에서|HTS|MTS|증권\s*앱|증권사\s*앱", re.I)
_OFF = re.compile(r"장외|직거래|직접\s*(?:양도|팔|넘기|넘겨|매도)|개인\s*간\s*(?:거래|양도)")
_SIZE = (("sme", re.compile(r"중소\s*기업")), ("mid", re.compile(r"중견\s*기업")),
         ("large", re.compile(r"대기업|일반\s*기업|중소기업이\s*아닌|중소기업\s*아니")))

# ── 관계(양수자 기준) · 나이 · 증여 이력 ──────────────────────────────────────
# 낱말 → '그 사람이 상대에게 누구인가'. 양수자로 나오면 그대로, 양도자로 나오면 뒤집는다(_INVERSE).
_REL_WORDS = (
    ("unrelated", r"특수\s*관계(?:가|는)?\s*(?:없|아닌|아니)|지인|친구|제\s*3\s*자|타인|모르는\s*사람|남(?=에게|한테)|거래처|무관한\s*사람"),
    ("grandchild", r"손자|손녀|손주"),
    ("child", r"아들|딸|자녀|자식|장남|차남|장녀"),
    ("parent", r"아버지|어머니|부모님?|아빠|엄마|부친|모친"),
    ("spouse", r"배우자|아내|남편|부인(?=에게|한테|이|과|와|께)|와이프"),
    ("relative", r"형님|형(?=에게|한테|이|과|와)|누나|오빠|언니|동생|형제|조카|삼촌|이모|고모|외삼촌|사촌|친척|처남|매형|사위|며느리"),
    ("other_related", r"특수\s*관계(?:인|자|법인)?|가족\s*회사"),
)
_INVERSE = {"child": "parent", "grandchild": "parent", "parent": "child", "spouse": "spouse", "relative": "relative",
            "other_related": "other_related", "unrelated": "unrelated"}
_TO = r"\s*(?:님)?\s*(?:에게|한테|께|에게서는)"
_FROM = r"\s*(?:님)?\s*(?:로부터|에게서|한테서|께서|으로부터)"
_BUY_AFTER = re.compile(r"(?:주식|지분)?\S{0,6}\s*(?:제가|내가|저희가)?\s*(?:사|매수|양수|인수|넘겨\s*받|받)")

_MINOR = re.compile(r"미성년|고등학생|중학생|초등학생|고딩|중딩")
_ADULT = re.compile(r"성년|성인|대학생|직장인|결혼한|취업한")
_AGE = re.compile(r"(?P<n>\d{1,2})\s*(?:살|세)(?!\s*(?:이상|이하|미만|부터))")
_PRIOR = re.compile(rf"(?:10\s*년|십\s*년)?\s*(?:안에|이내에?|전에|예전에|이전에|작년에|재작년에)\D{{0,12}}?(?P<amt>{_AMOUNT})\s*"
                    r"(?:을|를|정도)?\s*(?:현금\s*)?(?:으로\s*)?(?:증여|받)")
_NO_PRIOR = re.compile(r"(?:증여|받은)\s*(?:받은\s*)?(?:적|일)\s*(?:은|이)?\s*(?:없|한\s*번도)")


def _last(rx: re.Pattern, texts: Iterable[str]) -> Optional[re.Match]:
    m = None
    for t in texts:
        for x in rx.finditer(t or ""):
            m = x
    return m


def _amt(m: Optional[re.Match]) -> Optional[int]:
    if m is None:
        return None
    s = next((g for k, g in m.groupdict().items() if k.startswith("amt") and g), None)
    return parse_amount(s) if s else None


def _rel_hits(t: str) -> list[tuple[int, str, str]]:
    """(위치, 관계, 방향 'to'|'from'|'') — 낱말 바로 뒤 조사로 양수자(에게)·양도자(로부터) 구분."""
    hits = []
    taken: list[tuple[int, int]] = []
    for rel, pat in _REL_WORDS:
        for m in re.finditer(pat, t):
            if any(a <= m.start() < b for a, b in taken):     # '특수관계가 없는' 을 other_related 로 다시 읽지 않게
                continue
            taken.append((m.start(), m.end()))
            tail = t[m.end():m.end() + 30]
            if re.match(_FROM, tail):
                way = "from"
            elif re.match(_TO, tail):
                way = "to"
            elif re.match(r"\s*(?:님)?\s*(?:이|가|께서)\s*", tail) and re.search(r"(?:사|매수|인수)(?:려|면|고|ㄴ|겠|기로)", tail):
                way = "buyer_subject"                          # '아들이 사려고' — 주어가 양수자
            else:
                way = ""
            hits.append((m.start(), rel, way))
    return sorted(hits)


def read_relation(texts: Iterable[str]) -> Optional[str]:
    """양수자가 양도자에게 누구인가. 조사로 방향이 드러난 언급('X에게'·'X로부터')이 그냥 언급('아버지 취득가는')보다 이기고,
    같은 종류끼리는 마지막이 이긴다. 방향을 모르면 양수자로 본다(가장 흔한 꼴: 'X에게 양도')."""
    directed = plain = None
    for t in texts:
        for _pos, rel, way in _rel_hits(t or ""):
            if rel == "unrelated":
                directed = rel
            elif way == "from":
                directed = _INVERSE[rel]
            elif way:
                directed = rel
            else:
                plain = rel
    return directed or plain


def read_slots(texts: Iterable[str]) -> dict:
    texts = [t or "" for t in texts]
    out: dict = {}
    mv = _amt(_last(_MV, texts))
    if mv:
        out["market_value"] = mv
    acq = _amt(_last(_ACQ, texts))
    if acq:
        out["acquisition"] = acq
    # 거래가 — '시가 10억'·'1억에 샀다' 의 금액을 거래가로 다시 읽지 않게, 다른 슬롯이 잡은 자리는 뺀다
    price = None
    for t in texts:
        spans = [m.span() for rx in (_MV, _ACQ) for m in rx.finditer(t)]
        for m in _PRICE.finditer(t):
            if any(a <= m.start() < b for a, b in spans):
                continue
            v = _amt(m)
            if v:
                price = v
        if _AT_MARKET.search(t) and mv:
            price = mv
    if price:
        out["price"] = price

    m = _last(_SHARE, texts)
    if m:
        out["share_pct"] = float(m.group("p") or m.group("p2"))
    for t in texts:
        if _HOLD_SHORT.search(t):
            out["holding_months"] = 6
        for x in _HOLD_Y.finditer(t):
            out["holding_months"] = int(x.group("n")) * 12
        for x in _HOLD_M.finditer(t):
            out["holding_months"] = int(x.group("n"))

    for t in texts:
        for key, rx in _MARKET:
            if rx.search(t):
                out["market"] = key
                break
        else:
            if _LISTED.search(t) and out.get("market") in (None, "unlisted"):
                out["market"] = "listed"                          # 시장 모름 — 슬롯이 유가증권시장으로 가정
        if _ON.search(t):
            out["on_market"] = True
        elif _OFF.search(t):
            out["on_market"] = False
        for key, rx in reversed(_SIZE):                         # '중소기업이 아닌' 이 '중소기업' 보다 먼저
            if rx.search(t):
                out["size"] = key
                break

    rel = read_relation(texts)
    if rel:
        out["relation"] = rel
    for t in texts:
        if _MINOR.search(t):
            out["buyer_minor"] = True
        elif _ADULT.search(t):
            out["buyer_minor"] = False
        for x in _AGE.finditer(t):
            n = int(x.group("n"))
            if n <= 30:                                          # '65세 어머니' 같은 양도자 나이는 성년 판단에 안 씀
                out["buyer_minor"] = n < 19
        if _NO_PRIOR.search(t):
            out["prior_deduction_used"] = 0
        p = _amt(_last(_PRIOR, [t]))
        if p:
            out["prior_deduction_used"] = p
    return out
