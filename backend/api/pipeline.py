"""
Seam A hybrid pipeline — the heart of the product (docs API 계약 §2.5).

    history + userInput
       │  ① Solar function-calling → extract ClinicProfile / ExpenseInput
       │     required missing? → follow-up Message (no verdict) ─── return
       │  ⓪ 세무사 연결 명시 요청? → 연결 카드(expert_handoff)만 ─── return
       │     엔진 규칙 밖(etype='기타')? → RAG 자문 Message (판정 없음, 연결 카드 제안) ─── return
       │  ② clinic_expense_engine.evaluate() → ExpenseResult   (deterministic)
       │  ③ case refs from engine 근거          (RAG proper = follow-up, §5 step4)
       │  ④ Solar writes segments grounded on ②③ (natural-language argument)
       │  ⑤ ExpenseResult → verdict_card + evidence_checklist  (deterministic)
       │  ⑥ assemble assistant Message (A-3 id rules) → return
"""

from __future__ import annotations

import logging
import threading
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from dataclasses import dataclass, replace
import re

import os

import clinic_expense_engine as eng
from calc import income_tax as itax
from calc import income_tax_extract as itax_extract
from calc import income_tax_slots as itax_slots
from calc import income_tax_view as itax_view
from calc import stock_transfer_extract as stock_extract
from calc import stock_transfer_slots as stock_slots
from calc import stock_transfer_view as stock_view
from api import engine_adapter as adapter
from api import handoff
from api import law_select
from api import llm
from api import numeric_guard
from api import upstage_gate
from api import turn_record
from api import usage_log
from api import answer_display
from api.rag import get_retriever
from api.rag.retriever import NullRetriever
from api.schema import ChatMeta, ChatResponse, Message, Segment

log = logging.getLogger("api.pipeline")

# ③ 판례 사건번호 정규식 — 이제 RAG 의 보조(엔진 근거 안의 직접 인용)일 뿐.
# 실 그라운딩은 get_retriever()(KB3 벡터 검색)가 담당(마스터 §5 step4).
_CASE_REF = re.compile(r"조심\s?\d{4}[가-힣]{1,2}\d+")


def _rag_top_k() -> int:
    return int(os.environ.get("RAG_TOP_K", "5"))


def _rag_source_label(passages) -> str:
    """meta.ragSource / chat_turns.rag_source 값 — 근거 검색은 KB3 하나라(절단 S5) 근거가 있으면 'kb3'."""
    return "kb3" if passages else "none"


def _corpus_distribution(passages) -> tuple[dict[str, int], list[dict]]:
    """근거의 코퍼스 분포 — (개수, 원시 목록). meta 와 rag.chat_turns 가 함께 쓴다(0033).

    `ragSource` 는 "어느 검색기를 탔나"만 말한다. fusion 은 코퍼스가 섞여 있어서, 근거가
    실제로 어느 층에서 왔는지는 그 값으로 알 수 없었다 — P3P4 프로덕션 스모크가 여기서
    막혔다(기록 §3). 개수만이 아니라 원시 목록을 함께 남기는 이유는 0027 주석 그대로다:
    지표는 나중에 바뀌지만 원시값은 그대로 쓸 수 있다.

    rank 는 **프롬프트에 박힌 순서**(1-based)다 — 융합·정렬이 끝난 최종 자리라, 나중에
    "몇 번째 근거를 모델이 따라갔나"를 답변과 맞춰볼 수 있다. 본문은 싣지 않는다(원본
    테이블에 있고, 복사하면 같은 지식이 두 곳에서 갈라진다)."""
    counts: dict[str, int] = {}
    raw: list[dict] = []
    for rank, p in enumerate(passages or [], start=1):
        corpus = p.corpus or "unknown"
        counts[corpus] = counts.get(corpus, 0) + 1
        raw.append({
            "corpus": corpus,
            "sourceKind": p.source_kind,
            "score": round(float(p.score), 4),
            "rank": rank,
            "id": p.id,
        })
    return counts, raw


def _issue_gate(user_text: str, passages: list, fits_out: dict | None = None) -> tuple[list, list[dict]]:
    """KB3 근거 중 질문과 쟁점이 다른 것('different')을 뺀다 — (남긴 근거, 뺀 근거의 계측 행).

    KB3 가 없거나, KB3_ISSUE_GATE=off 거나, 판정이 실패하면 그대로 돌려준다(지금 동작).
    KB3 층이 아닌 근거는 판정하지 않는다. fits_out 을 주면 판정 결과 {id: fit} 를 담아 준다."""
    kb3 = [p for p in passages if p.corpus in llm.KB3_CORPORA]
    if not kb3 or os.environ.get("KB3_ISSUE_GATE", "on") == "off":
        return passages, []
    fits = llm.judge_issue_fit(user_text, kb3)
    if not fits:
        return passages, []
    if fits_out is not None:
        fits_out.update(fits)
    kept = [p for p in passages if fits.get(p.id) != "different"]
    dropped = [{"corpus": p.corpus, "sourceKind": p.source_kind, "score": round(float(p.score), 4),
                "rank": None, "id": p.id, "issueFit": "different"}
               for p in passages if fits.get(p.id) == "different"]
    if dropped:
        log.info("쟁점 적합성 게이트: KB3 %d건 중 %d건 제외 %s", len(kb3), len(dropped),
                 [p.case_refs for p in passages if fits.get(p.id) == "different"])
    return kept, dropped


def _trim_cases_for_law(passages: list, fits: dict, has_table: bool, qtype: str | None) -> tuple[list, list[dict]]:
    """법령으로 답이 되는 질문(_law_answerable) — 사례 자료는 쟁점이 'same' 인 것 CASE_KEEP_MAX 건만, 세율 표가 나가면 0건.
    판정이 없었던 카드(게이트 실패·KB3 아님)도 뺀다 — 조문이 이미 답이라 빼는 쪽이 안전하다. 뺀 것은 계측 행으로."""
    keep_n = 0 if has_table else CASE_KEEP_MAX.get(qtype or "", 0)
    kept = [p for p in passages if fits.get(p.id) == "same"][:keep_n]
    dropped = [{"corpus": p.corpus, "sourceKind": p.source_kind, "score": round(float(p.score), 4),
                "rank": None, "id": p.id, "issueFit": fits.get(p.id) or "unjudged", "trim": "law_answerable"}
               for p in passages if p not in kept]
    if dropped:
        log.info("법령 답 유형 — 사례 자료 %d건 중 %d건 제외(표 %s)", len(passages), len(dropped), has_table)
    return kept, dropped


def _number_sources(history: list[Message], user_text: str, passages: list,
                    engine_block: str = "") -> tuple[list[str], list[str]]:
    """numeric_guard 의 출처 (sources, derive_from) — P8 C.

    sources 는 모델이 본 것 중 수치의 근거가 될 수 있는 것 전부, derive_from 은 그중 **이 사안의**
    수(사용자 발화·엔진 판정) — 산술 피연산자는 여기서만 뽑는다(근거는 남의 사안이다).
    이전 턴은 **사용자 발화만** 넣는다: 앞선 답변의 수가 날조였다면 그걸 근거로 되살리면 안 된다."""
    from api.prompts import load_norms

    own = [user_text, engine_block] + [s.text for m in history if m.role == "user" for s in m.segments]
    return own + [load_norms() or ""] + [p.content for p in passages or []], own


@dataclass
class _LawStep:
    passages: list            # 작문에 줄 근거(LLM3 가 켜지면 심판례 카드 '조문:' 줄을 뺀 판)
    block: str                # [관련 법령] 블록 + 인용 규칙
    allowed: set              # 사후 대조 허용 조문 키
    labels: list[str]         # 출처 배지 후보
    texts: list[str]          # numeric_guard 출처에 더할 조문 원문
    tables: list = None       # 고른 조문의 표(law_select.TableBlock) — 세율·구간 질문엔 행을 결정론으로 싣는다(F1)
    titles: list = None       # labels 와 같은 순서의 조문 제목 — 정의 형식 '관련 조문' 줄(A3)
    articles: list = None     # 고른 조문(law_select.Article) — 요건 형식 호 목록 폴백(A3)
    heads: list = None        # 복합 사안 — 블록에 조문이 실린 쟁점의 세목 이름(작문 '■ 세목' 머리 최소 목록, 10/16)


def _law_step(user_text: str, passages: list, extra_texts: list[str], qtype: str | None = None,
              compound: bool = False) -> _LawStep | None:
    """LLM3(10/7) — 관련 법령 선택. 꺼져 있거나 저장소·선택이 실패하면 None(지금 동작 그대로).
    compound(복합 사안): 위임 시행령까지 싣는다 — 상증법 §35 의 기준금액(시행령 §26)처럼 쟁점의 기준이 시행령에 있다."""
    if not law_select.enabled():
        return None
    cands = law_select.candidates(user_text, passages)
    picks = law_select.select(user_text, cands)
    if picks is None:
        return None
    deep = (_law_deep(qtype) or compound) and not _TABLE_Q.search(user_text)   # 세율 질문은 표가 답 — 위임 조문(근속연수 등)은 잡음
    if deep and picks:
        picks = picks + law_select.delegated(picks)
    if qtype == "법령 정의":   # 정의 조항(A5, 10/20) — 질문 낱말이 그 법 '정의' 조문의 용어면 그 호를 싣는다
        picks = picks + law_select.definitions(user_text, picks)
    if compound and picks and not _TABLE_Q.search(user_text):
        picks = picks + law_select.referenced(picks)
    # 쟁점별 조문(E 설계 §2-3, 10/15) — 세율·공제·신고 기한 조문을 쟁점마다 코드로. 표 목록(세율 질문의 결정론 표)에는 넣지 않는다.
    issue = law_select.issue_picks(user_text, picks) if compound else []
    # 세율·구간 질문(F1, 10/12) — 후보 중 제목에 '세율'이 든, 표 있는 첫 조문을 고른 목록에 보탠다. 로컬 X06 "법인세율이
    # 어떻게 되나요?"에서 LLM3 가 검색 1위 법인세법 §55(세율)를 두고 §55의2·§13 을 골라 작문이 "세율은 시행령에 있다"고 지어냈다.
    if _TABLE_Q.search(user_text):
        named = law_select.question_laws(user_text)
        rate = next((c.article for c in cands if law_select.is_rate_title(c.article.title) and "[표]" in c.article.text
                     and (not named or c.article.law in named)), None)
        laws = named + [p.article.law for p in picks] + [c.article.law for c in cands]
        if rate is None or (laws and rate.law != laws[0]):
            rate = law_select.rate_article(laws) or rate
        if rate is not None and rate.key not in {p.article.key for p in picks}:
            picks = picks + [law_select.Pick(rate, [], "세율 질문 — 표가 있는 세율 조문 보강", "rate")]
    log.info("LLM3 법령: 후보 %d · 선택 %s", len(cands), [p.article.label() for p in picks])
    tables = [t for p in picks for t in law_select.table_blocks(p.article)]
    have = {p.article.key for p in picks}
    picks = picks + [p for p in issue if p.article.key not in have]
    allowed = law_select.allowed_keys(picks, [user_text] + extra_texts)
    return _LawStep(
        passages=law_select.strip_card_law_lines(passages),
        block=law_select.law_block(picks, law_select.ARTICLE_CHARS_DEEP if deep else law_select.ARTICLE_CHARS),
        allowed=allowed,
        labels=law_select.pick_labels(picks),
        texts=[law_select.numeric_view(p.article.text) for p in picks],
        tables=tables,
        titles=[p.article.title or "" for p in picks],
        articles=[p.article for p in picks],
        heads=law_select.issue_heads(user_text, allowed) if compound else [],
    )


_TAX_WORDS = re.compile(r"세금|세율|세액|세법|[가-힣]+세(?:는|가|를|도|에)?\b|소득|공제|신고|익금|손금|과세|감면|환급|원천징수|"
                        r"연말정산|양도|상속|증여|필요경비|가산세|세무|부가세|사업자|거주자")   # 거주자: 10/20 '거주자와 비거주자는…'이 off_topic 거절


_LAW_POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix="law3")

# 법령으로 답이 되는 유형(세무사 재평가 10/14 지적 2·5) — 정의·요건은 조문이 답이다. 이 유형에서
#  ① 고른 법률 조문의 위임 시행령을 따라 싣고 조문 상한을 늘린다(LAW_DEEP — 끄기 off)
#  ② 사례 자료(심판례·해석)는 쟁점이 같은 1건만, 세율 표가 나가는 답엔 싣지 않는다(ADVISORY_CASE_TRIM — 끄기 off).
#     Q4 익금에 '간접외국납부세액' 질의회신, 증여세율 답에 가업승계 특례(조특법 §30의6) 해석, Q3 에 2020년 4,800만원 기준
#     해석이 들어가 "엉뚱한 예규를 매번 끌어온다"고 했다. 쟁점 게이트는 'different' 만 빼서 'related' 가 다 들어왔다.
_LAW_TYPES = ("법령 정의", "요건")
# 정의는 위임 시행령·제외 조문까지 실으니 사례 0건(10/14 로컬 X04: 게이트가 '간접외국납부세액' 질의회신을 same 으로 봐 남았다 —
# 세무사가 짚은 그 예규). 요건은 쟁점이 같은 1건까지(적용이 갈리는 지점 보충).
CASE_KEEP_MAX = {"법령 정의": 0, "요건": 1}


def _law_deep(qtype: str | None) -> bool:
    return qtype in _LAW_TYPES and os.environ.get("LAW_DEEP", "on") != "off"


def _law_answerable(qtype: str | None) -> bool:
    return qtype in _LAW_TYPES and os.environ.get("ADVISORY_CASE_TRIM", "on") != "off"


# ── 복합 사안(E단계 골격, 10/15 — design/E단계_주식양도_복합사안_설계_1014.md §2-2) ─────────────────────────────────────
# 세금이 둘 이상 걸린 사례 질문: 세목을 둘 이상 이름으로 말했거나("양도세랑 부가세") 어떤 세금이 생기는지를 통째로 물었다("어떤
# 세금문제가 발생하는지"). 정의·요건·절차 질문은 제 형식이 있다. 작문 형식은 llm._compound_rule, 마무리는 _shape_compound.
# 사례 자료는 쟁점 같은 1건만(조문 블록이 위임 시행령까지 길어지는 만큼 입력을 덜어 낸다). 끄기 ADVISORY_COMPOUND=off.
_TAX_NAMES = (("양도", re.compile(r"양도(?:소득)?세")), ("증여", re.compile(r"증여세")), ("상속", re.compile(r"상속세")),
              ("부가", re.compile(r"부가(?:가치)?세")), ("소득", re.compile(r"(?<!양도)(?<!지방)(?<!양도\s)소득세|종소세")),
              ("법인", re.compile(r"법인세")), ("취득", re.compile(r"취득세")), ("증권", re.compile(r"증권거래세")),
              ("종부", re.compile(r"종합부동산세|종부세")), ("재산", re.compile(r"(?<!부동)재산세")))
_ALL_TAXES_Q = re.compile(r"(?:어떤|무슨|어느)\s*세금|세금\s*문제|세금이\s*(?:발생|나오|생기|붙)|어떤\s*세목")
_AMOUNT_ASKED = re.compile(r"세액|얼마|계산")
CASE_KEEP_MAX["복합"] = 1
# 인용 대조 뒤 전체 상한은 넉넉히 두고(뒤를 자르면 ■ 확인할 점이 통째로 빠진다 — 10/16 로컬 C1: 세목 3개에 23세그먼트, 상한 16 에서
# 확인할 점 머리·항목이 다 잘렸다), 모양은 _shape_compound 가 절마다 자른다(세목 본문 ≤4 · 확인할 점 항목 ≤4).
COMPOUND_MAX_SEGMENTS = 30
COMPOUND_SECTION_BODY = 4
COMPOUND_CHECK_ITEMS = 4
COMPOUND_TAX_NOTE = ("세액은 이 질문의 세목에 자동 계산을 아직 지원하지 않아 기준·세율·계산 방식까지만 안내했습니다 — "
                     "실제 세액은 평가액과 다른 거래·증여 내역에 따라 달라지므로 세무사 확인이 필요합니다.")
_ASSUME_LINE = re.compile(r"^\s*가정\s*[:：]")


def _compound_case(qtype: str | None, *texts: str) -> bool:
    if os.environ.get("ADVISORY_COMPOUND", "on") == "off" or qtype in ("법령 정의", "요건", "절차"):
        return False
    t = " ".join(x for x in texts if x)
    return len({k for k, pat in _TAX_NAMES if pat.search(t)}) >= 2 or bool(_ALL_TAXES_Q.search(t))


# '■ 양도소득세(아버지) — 문장' · '■ 확인할 점: 1. …' · '■ 증여세(납세자: 배우자): …' — 머리(괄호 속 ':' 허용)와 나머지
_HEAD_WORDS = r"■\s*[^:：—–()（）\n]{1,25}?"
_HEAD_SPLITS = (
    re.compile(rf"^\s*({_HEAD_WORDS}(?:[(（][^)）]{{0,30}}[)）])?)\s*[:：—–]\s*(\S.*)$", re.S),   # 머리: · 머리 —
    re.compile(rf"^\s*({_HEAD_WORDS}[(（][^)）]{{0,30}}[)）])\s+(\S.*)$", re.S),                 # 머리(납세자) 문장
    re.compile(rf"^\s*({_HEAD_WORDS})\s+(\d{{1,2}}[.)]\s.*)$", re.S),                             # 머리 2. 항목
)
_HEAD = re.compile(r"^\s*■")
_CHECK_HEAD = re.compile(r"^\s*■\s*확인할\s*점")
_ALT_HEAD = re.compile(r"^\s*■\s*검토할\s*대안")
_BARE_HEAD = re.compile(r"^\s*(확인할\s*점|검토할\s*대안)\s*[:：]\s*(\S.*)$", re.S)
_NO_ALT = re.compile(r"대안이\s*없|(?:규정|특례)이\s*(?:직접\s*)?(?:적혀\s*있지\s*않|없)")
# 작문이 프롬프트 용어를 화면에 흘린 문장("이 블록에는 증여세 세율이 적혀 있지 않으므로" — 10/15 로컬 C3)
_META_TALK = re.compile(r"블록|자료에(?:는)?\s*(?:직접\s*)?(?:적혀|나와)\s*있지\s*않")


