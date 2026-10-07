"""
법령 인용 정규화 — 문자열 속 "「소득세법 시행령」제159조 제1항" 같은 인용을 법령 DB 키
(law_name, article_no) 로 바꾼다. (LLM3 법령 단계, 2026-10-07)

쓰는 자리
  · 법령 DB 후보 만들기: KB3 카드의 수집 원본 law_articles → 법령 DB 조문 조회
  · 작문 뒤 인용 대조: 답변 속 인용이 동봉한 조문 목록에 있는지 검사

키 규칙 = backend/scripts/law_pdf_parse.py 산출과 같다
  law_name   = 법제처 공식 명칭(띄어쓰기 포함) 예 "상속세 및 증여세법 시행령"
  article_no = "53" / "81의7"

순수 파이썬(외부 의존 0) — 백엔드 venv·시스템 파이썬 어느 쪽에서도 import 된다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, Optional

# 공식 명칭(띄어쓰기 뺀 형태 → 공식 표기). 법령 DB 에 없는 법도 이름은 알아 둔다(커버리지 계측용).
OFFICIAL = {
    "국세기본법": "국세기본법",
    "국세징수법": "국세징수법",
    "소득세법": "소득세법",
    "법인세법": "법인세법",
    "상속세및증여세법": "상속세 및 증여세법",
    "부가가치세법": "부가가치세법",
    "개별소비세법": "개별소비세법",
    "조세특례제한법": "조세특례제한법",
    "종합부동산세법": "종합부동산세법",
    "조세범처벌법": "조세범 처벌법",
    "지방세기본법": "지방세기본법",
    "지방세법": "지방세법",
    "지방세특례제한법": "지방세특례제한법",
    "민법": "민법",
    "상법": "상법",
    "국제조세조정에관한법률": "국제조세조정에 관한 법률",
    "농어촌특별세법": "농어촌특별세법",
    "교육세법": "교육세법",
    "증권거래세법": "증권거래세법",
    "인지세법": "인지세법",
}
# 약칭 → 띄어쓰기 뺀 공식 명칭
ALIAS = {
    "국기법": "국세기본법",
    "국징법": "국세징수법",
    "소법": "소득세법",
    "법법": "법인세법",
    "상증법": "상속세및증여세법",
    "상증세법": "상속세및증여세법",
    "상속세및증여세법": "상속세및증여세법",
    "부가법": "부가가치세법",
    "부가세법": "부가가치세법",
    "부가가치세": "부가가치세법",
    "개소세법": "개별소비세법",
    "조특법": "조세특례제한법",
    "종부세법": "종합부동산세법",
    "조처법": "조세범처벌법",
    "지기법": "지방세기본법",
    "지특법": "지방세특례제한법",
    "국조법": "국제조세조정에관한법률",
    "국제조세조정법": "국제조세조정에관한법률",
    "농특세법": "농어촌특별세법",
}
SUFFIX = {"시행령": " 시행령", "령": " 시행령", "시행규칙": " 시행규칙", "규칙": " 시행규칙"}

# 법 이름 후보: 「…」 안이거나, 법/령/규칙/세 로 끝나는 한글 덩어리
_LAW = (r"(?:「\s*(?P<q>[^」]{2,40}?)\s*」"
        r"|(?P<r>(?:같은|동)\s*법(?:\s*시행령|\s*시행규칙)?|(?<![가-힣])(?:시행령|시행규칙|법))(?=\s*제?\s*\d+\s*조)"
        r"|(?P<p>[가-힣][가-힣·\s]{0,30}?(?:법률|법|령|규칙)|부가가치세)」?)")
_ART = r"\s*(?:제\s*)?(?P<num>\d+)\s*조(?:\s*의\s*(?P<sub>\d+))?"
_PARA = r"(?:\s*제?\s*(?P<para>\d+)\s*항)?(?:\s*제?\s*(?P<item>\d+)\s*호)?"
CITE_RE = re.compile(_LAW + _ART + _PARA)
# 같은 법 안에서 이어지는 "및 제47조 제2항", ", 제3조"
FOLLOW_RE = re.compile(r"\s*(?:,|및|과|와|또는|·|ㆍ)\s*" + _ART + _PARA)


@dataclass(frozen=True)
class Cite:
    law: str  # 공식 명칭(시행령·시행규칙 포함)
    article_no: str  # "81의7"
    para: Optional[int] = None
    item: Optional[int] = None

    @property
    def key(self) -> tuple[str, str]:
        return (self.law, self.article_no)

    def label(self) -> str:
        num, _, sub = self.article_no.partition("의")
        s = f"{self.law} 제{num}조" + (f"의{sub}" if sub else "")
        if self.para:
            s += f" 제{self.para}항"
        if self.item:
            s += f" 제{self.item}호"
        return s


def normalize_law_name(raw: str) -> Optional[str]:
    """'상증세법시행령' · '「소득세법 시행령」' · '부가가치세' → 공식 명칭. 모르면 None."""
    s = re.sub(r"[\s「」『』]", "", raw)
    # 앞에 붙은 "구"(舊)·"같은"·"동" 등 수식어 제거
    s = re.sub(r"^(?:구|舊|동|같은|현행|개정전|개정된)", "", s)
    suffix = ""
    for k in ("시행규칙", "시행령", "규칙", "령"):
        if s.endswith(k) and len(s) > len(k) + 1:
            base = s[: -len(k)]
            # "령" 하나만 떼면 "…법령" 같은 오탐이 생기므로 base 가 법/법률로 끝날 때만
            if k in ("령", "규칙") and not re.search(r"(법|법률)$", base):
                continue
            s, suffix = base, SUFFIX[k]
            break
    s = ALIAS.get(s, s)
    if s not in OFFICIAL:
        # 문장 앞쪽 군더더기가 붙은 경우("…에 따른 소득세법") — 알려진 이름으로 끝나는지
        hit = next((k for k in sorted(set(OFFICIAL) | set(ALIAS), key=len, reverse=True) if s.endswith(k)), None)
        if not hit:
            return None
        s = ALIAS.get(hit, hit)
    return OFFICIAL[s] + suffix


_REL_LEAD = re.compile(r"^(?:및|과|와|또는|그리고|이|위|같은|동)+")


def _relative(raw: str, context: Optional[str]) -> Optional[str]:
    """'시행령'·'같은 법 시행령'·'법' → 앞서 나온 법(context)의 법률/시행령/시행규칙. 문맥이 없으면 None."""
    if not context:
        return None
    s = _REL_LEAD.sub("", re.sub(r"\s", "", raw))
    s = re.sub(r"^법(?=시행)", "", s)
    base = re.sub(r"\s*시행(령|규칙)$", "", context)
    return {"법": base, "": base, "시행령": base + " 시행령", "령": base + " 시행령",
            "시행규칙": base + " 시행규칙", "규칙": base + " 시행규칙"}.get(s)


def parse_cites(text: str, context: Optional[str] = None) -> list[Cite]:
    """문자열 속 인용을 모두 뽑는다. '시행령 제N조'·'같은 법 제N조' 같은 상대 인용은 앞서 나온 법(또는 context)
    기준으로 푼다. 법 이름을 끝내 모르는 인용은 버린다."""
    out: list[Cite] = []
    pos = 0
    while True:
        m = CITE_RE.search(text, pos)
        if not m:
            break
        if m["r"]:
            law = _relative(m["r"], context)
        else:
            raw = m["q"] or m["p"]
            law = normalize_law_name(raw) or _relative(raw, context)
        end = m.end()
        if law:
            if not m["r"]:
                context = law
            out.append(_mk(law, m))
            # 같은 법으로 이어지는 조문들
            while True:
                f = FOLLOW_RE.match(text, end)
                if not f:
                    break
                out.append(_mk(law, f))
                end = f.end()
        pos = end
    # 순서 유지 중복 제거
    seen, uniq = set(), []
    for c in out:
        if c not in seen:
            seen.add(c)
            uniq.append(c)
    return uniq


def _mk(law: str, m: re.Match) -> Cite:
    no = m["num"] + (f"의{m['sub']}" if m["sub"] else "")
    return Cite(law, no, int(m["para"]) if m["para"] else None, int(m["item"]) if m["item"] else None)


def keys(texts: Iterable[str]) -> list[tuple[str, str]]:
    """여러 문자열 → 조 단위 키(항·호 무시) 순서 유지 중복 제거."""
    seen, out = set(), []
    for t in texts:
        for c in parse_cites(t or ""):
            if c.key not in seen:
                seen.add(c.key)
                out.append(c.key)
    return out


def parse_answer(texts: Iterable[str]) -> list[list[Cite]]:
    """답변 문장 목록 → 문장별 인용. 앞 문장에서 나온 법을 다음 문장의 상대 인용('시행령 제N조') 문맥으로 넘긴다."""
    out, ctx = [], None
    for t in texts:
        cs = parse_cites(t or "", ctx)
        absolute = [c.law for c in cs]
        if absolute:
            ctx = absolute[-1]
        out.append(cs)
    return out
