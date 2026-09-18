"""
세무사 연결(전문가 상담 핸드오프) 발행 규칙 — 결정적. LLM 판단 없음.

설계: docs/doing/세무사연결_핸드오프_이식설계.md §3.1

    explicit      사용자가 세무사/전문가/사람과의 상담·연결을 명시 요청 → 매번
    advisory      엔진 규칙 밖 자문 답변                                 ┐
    no_precedent  엔진 규칙 밖 + 선례 없음                               ├ 대화당 1회
    stalled       판정 없는 되묻기가 이번 턴 포함 3턴 연속               ┘

판정(verdict_card)이 난 턴에는 붙이지 않는다 — 판정은 엔진의 권위이고, 판정 옆의 "사람에게
물어보세요"는 판정을 스스로 깎는다. 명단은 블록에 없다(프론트가 list_experts() 로 조회).
"""

from __future__ import annotations

import re

from api.schema import ExpertHandoff, Message

# 명시 요청으로 잡히면 원래 질문엔 답하지 않고 카드만 낸다 → 오탐 비용이 크다.
# 그래서 "대상 + 행위" 뒤에 **바람·요청 어미**가 짧게 이어질 때만 잡는다.
#   잡힘: "세무사 연결해 줘", "인간 세무사와 소통하고 싶어", "사람이랑 얘기할 수 있나요?"
#   안 잡힘: "세무사와 상담했더니 괜찮다던데", "거래처 사람과 만나 식사했는데 접대비인가요?"
_TARGET = r"(?:세무사|전문가|상담사|회계사|사람)\s*(?:님)?"
_ACT_WITH = r"(?:상담|얘기|이야기|대화|통화|소통|연락|연결|물어|문의|만나)"
_ACT_DIRECT = r"(?:연결|소개|추천|바꿔|불러|연락처)"
_TAIL = (r"[^.?!\n]{0,6}?"
         r"(?:싶|주세요|주실|줘|줄\s*수|해\s*주|드려|원해|원합|필요|부탁|가능|"
         r"할\s*수\s*있|되나요|될까|있나요|있을까|알려)")

_PATTERNS = [
    # "세무사와 상담하고 싶어요", "전문가한테 직접 물어볼 수 있나요"
    re.compile(_TARGET + r"\s*(?:와|과|랑|이랑|하고|한테|에게|께)\s*(?:직접\s*)?"
               + _ACT_WITH + _TAIL),
    # "세무사 연결해 줘", "전문가 좀 소개해 주세요", "세무사 연락처 알려줘"
    re.compile(_TARGET + r"\s*(?:을|를|분)?\s*(?:좀\s*)?" + _ACT_DIRECT + _TAIL),
    # "인간 세무사 필요해요", "진짜 세무사랑 얘기하고 싶어"
    re.compile(r"(?:진짜|실제|인간|사람)\s*(?:인\s*)?(?:세무사|전문가)" + _TAIL),
]

REASONS = {
    "explicit": "요청하신 대로 세무사와 직접 상담하실 수 있습니다.",
    "advisory": ("규칙엔진이 판정하는 유형이 아니어서 위 내용은 참고 의견입니다. "
                 "확실한 판단이 필요하면 세무사와 직접 상담해 보세요."),
    "no_precedent": ("이 사안은 AI가 판정하거나 참고할 선례가 아직 없습니다. "
                     "세무사와 직접 상담해 보시기를 권합니다."),
    "stalled": ("판정에 필요한 사실관계 확인이 길어지고 있습니다. 상황이 복잡하다면 "
                "세무사와 직접 상담하는 편이 빠를 수 있습니다."),
}

NOTE = "아래에서 세무사를 골라 상담을 신청할 수 있습니다."

EXPLICIT_REPLY = "네, 세무사와 직접 상담하실 수 있도록 연결해 드릴게요."

# 이번 턴을 포함해 판정 없는 되묻기가 이만큼 이어지면 제안한다.
STALLED_TURNS = 3


def is_explicit_request(text: str) -> bool:
    t = (text or "").strip()
    if not t:
        return False
    return any(p.search(t) for p in _PATTERNS)


def _kinds(m: Message) -> set[str]:
    return {b.kind for b in (m.uiBlocks or [])}


def already_offered(history: list[Message]) -> bool:
    return any("expert_handoff" in _kinds(m) for m in history if m.role == "assistant")


def is_stalled(history: list[Message]) -> bool:
    """직전 (STALLED_TURNS-1) 개의 assistant 답변이 모두 판정 없이 끝났는가.
    (이번 턴의 되묻기는 호출 자리에서 이미 확정 — 여기선 과거만 본다.)"""
    need = STALLED_TURNS - 1
    recent = [m for m in sorted(history, key=lambda m: m.order) if m.role == "assistant"][-need:]
    return len(recent) == need and all("verdict_card" not in _kinds(m) for m in recent)


def block(reason_key: str) -> ExpertHandoff:
    return ExpertHandoff(reason=REASONS[reason_key], note=NOTE)


def auto_offer(history: list[Message], reason_key: str) -> ExpertHandoff | None:
    """자동 제안 — 대화당 1회."""
    if already_offered(history):
        return None
    return block(reason_key)