def _fix_decree_names(raw: list[dict], allowed: set) -> list[dict]:
    """'부가가치세법 제23조' → '부가가치세법 시행령 제23조' — 블록엔 시행령 조문만 있고 같은 번호 법률 조문은 없을 때만(10/15 로컬
    T03: 4회 중 3회 시행령을 빼고 써 문장째 빠졌다). 인용 대조 전에, 복합 사안에만."""
    fixes = []
    for law, no in allowed:
        if not law.endswith(" 시행령") or (law.removesuffix(" 시행령"), no) in allowed:
            continue
        num, _, sub = no.partition("의")
        art = f"제{num}조" + (f"의{sub}" if sub else r"(?!의)")
        fixes.append((re.compile(rf"(「?){re.escape(law.removesuffix(' 시행령'))}(」?)(\s?)({art})"), law))
    if not fixes:
        return raw
    out = []
    for s in raw:
        t = s.get("text") or ""
        for pat, law in fixes:
            t = pat.sub(lambda m, law=law: f"{m.group(1)}{law}{m.group(2)}{m.group(3)}{m.group(4)}", t)
        out.append({**s, "text": t} if t != s.get("text") else s)
    return out


def _split_compound_heads(raw: list[dict]) -> list[dict]:
    """머리와 문장이 한 세그먼트면 가른다 — 인용 대조·수치 가드가 문장을 빼도 세목 머리는 남는다(10/15 로컬: 허용 밖 조문 한 번에
    '■ 증여세…' 부분이 통째로 사라졌다). 작문 직후, 검사 전에 부른다."""
    out = []
    for s in raw:
        t = s.get("text") or ""
        m = next((m for pat in _HEAD_SPLITS if (m := pat.match(t))), None) if s.get("type") != "summary" else None
        if m:
            out += [{"text": m.group(1).strip(), "type": "context"}, {**s, "text": m.group(2).strip()}]
        else:
            out.append(s)
    return out


def _cap_compound_sections(raw: list[dict]) -> list[dict]:
    """■ 절마다 본문 상한 — 세목 절은 본문 COMPOUND_SECTION_BODY 문장, 확인할 점은 항목 COMPOUND_CHECK_ITEMS 개(앞에서부터).
    머리 앞(결론 문단·가정)·안내(caveat)·되묻기는 세지 않는다."""
    out, n, cap, dropped = [], 0, None, 0
    for s in raw:
        t = s.get("text") or ""
        if _HEAD.match(t):
            n, cap = 0, (COMPOUND_CHECK_ITEMS if _CHECK_HEAD.match(t) else None if _ALT_HEAD.match(t) else COMPOUND_SECTION_BODY)
            out.append(s)
            continue
        if cap is not None and s.get("type") not in ("caveat", "follow_up", "summary"):
            n += 1
            if n > cap:
                dropped += 1
                continue
        out.append(s)
    if dropped:
        log.info("복합 사안 — 절 상한으로 %d문장 뺌", dropped)
    return out


_HEAD_LAW = {"증권거래세": "증권거래세법"}    # 다른 세목 법(소득세법·상증법)은 여러 절에 걸쳐 인용돼 배지로 가르지 않는다


def _add_missing_heads(raw: list[dict], heads: list[str] | None) -> list[dict]:
    """다룰 세목(law.heads)인데 ■ 머리가 없고 본문 문장이 그 세목 이름으로 시작하면(앞 30자 안) 그 앞에 '■ 세목' 머리를 넣는다
    (10/16 로컬 C1 3회차: 증권거래세 문장을 ■ 증여세 절 끝에 붙여 썼다). 확인할 점·대안 절 안의 문장은 건드리지 않는다."""
    from api import law_cite

    if not heads:
        return raw
    have = " ".join(s.get("text") or "" for s in raw if _HEAD.match(s.get("text") or ""))
    out = list(raw)
    for name in [h for h in heads if h not in have]:
        in_tail = False
        for i, s in enumerate(out):
            t = s.get("text") or ""
            if _HEAD.match(t):
                in_tail = bool(_CHECK_HEAD.match(t) or _ALT_HEAD.match(t))
                continue
            if in_tail or s.get("type") in ("summary", "caveat", "follow_up") or _ASSUME_LINE.match(t):
                continue
            k = t.find(name)
            by_name = 0 <= k < 30 and not any(0 <= t.find(o) < k for o in heads if o != name)
            # 세목 이름 없이 '주권등을 양도하는 경우 …' 로 쓴 회차(10/16 로컬 C1 g3) — 배지가 전부 그 세목 법이면 그 세목 문장
            own = _HEAD_LAW.get(name)
            cited = [c.law for x in s.get("citations") or [] for c in law_cite.parse_cites(str(x))]
            if by_name or (own and cited and all(lw.startswith(own) for lw in cited)):
                out.insert(i, {"text": f"■ {name}", "type": "context"})
                log.info("복합 사안 — 빠진 세목 머리 보탬: %s", name)
                break
    return out


def _shape_compound(raw: list[dict], user_text: str, heads: list[str] | None = None, calc: bool = False) -> list[dict]:
    """'가정:' 줄을 결론 문단 바로 뒤로, '■ 확인할 점' 머리 하나 + 항목 1부터 번호로, 근거 없는 '대안 없음'·프롬프트 용어 문장과
    본문이 빠진 머리는 빼고, 금액을 물었으면 세액 안내 문장을 되묻기 앞에(calc = 주식 계산기가 세액을 냈으면 안내 없음)."""
    # '확인할 점: 1. …'·'검토할 대안: …' — ■ 없이 머리를 문장 앞에 붙인 꼴(10/15 로컬 C1, 쟁점별 조문을 실은 뒤) → 머리 + 문장
    split = []
    for s in raw:
        m = _BARE_HEAD.match(s.get("text") or "") if s.get("type") != "summary" else None
        split += ([{"text": f"■ {m.group(1)}", "type": "context"}, {**s, "text": m.group(2).strip()}] if m else [s])
    # '■ 확인할 점 — 1. … 2. …' 를 caveat 한 덩이로 쓴 회차(10/16 로컬 C1) — 머리 뒤 번호 항목은 항목으로(caveat 이면 '본문 없는
    # 머리'로 머리가 빠지고 항목도 안 갈린다)
    sec_check = False
    for i, s in enumerate(raw):
        t = s.get("text") or ""
        if _HEAD.match(t):
            sec_check = bool(_CHECK_HEAD.match(t))
        elif sec_check and s.get("type") == "caveat" and _NUMBERED_ITEM.match(t):
            raw[i] = {**s, "type": "evidence_request"}
    raw = _add_missing_heads(raw, heads)
    assume = [s for s in raw if _ASSUME_LINE.match(s.get("text") or "")][:1]
    rest, alt, check_seen = [], False, False
    for s in raw:
        if s in assume:
            continue
        t = s.get("text") or ""
        if s.get("type") != "caveat" and (_META_TALK.search(t) or (alt and _NO_ALT.search(t))):
            log.info("복합 사안 — 문장 제거: %r", t[:60])
            continue
        if _HEAD.match(t):
            alt = bool(_ALT_HEAD.match(t))
            if _CHECK_HEAD.match(t):
                if check_seen:                      # 항목마다 붙은 '■ 확인할 점'(10/15 로컬 C2·T03) — 머리는 하나
                    continue
                check_seen = True
        elif alt:
            s = {**s, "type": "context"}            # 대안은 되묻기가 아니다(작문이 follow_up 으로 달았다)
        rest.append(s)
    rest = _cap_compound_sections(_shape_requirements(rest))
    # 번호 항목은 확인할 점이다 — 작문이 follow_up 으로 달면(10/15 로컬 C1) 세액 안내가 그 앞에 끼고 머리가 고아로 빠졌다
    rest = [{**s, "type": "evidence_request"} if s.get("type") == "follow_up" and _NUMBERED_ITEM.match(s.get("text") or "")
            else s for s in rest]
    if not check_seen:
        i = next((i for i, x in enumerate(rest) if _NUMBERED_ITEM.match(x.get("text") or "")), None)
        if i is not None:
            rest.insert(i, {"text": "■ 확인할 점", "type": "context"})
    # 본문이 빠진 머리(뒤가 머리·안내·되묻기·끝) — 인용 대조나 위 제거로 문장만 사라진 경우
    rest = [s for i, s in enumerate(rest)
            if not (_HEAD.match(s.get("text") or "") and (i + 1 == len(rest) or _HEAD.match(rest[i + 1].get("text") or "")
                                                          or rest[i + 1].get("type") in ("caveat", "follow_up")))]
    at = next((i + 1 for i, s in enumerate(rest) if s.get("type") == "summary"),
              next((i for i, s in enumerate(rest) if s.get("type") != "caveat"), len(rest)))
    out = rest[:at] + [{**s, "type": "context"} for s in assume] + rest[at:]
    if _AMOUNT_ASKED.search(user_text) and not calc:
        end = len(out)
        while end > 0 and out[end - 1].get("type") == "follow_up":
            end -= 1
        out = out[:end] + [{"text": COMPOUND_TAX_NOTE, "type": "caveat"}] + out[end:]
    return out


# ── 주식 양도 계산 갈래(E단계, 10/20 — design/E단계_주식양도_복합사안_설계_1014.md §2-4·§3) ─────────────────────────────
# 스위치 STOCK_CALC(기본 off) 뒤에서만. 주식/지분 낱말 + 양도·매매 낱말 + 금액 하나 이상(복합 사안 꼴이거나 세액을 물었을 때)이면
# 계산기(calc.stock_transfer*)가 세액을 내고 작문은 세목 절 문장만 쓴다(Solar 산술 금지 — 세액은 계산기만).
#  · 필수 값(거래가·취득가, 특수관계면 시가)이 없으면 한 문장으로 묻는다(Solar 0, outcome stock_missing)
#  · 있으면 복합 사안 자문 갈래 그대로 + 결론 문단 = 계산기 결론(대주주 여부·회사 규모를 모르면 경우별) · ■ 세목 절마다 단계 표 ·
#    끝에 계산하지 않는 것(NOT_MODELED) + 청하기(invite). 쟁점별 조문 블록(law_select.ISSUE_LAWS)은 그대로.
_STOCK_WORD = re.compile(r"주식|지분|주권|비상장|상장\s*(?:주|사|회사|기업)")
_STOCK_DEAL = re.compile(r"양도|팔|판매|매도|매매|넘기|넘겨|처분|사려|사면|매수|양수|인수")
_STOCK_MISSING_HEAD = "주식 양도 세금을 계산하려면"


def _stock_calc_on() -> bool:
    return os.environ.get("STOCK_CALC", "off") == "on"


@dataclass
class _StockPlan:
    filled: "stock_slots.Filled"
    scens: list
    trace: str


def _stock_context(history: list[Message]) -> bool:
    """바로 앞 답이 주식 계산(필수 값 묻기 또는 계산 답 — 고정 문장으로 안다)이었나."""
    last = next((m for m in sorted(history, key=lambda m: m.order, reverse=True) if m.role == "assistant"), None)
    return last is not None and any(s.text.startswith(_STOCK_MISSING_HEAD) or s.text == stock_view.NOT_MODELED
                                    for s in last.segments)


def _stock_plan(history: list[Message], user_text: str, qtype: str | None) -> _StockPlan | None:
    if not _stock_calc_on():
        return None
    ctx = _stock_context(history) and bool(stock_extract.read_slots([user_text]) or _STOCK_WORD.search(user_text))
    if ctx:      # 앞 계산에 대한 답("취득가는 1억이에요") — 대화의 사용자 발화를 다 읽는다(뒤 발화가 이김)
        users = [s.text for m in sorted(history, key=lambda m: m.order) if m.role == "user" for s in m.segments]
    else:
        if not (_STOCK_WORD.search(user_text) and _STOCK_DEAL.search(user_text)):
            return None
        if not (_compound_case(qtype, user_text) or _AMOUNT_ASKED.search(user_text)):
            return None
        users = []
    ex = stock_extract.read_slots(users + [user_text])
    if not ctx and not any(ex.get(k) is not None for k in ("price", "acquisition", "market_value")):
        return None
    f = stock_slots.fill(ex)
    scens = stock_slots.scenarios(f)
    return _StockPlan(f, scens, stock_view.trace_text_cases(scens, f.assumed) if scens else "")


def _stock_section_at(raw: list[dict], title: str) -> int | None:
    return next((i for i, s in enumerate(raw) if _HEAD.match(t := s.get("text") or "") and title in t
                 and not _CHECK_HEAD.match(t) and not _ALT_HEAD.match(t)), None)


def _stock_finish(raw: list[dict], stock: _StockPlan) -> list[dict]:
    """작문(_shape_compound 뒤) + 계산기 — 작문의 결론 문단·'가정:' 줄은 빼고 계산기 결론을 맨 위에, ■ 세목 머리는 계산기
    머리로 맞추고 그 절 문장 뒤에 단계 표, 작문이 안 쓴 과세 세목은 머리 + 판정 문장 + 표로 보탬, 끝에 NOT_MODELED + 청하기."""
    out = [s for s in raw if s.get("type") != "summary" and not _ASSUME_LINE.match(s.get("text") or "")]
    parts = stock_view.sections_markdown_cases(stock.scens)
    titles = {sec.title for sec, _, _ in parts}
    for sec, lead, table in parts:
        tab = ([{"text": table, "type": "application", "citations": stock_view.section_citations(sec)}] if table else [])
        i = _stock_section_at(out, sec.title)
        if i is None:
            if not sec.applies:
                continue
            at = next((j for j, s in enumerate(out) if _CHECK_HEAD.match(t := s.get("text") or "") or _ALT_HEAD.match(t)),
                      None)
            if at is None:
                at = len(out)
                while at > 0 and out[at - 1].get("type") in ("caveat", "follow_up"):
                    at -= 1
            out[at:at] = [{"text": stock_view.section_head(sec), "type": "context"},
                          {"text": lead, "type": "application"}] + tab
            log.info("주식 계산 — 작문에 없던 세목 절 보탬: %s", sec.title)
            continue
        out[i] = {**out[i], "text": stock_view.section_head(sec)}
        # 절 끝 = 다음 ■ 머리 · 고지 · 또는 다른 세목 이름으로 시작하는 문장(로컬 sm1020 M1: 작문이 마지막 절 뒤에 머리 없이
        # '양도소득세는 …'·'증여세는 …'을 덧붙여 증권거래세 표가 그 뒤로 밀렸다)
        j = i + 1
        while (j < len(out) and not _HEAD.match(t := out[j].get("text") or "")
               and out[j].get("type") not in ("caveat", "follow_up")
               and not any(t.lstrip().startswith(o) for o in titles - {sec.title})):
            j += 1
        out[j:j] = tab
    concl = []
    for kind, text in stock_view.conclusion_parts(stock.scens, stock.filled.assumed):
        if kind == "headline":
            concl.append({"text": text, "type": "summary" if answer_display.summary_on() else "conclusion"})
        else:
            concl.append({"text": text, "type": "application" if kind == "table" else "context"})
    at = next((i for i, s in enumerate(out) if s.get("type") != "caveat"), len(out))
    out = out[:at] + concl + out[at:]
    out.append({"text": stock_view.NOT_MODELED, "type": "caveat"})
    ask = stock_slots.invite(stock.filled, stock.scens)
    if ask:
        out.append({"text": ask, "type": "follow_up"})
    return out


def _stock_law(law: "_LawStep", stock: _StockPlan | None) -> "_LawStep":
    """계산 표가 다는 조문을 허용 조문에 더한다(배지 대조가 표 배지를 지우지 않게)."""
    if stock is None or law is None:
        return law
    return replace(law, allowed=set(law.allowed) | stock_view.calc_citation_keys(stock.scens))


# 질문 유형(A2) — 되묻기에 대한 짧은 답("연봉 4천이에요", "2억짜리요")은 추출이 '계산'으로 바꿔 버린다(10/13 오프라인: 데모
# 세트 오류 12건 중 7건, 스키마에 '바꾸지 마세요'를 적어도 그대로). 질문 꼴이 아닌 후속 턴은 같은 대화의 직전 유형을 잇는다.
# 직전 유형은 프로세스 메모리(서버는 워커 1대) — 재시작으로 잃으면 추출 값 그대로. Message 에 필드를 더하지 않는다(프론트 Zod).
_QUESTION_FORM = re.compile(r"[?？]|[나까가]요|뭐예요|뭔가요|뭐야|어때|알려|궁금|어떻게|얼마|무엇|뭐가|되나|돼요\?|해야|할까|인지")
_QTYPE_MEMORY: "OrderedDict[str, str]" = OrderedDict()
_QTYPE_LOCK = threading.Lock()
QTYPE_MEMORY_MAX = 5000


# 어휘 단서가 분명한 질문은 결정론으로 보정한다(차량 낱말 보정과 같은 방식) — 추출은 같은 문장도 회차마다 갈렸다(10/13 오프라인:
# "상속세 얼마나 나와요?" 계산↔요건, "미용 시술하면 부가세 내야 해요?"는 법령 정의로 쏠림). 앞에 있는 단서가 이긴다.
_QTYPE_CUES = (
    ("절차", re.compile(r"(?<!성실)신고.{0,12}(?:해야|언제|기한|어떻게|안\s*하면|못\s*하면|놓치|빠뜨)"
                      r"|(?:기한|마감).{0,6}(?:놓치|놓쳤|지났|넘)|어떻게\s*(?:하면|해야|하나요|하죠|신청)")),
    ("계산", re.compile(r"얼마(?!까지)(?:나|쯤|정도)?\s*(?:나와|나오|내|떼|돌려|받|돼|되|예요|에요|인가|야|일까)|실수령")),
    ("사례 판단", re.compile(r"(?:하면|할\s*때|팔\s*때|받으면|주면|살면|쓰면|사면|생기면).{0,25}"
                         r"(?:내야|붙여야|나와|나오|되나|돼요|될까|줄어|줄까)")),
)


def _question_type_cue(user_text: str) -> str | None:
    return next((qt for qt, pat in _QTYPE_CUES if pat.search(user_text)), None)


def _settle_question_type(conversation_id: str, history: list[Message], user_text: str, extracted: dict) -> None:
    cue = _question_type_cue(user_text)
    if cue and extracted.get("question_type") != cue:
        log.info("질문 유형 단서 보정: %r → %s", extracted.get("question_type"), cue)
        extracted["question_type"] = cue
    with _QTYPE_LOCK:
        prev = _QTYPE_MEMORY.get(conversation_id)
        if (prev and any(m.role == "user" for m in history) and not _QUESTION_FORM.search(user_text)
                and extracted.get("question_type") != prev):
            log.info("질문 유형 이어 받기(짧은 답): %r → %s", extracted.get("question_type"), prev)
            extracted["question_type"] = prev
        qt = extracted.get("question_type")
        if qt:
            _QTYPE_MEMORY[conversation_id] = qt
            _QTYPE_MEMORY.move_to_end(conversation_id)
            while len(_QTYPE_MEMORY) > QTYPE_MEMORY_MAX:
                _QTYPE_MEMORY.popitem(last=False)


