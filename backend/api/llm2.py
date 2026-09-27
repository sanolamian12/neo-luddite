"""
LLM2(v2) — 답변 단계. 설계 design/W5_LLM2_답변단계_설계.md.

    write_answer()   모아진 사실 + 검색 근거(검수 선례·판례 요지·국세청 해석·참고 사전) → 판정 + 세그먼트

**판정 권위는 LLM2 다**(정본 §1). 대신 근거 없는 판정은 코드가 막는다(M1, §4):
  · verdict_basis 중 하나 이상이 검수 선례·KB3 근거 본문에 실제로 있어야 판정이 산다 — 아니면 '판정 보류'로
    내리고 결론·적용 문장을 뺀다(판정처럼 읽히는 문장을 남기지 않는다).
  · 빈 사실(gap)이 있는데 확정 판정이면 '조건부'로 내린다.
  · 본문·인용의 조문 번호(제N조)가 근거 어디에도 없으면 그 문장을 뺀다 — numeric_guard 는 조문 번호를
    수치로 안 본다(그 가드의 설계상 제외). 이 모듈이 그 빈자리를 막는다.

`llm.py` 는 고치지 않는다(격리 규칙). v1 의 근거 라벨(`llm._grounding_block`)도 그대로 — KB3 라벨은 여기만 산다.
공통 규범(L0)은 본문만 빌리고 머리말은 여기 것을 쓴다: `llm._with_norms` 의 "판정은 어떤 경우에도
규칙엔진의 권위다"는 v2 에서 거짓이다.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field

from api import upstage_gate
from api.llm import _FRAMEWORKS, _chat_model, _history_to_messages, bounded_client

log = logging.getLogger("api.llm2")

TIMEOUT_ANSWER = 120   # 산문 생성 — llm.TIMEOUT_WRITE_ADVISORY 와 같은 급

VERDICTS = ("인정", "일부 인정", "부인", "조건부", "판정 보류")
FIRM = ("인정", "일부 인정", "부인")        # gap 이 있으면 조건부로 내린다
WITHHELD = "판정 보류"
_JUDGING_TYPES = ("conclusion", "application")   # 판정 보류면 빼는 문장 유형
_SEGMENT_TYPES = ["context", "issue_framing", "rule_statement", "application", "evidence_request",
                  "conclusion", "caveat", "follow_up"]

# ── 근거 블록 (W5 설계 §3) ──────────────────────────────────────────────────────
# 블록 순서 = 권위 서열. corpus 가 없는 항목은 검수 선례로 본다(llm.py P4 관례).
_BLOCKS = (
    ("rag", "[검수 선례 — 세무사가 확인한 내용 · 다른 질문자의 사안]"),
    ("kb3_prec", "[판례 요지 — 법원·심판 결정 · 다른 사건]"),
    ("kb3_qna", "[국세청 해석 — 질의회신 · 행정 해석이며 법원 판단과 다를 수 있음]"),
    ("kbdict", "[참고 사전 — 일반 법리·용어, 본 사안에 대한 확인이 아님]"),
)
_GROUNDING_RULES = (
    "[근거 사용 규칙]\n"
    "- 우선순위는 검수 선례 > 판례 요지 > 국세청 해석 > 참고 사전입니다.\n"
    "- 판례 요지와 국세청 해석이 엇갈리면 둘 다 밝히고 판례 쪽을 앞세우세요. 이때 판정은 '조건부' 또는 "
    "'판정 보류'로 하세요.\n"
    "- 검수 선례·판례·질의회신은 모두 다른 사람의 사안입니다. 거기 나오는 인원·금액·연도·업종·명의 같은 "
    "사실관계를 사용자의 상황인 것처럼 옮겨 쓰지 마세요. 사용자의 사실은 [사용자 질문]과 대화에 나온 것뿐입니다.\n"
    "- 문서번호·법령 조문은 위 근거 블록에 적힌 것만 인용하세요. 근거에 없는 조문 번호를 쓰지 마세요.\n"
    "- 참고 사전만으로 판정하거나 단정하지 마세요. 참고 사전 내용을 '세무사들은 ~로 보았습니다'처럼 "
    "세무사 판단으로 쓰지 마세요."
)


def _block_of(p) -> str:
    c = getattr(p, "corpus", None)
    return c if c in ("kb3_prec", "kb3_qna", "kbdict") else "rag"


def grounding_block(passages) -> str:
    """검색 근거 → 권위별 라벨 블록 + 사용 규칙. 근거가 없으면 빈 문자열."""
    blocks = []
    for key, header in _BLOCKS:
        items = [p.content for p in passages if _block_of(p) == key]
        if items:
            blocks.append(header + "\n" + "\n\n".join(f"- {c}" for c in items))
    if not blocks:
        return ""
    return "\n\n".join(blocks) + "\n\n" + _GROUNDING_RULES


# ── 시스템 프롬프트 ────────────────────────────────────────────────────────────

_SYSTEM = (
    "당신은 한국 세무 전문가입니다. 사용자의 질문과 대화에서 확인된 사실, 그리고 제공된 근거(검수 선례·"
    "판례 요지·국세청 해석·참고 사전)만으로 판단을 내리고 설명합니다. 규칙:\n"
    "1. verdict 는 인정 / 일부 인정 / 부인 / 조건부 / 판정 보류 중 하나입니다. 근거가 사안에 직접 닿지 "
    "않거나 부족하면 '판정 보류'를 고르세요 — 억지로 판정하지 마세요.\n"
    "2. 인정·일부 인정·부인·조건부를 고르면 verdict_basis 에 그 판정을 떠받치는 문서번호나 법령 조문을 "
    "근거 블록에 적힌 그대로 한 개 이상 넣으세요. 근거 블록에 없는 것을 넣으면 판정이 무효가 됩니다.\n"
    "3. [미확인 사실]이 있으면 확정 판정 대신 '조건부'로 하고, 그 사실에 따라 결론이 어떻게 갈리는지 "
    "'~라면 ~, ~라면 ~' 식으로 쓰세요.\n"
    "4. 세그먼트는 결론(conclusion) → 법리(rule_statement) → 적용(application) → 증빙(evidence_request) "
    "→ 단서(caveat) 흐름을 권장합니다. 판정 보류면 결론·적용 문장 없이 쟁점·법리·확인할 사항으로 쓰세요.\n"
    "5. 근거·규범에 없는 수치(한도액·세율·비율·기한·연도)나 사용자가 말하지 않은 인원·금액을 새로 쓰지 "
    "마세요. 필요하면 '적용 한도는 세무사 확인이 필요합니다'처럼 수치 없이 쓰세요.\n"
    "6. 반드시 emit_answer 도구로만 출력하세요."
)


def _system() -> str:
    from api.prompts import load_norms

    norms = load_norms()
    if not norms:
        return _SYSTEM
    return (f"{_SYSTEM}\n\n"
            "[공통 규범 — 답변 절차·해석 원칙·오류 패턴. 위 규칙과 부딪히면 위 규칙이 우선입니다]\n"
            f"{norms}")


def _answer_tool() -> dict:
    return {
        "type": "function",
        "function": {
            "name": "emit_answer",
            "description": "세무 판단(verdict)과 그 근거, 설명 세그먼트를 출력한다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "verdict": {"type": "string", "enum": list(VERDICTS)},
                    "verdict_basis": {"type": "array", "items": {"type": "string"},
                                      "description": "판정을 떠받치는 문서번호·법령 조문 — 근거 블록에 적힌 그대로."},
                    "segments": {
                        "type": "array",
                        "minItems": 1,
                        "items": {
                            "type": "object",
                            "properties": {
                                "text": {"type": "string", "description": "한 문장(자연어)."},
                                "type": {"type": "string", "enum": _SEGMENT_TYPES},
                                "framework": {"type": "string", "enum": _FRAMEWORKS},
                                "citations": {"type": "array", "items": {"type": "string"},
                                              "description": "근거 블록에 실제로 등장한 문서번호·법령만."},
                            },
                            "required": ["text", "type"],
                        },
                    },
                },
                "required": ["verdict", "verdict_basis", "segments"],
            },
        },
    }


# ── M1 · 조문 가드 ─────────────────────────────────────────────────────────────

_NOISE = re.compile(r"[\s\-·.,()\[\]「」『』\"']")
_SECTION = re.compile(r"§\s*(\d+)(?:\s*의\s*(\d+))?")
_ARTICLE = re.compile(r"제\s*(\d+)\s*조(?:\s*의\s*(\d+))?")


def _norm(s: str) -> str:
    s = _SECTION.sub(lambda m: f"제{m.group(1)}조" + (f"의{m.group(2)}" if m.group(2) else ""), s or "")
    return _NOISE.sub("", s)


def _articles(text: str) -> set[str]:
    """'제12조의2' 같은 조문 토큰(정규화). 항·호는 보지 않는다 — 조까지 맞으면 통과."""
    return {f"제{a}조" + (f"의{b}" if b else "") for a, b in _ARTICLE.findall(_norm(text))}


@dataclass
class Answer:
    segments: list[dict]
    verdict: str = WITHHELD
    verdict_raw: str | None = None
    downgraded: str | None = None           # "no_basis" | "gap" | None
    basis: list[str] = field(default_factory=list)
    basis_matched: list[str] = field(default_factory=list)
    citations_dropped: int = 0
    article_dropped: int = 0
    failed: bool = False

    def meta(self) -> dict:
        out = {"verdict": self.verdict, "verdictRaw": self.verdict_raw, "downgraded": self.downgraded,
               "basis": self.basis or None, "basisMatched": self.basis_matched or None,
               "citationsDropped": self.citations_dropped or None,
               "articleDropped": self.article_dropped or None, "failed": self.failed or None}
        return {k: v for k, v in out.items() if v is not None}


def enforce(data: dict, passages, has_gaps: bool) -> Answer:
    """모델 출력 → 코드 검사를 통과한 답(M1, W5 설계 §4). 모델 호출과 분리해 두어 하니스가 그대로 쓴다."""
    authoritative = [_norm(p.content) for p in passages if _block_of(p) != "kbdict"]
    everything = [_norm(p.content) for p in passages]
    known_articles = set().union(*(_articles(p.content) for p in passages)) if passages else set()

    raw_verdict = data.get("verdict")
    verdict = raw_verdict if raw_verdict in VERDICTS else WITHHELD
    basis = [b for b in (data.get("verdict_basis") or []) if isinstance(b, str) and b.strip()]
    # 숫자 없는 인용("소득세법")은 어느 근거에나 부분일치해 M1 을 공짜로 통과한다 — 문서번호·조문만 센다.
    matched = [b for b in basis if re.search(r"\d", b) and any(_norm(b) in c for c in authoritative)]

    ans = Answer(segments=[], verdict=verdict, verdict_raw=raw_verdict, basis=basis, basis_matched=matched)
    if verdict != WITHHELD and not matched:
        ans.verdict, ans.downgraded = WITHHELD, "no_basis"
    elif has_gaps and verdict in FIRM:
        ans.verdict, ans.downgraded = "조건부", "gap"

    for seg in data.get("segments") or []:
        if not isinstance(seg, dict) or not (seg.get("text") or "").strip():
            continue
        if ans.verdict == WITHHELD and seg.get("type") in _JUDGING_TYPES:
            continue
        if _articles(seg["text"]) - known_articles:
            ans.article_dropped += 1
            log.warning("근거에 없는 조문 문장 제거: %s", seg["text"][:80])
            continue
        cites = [c for c in (seg.get("citations") or []) if isinstance(c, str) and c.strip()]
        kept = [c for c in cites if any(_norm(c) in t for t in everything)]
        ans.citations_dropped += len(cites) - len(kept)
        ans.segments.append({**seg, "citations": kept or None})
    return ans


FALLBACK = [{"text": "근거 자료를 바탕으로 한 답변을 만들지 못했습니다. 세무사와 직접 상담해 보시기를 권합니다.",
             "type": "caveat"}]


def write_answer(history: list, question: str, answers: list[str], gaps: list[str], passages: list) -> Answer:
    """답변 단계 본체. 호출 전제: passages 가 비어 있지 않다(비면 pipeline 이 '선례 없음'으로 간다).
    혼잡(UpstageCongested)은 올려 보낸다 — main.chat 이 혼잡 안내로 바꾼다. 그 밖의 실패는 폴백 문안."""
    composed = f"[사용자 질문]\n{question}"
    if answers:
        composed += "\n\n[이어서 확인된 답변]\n" + "\n".join(f"- {a}" for a in answers)
    if gaps:
        composed += "\n\n[미확인 사실 — 이 사실에 따라 결론이 달라질 수 있으니 조건부로 쓰세요]\n" + \
                    "\n".join(f"- {g}" for g in gaps)
    composed += "\n\n" + grounding_block(passages) + "\n\n위 근거로 판단하고 설명하세요."

    messages = [{"role": "system", "content": _system()}]
    messages += _history_to_messages(history)
    messages.append({"role": "user", "content": composed})
    try:
        resp = bounded_client(TIMEOUT_ANSWER).chat.completions.create(
            model=_chat_model(), messages=messages, tools=[_answer_tool()],
            tool_choice={"type": "function", "function": {"name": "emit_answer"}}, temperature=0.3)
        calls = getattr(resp.choices[0].message, "tool_calls", None)
        data = json.loads(calls[0].function.arguments) if calls else None
    except upstage_gate.UpstageCongested:
        raise
    except Exception as exc:  # noqa: BLE001 — 답변 실패는 폴백 문안(세무사 연결 카드는 pipeline 이 붙인다)
        log.warning("write_answer 실패 — 폴백: %s", exc)
        data = None
    if not isinstance(data, dict):
        return Answer(segments=list(FALLBACK), failed=True)
    ans = enforce(data, passages, bool(gaps))
    if not ans.segments:
        ans.segments = list(FALLBACK)
    return ans