# ── 이번 턴의 성격(C단계, 10/15 사용자 정책) ─────────────────────────────────────────────────────────
# 추출의 turn_kind(답변 / 같은 주제 / 다른 주제)를 결정론으로 보정해 두 가지에 쓴다. 끄기 TURN_KIND=off.
#  ① 답변 턴 — 앞 턴이 경비 아닌 특정 세목(상속·양도·부가세 …)이었으면 경비 판정 갈래로 보내지 않는다. g5(10/15) S02 상속세
#     "아파트 한 채, 시가 15억 정도요"를 추출이 가사관련비로 잡아 업무사용비율을 되묻고, 3턴째 차량 판정 카드까지 냈다(10/13부터 간헐).
#  ② 다른 주제 — 앞 대화의 결정변수·슬롯을 쓰지 않고 새 질문으로 답한 뒤, 끝에 새 상담·세무사 상담 권장 문구와 세무사 연결 박스.
#     같은 주제의 새 질문은 지금처럼 원질문으로 다시 판단한다(질문 꼴이면 유형 이어 받기도 안 한다 — _settle_question_type).
# 앞 턴 주제는 프로세스 메모리(질문 유형 메모리와 같은 방식, 재시작 시 ①은 건너뜀). Message 에 필드를 더하지 않는다(프론트 Zod).
TOPIC_SHIFT_NOTE = "더 다양하거나 깊은 질문은 새 상담을 시작하시거나 세무사와 상담해 보시길 권해 드려요."
_TOPIC_MEMORY: "OrderedDict[str, str]" = OrderedDict()
# 답변 턴을 경비 갈래로 보내지 않는 앞 주제 — 막연한 주제('기타'·'사업경비 일반')는 뒤 답이 경비 사안일 수 있어 뺀다.
_NON_EXPENSE_SPECIFIC = {"근로소득세·연말정산", "종합소득세", "부가가치세", "양도소득세", "상속·증여",
                         "인건비·4대보험", "법인전환·개원폐업", "세무조사·신고절차"}


def _turn_kind_on() -> bool:
    return os.environ.get("TURN_KIND", "on") != "off"


def _settle_turn_kind(history: list[Message], user_text: str, extracted: dict) -> str | None:
    """첫 턴이면 None. 질문 꼴이 아닌 발화는 모델 값과 무관하게 '답변'(앞 질문에 대한 짧은 답을 새 주제로 읽으면 맥락이 통째로
    사라진다 — 오판의 비용이 비대칭). 질문 꼴인데 모델이 값을 안 냈으면 '같은 주제'(지금 동작)."""
    if not any(m.role == "user" for m in history):
        return None
    raw = extracted.get("turn_kind")
    if not _QUESTION_FORM.search(user_text):
        return "답변"
    return raw if raw in adapter.TURN_KINDS else "같은 주제"


def _prev_topic(conversation_id: str) -> str | None:
    with _QTYPE_LOCK:
        return _TOPIC_MEMORY.get(conversation_id)


def _remember_topic(conversation_id: str, topic: str | None) -> None:
    if not topic:
        return
    with _QTYPE_LOCK:
        _TOPIC_MEMORY[conversation_id] = topic
        _TOPIC_MEMORY.move_to_end(conversation_id)
        while len(_TOPIC_MEMORY) > QTYPE_MEMORY_MAX:
            _TOPIC_MEMORY.popitem(last=False)


_AMOUNT_WORD = re.compile(r"\d|[일이삼사오육칠팔구십백천만억]\s*(?:원|만|억|천)")


def _drop_carried(extracted: dict, user_text: str) -> None:
    """다른 주제 턴 — 추출이 앞 대화에서 옮겨 온 판정·계산 입력값을 버린다(결정변수는 뒤의 verify_decisive 가 빈 이력으로 한 번 더
    거른다). 질문 성격 값(주제·검색 질의·유형)은 이번 발화로 다시 잡은 것이라 둔다."""
    for k in adapter.DECISIVE_FIELDS + adapter.CALC_FIELDS:
        extracted.pop(k, None)
    if not _AMOUNT_WORD.search(user_text):
        extracted.pop("amount", None)


def _with_topic_shift_note(resp: ChatResponse) -> ChatResponse:
    """다른 주제 턴의 끝에 권장 문구(caveat) + 세무사 연결 박스(이미 붙어 있으면 그대로). 응답 모양은 기존 그대로(Zod 무변경)."""
    msg = resp.message
    if any(s.text == TOPIC_SHIFT_NOTE for s in msg.segments):
        return resp
    seg = Segment(id=f"{msg.id}_s{len(msg.segments)}", text=TOPIC_SHIFT_NOTE, type="caveat")
    blocks = list(msg.uiBlocks or [])
    meta = resp.meta
    if not any(b.kind == "expert_handoff" for b in blocks):
        blocks.append(handoff.block("topic_shift"))
        meta = meta.model_copy(update={"handoff": meta.handoff or "topic_shift"})
    return resp.model_copy(update={"message": msg.model_copy(update={"segments": list(msg.segments) + [seg],
                                                                      "uiBlocks": blocks}),
                                   "meta": meta})


def _law_result(future, gated_passages: list) -> _LawStep | None:
    """병렬로 돈 LLM3 결과 + 작문에 줄 근거는 게이트 **뒤** 근거(심판례 카드 '조문:' 줄 뺀 판). 혼잡은 올려 보낸다."""
    if future is None:
        return None
    try:
        law = future.result()
    except upstage_gate.UpstageCongested:
        raise
    except Exception as exc:  # noqa: BLE001 — 부가 단계. 실패하면 LLM3 없이
        log.warning("LLM3 단계 실패 — 건너뜀: %s", exc)
        return None
    if law is None:
        return None
    return replace(law, passages=law_select.strip_card_law_lines(gated_passages))


def _law_checked(raw: list[dict], law: _LawStep | None, where: str,
                 max_n: int = law_select.MAX_SEGMENTS) -> list[dict]:
    """작문 뒤 코드 대조 — LLM3 가 고른 조문·엔진 근거·사용자 발화 밖 법령을 인용한 문장(LAW_CITE_CHECK=drop 이면 뺀다)."""
    if law is None:
        return raw
    out = raw
    if law_select.check_mode() != "off":
        out, rep = law_select.check_answer(raw, law.allowed)
        if rep.flagged:
            log.info("법령 인용 대조(%s): 허용 밖 %s · 제외 %d", where, [f["cites"] for f in rep.flagged], rep.dropped)
    return law_select.trim_answer(out, max_n)


def _search_query(history: list[Message], user_text: str, extracted: dict) -> str:
    """KB3·LLM3·쟁점 게이트에 쓸 질의(R1-a, 10/10). 추출기가 대화 전체를 반영해 다시 쓴 독립 질의를 쓰고,
    대화 첫 턴이거나 비었으면 이번 발화 그대로(첫 턴은 다시 쓸 맥락이 없다 — 기준선 동작 유지)."""
    q = (extracted.get("search_query") or "").strip() if isinstance(extracted.get("search_query"), str) else ""
    if not q or not any(m.role == "user" for m in history):
        return user_text
    if q != user_text:
        log.info("검색 질의 재작성: %r → %r", user_text[:40], q[:80])
    return q


# 표 값 질문(F1, 10/12) — 세무사 Q1 "종합소득세율 알려주세요": 조문에 표가 복원돼도 작문이 첫 두 구간만 말하거나
# "표를 참고하세요"로 넘겼다(로컬 X01·X07). 표의 행은 법령 원문이므로 결정론으로 싣는다(Solar 가 옮겨 적지 않음).
_TABLE_Q = re.compile(r"세율|구간|공제액|공제율|누진|세액표|몇\s*(?:%|퍼센트|프로)")
TABLE_MAX_ROWS = 12


def _md_cell(t: str) -> str:
    # 법령 원문 표 머리의 '<과세표준>'·'세 율' — 화면 표 머리로는 꺾쇠를 벗기고 띄어 쓴 두 글자를 붙인다(값 칸은 원문 그대로)
    t = re.sub(r"^<\s*(.+?)\s*>$", r"\1", (t or "").strip())
    t = re.sub(r"^([가-힣]) ([가-힣])$", r"\1\2", t)
    return t.replace("|", "\\|").replace("\n", " ").strip()


def _table_segments(law: "_LawStep | None", user_text: str) -> list[dict]:
    if law is None or not law.tables or not _TABLE_Q.search(user_text):
        return []
    def rank(t) -> tuple:
        stem = re.sub(r"(?:의)?\s*세율$", "", t.title or "").strip()
        return (0 if stem and stem in user_text else 1 if law_select.is_rate_title(t.title) else 2, len(t.title or ""))
    best = min(law.tables, key=rank).label           # 질문에 가장 가까운 조문 하나의 표만(같은 조문의 호별 표는 함께)
    out: list[dict] = []
    for t in [t for t in law.tables if t.label == best][:3]:
        head = f"{t.label}({t.title})" if t.title else t.label
        cap = t.caption if re.match(r"^(?:\d+\.|[가-하]\.)\s", t.caption or "") else ""   # 호·목 줄만 표 제목으로
        cols = " · ".join(t.header)
        out.append({"text": f"{head}{' ' + cap if cap else ''}에 정한 표({cols})는 다음과 같습니다.",
                    "type": "rule_statement", "citations": [t.label]})
        if answer_display.TABLES:   # Markdown 표 한 세그먼트(팀 design/answer-tables.md) — 행 값은 '· 행'과 같은 법령 원문
            width = max(len(t.header), *(len(r) for r in t.rows[:TABLE_MAX_ROWS]))
            head_row = [_md_cell(c) for c in t.header] + [""] * (width - len(t.header))
            lines = ["| " + " | ".join(head_row) + " |", "|" + " --- |" * width]
            lines += ["| " + " | ".join([_md_cell(c) for c in r] + [""] * (width - len(r))) + " |"
                      for r in t.rows[:TABLE_MAX_ROWS]]
            out.append({"text": "\n".join(lines), "type": "rule_statement"})
            continue
        for r in t.rows[:TABLE_MAX_ROWS]:
            line = f"{r[0]}: {' · '.join(c for c in r[1:] if c)}" if len(r) > 1 else r[0]
            out.append({"text": f"· {line}", "type": "rule_statement"})
    return out


# 증여세율 질문의 '세율 적용 전·후'(세무사 3차 평가 10/18 추가2, 근거 3점: "세율만이 아니라 증여재산공제·세대생략 할증이 중요").
# 표 뒤에 결정론으로 — 공제 한도표는 §53 호 원문에서, 혼인·출산 공제(§53의2)·할증(§57)은 조문의 금액·비율을 읽어 문장 틀에 넣는다
# (Solar 가 옮겨 적지 않는다). 조문 모양이 바뀌어 못 읽으면 그 부분은 싣지 않는다. 끄기 GIFT_RATE_EXTRAS=off.
_GIFT_RATE_Q = re.compile(r"증여세")
_SGJ = "상속세 및 증여세법"
_GIFT_ITEM = re.compile(r"^(\d)\.\s*(.+?)(?:으로부터|로부터)\s*증여를\s*받은\s*경우\s*:\s*([\d억천만]+원)(.*)$", re.M)


def _strip_brackets(t: str) -> str:
    prev = None
    while prev != t:
        prev, t = t, re.sub(r"[\[(][^\[\]()]*[\])]", "", t)
    return re.sub(r"\s+", " ", t).strip()


def _gift_rate_extras(user_text: str) -> tuple[list[dict], set]:
    if os.environ.get("GIFT_RATE_EXTRAS", "on") == "off" or not _GIFT_RATE_Q.search(user_text) or not _TABLE_Q.search(user_text):
        return [], set()
    st = law_select.store()
    if st is None:
        return [], set()
    out: list[dict] = []
    keys: set = set()
    a53 = st.by_key.get((_SGJ, "53"))
    rows = []
    for m in _GIFT_ITEM.finditer(a53.text if a53 else ""):
        who = re.sub(r"^제\d호\s*및\s*제\d호의\s*경우\s*외에\s*", "", _strip_brackets(m.group(2)))
        minor = re.search(r"미성년자[^.]*?([\d억천만]+원)으로\s*한다", m.group(4))
        rows.append((who, m.group(3) + (f" (미성년자는 {minor.group(1)})" if minor else "")))
    if len(rows) >= 3:
        out.append({"text": "■ 세율 적용 전: 증여재산공제 — 세율은 증여받은 금액 전체가 아니라 공제를 뺀 과세표준에 적용되고, "
                            "공제 한도는 증여자 그룹별로 10년간 받은 증여를 합산해 적용합니다.",
                    "type": "rule_statement", "citations": [f"{_SGJ} 제53조"]})
        out.append({"text": "\n".join(["| 증여자 | 공제 한도(10년 합산) |", "| --- | --- |"]
                                      + [f"| {_md_cell(w)} | {_md_cell(v)} |" for w, v in rows]),
                    "type": "rule_statement"})
        keys.add((_SGJ, "53"))
    a532 = st.by_key.get((_SGJ, "53의2"))
    m = re.search(r"별개로\s*([\d억천만]+원)을", a532.text if a532 else "")
    if m:
        out.append({"text": f"이와 별도로 직계존속에게서 혼인일 전후 2년 이내 또는 자녀 출생·입양일부터 2년 이내에 받는 증여는 "
                            f"혼인·출산 증여재산공제로 {m.group(1)}까지 더 공제됩니다(둘을 합쳐 {m.group(1)} 한도).",
                    "type": "rule_statement", "citations": [f"{_SGJ} 제53조의2"]})
        keys.add((_SGJ, "53의2"))
    a57 = st.by_key.get((_SGJ, "57"))
    m = re.search(r"100분의\s*(\d+)\(.*?([\d억천만]+원)을\s*초과하는\s*경우에는\s*100분의\s*(\d+)\)", a57.text if a57 else "")
    if m:
        out.append({"text": f"■ 세율 적용 후: 세대생략 할증과세 — 조부모가 손자녀에게 주는 것처럼 자녀가 아닌 직계비속이 증여받으면 "
                            f"산출세액에 {m.group(1)}%를 더합니다(미성년자이면서 증여재산가액이 {m.group(2)}을 넘으면 {m.group(3)}%). "
                            "자녀가 이미 사망해 그 자녀의 자녀가 받는 경우에는 할증하지 않습니다.",
                    "type": "rule_statement", "citations": [f"{_SGJ} 제57조"]})
        keys.add((_SGJ, "57"))
    return out, keys


# 근거에 없는 문서번호 인용(F1 운영 10/12): X07 답이 "국세청의 기존 해석 사례(조심 2024서0560, 서면-2022-원천-4266)"라고 썼다 —
# 둘 다 법령 인용 규칙 프롬프트의 **예시**였다(예시는 지웠다). 프롬프트에 실제로 들어간 근거의 문서번호가 아니면 그 문장을 뺀다.
_DOC_REF = re.compile(r"(?:조심|국심)\s?\d{4}\s?[가-힣]{1,2}\s?\d+|(?:서면|사전|기준|법규|법령해석)-\d{4}-[가-힣A-Za-z]+-\d+")


def _drop_unknown_doc_refs(raw: list[dict], passages, where: str) -> list[dict]:
    known = {re.sub(r"\s", "", r) for p in passages or [] for r in (p.case_refs or [])}
    known |= {re.sub(r"\s", "", m.group(0)) for p in passages or [] for m in _DOC_REF.finditer(p.content or "")}
    kept = [s for s in raw if all(re.sub(r"\s", "", m.group(0)) in known for m in _DOC_REF.finditer(s.get("text") or ""))]
    if len(kept) < len(raw):
        log.warning("근거에 없는 문서번호 인용 문장 제거 %d건 — %s", len(raw) - len(kept), where)
    return kept


_STATUTE = re.compile(r"제\s?\d+\s?조|§\s?\d+|\d+조의?\d*\s?제?\d*항")
LAW_ONLY_LEAD = "아래는 현행 법령 조문을 바탕으로 한 참고 안내입니다(세무사가 이 사안을 확인한 내용은 아닙니다)."
LISTENING_LABEL = "아래는 법령 조문을 특정하지 못한 일반 안내입니다(세무사가 확인한 내용은 아닙니다)."


def _listening_segments(history: list[Message], user_text: str, topic: str | None, message_id: str,
                        searched: list[str]) -> list[Segment]:
    """듣기 응답(R1-c · D-1) — 되짚기·일반 확인 포인트·질문 1개는 Solar, 라벨은 여기서 결정론으로.
    숫자는 numeric_guard 로 걸러 낸다(근거가 없으니 출처 = 사용자 발화·규범뿐). 라벨은 되짚기 문장 바로 뒤."""
    raw = llm.write_listening(history, user_text, topic)
    sources, own = _number_sources(history, user_text, [])
    raw = numeric_guard.drop_unsourced_numbers(raw, sources, own, where=f"listening {message_id}")
    # 근거 없는 갈래라 조문 인용은 날조다 — 프롬프트 금지를 뚫고 앞선 대화의 조문을 옮겨 쓴 일이 있다(S02 3턴 '상증법 제60조').
    kept = [s for s in raw if not _STATUTE.search(s.get("text") or "")]
    if len(kept) < len(raw):
        log.warning("듣기 응답 조문 인용 문장 제거 %d건 — %s", len(raw) - len(kept), message_id)
    raw = kept
    label = (f"관련 {'·'.join(searched)} 자료를 찾아봤지만 이 질문의 쟁점을 직접 다룬 것이 없습니다. " + LISTENING_LABEL
             if searched else LISTENING_LABEL)
    at = 1 if len(raw) > 1 else 0
    raw = raw[:at] + [{"text": label, "type": "caveat"}] + raw[at:]
    return _clean_segment_dicts(raw, message_id)


# 내부 용어 결정론 교정(R1-b) — 프롬프트 금지를 뚫고 나온 것만. 판정 경로의 "규칙엔진의 판정에 따르면"도 고친다.
_JARGON_FIX = [
    (re.compile(r"규칙\s?엔진의\s*판정"), "판정"),
    (re.compile(r"규칙\s?엔진"), "판정 기준"),
]


def _scrub_jargon(text: str) -> str:
    for pat, sub in _JARGON_FIX:
        text = pat.sub(sub, text)
    return text


def _next_order(history: list[Message]) -> int:
    return (max((m.order for m in history), default=0)) + 1


def _clean_segment_dicts(raw: list[dict], message_id: str) -> list[Segment]:
    """Assign deterministic ids (A-3) and coerce LLM output into Segment models.

    같은 문장이 다시 나오면 버린다. solar-pro3 도구 출력이 가끔 반복 루프에 빠진다 — 한 문장 ×65,
    네 문장 ×26 (2026-09-17 로컬, 자문 경로 24회 중 1~4회 · 09-16 프로덕션 7문장 ×4). 원인
    치료가 아니라 화면 보호용 가드이고, 빈도를 볼 수 있게 버린 개수를 로그로 남긴다."""
    segments: list[Segment] = []
    seen: set[str] = set()
    dropped = 0
    for i, s in enumerate(raw):
        text = _scrub_jargon((s.get("text") or "").strip())
        if not text:
            continue
        if text in seen:
            dropped += 1
            continue
        seen.add(text)
        framework = s.get("framework") or None
        citations = [c for c in (s.get("citations") or []) if c] or None
        segments.append(Segment(
            id=f"{message_id}_s{len(segments)}",
            text=text,
            type=s.get("type") or "context",
            framework=framework,
            citations=citations,
        ))
    if dropped:
        log.warning("segment 반복 제거 %d건 (남은 %d) — %s", dropped, len(segments), message_id)
    if not segments:  # never return an empty-segment message (schema requires ≥1)
        segments.append(Segment(id=f"{message_id}_s0",
                                text="죄송합니다. 답변을 생성하지 못했습니다.", type="caveat"))
    return segments


# 출처 배지(S1b, 10/6 밤) — 화면(SegmentRenderer)은 세그먼트 citations 를 배지로 그리는데, solar 가 도구에서 채우는 날과
# 안 채우는 날이 갈렸다(자문 0/9 · 3/8, 판정은 조문만 — 쓴 해석·심판례 번호 0). 그 답의 프롬프트에 실제로 들어간 근거의
# 문서번호를 서버가 결정적으로 붙인다(LLM 아님): ① 본문에 적힌 번호·조문은 그 문장에 ② 그래도 쓴 번호가 하나도 안 보이면
# 기준 문장(자문 = 맨 앞 안내 · 판정 = 마지막)에 모아서. 세무사 사례는 번호가 없어 '세무사 사례 · 이름 · 제목' 표시를 쓴다
# — 3자 방에서 세무사가 자기 사례가 쓰였는지 보고 가르치기를 판단한다(사용자 10/6).
CITATION_ANCHOR_MAX = 5
CITATIONS_PER_SEGMENT = 3


def _passage_refs(passages) -> list[str]:
    refs: list[str] = []
    for p in passages or []:
        if p.case_refs:
            refs += [r for r in p.case_refs if r]
        elif getattr(p, "corpus", None) == "kb3_expert":
            first = (p.content or "").strip().splitlines()[0] if (p.content or "").strip() else ""
            m = re.match(r"\[(.+?)\]\s*(.+)", first)
            if m:
                refs.append(f"{m.group(1)} · {m.group(2)}"[:60])
    return list(dict.fromkeys(refs))


def _attach_citations(segments: list[Segment], passages, anchor: int,
                      laws: list[str] | None = None) -> list[Segment]:
    """laws: LLM3 가 고른 조문 표시 이름 — 주면 근거 카드 law_articles 대신 이것만 배지 후보로 쓴다(10/7)."""
    refs = _passage_refs(passages)
    if laws is None:
        laws = list(dict.fromkeys(a for p in passages or [] for a in (p.law_articles or []) if a))
    out = []
    for seg in segments:
        have = seg.citations or []
        text = _plain_law_names(seg.text)
        add = [r for r in refs + laws if _mentions(r, text) and r not in have]
        out.append(seg.model_copy(update={"citations": have + add}) if add else seg)
    shown = {c for seg in out for c in (seg.citations or [])}
    if refs and not any(r in shown for r in refs):
        i = anchor if 0 <= anchor < len(out) else len(out) - 1
        have = out[i].citations or []
        out[i] = out[i].model_copy(update={"citations": have + [r for r in refs[:CITATION_ANCHOR_MAX] if r not in have]})
    return _tidy_citations(out)


# ── 유형별 답변 형식(A3, 10/13) — 작문 규칙(llm._FORM_RULES)이 형식을 요청하고, 여기서 화면 모양을 결정론으로 마무리한다 ──
# 요건: 한 세그먼트에 몰아 쓴 "1. … 2. …"를 항목별로 가르고, ①·1) 표기를 "1. "로 맞추고, 항목마다 호까지 적힌 조문 배지를 단다.
# 정의: 작문이 '관련 조문' 문장을 빠뜨리면 LLM3 가 고른 다른 조문으로 한 문장을 붙인다(블록에 실제로 들어간 조문만).
_RELATED_LINE = re.compile(r"^\s*관련\s*조문\s*[:：]")   # 산문 속 '관련 조문과 해석…'은 형식 줄이 아니다
REQ_MAX_SEGMENTS = 10          # 조문 소개 + 요건 ≤6 + 보충·질문 — 일반 자문 상한(8)으로는 목록 꼬리가 잘린다
_ITEM_MARK = re.compile(r"^\s*(?:(\d{1,2})[.)]|\((\d{1,2})\)|([①-⑩]))\s*")
_INLINE_ITEMS = re.compile(r"(?:(?<=\s)|^)(?:(\d{1,2})[.)]\s|([①-⑩])\s?)")
_CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩"


def _item_no(m: re.Match) -> int:
    return int(m.group(1)) if m.group(1) else _CIRCLED.index(m.group(2)) + 1


def _segment_cap(qtype: str | None) -> int:
    return REQ_MAX_SEGMENTS if qtype == "요건" else law_select.MAX_SEGMENTS


def _split_inline_items(seg: dict) -> list[dict]:
    """"요건은 1. A 2. B 3. C" 한 문장 → 머리 + 항목별 세그먼트. 1부터 차례로 이어지는 번호가 둘 이상일 때만."""
    text = seg.get("text") or ""
    if text.lstrip().startswith("|") or seg.get("type") == "summary":   # Markdown 표 셀 속 '1. '을 항목으로 쪼개지 않는다
        return [seg]
    marks = [m for m in _INLINE_ITEMS.finditer(text)]
    seq, want = [], 1
    for m in marks:
        if _item_no(m) == want:
            seq.append(m)
            want += 1
    if len(seq) < 2:
        return [seg]
    parts = []
    head = re.sub(r"[,，]\s*$", ":", text[:seq[0].start()].strip())   # "…정하고 있는데," → "…정하고 있는데:"
    if len(head) > 12:          # "요건은" 같은 짧은 머리 조각은 버린다 — 앞의 조문 소개 문장이 그 몫이다
        parts.append({**seg, "text": head, "citations": []})
    for i, m in enumerate(seq):
        end = seq[i + 1].start() if i + 1 < len(seq) else len(text)
        item = re.sub(r"[,，]?\s*(?:및|그리고)?\s*$", "", text[m.end():end].strip())   # 문장 속 나열의 이음 쉼표·'및'
        parts.append({"text": f"{_item_no(m)}. {item}", "type": "rule_statement"})
    return parts


def _shape_requirements(raw: list[dict]) -> list[dict]:
    """항목 표기를 '1. '로 맞추고, 이어진 항목 줄은 1부터 차례로 다시 번호를 매긴다(세그먼트를 넘어 1이 다시 나오지 않게)."""
    out: list[dict] = []
    n = 0
    for s in raw:
        if s.get("type") == "caveat":
            out.append(s)
            n = 0
            continue
        for p in _split_inline_items(s):
            m = _ITEM_MARK.match(p.get("text") or "")
            if m:
                n += 1
                p = {**p, "text": f"{n}. {p['text'][m.end():].strip()}"}
            else:
                n = 0
            out.append(p)
    return out


def _related_articles_line(raw: list[dict], law: "_LawStep | None") -> list[dict]:
    """정의 형식 ③ '관련 조문' — 작문이 썼으면 그대로. 없으면 첫 설명 문장에 안 나온 고른 조문으로 한 문장(없으면 안 붙인다)."""
    if law is None or not law.labels or any(_RELATED_LINE.match(s.get("text") or "") for s in raw):
        return raw
    body = [i for i, s in enumerate(raw) if s.get("type") != "caveat"]
    if not body:
        return raw
    first = _plain_law_names(raw[body[0]].get("text") or "")
    others = [(lab, t) for lab, t in zip(law.labels, law.titles or [""] * len(law.labels)) if lab not in first]
    if not others:
        return raw
    line = {"text": "관련 조문: " + ", ".join(f"「{lab.split(' 제')[0]}」 제{lab.split(' 제', 1)[1]}" + (f"({t})" if t else "")
                                            for lab, t in others[:3]) + ".",
            "type": "rule_statement", "citations": [lab for lab, _ in others[:3]]}
    # 첫 설명·풀이 뒤(보충 사례·되묻기 앞)에 둔다.
    at = next((i for i in body[1:] if raw[i].get("type") in ("follow_up", "caveat", "evidence_request")
               or re.search(r"심판|국세청|해석|판례", raw[i].get("text") or "")), len(raw))
    at = max(at, min(body[0] + 2, len(raw)))
    return raw[:at] + [line] + raw[at:]


# 이름 없는 '시행령 제N조'·'같은 법 시행령 제N조'(10/15 운영 g1 X03: 작문이 요건 항목을 직접 쓰며 "시행령 제109조제1항의 1억400만원에
# 미달하고"처럼 법령 이름을 빼 항목 배지가 1/3 — A3 실패). 허용 조문 중 그 번호의 시행령·시행규칙이 하나뿐일 때만 이름을 채운다.
_BARE_SUB = re.compile(r"(같은\s?법\s?)?(시행령|시행규칙)\s?(제\s?(\d+)\s?조(?:의\s?(\d+))?)")
_NAMED_BEFORE = re.compile(r"(?:법|」)\s?$")


def _qualify_bare_decrees(raw: list[dict], allowed: set) -> list[dict]:
    def fix(t: str) -> str:
        out, pos = [], 0
        for m in _BARE_SUB.finditer(t):
            if not m.group(1) and _NAMED_BEFORE.search(t[:m.start()]):
                continue
            no = m.group(4) + (f"의{m.group(5)}" if m.group(5) else "")
            laws = {lw for lw, n in allowed if n == no and lw.endswith(" " + m.group(2))}
            if len(laws) != 1:
                continue
            out += [t[pos:m.start()], f"{laws.pop()} {m.group(3)}"]
            pos = m.end()
        return "".join(out) + t[pos:] if out else t
    return [{**s, "text": fix(s.get("text") or "")} if s.get("type") != "summary" and _BARE_SUB.search(s.get("text") or "")
            else s for s in raw]


def _shape_by_qtype(raw: list[dict], qtype: str | None, law: "_LawStep | None") -> list[dict]:
    if os.environ.get("ADVISORY_QTYPE_FORM", "on") == "off" or law is None:
        return raw
    if qtype == "요건":
        shaped = _shape_requirements(_qualify_bare_decrees(raw, law.allowed))
        qs = _question_items([s.get("text") or "" for s in shaped])
        if not any(_NUMBERED_ITEM.match(s.get("text") or "") and i not in qs for i, s in enumerate(shaped)):
            shaped = _requirement_list_from_law(shaped, law)
        return _drop_list_restatements(shaped)
    if qtype == "법령 정의":
        return _related_articles_line(raw, law)
    return raw


# ── 같은 내용 반복 제거(세무사 재평가 10/14 지적 3) ──────────────────────────────────────────────────────────
# Q3 캡처: 호 목록(요건 폴백 또는 작문 목록)을 보인 바로 뒤에 "다만 같은 항 각 호는 …(제1호), …(제2호)…"로 같은 호를 문장으로 다시
# 풀었다. 세율 질문: 표(결정론) 뒤에 작문이 "2억원 이하 구간은 10%, …"로 표를 다시 읽었다. 규칙("다시 옮겨 적지 말 것")은 안 따랐다
# — 작문은 표·폴백 목록이 붙을 줄 모른다. 결론 문장(첫 설명)·질문별 머리(■)·되묻기는 지우지 않는다. 끄기 ADVISORY_DEDUPE=off.
_HO_MENTION = re.compile(r"제\s?(\d{1,2})\s?호")
# 번호 목록이 요건이 아니라 사용자에게 확인할 사항일 때("1. …최종소비자에게 직접 공급하는 사업인지") — 10/14 로컬 X03: 이 목록에
# 앞 문장의 조문(시행령 §111 부가가치율) 배지가 붙었고, 요건 목록이 있는 것으로 쳐서 호 목록 폴백도 안 나갔다.
_QUESTION_ITEM = re.compile(r"(?:인지|는지|ㄴ지|은지|할지|될지)(?:입니다|요|를|와|,)?(?:[.?？]|\s|$)|[?？]\s*$|여부\.?\s*$")
_QUESTION_HEAD = re.compile(r"확인|알려|여쭙|여쭤|궁금")


def _question_items(texts: list[str]) -> set[int]:
    """확인할 사항 목록에 속한 번호 항목의 위치 — 이어진 번호 항목 덩어리 단위로, 머리 문장이 '확인·알려 주시면'이거나 항목 절반 이상이
    질문 꼴이면 덩어리 전체(10/14 운영 X05-3: 마지막 항목 '…예상 공급대가 규모입니다.'가 질문 꼴이 아니라 폴백이 안 나갔다)."""
    out: set[int] = set()
    i = 0
    while i < len(texts):
        if not _NUMBERED_ITEM.match(texts[i]):
            i += 1
            continue
        j = i
        while j < len(texts) and _NUMBERED_ITEM.match(texts[j]):
            j += 1
        head = texts[i - 1] if i > 0 else ""
        block = range(i, j)
        if _QUESTION_HEAD.search(head) or sum(1 for k in block if _QUESTION_ITEM.search(texts[k])) * 2 >= len(block):
            out.update(block)
        i = j
    return out
_KEEP_TYPES = ("caveat", "follow_up", "evidence_request", "summary")
LIST_RESTATE = 0.55       # 항목 2-gram 중 이 비율 이상이 한 문장에 들어 있으면 그 항목을 되풀이한 것
TABLE_RESTATE = 3         # 표의 수치(금액·세율) 중 이만큼 겹치면 표를 다시 읽은 문장


# ── 결론 문단(answer_display.SUMMARY, 10/14 팀 피드백) ─────────────────────────────────────────────────────────
# 작문이 type=summary 로 쓴 첫 문장을 떼어 두었다가(문장 상한·반복 제거에 걸려 빠지지 않게) 따로 검사하고 위·아래에 둔다.
# 작문이 안 쓰면 만들지 않는다(지어 붙이지 않음).
def _pop_summary(raw: list[dict]) -> tuple[list[dict], list[dict]]:
    summ, rest = [], []
    for s in raw:
        if s.get("type") == "summary":
            if not summ and answer_display.summary_on():
                summ.append(s)
                continue
            s = {**s, "type": "rule_statement"}      # 둘째부터·꺼짐 = 일반 문장
        rest.append(s)
    return summ, rest


def _checked_summary(summ: list[dict], sources: list[str], own: list[str], law: "_LawStep | None",
                     passages, where: str) -> list[dict]:
    """본문과 같은 검사 — 출처 없는 수치·허용 밖 조문·근거에 없는 문서번호면 결론 문단을 뺀다(고쳐 쓰지 않음)."""
    if not summ:
        return []
    # drop_unsourced_numbers 는 전부 걸리면 원문을 돌려준다(빈 답보다 낫다는 본문용 규칙) — 결론 문단은 한 줄이라 걸리면 그대로 나갔다
    # (g5 10/15 G02-2: 사용자 "1200만원" → 결론 문단 "120만 원"이 가드에 걸리고도 화면에 나감). 결론 문단은 걸리면 뺀다.
    bad = [b for s in summ for b in numeric_guard.unsourced_in(s.get("text") or "", sources, own)]
    if bad:
        log.warning("결론 문단 출처 없는 수치 — 뺌(%s): %s", where, bad)
        return []
    out = [s for s in summ if s.get("type") == "summary"]
    if out and law is not None and law_select.check_mode() != "off":
        # 대조가 지운 배지를 쓴다 — 버리던 때(10/16 시민 48 C03) 결론 문단의 '소득세법 시행령 제14조의3'(현행에 없음) 배지가 나갔다
        out, rep = law_select.check_answer(out, law.allowed)
        if rep.flagged:
            log.info("결론 문단 허용 밖 조문 — 뺌(%s): %s", where, rep.flagged[0]["cites"])
            return []
    return _drop_unknown_doc_refs(out, passages, where)


def _place_summary(raw: list[dict], summ: list[dict]) -> list[dict]:
    if not summ:
        return raw
    # 결론 문단과 거의 같은 본문 문장(결론 먼저 규칙의 첫 문장 등)은 뺀다 — 같은 말 두 번(세무사 지적 3)
    g = law_select._bigrams(_PAREN_STRIP.sub("", summ[0].get("text") or ""))
    def echo(s: dict) -> bool:
        h = law_select._bigrams(_PAREN_STRIP.sub("", s.get("text") or ""))
        return bool(g and h) and s.get("type") != "caveat" and len(g & h) / len(g | h) >= law_select.NEAR_DUP
    raw = [s for s in raw if not echo(s)]
    if answer_display.SUMMARY == "top":         # 선두 안내(caveat) 바로 뒤
        at = next((i for i, s in enumerate(raw) if s.get("type") != "caveat"), len(raw))
    else:                                       # 끝 — 되묻기 앞
        at = len(raw)
        while at > 0 and raw[at - 1].get("type") == "follow_up":
            at -= 1
    return raw[:at] + summ + raw[at:]


def _dedupe_on() -> bool:
    return os.environ.get("ADVISORY_DEDUPE", "on") != "off"


def _protected(raw: list[dict], i: int) -> bool:
    s = raw[i]
    if s.get("type") in _KEEP_TYPES or (s.get("text") or "").lstrip().startswith(("■", "|")):   # '|' = Markdown 표
        return True
    first_body = next((j for j, x in enumerate(raw) if x.get("type") != "caveat"), None)
    return i == first_body          # 결론 문장


def _drop_list_restatements(raw: list[dict]) -> list[dict]:
    items = [law_select._bigrams(_PAREN_STRIP.sub("", s.get("text") or "")[3:])
             for s in raw if _NUMBERED_ITEM.match(s.get("text") or "")]
    items = [g for g in items if len(g) >= 4]
    if len(items) < 2 or not _dedupe_on():
        return raw
    out = []
    for i, s in enumerate(raw):
        t = s.get("text") or ""
        if _NUMBERED_ITEM.match(t) or _protected(raw, i) or t.rstrip().endswith(":"):
            out.append(s)
            continue
        g = law_select._bigrams(_PAREN_STRIP.sub("", t))
        covered = sum(1 for h in items if len(h & g) / len(h) >= LIST_RESTATE)
        if covered >= 2 or len(set(_HO_MENTION.findall(t))) >= 2:
            log.info("목록 반복 문장 제거: %r", t[:60])
            continue
        out.append(s)
    return out


_NUM_TOKEN = re.compile(r"\d[\d,]*(?:\.\d+)?\s*(?:억|천|만|%)?[\d,]*\s*(?:억|천|만)?\s*(?:원|%)")


def _num_tokens(text: str) -> set[str]:
    t = law_select.numeric_view(text).replace("퍼센트", "%")
    return {re.sub(r"[\s,]", "", m.group(0)) for m in _NUM_TOKEN.finditer(t)}


def _drop_table_restatements(raw: list[dict], table: list[dict]) -> list[dict]:
    if not table or not _dedupe_on():
        return raw
    tab = set().union(*(_num_tokens(s.get("text") or "") for s in table))
    out = []
    for i, s in enumerate(raw):
        t = s.get("text") or ""
        hit = len(_num_tokens(t) & tab)
        # 결론 문장도 표 전체를 다시 읽으면(10/14 로컬 X06 첫 문장에 4구간 전부) 뺀다 — 표 머리 문장이 그 자리를 잇는다.
        if (hit >= TABLE_RESTATE_LEAD or (not _protected(raw, i) and (hit >= TABLE_RESTATE or _LIST_LEADIN.search(t)))):
            log.info("표 반복 문장 제거: %r", t[:60])
            continue
        out.append(s)
    return out


TABLE_RESTATE_LEAD = 5
# "…과세표준 구간별로 다음과 같이 적용됩니다." — 작문이 행을 옮겨 적으려던 머리말. 행은 위에서 빠지고 머리말만 남는다(X07).
_LIST_LEADIN = re.compile(r"다음과\s*같(?:이|은|습니다)|아래와\s*같")


_PAREN_STRIP = re.compile(r"\([^()]*\)")


def _requirement_list_from_law(raw: list[dict], law: "_LawStep") -> list[dict]:
    """작문이 번호 목록을 안 썼을 때(10/13 로컬: 차이+요건 복합 질문 X03 이 규칙을 넣어도 산문) — 답이 먼저 인용한 조문(없으면
    고른 조문 순서)의 호를 **원문 그대로** 번호 목록으로 싣는다(세율 표 F1 과 같은 이유: 법령 원문은 Solar 가 옮겨 적지 않는다).
    호가 있는 조문이 없으면 그대로 둔다."""
    from api import law_cite
    arts = {a.key: a for a in law.articles or []}
    body = [i for i, s in enumerate(raw) if s.get("type") != "caveat"]
    # 질문별로 나눠 답했으면(■ 요건: …) 요건 부분부터 조문을 찾는다 — 10/14 로컬 X03: '■ 차이' 부분이 인용한 §63③(공제 호)이 요건 목록으로 나갔다.
    req = next((i for i in body if "요건" in (raw[i].get("text") or "")[:40]), None)
    scan = [i for i in body if req is None or i >= req][:3]
    found = []
    for i in scan:
        for c in law_cite.parse_cites(raw[i].get("text") or ""):
            if c.key not in arts:
                continue
            a = arts[c.key]
            if a.law.endswith(("시행령", "시행규칙")):   # 시행령 인용이면 그 조문이 받는 법률 조문(§109② → §61①)을 먼저
                head = a.paragraphs[0]["text"] if a.paragraphs else a.text[:200]
                found += [(p, lst) for p in law.articles or []
                          if p.law == a.law.rsplit(" ", 1)[0] and law_select._refers(head, p.no)
                          and (lst := law_select.item_list(p))]
            if lst := law_select.item_list(a, c.para):
                found.append((a, lst))
    found += [(a, lst) for a in law.articles or [] if (lst := law_select.item_list(a))]
    # 법률 조문의 호를 먼저(10/14) — 결론 문장이 시행령(§109②2호 '제조업')을 먼저 인용하면 시행령의 업종 14개 목록이 요건으로 나갔다.
    picked = next((x for x in found if not x[0].law.endswith(("시행령", "시행규칙"))), found[0] if found else None)
    if picked is None:
        return raw
    art, lst = picked
    where = f"「{art.law}」 제{art.label().split(' 제', 1)[1]}" + (f"제{lst.para}항" if lst.para else "")
    base = art.label() + (f" 제{lst.para}항" if lst.para else "")
    block = [{"text": f"{where}: {lst.lead}", "type": "rule_statement", "citations": [base]}]
    block += [{"text": f"{n}. {t}", "type": "rule_statement", "citations": [f"{base} 제{n}호"]}
              for n, t in lst.items[:6]]
    # 요건 부분 뒤에 — 결론 문장 바로 뒤에 두면 '■ 차이' 부분 앞에 요건 목록이 끼었다.
    at = (req if req is not None else body[0]) + 1 if body else len(raw)
    log.info("요건 번호 목록 폴백: %s 호 %d개", base, len(block) - 1)
    return raw[:at] + block + raw[at:]


def _cite_requirement_items(segments: list[Segment], law: "_LawStep | None", qtype: str | None) -> list[Segment]:
    """요건 항목마다 배지 — 항목 본문에 적힌 조문(호까지)이 허용 조문이면 그 표시 이름, 없으면 목록 앞 조문 소개 문장의 조문.
    같은 조문의 조문 단위 배지는 항목 배지로 갈음한다(같은 문장에 '…제61조'와 '…제61조 제1항 제2호'가 겹치지 않게)."""
    if qtype != "요건" or law is None or os.environ.get("ADVISORY_QTYPE_FORM", "on") == "off":
        return segments
    from api import law_cite
    out, fallback = list(segments), None
    qs = _question_items([s.text for s in segments])
    for i, seg in enumerate(out):
        cites = [c for c in law_cite.parse_cites(seg.text) if c.key in law.allowed]
        if not _NUMBERED_ITEM.match(seg.text):
            if cites:      # 목록 머리 문장의 조문 — 호를 떼고 조문 단위로만 물려준다(다른 호를 잘못 달지 않게)
                fallback = law_cite.Cite(cites[0].law, cites[0].article_no)
            elif not (_LIST_LEADIN.search(seg.text) or seg.text.rstrip().endswith(":")):
                fallback = None   # 조문 없는 다른 문장('정리하면, …는')이 끼면 앞 조문을 물리지 않는다(10/14 로컬 X05-3: §62 배지)
            continue
        if i in qs and not cites:
            continue       # 확인할 사항 목록 — 앞 문장 조문을 물려 달지 않는다
        if not cites and any(law_cite.parse_cites(c) for c in seg.citations or []):
            continue       # 이미 호 배지가 있다(호 목록 폴백) — 조문 단위 배지를 덧붙이지 않는다
        if not cites and not fallback and i not in qs:
            # 물려줄 앞 문장 조문이 없다(10/15 운영 g3x X05-3: 결론 문단과 목록 사이에 비교표가 끼어 연결이 끊겼고 '1. 개인사업자일 것'
            # 이 배지 없이 나갔다) → 고른 조문 중 호 목록이 있는 법률 조문(요건 조문, 호 목록 폴백과 같은 기준)
            req = next((a for a in law.articles or [] if not a.law.endswith(("시행령", "시행규칙"))
                        and law_select.item_list(a)), None)
            fallback = law_cite.Cite(req.law, req.no) if req is not None else None
        mine = cites or ([fallback] if fallback else [])
        if not mine:
            continue
        labels = [c.label() for c in mine][:CITATIONS_PER_SEGMENT]
        bases = {law_cite.Cite(c.law, c.article_no).label() for c in mine}   # '부가가치세법 제61조'
        keep = [c for c in (seg.citations or []) if c not in bases and c not in labels]
        out[i] = seg.model_copy(update={"citations": (labels + keep)[:CITATIONS_PER_SEGMENT]})
    return out


_NUMBERED_ITEM = re.compile(r"^\d{1,2}\.\s")


def _guard_badges(segments: list[Segment], law: "_LawStep | None", where: str) -> list[Segment]:
    """배지 마지막 대조(10/16) — 어느 단계에서 붙었든 법령으로 읽히는 배지는 이 답의 허용 조문(LLM3 선택·엔진 근거·사용자 발화)
    안에 있어야 한다. 인용 대조(check_answer)와 같은 기준(law_select.allowed_citations). 세무사 사례 표시('… · 제목')는 대상 아님."""
    from api import law_cite

    if law is None or law_select.check_mode() == "off":
        return segments
    out, gone = [], []
    per = law_cite.parse_answer([s.text for s in segments])
    for seg, cs in zip(segments, per):
        have = seg.citations or []
        keep = law_select.allowed_citations([c for c in have if " · " not in c], law.allowed, cs[0].law if cs else None)
        keep = [c for c in have if c in keep or " · " in c]
        if len(keep) != len(have):
            gone += [c for c in have if c not in keep]
            seg = seg.model_copy(update={"citations": keep or None})
        out.append(seg)
    if gone:
        log.warning("허용 밖 조문 배지 제거(%s): %s", where, gone)
    return out


def _plain_law_names(text: str) -> str:
    """'「소득세법」 제21조' → '소득세법 제21조' — 배지 매칭용(근거 서열 규칙 뒤 작문이 「」를 자주 쓴다, 10/13 로컬 G02 배지 0)."""
    return re.sub(r"[「｢]([^」｣]{1,40})[」｣]", r"\1", text)


def _mentions(label: str, text: str) -> bool:
    """본문에 배지 이름이 그 조문으로 적혔나 — 부분 문자열이면 '제167조의8' 문장에 '제167조' 배지가 붙었다(10/20 K3, 10/24 고침).
    이름 바로 뒤가 숫자이거나, '…조'로 끝난 이름 뒤에 '의'+숫자가 붙으면(가지 조문) 다른 조문이다.
    '제167조제3항'·'제167조의 규정'·'제1항의 60세'(항·호 뒤 '의'는 조사)는 같은 조문."""
    i = text.find(label)
    while i >= 0:
        rest = text[i + len(label):]
        if not (rest[:1].isdigit() or label.endswith("조") and re.match(r"의\d", rest)):
            return True
        i = text.find(label, i + 1)
    return False


def _tidy_citations(segments: list[Segment]) -> list[Segment]:
    """배지 정리(사용자 10/6 밤) — solar 가 같은 번호 5~6개를 문장마다 반복해 붙여 화면이 번잡했다.
    ① 한 답에서 같은 번호는 한 문장에만: 본문에 그 번호가 적힌 첫 문장, 없으면 처음 붙은 문장 ② 한 문장 최대 3개."""
    home: dict[str, int] = {}
    for i, seg in enumerate(segments):
        for c in seg.citations or []:
            if _mentions(c, _plain_law_names(seg.text)) and c not in home:
                home[c] = i
    for i, seg in enumerate(segments):
        for c in seg.citations or []:
            home.setdefault(c, i)
    out = []
    for i, seg in enumerate(segments):
        if not seg.citations:
            out.append(seg)
            continue
        kept = [c for c in dict.fromkeys(seg.citations) if home.get(c) == i][:CITATIONS_PER_SEGMENT]
        out.append(seg if kept == seg.citations else seg.model_copy(update={"citations": kept or None}))
    return out


_VEHICLE = re.compile(r"차량|자동차|승용차|렌터카|리스\s*차|(?:차|카)\s*리스")


def _followup_rounds(history: list[Message]) -> int:
    """지금까지 이어진 되묻기 턴 수(R1-f 상한) — 마지막 판정 카드 이후, follow_up 세그먼트를 가진 연속 assistant 메시지.
    Message 에 필드를 더하지 않고 history 만으로 센다(프론트 Zod 가 모르는 필드를 조용히 지운다)."""
    n = 0
    for m in sorted(history, key=lambda m: m.order, reverse=True):
        if m.role != "assistant":
            continue
        if any(b.kind == "verdict_card" for b in m.uiBlocks or []):
            break
        if not any(s.type == "follow_up" for s in m.segments):
            break
        n += 1
    return n


def _cite_followups(segments: list[Segment], ask: list[str], extracted: dict) -> list[Segment]:
    """경비 되묻기 문항에 근거 조문 배지(R4 출처 표시, 10/13 사용자 결정 — 계산 되묻기 §50·§12 와 같은 방식).
    문항 수가 물은 항목 수와 같으면 차례로 하나씩, 아니면 첫 문항에 모아서. 이미 붙은 배지는 그대로 둔다."""
    per = [adapter.field_citations(k, extracted) for k in ask]
    if not any(per):
        return segments
    qs = [i for i, s in enumerate(segments) if s.type in ("follow_up", "evidence_request")] or [len(segments) - 1]
    if len(qs) != len(per):
        qs, per = qs[:1], [list(dict.fromkeys(c for cs in per for c in cs))]
    out = list(segments)
    for i, cites in zip(qs, per):
        have = out[i].citations or []
        add = [c for c in cites if c not in have]
        if add:
            out[i] = out[i].model_copy(update={"citations": have + add})
    return _tidy_citations(out)


def _ensure_follow_up(segments: list[Segment]) -> list[Segment]:
    """되묻기 턴은 반드시 follow_up 세그먼트를 하나 갖게 한다 — 모델이 전부 evidence_request 로 내면 상한 계산에서 빠진다."""
    if any(s.type == "follow_up" for s in segments):
        return segments
    return segments[:-1] + [segments[-1].model_copy(update={"type": "follow_up"})]


# R1-f 결정론 문장(F-2a·F-3) — 세무사 문구 권고(10/10).
RECEIPT_WARNING = ("적격증빙이 없으면 정황 자료로 업무 관련성을 입증해야 하며, 인정 범위가 줄거나 "
                   "증빙불비가산세가 붙을 수 있습니다.")
NAME_WARNING = "사업자 명의가 아닌 지출이면 실제 업무에 쓴 사실을 따로 입증해야 해서 인정이 어려워질 수 있습니다."
RATIO_WARNING = "사적 사용이 있으면 그만큼 비용 인정분이 줄어들 수 있습니다."
CONSERVATIVE_MARK = "미확인 항목은 요건 미충족으로 보고 보수적으로 판정"


def _assumption_note(a: adapter.Assumptions) -> str:
    """카드 summary·작문 근거에 붙이는 가정 표시(스키마 변경 없음)."""
    notes = []
    if a.unfavorable:
        notes.append(f"{CONSERVATIVE_MARK}: {'·'.join(adapter.ASSUMED_LABEL[k] for k in a.unfavorable)}")
    if a.gates:
        notes.append("적격증빙·사업자 명의는 확인 전이라 갖춘 것으로 보고 판정")
    if a.ratio:
        notes.append("업무사용비율은 확인 전이라 100%로 보고 계산")
    return f" ({' / '.join(notes)})" if notes else ""


def _assumption_segments(a: adapter.Assumptions, result: eng.ExpenseResult | None) -> list[dict]:
    """가정 문장(결정론, Solar 0) — F-1 보수 판정 고지 + '갖추면 →' 문장, F-2a 관문 경고, F-3 비율 경고."""
    out: list[dict] = []
    if a.unfavorable:
        labels = "·".join(adapter.ASSUMED_LABEL[k] for k in a.unfavorable)
        out.append({"text": f"말씀하지 않은 항목({labels})은 요건을 갖추지 못한 것으로 보고 보수적으로 판정했습니다.",
                    "type": "caveat"})
        if result is not None:
            out += [{"text": t, "type": "application"} for t in adapter.what_if_lines(a, result)]
    if a.gates:
        head = "적격증빙·사업자 명의는 확인하지 못해 갖춘 것으로 보고 판정했습니다."
        warn = [RECEIPT_WARNING] if "has_qualified_receipt" in a.gates else []
        warn += [NAME_WARNING] if "in_business_name" in a.gates else []
        out.append({"text": " ".join([head] + warn), "type": "caveat"})
    if a.ratio:
        out.append({"text": f"업무사용비율을 확인하지 못해 100% 업무용으로 보고 계산했습니다. {RATIO_WARNING}",
                    "type": "caveat"})
    return out


def _ratio_guide_segments(a: adapter.Assumptions, message_id: str) -> list[Segment]:
    """F-3 예외 — 가사관련비는 비율을 100%로 가정하지 않는다(자택 전체를 업무용으로 보는 판정은 성립하지 않음).
    판정 카드 없이 '업무 면적 비율만큼 인정' 안내 + 비율 질문 1개(결정론, Solar 0). 이 경로에 오면 별도 사업장은
    '없음'으로 확인된 상태다(가정으로 '있음'이면 부인 판정이라 비율을 묻지 않는다)."""
    raw = [{"text": ("자택 관리비 같은 가사 관련 비용은 집 전체 면적 중 업무에만 쓰는 공간의 비율만큼만 비용으로 "
                     "인정됩니다(소득세법 §33 가사경비 불산입)."), "type": "rule_statement"}]
    raw += [s for s in _assumption_segments(adapter.Assumptions(a.filled, a.unfavorable, a.gates, False), None)
            if s["type"] == "caveat"]
    raw.append({"text": "업무 공간이 집 전체 면적에서 차지하는 비율을 알려주시면 인정액을 계산해 드릴게요.",
                "type": "follow_up"})
    return _clean_segment_dicts(raw, message_id)


def _offer(history: list[Message], key: str) -> tuple[list | None, str | None]:
    """판정 없는 갈래의 세무사 연결 자동 제안 (uiBlocks, meta.handoff). 대화당 1회.
    key='stalled' 는 판정 없는 되묻기가 누적됐을 때만 성립한다."""
    if key == "stalled" and not handoff.is_stalled(history):
        return None, None
    b = handoff.auto_offer(history, key)
    return ([b], key) if b else (None, None)


def _recorded(resp: ChatResponse, conversation_id: str, occupation: str, outcome: str,
              rag_requested: str | None, rag_searched: bool | None,
              etype: str | None = None) -> ChatResponse:
    """응답을 그대로 돌려주면서 G3 계측을 한 줄 남긴다(2026-09-12, 마이그레이션 0027).

    각 return 자리마다 outcome 을 **손으로** 붙인다. meta 만 보고 갈래를 되추론하지
    않는 이유는, `followUp=True` 가 서로 성격이 다른 세 갈래에서 나오기 때문이다 —
    필수정보 부족·결정변수 부족은 RAG 와 무관하고 '선례 없음'만 G3 의 지표다. 되추론은
    그 셋을 한 덩어리로 만들어 지표를 조용히 오염시킨다.

    rag_searched 는 이 자리에서 판정하지 않고 넘겨받는다 — 검색을 아예 안 탄 갈래
    (되묻기)에서는 retriever 를 만들지 않으므로 app_config 를 한 번 더 조회하게 되는데,
    계측 때문에 사용자 경로에 DB 왕복을 더하지는 않는다. 그런 갈래는 **None 으로 남긴다**
    (0027 주석: 'RAG 를 껐다'와 '검색 단계에 도달 못 했다'는 다른 사실이다)."""
    from api.rag import store

    meta = resp.meta
    try:   # 0063 사용 현황 M2 — 보강 값·질문 원문. 여기서 무엇이 실패해도 답변은 그대로 나간다.
        extra = turn_record.fields(resp, conversation_id)
        question = turn_record.question(conversation_id)
    except Exception as exc:  # noqa: BLE001
        log.warning("turn_record 실패 (%s): %s", resp.message.id, exc)
        extra, question = {}, None
    store.record_chat_turn(
        conversation_id=conversation_id,
        message_id=resp.message.id,
        occupation=occupation,
        outcome=outcome,
        rag_searched=rag_searched,
        rag_source=meta.ragSource,
        rag_requested=rag_requested,
        rag_hits=meta.ragHits,
        follow_up=meta.followUp,
        advisory=meta.advisory,
        etype=etype,
        # 0033 — meta 에 실린 값을 그대로 넘긴다(계측이 제 손으로 다시 계산하면 화면에 간
        # 분포와 DB 에 남은 분포가 갈라질 수 있다). 검색 미도달 갈래는 None → null.
        rag_corpus_counts=meta.ragCorpora,
        rag_passages=meta.ragPassages,
        **extra,
    )
    if question:
        store.record_question(conversation_id, resp.message.id, question)
    return resp


CONGESTED_TEXT = "지금 상담 요청이 몰려 답변을 드리지 못했습니다. 잠시 후 같은 질문을 다시 보내 주세요."


def congested_response(conversation_id: str, history: list[Message], occupation: str,
                       rag_source_override: str | None = None) -> ChatResponse:
    """Upstage 호출 줄에서 턴 대기 상한을 넘겼을 때의 응답(P8 B, upstage_gate).

    500 이 아니라 평범한 답변 말풍선이다 — 프론트는 비정상 status 를 오류 배너로 띄운다.
    무한 대기는 타임아웃 멈춤과 체감이 같아서, 기다리게 하는 대신 다시 보내 달라고 한다.
    계측 outcome='congested' — 전시회에서 상한 k 가 모자랐는지 되짚는 자리."""
    order = _next_order(history)
    message_id = f"asst_{conversation_id}_{order}"
    seg = Segment(id=f"{message_id}_s0", text=CONGESTED_TEXT, type="caveat")
    return _recorded(
        ChatResponse(
            message=Message(id=message_id, role="assistant", order=order, segments=[seg]),
            meta=ChatMeta(engine="clinic_expense_engine" if occupation == "clinic" else None,
                          congested=True),
        ),
        conversation_id, occupation, "congested", rag_source_override, None,
    )


# ── 근로소득세 계산 갈래(R2-c, 10/10) ───────────────────────────────────────────────
# 계산의 권위는 calc.income_tax(순수 함수). Solar 는 추출(이미 한 호출)과 해설 1~2문장만 — 결론 문장·단계표·가정
# 문장·질문은 결정론. 근거 검색(KB3·LLM3)은 타지 않는다: 숫자는 trace 가 출처이고 조문 배지는 trace 의 근거 조문이다.
# 끄기: CALC_INCOME_TAX=off(서버 .env + 재시작) → 근로소득세 질문은 종전대로 자문 갈래.
# 계산 의도 = 세금 낱말 + 계산 낱말이 함께("소득세 얼마"·"세금 얼마나 떼이나요"·"실수령액이 얼마"·"세금 구간이 바뀌나요").
# 특정 공제 항목을 묻는 질문("신용카드 소득공제 얼마나 써야…" Y02)은 공제 요건 자문이라 계산 갈래로 보내지 않는다.
_CALC_TAX_WORD = re.compile(r"소득세|세금|세액|원천징수|실수령|세후")
_CALC_ASK_WORD = re.compile(r"얼마|몇|계산|떼|나와|나오|바뀌|구간|실수령")
_DEDUCTION_Q = re.compile(r"신용카드|체크카드|의료비|교육비|월세|기부금|연금저축|IRP|청약|주택자금|보험료\s*공제|부모님?\s*(?:기본)?공제")
# 근로소득이 아닌 소득·다른 세목 — 근로소득세 계산기 밖(운영 G01 10/10: "프리랜서 3.3% 떼고 받았는데 종소세…"가 '떼'로
# 계산 갈래에 들어가 총급여를 물었다). '종합소득세'·'종소세'는 여기 넣지 않는다 — 근로자도 관용적으로 "제 종합소득세는
# 얼마인가요?"라고 묻는다(세무사 Q2 10/10 밤: 이 낱말 때문에 계산 갈래가 막혀 계산 없는 자문이 나갔다). 판단은 **이번
# 발화**로 한다 — 세무사는 한 대화에 세목이 다른 질문 4개를 이어 물었다(앞 질문 낱말이 뒤 질문을 막지 않게).
_NON_WAGE = re.compile(r"프리랜서|3\.3\s*%|사업소득|개인사업자|사업자\s*등록|인적용역|강사료|원고료|부업|임대소득"
                       r"|증여|상속|양도|부가세|부가가치세")
# 근로 신호 — 주제가 '종합소득세'로 잡혀도 이게 있으면 근로소득세 계산으로 본다.
_WAGE = re.compile(r"연봉|월급|급여|근로|직원|직장|회사원|사무직|정규직|계약직|페이닥터|봉직의|월\s*실수령")
_SHORT_REPLY = 25          # 이 길이 이하의 발화는 앞 질문에 대한 답으로 보고 직전 사용자 발화와 함께 판단한다
_TAKEHOME = re.compile(r"실수령|세후|손에\s*쥐|통장에\s*들어")
_CALC_SLOT_QUESTIONS = {s.question: s.key for s in itax_slots.SLOTS if s.question}


def _calc_enabled() -> bool:
    return os.environ.get("CALC_INCOME_TAX", "on") != "off"


def _calc_asked(history: list[Message]) -> tuple[set[str], list[str]]:
    """(지금까지 물은 계산 슬롯, 직전 assistant 메시지가 물은 슬롯) — 질문 문장이 결정론이라 history 문장으로 센다."""
    asked: set[str] = set()
    last: list[str] = []
    seen_last = False
    for m in sorted(history, key=lambda m: m.order, reverse=True):
        if m.role != "assistant":
            continue
        keys = [k for s in m.segments for k in ([_CALC_SLOT_QUESTIONS[s.text]] if s.text in _CALC_SLOT_QUESTIONS
                                                 else itax_slots.INVITE_KEYS if s.text == itax_slots.INVITE else [])]
        if not seen_last:
            last, seen_last = keys, True
        asked.update(keys)
    return asked, last


def _calc_context(history: list[Message]) -> bool:
    """**바로 앞** 답이 계산 갈래였나 — 계산 답에는 고정 고지(NOT_MODELED)나 슬롯 질문이 반드시 있다. 대화 어딘가에
    계산 답이 있었다는 것만으로는 이어 받지 않는다(X05 운영 10/12: 계산 뒤 다른 세목 질문 "익금이 뭔가요"가 계산으로 샘)."""
    last = next((m for m in sorted(history, key=lambda m: m.order, reverse=True) if m.role == "assistant"), None)
    return last is not None and any(s.text in (itax_slots.NOT_MODELED, itax_slots.INVITE) or s.text in _CALC_SLOT_QUESTIONS
                                    for s in last.segments)


# 계산 이어 받기 중에도 경비 질문으로 넘어가는 신호 — 이게 없으면 추출기가 잡은 경비 유형보다 계산 맥락을 따른다
# (W01 3턴 운영 10/12: "4대보험만 내요"를 추출기가 경비 유형으로 잡아 판정 카드가 나갔다).
_EXPENSE_WORD = re.compile(r"경비|비용\s*처리|비용으로|손금|필요경비")


def _calc_followup(history: list[Message], user_text: str) -> bool:
    """앞 답이 계산이고, 이번 발화가 그 답에 대한 짧은 답이거나 계산 슬롯(급여·가족·비과세)을 새로 말한 경우."""
    if not _calc_context(history):
        return False
    return (len(user_text.strip()) <= _SHORT_REPLY
            or bool(itax_extract.merge_slots({}, [user_text]))
            or bool(itax_extract.read_reply(user_text, _calc_asked(history)[1]))
            or itax_extract.read_rough([user_text]))       # "그냥 일반사무직이고 나머진 가정해서 러프하게 계산해줘"


def _calc_self_contained(text: str) -> bool:
    """이번 발화만으로 계산 질문이 완결되나 — 급여 금액 + 세금 낱말 + 계산 낱말. 그러면 짧아도(“연봉 7천만원 실수령액을
    알려주세요” 20자) 앞 질문에 대한 답으로 보지 않는다(3차 평가 10/18 운영: 25자 이하라 직전 발화 "증여세 세율 구간
    알려주세요"까지 함께 보다가 '증여'에 걸려 자문 갈래로 갔고, 작문이 지은 계산 문장이 가드에 다 지워져 한 문장만 남았다)."""
    return bool(_CALC_TAX_WORD.search(text) and _CALC_ASK_WORD.search(text) and itax_extract.read_salary([text]))


def _calc_ask_first_on() -> bool:
    """먼저 묻기 — 세무사 3차 평가(10/18) 뒤 팀 결정으로 기본 off: 가정을 밝히고 바로 계산한 뒤 끝에서 공제 정보를 청한다.
    CALC_ASK_FIRST=on 이면 10/13 방식(계산 전에 2문항)으로 되돌린다."""
    return os.environ.get("CALC_ASK_FIRST", "off") == "on"


def _calc_should_ask_first(history: list[Message], user_text: str, filled) -> bool:
    """먼저 묻기(세무사 피드백 10/13) — 이 대화의 첫 계산 질문이고 결과를 바꾸는 정보(부양가족·비과세/직종/상여)를 하나도
    안 말했으면 계산 전에 묻는다. "대략·가정해서" 요청, 구간 비교 질문, 이미 물어본 대화는 바로 계산. 기본 꺼짐(위)."""
    if filled.inp is None or not _calc_ask_first_on():
        return False
    asked, _ = _calc_asked(history)
    if asked:
        return False
    if itax_extract.read_rough([user_text]):
        return False
    users = [s.text for m in history if m.role == "user" for s in m.segments] + [user_text]
    if itax_extract.read_salary_change(users):
        return False
    return all(k in filled.assumed for k in itax_slots.ASK_FIRST_KEYS)


def _calc_slots(history: list[Message], user_text: str, extracted: dict) -> dict:
    users = [s.text for m in sorted(history, key=lambda m: m.order) if m.role == "user" for s in m.segments]
    if not _calc_context(history) and _calc_self_contained(user_text):
        # 바로 앞이 계산이 아닌데 이번 발화가 완결된 새 계산 질문이면 이 발화만 읽는다 — 앞서 다른 사안으로 말한 가족·
        # 비과세(3차 평가 대화: Q2 의 '장애인 배우자')와 추출기가 이력에서 옮겨 온 인원 수를 새 계산에 섞지 않는다.
        users = []
        extracted = {k: v for k, v in extracted.items() if k not in itax_slots.COUNT_KEYS}
    slots = itax_extract.merge_slots(extracted, users + [user_text])
    _, last = _calc_asked(history)
    slots.update(itax_extract.read_reply(user_text, last))
    return slots


def _is_calc_turn(history: list[Message], user_text: str, extracted: dict, slots: dict) -> bool:
    """근로소득세 계산으로 답할 턴인가. 경비 유형이 잡혔으면 아니다. 주제가 근로소득세여도 계산 의도(금액·'얼마')가
    없으면(“의료비 공제 요건이 뭐야?”) 자문 갈래 그대로. 앞 턴이 계산이었으면 짧은 답("부양가족 2명")도 이어 받는다."""
    if not _calc_enabled():
        return False
    if _NON_WAGE.search(user_text) or _DEDUCTION_Q.search(user_text):
        return False
    if _calc_followup(history, user_text):
        return not (extracted.get("etype") in adapter.SUPPORTED_ETYPES and _EXPENSE_WORD.search(user_text))
    if extracted.get("etype") in adapter.SUPPORTED_ETYPES:
        return False
    topic = extracted.get("tax_topic")
    # 이번 발화(짧은 답이면 직전 사용자 발화까지)만 본다 — 대화 전체를 훑으면 앞선 다른 세목 질문이 뒤를 막는다.
    prev_users = [s.text for m in sorted(history, key=lambda m: m.order) if m.role == "user" for s in m.segments]
    short = len(user_text.strip()) <= _SHORT_REPLY and not _calc_self_contained(user_text)
    window = [user_text] + (prev_users[-1:] if short else [])
    wage = any(_WAGE.search(t) for t in window)
    # 주제 None = 추출 실패(타임아웃)로 빈 추출 — 근로 신호가 있으면 '종합소득세'와 같이 본다.
    if topic != adapter.CALC_TOPIC and not (topic in ("종합소득세", None) and wage):
        return False
    if any(_DEDUCTION_Q.search(t) or _NON_WAGE.search(t) for t in window):
        return False
    return any(_CALC_TAX_WORD.search(t) and _CALC_ASK_WORD.search(t) for t in window)


def _calc_response(conversation_id: str, history: list[Message], user_text: str, extracted: dict,
                   slots: dict, message_id: str, order: int, occupation: str,
                   rag_source_override: str | None) -> ChatResponse:
    filled = itax_slots.fill(slots)
    meta_extracted = {**extracted, "income_tax_slots": slots}
    if filled.inp is None:
        # 총급여가 없으면 계산하지 않고 그것 하나만 묻는다(Solar 0).
        segs = _clean_segment_dicts(
            [{"text": "근로소득세를 직접 계산해 드릴게요.", "type": "ack"}]
            + [{"text": q.question, "type": "follow_up"} for q in itax_slots.followup_questions(slots)], message_id)
        return _recorded(
            ChatResponse(message=Message(id=message_id, role="assistant", order=order, segments=segs),
                         meta=ChatMeta(extracted=meta_extracted, followUp=True)),
            conversation_id, occupation, "calc_missing", rag_source_override, None, etype=extracted.get("etype"))

    if _calc_should_ask_first(history, user_text, filled):
        # 계산 전에 결과를 바꾸는 정보 2문항(턴당 2문항 상한) + "대략 계산해 줘" 안내. 질문에도 근거 조문 배지(출처 표시 약속).
        ask_cites = {"dependents": ["소득세법 제50조"], "nontaxable": ["소득세법 제12조"]}
        raw = [{"text": f"총급여 {filled.inp.total_salary:,}원 기준으로 근로소득세를 계산해 드릴게요. "
                        "결과가 달라지는 정보 두 가지를 먼저 여쭤볼게요.", "type": "context"}]
        raw += [{"text": itax_slots.SLOT[k].question, "type": "follow_up", "citations": ask_cites[k]}
                for k in itax_slots.ASK_FIRST_KEYS]
        raw.append({"text": itax_slots.ROUGH_HINT, "type": "caveat"})
        return _recorded(
            ChatResponse(message=Message(id=message_id, role="assistant", order=order,
                                         segments=_clean_segment_dicts(raw, message_id)),
                         meta=ChatMeta(extracted=meta_extracted, followUp=True)),
            conversation_id, occupation, "calc_ask", rag_source_override, None, etype=extracted.get("etype"))

    result = itax.calculate(filled.inp)
    asked, _ = _calc_asked(history)
    questions = itax_slots.followup_questions(slots, asked)

    # 해설(Solar) — 숫자 출처 = trace + 사용자 발화. 안 넣으면 계산값 문장이 지워진다(로드맵 R2-c 주의).
    trace = itax_view.trace_text(filled, result)
    explain = llm.write_calc(history, user_text, trace)
    sources, own = _number_sources(history, user_text, [], trace)
    explain = numeric_guard.drop_unsourced_numbers(explain, sources, own, where=f"calc {message_id}")
    # 해설은 개념 설명만 — 숫자가 든 문장은 단계표 되풀이라 뺀다(로컬 실측: 단계값을 문장으로 다시 옮겨 같은 수가 두 번 나왔다).
    explain = [s for s in explain if s.get("text") != numeric_guard.UNSOURCED_NUMBER_NOTE
               and not _STATUTE.search(s.get("text") or "") and not re.search(r"\d", s.get("text") or "")]
    for s in explain:
        s["type"] = "application" if s.get("type") not in ("context", "application", "caveat") else s["type"]

    # 이 계산의 발화 — 바로 앞이 계산이면 대화 전체, 아니면 이번 발화만(앞선 다른 질문의 '실수령' 낱말이 새 계산에 붙지 않게).
    users = ([s.text for m in history if m.role == "user" for s in m.segments] if _calc_context(history) else []) + [user_text]
    takehome = any(_TAKEHOME.search(t) for t in users)
    gross = slots["total_salary"]
    lead = [{"text": itax_view.headline(filled, result), "type": "conclusion"}]
    change = itax_extract.read_salary_change(users)
    if change and change[1] == filled.inp.total_salary + (slots.get("nontaxable") or 0):
        lead.append({"text": itax_view.change_line(change[0] - (slots.get("nontaxable") or 0), filled, result),
                     "type": "conclusion"})
    if takehome and not answer_display.TABLES:
        lead.append({"text": itax_view.takehome(gross, result), "type": "conclusion"})
    if takehome:                         # 실수령액 질문은 실수령액이 답이다(3차 평가 10/18) — 세금 문장은 그 다음
        lead.insert(0, {"text": itax_view.takehome_headline(gross, result), "type": "conclusion"})
    if answer_display.summary_on():      # 결정론 결론 문장(총급여 … 세금 …원)을 결론 문단으로 — 계산 답은 이 문장이 답이라 늘 맨 위
        lead[0]["type"] = "summary"
    raw = lead + explain
    if takehome and answer_display.TABLES:   # 월·연 공제 내역 — 4대보험 항목별 · 소득세 · 지방소득세 · 실수령액
        raw.append({"text": itax_view.takehome_table(gross, result), "type": "application"})
        raw.append({"text": itax_view.TAKEHOME_NOTE, "type": "caveat"})
    rows = itax_view.step_rows(result, filled.assumed)
    if answer_display.TABLES:            # 단계 산식 표(세무사 지적 6 '산식 구성') — 값은 step_rows 그대로
        raw.append({"text": itax_view.step_table(rows), "type": "application",
                    "citations": list(dict.fromkeys(c for r in rows for c in r.citations))})
    else:
        raw += [{"text": r.text, "type": "application", "citations": r.citations} for r in rows]
    raw.append({"text": itax_view.option_note(result), "type": "caveat"})
    raw += itax_slots.assumption_segments(filled, result)
    if questions:                        # 슬롯별 질문 대신 한 문장(3차 평가 Q2) — 짧은 답은 _calc_asked 가 INVITE_KEYS 에 붙인다
        raw.append({"text": itax_slots.INVITE, "type": "follow_up"})
    segments = _tidy_citations(_clean_segment_dicts(raw, message_id))
    return _recorded(
        ChatResponse(
            message=Message(id=message_id, role="assistant", order=order, segments=segments),
            meta=ChatMeta(extracted=meta_extracted, followUp=bool(questions),
                          calc={**result.to_dict(), "assumed": filled.assumed}),
        ),
        conversation_id, occupation, "calc", rag_source_override, None, etype=extracted.get("etype"),
    )


ROOM_EXPLICIT_REPLY = ("담당 세무사님께 직접 답변을 요청드렸어요. 세무사님이 이 채팅방에서 확인하고 답변드릴 거예요. "
                       "그 사이 궁금한 점을 더 남겨 주시면 정리해 두겠습니다.")


def run_clinic(conversation_id: str, history: list[Message], user_text: str,
               rag_override: bool | None = None, rag_source_override: str | None = None,
               agent_expert_id: str | None = None, preview_expert_id: str | None = None,
               room_mode: bool = False, occupation: str = "clinic") -> ChatResponse:
    """한 턴 답변. 본문은 _run_clinic — 여기서는 다른 주제 턴(C단계)의 끝 문구·세무사 박스만 덧붙인다(모든 갈래 공통)."""
    turn: dict = {}
    resp = _run_clinic(conversation_id, history, user_text, rag_override, rag_source_override,
                       agent_expert_id, preview_expert_id, room_mode, occupation, turn)
    if turn.get("topic_shift") and not room_mode:
        resp = _with_topic_shift_note(resp)
    return resp


def _run_clinic(conversation_id: str, history: list[Message], user_text: str,
                rag_override: bool | None, rag_source_override: str | None,
                agent_expert_id: str | None, preview_expert_id: str | None,
                room_mode: bool, occupation: str, turn: dict) -> ChatResponse:
    """occupation = 요청의 직군(R1-e · D-2, 10/10). clinic 외 직군도 같은 파이프라인으로 받되 엔진 판정(병의원 경비
    9종)은 clinic 전용 — 그 외 직군은 지출유형을 잡아도 자문 경로로 답한다. 검색 축은 clinic 그대로(KB3 는 직군 무관).
    agent_expert_id = 이 대화가 연결된 세무사(그 세무사의 게시 사례까지 검색) · preview_expert_id =
    스튜디오 시험칸(그 세무사의 초안까지). 둘 다 없으면 공용 KB3 만(0043, 10/6).
    room_mode = 3자 방(0044, api/room_agent.py) — 이미 세무사와 연결된 방이라 명시 연결 요청엔 연결 카드 대신 고정 문장
    (다른 갈래의 블록은 room_agent 가 버리고 텍스트만 방 메시지로 올린다)."""
    usage_log.bind(conversation_id)   # 이 턴의 Upstage 호출 로그에 대화(해시)·채널을 붙인다(10/12, API/사용 로그)
    turn_record.bind(user_text)       # 사용 현황 M2(0063) — 이번 질문·시작 시각(_recorded 가 꺼내 쓴다)
    order = _next_order(history)
    message_id = f"asst_{conversation_id}_{order}"
    # ENGINE_VERDICT=off — 엔진 판정을 끄고 경비 질문도 자문 경로로(운영 스위치, 10/10). 현장 데모에서 카드를 보일지
    # R6 리허설로 정한다. 서버 .env 수정 + 재시작만으로 바뀐다(재배포 불필요). 기본 on.
    engine_on = occupation == "clinic" and os.environ.get("ENGINE_VERDICT", "on") != "off"
    engine_name = "clinic_expense_engine" if engine_on else None

    # ⓪ 세무사 연결 명시 요청 — 추출·엔진·검색을 건너뛰고 연결 카드만 낸다(Upstage 호출 0).
    #    요청 어미가 붙은 경우만 잡으므로(api/handoff.py) 일반 질문이 여기로 새지 않는다.
    #    outcome 'handoff_request' 는 G3 분모(no_precedent/advisory)와 겹치지 않는다.
    #    3자 방(room_mode)은 이미 세무사가 같은 방에 있다 — 연결 카드 대신 고정 문장(Upstage 0).
    if handoff.is_explicit_request(user_text):
        seg = Segment(id=f"{message_id}_s0", text=ROOM_EXPLICIT_REPLY if room_mode else handoff.EXPLICIT_REPLY,
                      type="ack")
        return _recorded(
            ChatResponse(
                message=Message(id=message_id, role="assistant", order=order, segments=[seg],
                                uiBlocks=None if room_mode else [handoff.block("explicit")]),
                meta=ChatMeta(engine=engine_name, handoff="explicit"),
            ),
            conversation_id, occupation, "handoff_request", rag_source_override, None,
        )

    # ① extract (+ 질문 주제·검색 질의 — 같은 호출, R1-a·d)
    tool = adapter.build_extraction_tool()
    try:
        extracted = llm.extract_engine_inputs(history, user_text, tool) or {}
    except upstage_gate.UpstageCongested:
        raise
    except Exception as exc:  # noqa: BLE001 — 추출 타임아웃은 500 대신 빈 추출로(→ 계산 맥락·결정론 슬롯 또는 자문 경로)
        log.warning("추출 실패 — 빈 추출로 진행: %s", exc)
        extracted = {}
    if extracted:
        adapter.normalize_etype(extracted)   # '접대비' → '접대성지출' (enum 은 소프트 제약)
        adapter.normalize_question_type(extracted)   # 질문 유형(A2) — 풀이 붙은 enum 값 → 5유형 이름
        _settle_question_type(conversation_id, history, user_text, extracted)
        # 주제는 지출유형 하나로 잡았는데 etype 만 '기타'로 빠진 경우 주제를 따른다(R1-f — E06 '자택 관리비'가
        # etype=기타 · 주제=가사관련비로 갈려 자문으로 빠지던 것). '사업경비 일반'은 유형이 아니라 그대로 둔다.
        if (extracted.get("etype") not in adapter.SUPPORTED_ETYPES
                and extracted.get("tax_topic") in adapter.SUPPORTED_ETYPES):
            extracted["etype"] = extracted["tax_topic"]
        # 차량 질문이 '기타'로 빠지는 흔들림(운영 E01 "리스 차량 비용…" 1턴 5회 중 2회, 10/10) — 차량 낱말이 있고
        # 경비 아닌 주제(부가세·양도 등)로 잡히지 않았으면 업무용승용차로 본다. 다른 유형의 보정은 R4 Intake 에서.
        if (extracted.get("etype") not in adapter.SUPPORTED_ETYPES
                and extracted.get("tax_topic") in adapter.EXPENSE_TOPICS + ["기타", None]
                and _VEHICLE.search(user_text)):
            log.info("차량 낱말로 etype 보정: %r → 업무용승용차", extracted.get("etype"))
            extracted["etype"] = "업무용승용차"
        # clinic 외 직군은 엔진 판정을 하지 않는다(R1-e) — 지출유형을 '규칙 밖'으로 돌려 자문 경로로 보낸다.
        if not engine_on and extracted.get("etype") in adapter.SUPPORTED_ETYPES:
            extracted["etype"] = "기타"

    # 이번 턴의 성격(C단계, 10/15) — 위 _settle_turn_kind 주석.
    kind = _settle_turn_kind(history, user_text, extracted) if _turn_kind_on() and extracted else None
    prev_topic = _prev_topic(conversation_id)
    if kind:
        extracted["turn_kind"] = kind
    else:
        extracted.pop("turn_kind", None)     # 첫 턴·끔 — 모델 값을 meta 에 남기지 않는다(계측 혼동)
    if (kind == "답변" and prev_topic in _NON_EXPENSE_SPECIFIC and extracted.get("etype") in adapter.SUPPORTED_ETYPES
            and not _EXPENSE_WORD.search(user_text)):
        log.info("답변 턴 — 앞 주제 %s 를 잇고 경비 갈래로 보내지 않음(추출 etype %r)", prev_topic, extracted.get("etype"))
        extracted["etype"] = "기타"
        extracted["tax_topic"] = prev_topic
        # 검색 질의도 추출이 경비 사안으로 오해한 채 썼다(로컬 S02 2턴: 주택임대소득·근로소득 조문) — 앞 주제·직전 질문으로 다시 짓는다.
        prev_user = next((s.text for m in sorted(history, key=lambda m: m.order, reverse=True) if m.role == "user"
                          for s in m.segments), "")
        extracted["search_query"] = f"{prev_topic} {prev_user} {user_text}".strip()
    elif kind == "다른 주제" and extracted.get("tax_topic") != adapter.OFF_TOPIC:
        log.info("다른 주제 턴 — 앞 대화 없이 답함: %r", user_text[:40])
        _drop_carried(extracted, user_text)
        history = []
        turn["topic_shift"] = True
    _remember_topic(conversation_id, extracted.get("tax_topic"))

    # 근로소득세 계산 갈래(R2-c) — 직군 무관. 경비 판정·자문보다 먼저 가른다(계산 의도가 있을 때만).
    calc_slots = _calc_slots(history, user_text, extracted)
    if _is_calc_turn(history, user_text, extracted, calc_slots):
        return _calc_response(conversation_id, history, user_text, extracted, calc_slots,
                              message_id, order, occupation, rag_source_override)

    # 주식 양도 계산 갈래(E, 스위치 STOCK_CALC 기본 off) — 필수 값이 없으면 그것만 묻고, 있으면 아래 복합 사안 자문 갈래로 보낸다.
    stock = _stock_plan(history, user_text, (extracted or {}).get("question_type"))
    if stock is not None:
        extracted = extracted or {}
        if stock.filled.inp is None:
            segs = _clean_segment_dicts([{"text": stock_slots.missing_question(stock.filled), "type": "follow_up"}],
                                        message_id)
            return _recorded(
                ChatResponse(message=Message(id=message_id, role="assistant", order=order, segments=segs),
                             meta=ChatMeta(engine=engine_name, extracted=extracted, followUp=True)),
                conversation_id, occupation, "stock_missing", rag_source_override, None, etype=extracted.get("etype"))
        log.info("주식 계산 갈래: 경우 %d · 나눔 %s · 가정 %s", len(stock.scens), stock.filled.split, stock.filled.assumed)
        if extracted.get("etype") is None or extracted.get("etype") in adapter.SUPPORTED_ETYPES:
            extracted["etype"] = "기타"          # 경비 판정·지출유형 되묻기로 가지 않게
        if extracted.get("tax_topic") == adapter.OFF_TOPIC:
            extracted["tax_topic"] = "기타"

    missing =adapter.missing_required(extracted) if extracted else list(adapter.REQUIRED_FOR_VERDICT)

    # 자문 경로는 amount 를 요구하지 않는다. 판정을 안 하니 금액이 무의미하고("고용증대 세액공제
    # 받을 수 있나요?"엔 금액이 없다), 요구하면 추출기가 금액을 지어냈는지에 따라 자문이 나가다
    # 말다 한다. etype 이 규칙 밖이면 amount 미확인은 판정 차단 사유가 아니다.
    if "etype" not in missing and extracted.get("etype") not in adapter.SUPPORTED_ETYPES:
        missing = []
    # 지출유형을 못 잡았어도 경비 주제가 아니면 "어떤 종류의 지출인지"를 묻지 않는다(R1-d, 10/10) — 연봉·양도·증여
    # 질문에 지출 종류를 되묻던 엇나간 되묻기(로드맵 C3)였다. 주제를 못 잡은 경우도 묻지 않고 자문 경로로 듣는다.
    if "etype" in missing and extracted.get("tax_topic") not in adapter.EXPENSE_TOPICS:
        missing = []
    # 검색 질의(R1-a) — 되묻기에 대한 짧은 답("1인 가구예요")은 세무 내용이 없어 검색이 0건이었다(로드맵 C1).
    query = _search_query(history, user_text, extracted)

    # follow-up path — insufficient info, no verdict
    if missing:
        # 지출유형이 잡혔으면 금액과 함께 판정 항목도 한 턴에 묻는다(R1-f, 턴당 2개). 이 시점의 결정변수는 아직
        # 검증 전이라(추출기가 상식으로 지어 채운다 — 실측 10/10) 비어 있다고 보고 순서만 정한다.
        ask = missing
        if extracted.get("etype") in adapter.SUPPORTED_ETYPES:
            probe = {k: v for k, v in extracted.items() if k not in adapter.DECISIVE_FIELDS}
            ask = adapter.followup_fields(extracted["etype"], missing,
                                          adapter.missing_decisive(probe, profile_hint=probe),
                                          _followup_rounds(history))
        raw = llm.write_followup(history, user_text, ask)
        segments = _cite_followups(_ensure_follow_up(_clean_segment_dicts(raw, message_id)), ask, extracted or {})
        blocks, offered = _offer(history, "stalled")
        msg = Message(id=message_id, role="assistant", order=order, segments=segments,
                      uiBlocks=blocks)
        return _recorded(
            ChatResponse(
                message=msg,
                meta=ChatMeta(engine=engine_name, extracted=extracted or None,
                              followUp=True, handoff=offered),
            ),
            conversation_id, occupation, "missing_inputs", rag_source_override, None,
            etype=extracted.get("etype") if extracted else None,
        )

    # 엔진 규칙 밖(etype='기타' 또는 enum 밖 값) — 판정하지 않는다. 대신 RAG 자문으로 답한다.
    #
    # 엔진 규칙은 9개 지출유형뿐이라 4대보험·세액공제·대손금 등은 판정 자체가 불가능하다.
    # 예전엔 여기서 "미지원"만 안내하고 즉시 return 했다 → 세무사 코멘트로 쌓은 KB 가 통째로
    # 사장됐다(실측: KB 질문의 55%가 이 갈래로 빠짐). 이제 검색을 태워, 유사 선례가 있으면
    # 판정 없는 자문을 준다. 선례가 없으면(=RAG_MIN_SCORE 컷) 종전대로 미지원 안내.
    #
    # ⚠️ 이 경로는 판정 카드(verdict_card/evidence_checklist)를 절대 만들지 않는다 — 판정은
    #    엔진만의 권위(마스터 §2). 붙을 수 있는 블록은 세무사 연결(expert_handoff)뿐이다.
    if extracted.get("etype") not in adapter.SUPPORTED_ETYPES:
        etype = extracted.get("etype")
        qtype = extracted.get("question_type")   # 자문 답변 형식(A3) — 요건 = 번호 목록, 법령 정의 = 조문 → 풀이 → 관련 조문
        # 세금과 무관한 질문·서비스 문의 — 검색하지 않고 무엇을 도울 수 있는지 소개(R1-c 보강, 10/10).
        # outcome 'off_topic' 은 G3 분모 밖이다(검색 미도달 → rag_searched None).
        # 세금 낱말이 있는데 세무 외로 분류된 턴은 자문 갈래로 돌린다(10/13 기준선: X04 '익금'·X06 '법인세율'이 off_topic →
        # "단순 세율 수치 질문에는 답하기 어렵다"는 거절이 나갔다. Pro 4 추출의 흔들림).
        if extracted.get("tax_topic") == adapter.OFF_TOPIC and _TAX_WORDS.search(user_text):
            log.info("세무 외 분류 무시(세금 낱말): %r", user_text[:40])
            extracted["tax_topic"] = "기타"
        if extracted.get("tax_topic") == adapter.OFF_TOPIC:
            segments = _clean_segment_dicts(
                llm.write_listening(history, user_text, off_topic=True), message_id)
            return _recorded(
                ChatResponse(
                    message=Message(id=message_id, role="assistant", order=order, segments=segments),
                    meta=ChatMeta(engine=engine_name, extracted=extracted, followUp=True),
                ),
                conversation_id, occupation, "off_topic", rag_source_override, None, etype=etype,
            )
        retriever = get_retriever(force_enabled=rag_override,
                                  agent_expert_id=agent_expert_id, preview_expert_id=preview_expert_id)
        # 검색기가 실제로 살아 있었나 — RAG off(?rag=false / app_config.rag_enabled=0)든 DB 미설정이든
        # NullRetriever 로 수렴한다. 계측에는 "선례가 없었다"와 "애초에 안 찾아봤다"를
        # 가르는 값이라, ragHits=0 하나로 뭉뚱그리면 G3 지표가 RAG off 회차에 오염된다.
        rag_searched = not isinstance(retriever, NullRetriever)
        passages = retriever.retrieve(query, k=_rag_top_k(), occupation="clinic")
        rag_source_used = _rag_source_label(passages)   # 게이트 전 — 전부 빠져도 'none' 이 아니다
        # LLM3 는 쟁점 게이트와 **동시에** 돈다(10/8 지연 진단 — 둘 다 검색 결과만 있으면 되는 Solar 호출 1회씩).
        # 후보는 게이트 전 근거로 만든다 — 쟁점이 다른 카드의 조문이 섞여도 LLM3 가 질문 적합성으로 거른다.
        # 컨텍스트 사본을 들려 보낸다 — 풀 스레드에서도 사용 로그에 대화 id 가 붙는다(10/12).
        compound = _compound_case(qtype, user_text, query) or stock is not None
        if compound:
            log.info("복합 사안 형식: %r", user_text[:40])
        law_future = (_LAW_POOL.submit(copy_context().run, _law_step, query, passages, [], qtype, compound)
                      if law_select.enabled() else None)
        # 쟁점이 다른 KB3 근거는 작문 전에 뺀다(10/6). 뺀 것도 계측에는 남긴다(rank=None, issueFit).
        fits: dict = {}
        passages, gated_out = _issue_gate(query, passages, fits)
        law = _law_result(law_future, passages)
        if law and law.labels and (_law_answerable(qtype) or compound):
            passages, trimmed = _trim_cases_for_law(passages, fits, bool(_table_segments(law, user_text)),
                                                    "복합" if compound else qtype)
            gated_out += trimmed
            law = replace(law, passages=law_select.strip_card_law_lines(passages))
        case_refs = sorted({ref for p in passages for ref in p.case_refs})
        # 검색을 탄 갈래는 근거가 0건이어도 {} / [] 를 남긴다 — null(미도달)과 다른 사실이다.
        corpora, corpus_raw = _corpus_distribution(passages)
        corpus_raw += gated_out

        # 사례 근거 0건 — 질문에 직접 맞는 현행 조문이 있으면 조문만으로 일반 안내(LAW_ONLY, 10/7).
        # C48(세무조사 연기)처럼 심판례·해석은 다른 쟁점뿐이어도 국기법 §81의7 이 바로 답인 질문이 있다.
        # 선두 안내에 "규칙엔진의 판정 대상이 아닙니다"를 붙이던 것은 뺐다(R1-b) — 근거 수준만 밝힌다.
        if not passages and law_select.law_only_enabled():
            if law and law.labels:
                # "심판례·해석을 찾지 못해"는 뺐다(세무사 10/14 지적 4 — 세율처럼 법령으로 끝나는 답에선 신뢰도를 떨어뜨린다).
                raw = [{"text": LAW_ONLY_LEAD, "type": "caveat"}]
                sources, own = _number_sources(history, user_text, [], stock.trace if stock else "")
                summ, written = _pop_summary(law_select.fix_phantom_paras(
                    llm.write_advisory(history, user_text, etype, [], law_block=law.block, law_first=True, qtype=qtype,
                                       compound=compound, heads=law.heads, calc=stock.trace if stock else ""),
                    law.allowed))
                if stock:
                    summ = []                           # 결론 문단은 계산기가 낸다(_stock_finish)
                if compound:
                    written = _split_compound_heads(_fix_decree_names(written, law.allowed))
                raw += _law_checked(numeric_guard.drop_unsourced_numbers(
                    written, sources + law.texts, own, where=f"law_advisory {message_id}"), law,
                    f"law_advisory {message_id}", max_n=COMPOUND_MAX_SEGMENTS if compound else _segment_cap(qtype))
                raw = _drop_unknown_doc_refs(raw, [], f"law_advisory {message_id}")
                raw = _shape_by_qtype(raw, qtype, law)
                tab = _table_segments(law, user_text)
                raw = _drop_table_restatements(raw, tab)
                extra, extra_keys = _gift_rate_extras(user_text) if tab else ([], set())
                if extra_keys:                          # 결정론으로 실은 조문 — 배지 대조(_guard_badges)가 허용하게
                    law = replace(law, allowed=set(law.allowed) | extra_keys)
                raw = raw[:2] + tab + extra + raw[2:]   # 안내 caveat + 첫 설명 문장 뒤에 표 (+ 증여세율이면 공제·할증)
                raw = _place_summary(raw, _checked_summary(summ, sources + law.texts, own, law, [],
                                                           f"law_advisory summary {message_id}"))
                if compound:
                    raw = _shape_compound(raw, user_text, law.heads, calc=stock is not None)
                if stock:
                    raw = _stock_finish(raw, stock)
                    law = _stock_law(law, stock)
                segments = _clean_segment_dicts(raw, message_id)
                segments = _attach_citations(segments, [], anchor=0, laws=law.labels)
                segments = _cite_requirement_items(segments, law, qtype)
                segments = _guard_badges(segments, law, f"law_advisory {message_id}")
                blocks, offered = _offer(history, "advisory")
                return _recorded(
                    ChatResponse(
                        message=Message(id=message_id, role="assistant", order=order, segments=segments,
                                        uiBlocks=blocks),
                        meta=ChatMeta(engine=engine_name, extracted=extracted,
                                      ragHits=0, ragSource=rag_source_used, ragCorpora=corpora,
                                      ragPassages=corpus_raw, followUp=False, advisory=True, handoff=offered),
                    ),
                    conversation_id, occupation, "stock_calc" if stock else "law_advisory", rag_source_override,
                    rag_searched, etype=etype,
                )
        if not passages:
            # 근거 0건 — 폴백 사다리 3단계 "듣기 응답"(R1-c · D-1, 10/10). 예전엔 고정 문장으로 판정 지원 9개
            # 유형을 늘어놓고 그중 하나로 다시 설명해 달라고 했다('모른다'를 '질문을 잘못했다'로 말한 셈).
            # 이제 되짚기 + 숫자 없는 일반 확인 포인트 + 쟁점 특정 질문 1개 + 세무사 연결 제안.
            # 자료는 찾았지만 전부 다른 쟁점이었던 턴(off_issue)도 같은 응답이고, 찾아본 층만 밝힌다.
            # outcome 은 갈래 이름 그대로 둔다(G3 계측 연속성) — 'no_precedent' 가 **G3 의 분자**,
            # 'off_issue' 는 G3 분모 밖이다(집계 때 따로 본다).
            searched = [label for corpus, label, _ in llm.KB3_LAYERS
                        if any(g["corpus"] == corpus for g in gated_out)]
            segments = _listening_segments(history, user_text, extracted.get("tax_topic"), message_id, searched)
            blocks, offered = _offer(history, "no_precedent")
            return _recorded(
                ChatResponse(
                    message=Message(id=message_id, role="assistant", order=order, segments=segments,
                                    uiBlocks=blocks),
                    meta=ChatMeta(engine=engine_name, extracted=extracted,
                                  ragHits=0, ragSource=rag_source_used,
                                  ragCorpora=corpora, ragPassages=corpus_raw, followUp=True,
                                  handoff=offered),
                ),
                conversation_id, occupation, "off_issue" if gated_out else "no_precedent", rag_source_override,
                rag_searched, etype=etype,
            )

        # 선례 있음 — 판정 대신 자문. 선두 caveat 은 LLM 이 아니라 여기서 결정적으로 박는다
        # (모델이 면책 문구를 빠뜨려도 "판정이 아님"은 반드시 화면에 남아야 한다).
        # KB3(판례·심판례·질의회신·세무사 사례)는 세무사 검수가 아니다 — 들어온 층 이름을 그대로 밝힌다(D5, 10/5).
        kb3_names = [label for corpus, label, _ in llm.KB3_LAYERS
                     if any(p.corpus == corpus for p in passages)]
        # "○○ 사안은 규칙엔진의 판정 대상이 아닙니다." 머리는 뺐다(R1-b) — 근거 수준만 밝히는 참고 안내 문장.
        has_law = bool(law and law.labels)
        if has_law:
            # 근거 서열(A4) — 조문이 있으면 선두 안내도 법령을 먼저 밝힌다. 예전 "…국세청 해석 자료를 바탕으로 한 참고 안내"는
            # 세무사가 Q4 에서 짚은 문장이다(해석을 정답처럼 앞세움). 사례 층은 '보충'으로 뒤에 밝힌다.
            lead = ("아래는 현행 법령 조문을 중심으로"
                    + (f", {'·'.join(kb3_names)} 자료로 보충한" if kb3_names else " 한")
                    + " 참고 안내입니다(세무사가 이 사안을 확인한 내용은 아닙니다).")
        elif kb3_names:
            lead = (f"아래는 유사 사건의 {'·'.join(kb3_names)} 자료를 바탕으로 한 참고 안내입니다"
                    "(세무사가 이 사안을 확인한 내용은 아닙니다).")
        else:
            lead = ("아래는 일반 세무 용어·법리 자료를 바탕으로 한 참고 안내입니다"
                    "(세무사가 이 사안을 확인한 내용은 아닙니다).")
        raw = [{"text": lead, "type": "caveat"}]
        sources, own = _number_sources(history, user_text, passages, stock.trace if stock else "")
        if law:
            sources += law.texts
        summ, written = _pop_summary(law_select.fix_phantom_paras(
            llm.write_advisory(history, user_text, etype, law.passages if law else passages,
                               law_block=law.block if law else "", law_first=has_law, qtype=qtype,
                               compound=compound, heads=law.heads if law else None,
                               calc=stock.trace if stock else ""), law.allowed if law else set()))
        if stock:
            summ = []                                   # 결론 문단은 계산기가 낸다(_stock_finish)
        compound = compound and has_law          # 조문이 없으면 작문도 복합 형식을 안 썼다
        if compound:
            written = _split_compound_heads(_fix_decree_names(written, law.allowed))
        raw += _law_checked(numeric_guard.drop_unsourced_numbers(
            written, sources, own, where=f"advisory {message_id}"), law, f"advisory {message_id}",
            max_n=COMPOUND_MAX_SEGMENTS if compound else _segment_cap(qtype))
        raw = _drop_unknown_doc_refs(raw, passages, f"advisory {message_id}")
        raw = _shape_by_qtype(raw, qtype, law if has_law else None)
        tab = _table_segments(law, user_text)
        raw = _drop_table_restatements(raw, tab)
        raw = raw[:2] + tab + raw[2:]
        raw = _place_summary(raw, _checked_summary(summ, sources, own, law, passages, f"advisory summary {message_id}"))
        if compound:
            raw = _shape_compound(raw, user_text, law.heads, calc=stock is not None)
        if stock:
            raw = _stock_finish(raw, stock)
            law = _stock_law(law, stock)
        segments = _clean_segment_dicts(raw, message_id)
        segments = _attach_citations(segments, passages, anchor=0,   # 맨 앞 = '…자료를 참고해' 안내 문장
                                     laws=law.labels if law else None)
        segments = _cite_requirement_items(segments, law if has_law else None, qtype)
        segments = _guard_badges(segments, law, f"advisory {message_id}")
        # 자문은 판정이 아니다 — 판정 카드 대신 세무사 연결을 제안한다(판정 권위는 그대로 엔진).
        blocks, offered = _offer(history, "advisory")
        # G3 분모의 나머지 한쪽 — 같은 자문 경로에 들어와 선례를 찾아 답한 턴.
        return _recorded(
            ChatResponse(
                message=Message(id=message_id, role="assistant", order=order, segments=segments,
                                uiBlocks=blocks),
                meta=ChatMeta(engine=engine_name, extracted=extracted,
                              ragCaseRefs=case_refs, ragHits=len(passages), ragSource=rag_source_used,
                              ragCorpora=corpora, ragPassages=corpus_raw,
                              followUp=False, advisory=True, handoff=offered),
            ),
            conversation_id, occupation, "stock_calc" if stock else "advisory", rag_source_override,
            rag_searched, etype=etype,
        )

    # ①-b 결정변수 검증 → 판정 금지 시 되묻기.
    # 엔진 기본값(False / ratio 1.0)은 사용자가 말한 적 없는 사실이다. 그대로 판정하면
    # 추출기가 필드를 채웠는지에 따라 같은 질문이 부인↔조건부로 뒤집힌다(실측). 판정은
    # 오직 대화에서 확인된 사실의 함수여야 한다.
    #   (1) 추출기가 채운 결정변수 중 사용자 발화에 근거 없는 값(날조)을 떨어낸다.
    #   (2) 그러고도 비어 있는 결정변수가 있으면 판정하지 않고 한 번에 되묻는다.
    filled = [k for k in adapter.DECISIVE_FIELDS if extracted.get(k) is not None]
    grounded = set(llm.verify_decisive(history, user_text, filled))
    for k in filled:
        if k not in grounded:
            extracted.pop(k, None)

    #   (3) 되묻기는 턴당 2개·최대 2턴(R1-f). 상한을 넘기거나 관문(증빙·명의)만 남으면 더 묻지 않고 가정으로 판정.
    undecided = adapter.missing_decisive(extracted, profile_hint=extracted)
    ask = adapter.followup_fields(extracted.get("etype"), [], undecided, _followup_rounds(history))
    if ask:
        raw = llm.write_followup(history, user_text, ask)
        segments = _cite_followups(_ensure_follow_up(_clean_segment_dicts(raw, message_id)), ask, extracted)
        blocks, offered = _offer(history, "stalled")
        msg = Message(id=message_id, role="assistant", order=order, segments=segments,
                      uiBlocks=blocks)
        # ⚠️ 되묻기지만 **G3 지표가 아니다** — 판정형은 RAG 와 무관하게 결정변수를
        # 되묻는다. 'no_precedent' 와 같은 분모에 넣으면 지표가 오염된다.
        return _recorded(
            ChatResponse(
                message=msg,
                meta=ChatMeta(engine=engine_name, extracted=extracted, followUp=True,
                              handoff=offered),
            ),
            conversation_id, occupation, "undecided", rag_source_override, None,
            etype=extracted.get("etype"),
        )

    # ② engine (authoritative verdict) — 남은 결정변수는 가정으로 채워 엔진 입력에만 넣는다(R1-f F-1~F-3).
    #    meta.extracted 는 사용자 사실 그대로 둔다(가정은 화면 문장·카드 summary 로만 밝힌다).
    assumed = adapter.fill_assumptions(extracted)
    if assumed.ratio and extracted.get("etype") == "가사관련비":
        return _recorded(
            ChatResponse(
                message=Message(id=message_id, role="assistant", order=order,
                                segments=_ratio_guide_segments(assumed, message_id)),
                meta=ChatMeta(engine=engine_name, extracted=extracted, followUp=True),
            ),
            conversation_id, occupation, "ratio_guide", rag_source_override, None,
            etype=extracted.get("etype"),
        )
    profile, expense = adapter.to_engine_inputs(assumed.filled)
    result: eng.ExpenseResult = eng.evaluate(profile, expense)
    note = _assumption_note(assumed)

    # ③ RAG 검색 — KB3(판례·심판례·질의회신·세무사 사례) 벡터 검색.
    #    KB 가 비면 passages=[] → 스텁 refs 만으로 graceful.
    retriever = get_retriever(force_enabled=rag_override,
                              agent_expert_id=agent_expert_id, preview_expert_id=preview_expert_id)
    rag_searched = not isinstance(retriever, NullRetriever)
    passages = retriever.retrieve(query, k=_rag_top_k(), occupation="clinic")
    stub_refs = _CASE_REF.findall(result.근거)
    rag_refs = [ref for p in passages for ref in p.case_refs]
    case_refs = sorted(set(stub_refs) | set(rag_refs))
    # 프롬프트의 "참고 판례" 줄은 [규칙엔진 판정 — 권위 원천] 블록 안이다. KB3 문서번호(질의회신·심판례)를
    # 거기 넣으면 엔진이 댄 판례처럼 읽힌다 → 엔진 근거의 사건번호만 싣고, KB3 번호는 각자 라벨 블록 본문에서만.
    # meta.ragCaseRefs(화면·계측)는 종전대로 전부 싣는다.
    engine_refs = sorted(set(stub_refs))
    rag_source_used = _rag_source_label(passages)
    corpora, corpus_raw = _corpus_distribution(passages)

    # ④ segments (LLM prose grounded on ②③ — 엔진 판정 + RAG 지식)
    law = _law_step(query, passages, [result.근거])
    raw = llm.write_segments(
        user_text=user_text,
        verdict_label=result.verdict.value,
        # 가정 표시를 근거에 붙여 작문이 가정을 사실처럼 단정하지 않게 한다(Solar 추가 호출 0).
        reason=result.근거 + (f"{note} — 괄호 안 항목은 사용자가 말하지 않은 가정이니 사실로 단정하지 말 것"
                              if note else ""),
        accepted_won=result.인정금액,
        amount=expense.amount,
        evidences=result.필요증빙,
        case_refs=engine_refs,
        passages=(law.passages if law else passages) or None,
        law_block=law.block if law else "",
    )
    # 엔진 블록은 write_segments 가 모델에게 준 것과 같은 수치를 담아야 한다(인정/총액·근거·증빙).
    engine_block = (f"{result.verdict.value} {result.인정금액:,} / {expense.amount:,}원 "
                    f"{result.근거} {' '.join(result.필요증빙)}")
    sources, own = _number_sources(history, user_text, passages, engine_block)
    if law:
        sources += law.texts
    raw = numeric_guard.drop_unsourced_numbers(raw, sources, own, where=f"verdict {message_id}")
    raw = _law_checked(raw, law, f"verdict {message_id}")
    # 가정 문장은 숫자 가드 뒤에 붙인다 — 엔진을 다시 돌린 결정론 값이라 가드 대상이 아니다.
    extra = _assumption_segments(assumed, result)
    segments = _clean_segment_dicts(raw + extra, message_id)
    anchor = len(segments) - len(extra) - 1 if len(segments) > len(extra) else -1   # 작문의 마지막 문장
    segments = _attach_citations(segments, passages, anchor=anchor, laws=law.labels if law else None)
    segments = _guard_badges(segments, law, f"verdict {message_id}")
    if not any(seg.citations for seg in segments):
        # 근거 배지가 하나도 없으면(LLM3·KB3 가 못 댄 턴 — E04·E05, 10/13 기준선) 그 지출유형의 판정 근거 조문을 단다.
        i = anchor if 0 <= anchor < len(segments) else len(segments) - 1
        segments[i] = segments[i].model_copy(update={"citations": adapter.verdict_citations(extracted)})

    # ⑤ uiBlocks (deterministic)
    card, checklist = adapter.result_to_ui_blocks(result, expense.amount)
    if note:
        card = card.model_copy(update={"summary": card.summary + note})
    ui_blocks = [card] + ([checklist] if checklist else [])

    # ⑥ assemble
    msg = Message(id=message_id, role="assistant", order=order,
                  segments=segments, uiBlocks=ui_blocks)
    return _recorded(
        ChatResponse(
            message=msg,
            meta=ChatMeta(engine=engine_name, extracted=extracted,
                          ragCaseRefs=case_refs, ragHits=len(passages), ragSource=rag_source_used,
                          ragCorpora=corpora, ragPassages=corpus_raw, followUp=False),
        ),
        conversation_id, occupation, "verdict", rag_source_override, rag_searched,
        etype=extracted.get("etype"),
    )
