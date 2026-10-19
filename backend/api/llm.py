"""
Upstage Solar client — the LLM half of the hybrid pipeline (docs API 계약 §2.5, steps ①④).

Upstage is OpenAI-compatible, so we drive it through the `openai` SDK with a
base_url override. Two responsibilities:
  · extract_engine_inputs() — function-calling extraction of engine inputs (step ①)
  · write_segments()        — writes natural-language argument segments grounded on
                              the engine's authoritative result (step ④)

The LLM NEVER decides the verdict; it only extracts inputs and writes prose.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
import time
from contextvars import ContextVar, copy_context
from functools import lru_cache
from typing import get_args

from openai import OpenAI

from api import answer_display, upstage_gate, usage_log
from api.schema import Framework, SegmentType

log = logging.getLogger("api.llm")

_SEGMENT_TYPES = list(get_args(SegmentType))
_FRAMEWORKS = list(get_args(Framework))


@lru_cache(maxsize=1)
def get_client() -> OpenAI:
    key = os.environ.get("UPSTAGE_API_KEY")
    if not key:
        raise RuntimeError(
            "UPSTAGE_API_KEY is not set. Copy backend/.env.example → backend/.env "
            "and fill the Upstage key (see memory reference_upstage_api)."
        )
    base_url = os.environ.get("UPSTAGE_BASE_URL", "https://api.upstage.ai/v1")
    return OpenAI(api_key=key, base_url=base_url)


# ── 호출 시간 상한 ────────────────────────────────────────────────────────────
# OpenAI SDK 기본값은 타임아웃 600초 × 재시도 2회 = 한 번 물리면 최대 30분이다. 정상
# 응답이 수 초~수십 초인 호출에 이 기본값이 걸려 있으면, 단발 폭주 하나가 파이프라인
# 전체를 세운다(실측 2026-09-10: 분류 배치 하나가 1250초 = 600+600+50). 그래서 호출마다
# "이 정도면 비정상"인 상한을 명시하고 재시도도 1회로 줄인다.
#
# 상한을 넘기면 예외 → 각 함수의 except 가 폴백(빈 결과/건별 재시도/근거 없이 진행)으로
# 흡수한다. 즉 상한은 정확도를 깎지 않고 최악 시간만 자른다.
DEFAULT_RETRIES = 1

TIMEOUT_CLASSIFY_BATCH = 90     # 20건 배치 분류 — 실측 8~20초
TIMEOUT_CLASSIFY_ONE = 30       # 단건 분류(배치 폴백) — 실측 0.8초
TIMEOUT_PROPOSE_CATEGORIES = 90  # 맵 단계 배치 — 35건 요약 투입, 출력은 카테고리 3~8개
# 리듀스 — 처음엔 "레이블만 다루니 가볍다"고 90초로 잡았는데 오판이었다(2026-09-10
# 실측: 186초 ≈ 90×2 를 쓰고 폴백으로 빠졌다). 후보가 12배치 × 3~8개 = 50~90개
# 들어가고 출력도 카테고리 20개 + 설명이라 실제로는 무거운 생성이다. 여기서 폴백으로
# 빠지면 의미가 겹치는 카테고리를 합쳐주는 LLM 통합이 통째로 사라지고 레이블 문자열
# 완전일치 dedup 만 남아 — 사전 품질이 조용히 나빠진다. 넉넉히 준다.
TIMEOUT_MERGE_CATEGORIES = 600
# 근사 동의어 접기 뒤 빈 칸 리필(2026-09-13). 입력은 merge 와 같은 후보 목록이지만 출력이
# 빈 칸 수(현 세대 기준 8개 안팎)뿐이라 merge 보다 가볍다. 아직 실측 전이라 merge 실측
# (186초)은 넘겨 잡되 600 까지는 주지 않는다 — 여기서 실패해도 관찰 횟수순 코드 리필이
# 받고, 그 실패는 labelFold.refillError 로 세어진다.
TIMEOUT_REFILL_CATEGORIES = 300
# 카테고리별 문장 합성. 240 → 60 (2026-09-12). 240 은 "출력이 길어 넉넉히"라고 감으로
# 잡은 값이었고, 실측하니 **정상 호출의 16배**였다. 재시도를 SDK 밖으로 꺼내 한 번의
# 호출 = 한 개의 소요값으로 만든 회차(job 9da37290)에서 분포가 두 덩어리로 갈렸다:
#
#     성공 48회  min 1.04s  p50 2.90s  p90 4.87s  max 15.0s (2위 7.24s)
#     실패  2회  240.068s · 240.092s   ← 정확히 상한에 붙음
#
# **240초 근처의 성공이 0건**이다 — 느린 생성이면 연속 분포여야 한다. 즉 상한을 낮춰도
# 자를 정상 호출이 없다(48건 전부 15초 이하라 후보 20/30/45/60/90초 어느 것도 0건 절단).
# 60 은 관측 최대의 4배로, 아직 못 본 느린 호출에 여유를 남긴 보수적 선택이다.
# 실패한 호출은 CHUNK_ATTEMPTS 루프가 다시 묻고 그 재시도는 계측에 세어진다(유실 0 실측).
TIMEOUT_SYNTHESIZE = 60
TIMEOUT_PROPOSE_GROUPS = 90     # 세목 제목 목록 → 대목 배정
TIMEOUT_EMBED = 30              # 임베딩 — 실측 1초 미만. 챗 요청 경로에도 걸린다

# 챗 요청 경로 — 여기서 물리면 사용자가 그 시간만큼 응답을 못 받는다. 산문 생성은
# 넉넉히, 도구 호출(추출/검증)은 짧게. 여섯 함수 모두 try/except 폴백이 있어 상한을
# 넘겨도 500 이 아니라 폴백 응답으로 흡수된다(근거 없이 진행 / 기본 문안).
# 10/8 지연 진단: 정상 작문은 3~9초인데 가끔 응답 없이 멈춘 호출이 상한(120초)까지 버티다 재시도해 턴이 150초가
# 됐다(C27 write_advisory 127.8초). 상한을 정상치의 수 배로 줄여 멈춘 호출을 일찍 끊고 재시도(DEFAULT_RETRIES=1)한다.
TIMEOUT_EXTRACT = 30
TIMEOUT_WRITE_SEGMENTS = 45
TIMEOUT_WRITE_ADVISORY = 45     # 자문 경로 — 산문 생성이라 write_segments 와 같은 성격
TIMEOUT_VERIFY_DECISIVE = 30
TIMEOUT_WRITE_FOLLOWUP = 45
TIMEOUT_ISSUE_FIT = 30          # KB3 쟁점 적합성 — 카드 ≤5건 분류, 실패하면 거르지 않고 진행


class _Gated:
    """클라이언트 대리 — `.create(...)` 를 upstage_gate.slot() 안에서 부른다(P8 B).

    `bounded_client(t).chat.completions.create(...)` / `.embeddings.create(...)` 모양을 그대로
    두고 게이트를 한 자리에서 건다 — 호출 지점 14곳을 고치지 않고, 새 호출도 자동으로 줄에 선다."""

    def __init__(self, target, label: str) -> None:
        self._target = target
        self._label = label

    def __getattr__(self, name: str):
        attr = getattr(self._target, name)
        if name != "create":
            return _Gated(attr, self._label)

        def gated_create(*args, **kwargs):
            # 사용 로그(usage_log) — 호출 1회 = journald 한 줄. 지연은 줄 대기를 뺀 Upstage 호출 시간이다.
            # 원문 기록 모드(API_CALL_CAPTURE_DIR)면 요청 직전 시각과 응답 본문까지 한 건으로 남긴다(기본 꺼짐).
            t0 = requested_at = None
            try:
                with upstage_gate.slot(self._label):
                    t0 = time.monotonic()
                    requested_at = usage_log.kst_now()
                    resp = attr(*args, **kwargs)
            except BaseException as e:
                ms = int((time.monotonic() - t0) * 1000) if t0 is not None else 0
                usage_log.record(self._label, kwargs, latency_ms=ms, error=e)
                if requested_at is not None:
                    usage_log.capture(self._label, kwargs, requested_at, error=e)
                raise
            usage_log.record(self._label, kwargs, resp, int((time.monotonic() - t0) * 1000))
            usage_log.capture(self._label, kwargs, requested_at, resp)
            return resp
        return gated_create


def bounded_client(timeout_sec: float, retries: int = DEFAULT_RETRIES, label: str | None = None) -> OpenAI:
    """시간 상한이 걸린 클라이언트. 상한 없는 get_client() 를 그대로 쓰면 SDK 기본
    600초 × 2회에 걸린다 — 새 호출을 추가할 때는 이쪽을 쓸 것.

    돌려주는 것은 동시 호출 게이트(upstage_gate)를 거치는 대리다. 게이트 대기는 이 timeout 밖이다."""
    label = label or sys._getframe(1).f_code.co_name   # 로그용 — 어느 함수의 호출이 줄에서 기다렸나
    return _Gated(get_client().with_options(timeout=timeout_sec, max_retries=retries), label)


HEDGE_AFTER_SEC = float(os.environ.get("UPSTAGE_HEDGE_AFTER", "20"))   # 반복 루프는 출력 상한이 끊는다(약 13초) — 헤지는 무응답용
_HEDGE_POOL = None


def hedged_create(timeout_sec: float, hedge_after: float | None = None, **kwargs):
    """작문 호출 헤지(10/8 지연 진단) — 정상 3~9초인데 12문항 중 3건이 응답 없이 멈춰 45초 상한까지 버텼다.
    HEDGE_AFTER_SEC 안에 안 오면 같은 요청을 하나 더 보내 먼저 온 답을 쓴다(늦은 쪽은 버림 — 상한에 끝난다).
    정상 호출엔 추가 비용 0. 각 호출은 재시도 없이(헤지가 재시도 몫). 둘 다 실패면 마지막 예외를 올린다.
    UPSTAGE_HEDGE_AFTER=0 이면 헤지 없이 종전(재시도 1회) 동작. hedge_after = 호출별 기준(법령 선택처럼 정상이 짧은 호출)."""
    global _HEDGE_POOL
    from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

    label = sys._getframe(1).f_code.co_name   # 로그 라벨은 작문 함수 이름(write_advisory 등) — 안쪽 call 이 아니라
    after = HEDGE_AFTER_SEC if hedge_after is None else hedge_after

    def call():
        return bounded_client(timeout_sec, retries=0, label=label).chat.completions.create(**kwargs)

    if after <= 0:
        return bounded_client(timeout_sec, label=label).chat.completions.create(**kwargs)
    if _HEDGE_POOL is None:
        _HEDGE_POOL = ThreadPoolExecutor(max_workers=8, thread_name_prefix="hedge")
    # 헤지 스레드는 요청 컨텍스트를 물려받지 않는다 — 사본을 들려 보내 사용 로그의 대화 id 를 잇는다(사본 1개 = 스레드 1개).
    first = _HEDGE_POOL.submit(copy_context().run, call)
    done, _ = wait([first], timeout=after)
    if done and first.exception() is None:
        return first.result()
    log.info("%s 호출 %s초 무응답/실패 — 헤지 요청", label, after)
    pending = ({first, _HEDGE_POOL.submit(copy_context().run, call)} if not done
               else {_HEDGE_POOL.submit(copy_context().run, call)})
    last_exc = first.exception() if done else None
    while pending:
        done, pending = wait(pending, return_when=FIRST_COMPLETED)
        for f in done:
            if f.exception() is None:
                return f.result()
            last_exc = f.exception()
    raise last_exc


WRITE_MAX_TOKENS = int(os.environ.get("UPSTAGE_WRITE_MAX_TOKENS", "1800"))
# 3자 방(A7, 10/16) — 방 답은 채팅 말풍선이라 일반 챗보다 짧게. api/room_agent.py 가 run_clinic 을 부르는 동안만 세팅한다
# (AGENT_PRINCIPLES 와 같은 contextvar). 비어 있으면 일반 챗과 같은 WRITE_MAX_TOKENS.
WRITE_TOKENS_CAP: ContextVar[int | None] = ContextVar("write_tokens_cap", default=None)
# 방 답 형식 한 줄 — 작문 지시(user 메시지)의 **맨 끝**에 붙인다. 시스템 원칙 블록(_with_agent)의 '짧게' 는 형식 규칙(■ 세목·확인할 점)에
# 밀려 1,400자 답이 나왔다(10/16 로컬 스모크 S3). 비어 있으면 지시문이 종전과 바이트까지 같다.
ROOM_STYLE: ContextVar[str | None] = ContextVar("room_style", default=None)


def _with_room_style(grounding: str) -> str:
    style = ROOM_STYLE.get()
    return f"{grounding}\n{style}" if style else grounding


def write_max_tokens() -> int:
    cap = WRITE_TOKENS_CAP.get()
    return min(WRITE_MAX_TOKENS, cap) if cap else WRITE_MAX_TOKENS


def parse_segments(arguments: str) -> list[dict]:
    """emit_segments 도구 인자 → segments. 출력 상한(max_tokens)에서 잘린 JSON 도 **온전한 문장 객체까지는** 살린다
    (10/8: solar 가 같은 문장을 반복하는 루프에 빠지면 6/6 중 1회꼴로 6,000토큰을 채웠다 — 상한으로 끊고 앞부분을 쓴다).
    반복분은 _clean_segment_dicts(완전 중복)·law_select.trim_answer(유사 중복)가 걸러 낸다."""
    try:
        data = json.loads(arguments)
        segs = data.get("segments") if isinstance(data, dict) else None
        return [x for x in segs or [] if isinstance(x, dict)]
    except (json.JSONDecodeError, TypeError):
        pass
    if not isinstance(arguments, str):
        return []
    i = arguments.find("[")
    if i < 0:
        return []
    dec, out, pos = json.JSONDecoder(), [], i + 1
    while True:
        j = arguments.find("{", pos)
        if j < 0:
            break
        try:
            obj, end = dec.raw_decode(arguments, j)
        except json.JSONDecodeError:
            break
        if isinstance(obj, dict) and obj.get("text"):
            out.append(obj)
        pos = end
    if out:
        log.warning("잘린 도구 출력에서 문장 %d개 복구(출력 상한 %d토큰)", len(out), write_max_tokens())
    return out


def _chat_model() -> str:
    return os.environ.get("UPSTAGE_CHAT_MODEL", "solar-pro3")


def _history_to_messages(history: list) -> list[dict]:
    """Flatten prior Message[] → plain OpenAI chat messages (segment texts joined)."""
    out = []
    for m in history:
        text = " ".join(s.text for s in m.segments)
        if text.strip():
            out.append({"role": m.role, "content": text})
    return out


# 추출용 대화 이력(F0, 10/12) — 추출이 30초 타임아웃으로 500 이 난 4건이 전부 3·4턴째였다(R2 측정 Y01·V03·T01 3턴 ·
# 세무사 4문항 연속 재현 X05 4턴). 이력이 길수록(계산 답 20문장 등) 추출이 느려진다. 추출은 주제·슬롯·짧은 답의 맥락만
# 필요하다 — 최근 메시지만, assistant 답은 앞·뒤만 준다(되묻기 질문은 답의 **끝**에 있다 — "네"가 무엇에 대한 답인지
# 잃지 않게). 작문 단계는 종전대로 전체 이력.
EXTRACT_HISTORY_MESSAGES = 6
EXTRACT_ASSISTANT_HEAD = 200
EXTRACT_ASSISTANT_TAIL = 300


def _history_for_extract(history: list) -> list[dict]:
    out = []
    for msg in _history_to_messages(history)[-EXTRACT_HISTORY_MESSAGES:]:
        c = msg["content"]
        if msg["role"] == "assistant" and len(c) > EXTRACT_ASSISTANT_HEAD + EXTRACT_ASSISTANT_TAIL:
            msg = {**msg, "content": c[:EXTRACT_ASSISTANT_HEAD] + " … " + c[-EXTRACT_ASSISTANT_TAIL:]}
        out.append(msg)
    return out


# ── step ① extraction ───────────────────────────────────────────────────────────

# 결정변수를 '상식적으로 그럴 것 같다'고 채우면 판정이 사용자가 말한 적 없는 사실 위에
# 서게 되고, 같은 질문의 판정이 회차마다 뒤집힌다(실측: 부인↔조건부). 생략은 실패가 아니라
# 정상 경로다 — 파이프라인이 그 값을 사용자에게 되묻는다.
_EXTRACT_SYSTEM = (
    "당신은 개인·사업자 세무 상담(병의원 특화) 대화를 분석해, 질문 주제·검색 질의와 경비 판정 입력값을 "
    "추출하는 도구입니다.\n"
    "tax_topic·search_query·question_type·turn_kind 는 질문의 성격이므로 항상 채웁니다(search_query 는 대화 전체를 반영한 독립 질의 "
    "— 단 turn_kind 가 '다른 주제'면 이번 질문만으로). "
    "아래 규칙은 그 밖의 **판정 입력값**에 적용됩니다.\n"
    "규칙:\n"
    "1. 사용자가 대화에서 **명시적으로 말한 사실만** 채웁니다. 말하지 않은 필드는 반드시 생략하세요.\n"
    "2. 추측·추론·상식·일반적 관행으로 값을 채우는 것을 금지합니다. "
    "특히 적격증빙 보유(has_qualified_receipt), 사업자 명의(in_business_name), 업무사용비율(business_use_ratio), "
    "거래처 여부(상대방_거래처), 기록 보유(상대방_기록보유), 전직원 수혜(전직원_수혜), 사규 근거(사규근거), "
    "공식일정 증빙(공식일정증빙), 운행기록부 등 판정을 가르는 값은 "
    "사용자가 직접 언급하지 않았다면 **절대 채우지 마세요**.\n"
    "3. '보통 그렇다', '아마 있을 것이다' 같은 판단으로 true/false 를 넣지 마세요. 모르면 생략입니다.\n"
    "4. 필드를 생략하는 것은 올바른 동작입니다. 생략된 값은 시스템이 사용자에게 다시 물어봅니다.\n"
    # A1(10/13): solar-pro4 는 이 줄이 없으면 비경비 질문에서 도구를 안 부른다(데모 첫 턴 12/41) → 강제 재호출이 붙어
    # 턴당 2~4초. 이 줄로 3/41, 첫 추출 p90 4.8→1.7초, 결정변수 날조 0/41(같은 세트).
    "5. 이 도구는 매 메시지마다 **반드시 한 번 호출**합니다. 판정 입력값을 하나도 모르면 tax_topic·search_query 만 채워 호출하세요."
)


@lru_cache(maxsize=1)
def _non_expense_topics() -> frozenset[str]:
    from api.engine_adapter import EXPENSE_TOPICS, TAX_TOPICS
    return frozenset(t for t in TAX_TOPICS if t not in EXPENSE_TOPICS and t != "기타")


def _parse_extract_args(raw) -> dict | None:
    """도구 인자 문자열 → 추출 dict. solar 가 내는 비정상 모양을 결정적으로 바로잡는다(10/6 실측).

    · `{"properties": {...}}` 로 한 겹 싸서 보냄 — 안에 etype 이 있는데 못 읽던 것(시민 96회 중 6)
    · 도구 스키마를 그대로 베껴 보냄 — 값이 {"type":…,"description":…} 인 키는 값이 아니다
    · `amount: 0` — 금액을 말하지 않았을 때 넣는 자리표시다. 미확인으로 본다(0원 판정 방지)
    · null 값은 생략과 같다 — 생략 규칙(엔진 기본값)을 그대로 타게 지운다"""
    try:
        args = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(args, dict):
        return None
    inner = args.get("properties")
    if isinstance(inner, dict) and "etype" not in args:
        args = inner
    out = {k: v for k, v in args.items()
           if v is not None and not (isinstance(v, dict) and ("type" in v or "description" in v))}
    amount = out.get("amount")
    if isinstance(amount, (int, float)) and not isinstance(amount, bool) and amount <= 0:
        del out["amount"]
    return out


def _extract_call(messages: list[dict], tool: dict, tool_choice) -> dict | None:
    resp = bounded_client(TIMEOUT_EXTRACT).chat.completions.create(
        model=_chat_model(),
        messages=messages,
        tools=[tool],
        tool_choice=tool_choice,
        temperature=0,
    )
    choice = resp.choices[0].message
    if not getattr(choice, "tool_calls", None):
        return None
    return _parse_extract_args(choice.tool_calls[0].function.arguments)


def extract_engine_inputs(history: list, user_text: str, tool: dict) -> dict | None:
    """Run Solar with the extraction tool. Returns the parsed args dict, or None
    if Solar chose not to call the tool (insufficient info).

    자동 호출에서 etype 을 못 얻으면 도구 호출을 강제해 한 번 더 묻는다(10/6). solar 는 도구 대신
    산문으로 답해 버리곤 한다 — 시민 96회 중 20 · 병의원 110 중 15 · 판정형 차량 픽스처도. 그 턴은
    검색 전에 '지출 유형·금액'을 되묻는 엉뚱한 답이 됐다. 강제 호출은 말하지 않은 값까지
    false·0 으로 채우므로(실측) **etype 과 금액(0 초과)만** 가져온다 — 나머지 결정변수는
    생략 규칙 그대로(엔진 기본값 / 되묻기)."""
    messages = [{"role": "system", "content": _EXTRACT_SYSTEM}]
    messages += _history_for_extract(history)
    messages.append({"role": "user", "content": user_text})

    # A1(10/13): solar-pro4 는 이력이 있는 턴(되묻기에 대한 짧은 답 등)에서 자동 호출이 거의 항상 도구를 안 부르고
    # 산문을 쓴다(데모 2턴째 이후 14/16, 1.3~8.6초) — 그 뒤 강제 호출 값으로 진행하므로 자동 호출 시간은 그대로 낭비였다.
    # 이력이 있으면 곧바로 강제 호출(아래 병합 규칙 그대로: 화이트리스트 키만 · 결정변수는 verify_decisive 가 거른다).
    # 끄기: EXTRACT_FORCE_WITH_HISTORY=off.
    skip_auto = bool(history) and os.environ.get("EXTRACT_FORCE_WITH_HISTORY", "on") != "off"
    first = None if skip_auto else _extract_call(messages, tool, "auto")
    if first and first.get("etype") is not None:
        return first
    # 경비가 아닌 주제가 이미 잡혔으면 강제 재호출로 지출유형을 캐지 않는다 — 어차피 자문 경로다(R1-d, Solar 1회 절약).
    if first and first.get("tax_topic") in _non_expense_topics():
        first["etype"] = "기타"
        return first
    try:
        forced = _extract_call(messages, tool,
                               {"type": "function", "function": {"name": tool["function"]["name"]}})
    except Exception as exc:  # noqa: BLE001 — 재호출 실패는 첫 결과로 진행(지금 동작)
        log.warning("추출 강제 재호출 실패 — 첫 결과로 진행: %s", exc)
        return first
    if not forced or forced.get("etype") is None:
        return first
    merged = dict(first or {})
    merged["etype"] = forced["etype"]
    # 결정변수도 가져온다(R1-f, 10/10) — 되묻기에 대한 짧은 답("전 직원 다 대상이에요")은 자동 호출이 도구를 안 불러
    # 강제 호출에만 답이 담기는데, 버리면 그 답이 매번 사라져 상한 뒤 '요건 미충족'으로 가정됐다(E02·E03·E05 3턴 실측).
    # 강제 호출이 지어 채운 값은 판정 경로의 verify_decisive 가 떨어낸다(결정변수를 쓰는 곳은 그 경로뿐).
    # 프로필 값(biz_type·성실신고확인대상 등)은 검증 단계가 없어 계속 버린다.
    from api.engine_adapter import CALC_FIELDS, DECISIVE_FIELDS
    # 계산 슬롯(R2-c)도 같은 이유로 가져온다 — "부양가족 2명" 같은 짧은 답. 값은 calc.income_tax_extract 가 발화와 대조한다.
    for k in ("amount", "tax_topic", "search_query", "question_type", "turn_kind") + DECISIVE_FIELDS + CALC_FIELDS:
        if merged.get(k) is None and forced.get(k) is not None:
            merged[k] = forced[k]
    log.info("추출 강제 재호출로 etype 확보: %s (첫 호출 %s)", forced["etype"],
             "생략(이력 턴)" if skip_auto else "도구 안 부름" if first is None else "etype 없음")
    return merged


# ── step ④ segment writing ──────────────────────────────────────────────────────

def _emit_segments_tool() -> dict:
    return {
        "type": "function",
        "function": {
            "name": "emit_segments",
            "description": "세무 상담 답변을 문장 단위 세그먼트 배열로 출력한다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "segments": {
                        "type": "array",
                        "minItems": 1,
                        "items": {
                            "type": "object",
                            "properties": {
                                "text": {"type": "string", "description": "한 문장(자연어)."},
                                "type": {"type": "string", "enum": _SEGMENT_TYPES,
                                         "description": "세그먼트 유형(결정문 구조)."},
                                "framework": {"type": "string", "enum": _FRAMEWORKS,
                                              "description": "해석 프레임워크(해당 시에만)."},
                                "citations": {"type": "array", "items": {"type": "string"},
                                              "description": "법령·판례 인용(예: 소득세법 §35, 조심2025구1960)."},
                            },
                            "required": ["text", "type"],
                        },
                    }
                },
                "required": ["segments"],
            },
        },
    }


_WRITE_SYSTEM = (
    "당신은 한국 세무 전문가입니다. 규칙엔진이 내린 판정을 근거로, 병의원 원장에게 설명하는 "
    "논증을 문장 단위 세그먼트로 작성합니다. 규칙:\n"
    "1. 판정(인정/부인/안분/조건부)은 엔진이 이미 결정했습니다 — 절대 뒤집지 말고 그대로 설명하세요.\n"
    "2. 결론(conclusion) → 법리(rule_statement) → 적용(application) → 증빙요구(evidence_request) "
    "→ 단서(caveat) 흐름을 권장합니다.\n"
    "3. 법리·해석 문장에는 적절한 framework와 citations를 태깅하세요(근거 텍스트의 [ ] 인용 활용).\n"
    "4. 반드시 emit_segments 도구로만 출력하세요.\n"
    # P8 C(2026-09-18) — 접대비 한도액·비율을 근거 없이 회차마다 다르게 지어냈다(64회 중 23회).
    # 규칙만으론 잘 안 따라서 pipeline 이 numeric_guard 로 출력에서도 거른다.
    "5. 판정·근거·규범에 없는 수치(한도액·세율·비율·기한·연도)나 사용자가 말하지 않은 인원·금액을 "
    "새로 쓰지 마세요. 필요하면 '적용 한도는 세무사 확인이 필요합니다'처럼 수치 없이 쓰세요."
)


# ── L0 규범층 (KB통합 3층검색 로드맵 P1, 2026-09-16) ────────────────────────────
# 시스템 프롬프트 = 경로별 역할·출력 규칙(코드, 위 _WRITE_SYSTEM 등) + 공통 규범 블록.
# 규범은 load_norms() 경계 뒤에서만 온다 — 여기는 파일 위치도 저장소도 모른다.
# 로드 실패(None)면 규범 없이 현행 문안 그대로 = 규범 도입 전과 같은 프롬프트.
# 내부 용어 출력 금지(데모 로드맵 R1-b, 10/10) — 사용자는 '규칙엔진'이 뭔지 모른다. "이 사안은 규칙엔진의 판정
# 대상이 아닙니다"가 답의 79%에 붙어 "이 AI는 못 한다"는 인상을 줬다. 프롬프트 안의 지시어는 그대로 두고 출력만 막는다
# (뚫린 것은 pipeline._scrub_jargon 이 결정론으로 한 번 더 고친다).
_NO_JARGON = (
    "\n- 답변 문장에 '규칙엔진', '판정 대상', '지원 유형', '9개 유형' 같은 시스템 내부 용어를 쓰지 마세요. "
    "판정이 있으면 '판정 결과', 없으면 그냥 안내로 말하세요."
)


def _with_norms(base: str) -> str:
    from api.prompts import load_norms

    base = base + _NO_JARGON
    norms = load_norms()
    if not norms:
        return _with_agent(base)
    return _with_agent(
        f"{base}\n\n"
        "[공통 규범 — 답변 절차·해석 원칙·오류 패턴. 위 규칙과 부딪히면 위 규칙이 우선이며, "
        "판정은 어떤 경우에도 규칙엔진의 권위다]\n"
        f"{norms}"
    )


# 3자 방(0044) — 그 방 세무사가 스튜디오에 쓴 상담 원칙·확인 질문. api/room_agent.py 가 run_clinic 을 부르는 동안만
# 세팅한다(contextvar — 그 호출의 실행 문맥에만 보인다). 비어 있으면 모든 프롬프트가 종전과 바이트까지 같다.
# 10/4 결정: 원칙·되묻기 = 프롬프트, 사례 = RAG. 문장은 세무사 원문(D9).
AGENT_PRINCIPLES: ContextVar[str | None] = ContextVar("agent_principles", default=None)
AGENT_QUESTIONS: ContextVar[tuple[str, ...]] = ContextVar("agent_questions", default=())


def _with_agent(base: str) -> str:
    principles = AGENT_PRINCIPLES.get()
    if not principles:
        return base
    return (
        f"{base}\n\n"
        "[이 세무사의 상담 원칙 — 세무사가 직접 쓴 문장. 위 규칙·규칙엔진 판정·근거 규칙과 부딪히면 그것들이 "
        "우선입니다. 원칙에 없는 내용을 지어내 세무사의 뜻이라고 말하지 마세요]\n"
        f"{principles}"
    )


# 조건 붙은 법리(10/6) — 근거의 "미성년 자녀 증여재산공제 10년간 2,000만 원"이 나이를 말한 적 없는 사용자에게
# 그대로 적용됐다(C30, kb2 근거 · kb3 끔 3/3회). 수치가 근거에 있어 numeric_guard 로는 못 막는다.
# 이 문구는 코드 규칙이다 — 세무사 컨펌 대상인 규범 md(api/prompts/)에 넣지 않는다.
_CONDITION_RULE = (
    "\n- 근거의 법리가 특정 신분·조건(미성년자·법인·특정 업종·특정 기간 등)에만 적용되는 것이면, 사용자가 "
    "그 조건을 말하지 않은 한 사용자에게 해당하는 것처럼 쓰지 마세요. '~인 경우에는'처럼 조건을 밝혀 쓰거나, "
    "그 조건에 해당하는지 되물으세요."
)


# ── KB3 권위 층 (새RAG_KB3_구축설계 D5, 2026-10-05 제품 배선) ─────────────────────────
# 검색 근거를 한 목록으로 평평하게 붙이면 모델이 권위가 다른 층을 구분하지 못한다(로드맵 P4). 그래서 KB3 corpus 마다
# 블록을 가르고, 쓰는 규칙을 블록 뒤에 박는다. 서열(D5): 세무사 사례(kb3_expert) > 판례(kb3_prec) > 심판례(kb3_trib) >
# 국세청 해석(kb3_qna). 세무사 사례는 세무사가 쓴 사례지만 '검수'를 거친 선례가 아니다.
# 옛 층(검수 선례 = rag·kb2, 참고 사전 = kbdict)은 옛 검수 흐름 절단 S5(10/16)에서 검색 갈래와 함께 지웠다 — 운영은 10/6
# 부터 KB3 단독이라 그 블록·규칙이 프롬프트에 들어간 적이 없고, KB3 경로의 프롬프트는 지우기 전과 바이트까지 같다.
# 판례·질의회신 라벨 = design/KB3_요지수집_설계.md §10(사용자 9/27). 심판례 라벨은 10/5 새로.
KB3_LAYERS: list[tuple[str, str, str]] = [   # (corpus, 짧은 이름, 블록 머리)
    ("kb3_expert", "세무사 사례", "[세무사 사례 — 세무사가 등록한 사례 · 다른 질문자의 사안]"),
    ("kb3_prec", "판례", "[판례 요지 — 법원 판결 · 다른 사건]"),
    ("kb3_trib", "심판례", "[심판례 — 조세심판원 결정 · 다른 사건 · 결정유형(인용·기각 등)은 그 사건의 결론]"),
    ("kb3_qna", "국세청 해석", "[국세청 해석 — 질의회신 · 행정 해석이며 법원 판단과 다를 수 있음]"),
]
KB3_CORPORA = frozenset(c for c, _, _ in KB3_LAYERS)
# 서열·출처 문구는 **실제로 들어온 층만** 말한다(10/6 밤). 고정 문구로 전 층을 늘어놓으면 근거가 세무사 사례뿐일
# 때도 없는 층의 이름이 입력에 있어, solar 가 세무사 사례를 그 이름으로 불렀다(1/8 · 9ee428b 운영 확인 때도 1회).
# 프롬프트 지시로는 안 고쳐져서(두 번 확인) 없는 층의 이름을 입력에서 뺀다.
_KB3_SOURCE_EXAMPLES = (   # (corpus, 출처 밝히기 예시) — 세무사 확인이 아닌 층만
    ("kb3_trib", "'조세심판원은 유사 사건에서 ~로 결정했습니다'"),
    ("kb3_qna", "'국세청은 질의회신에서 ~로 해석했습니다'"),
)
_KB3_FIXED_RULES = (
    "- 사건번호·문서번호는 위 근거 본문에 실제로 적힌 것만 인용하세요.\n"
    # 쟁점 어긋남(10/6 진단) — 검색은 질문과 단어가 겹치는 다른 쟁점의 사건을 데려온다. C48(조사 연기)에
    # 들어온 5건이 전부 중지·가산세 감면 사건이었고, 답이 연기를 중지 조문(1/4회)·가산세 감면 조문(3/4회)으로
    # 설명하고 가산세 쪽으로 퍼졌다(4/4회). 문구에 시험 문항의 제도 이름은 일부러 넣지 않는다.
    "- 각 근거가 다루는 쟁점(심판례의 '쟁점' 줄, 질의회신의 제목)이 사용자 질문이 묻는 쟁점과 같은지 먼저 "
    "확인하세요. 쟁점이 다른 근거의 조문·결론은 사용자 질문의 답으로 쓰지 말고, 질문이 묻지 않은 쟁점으로 "
    "답을 넓히지 마세요.\n"
    "- 질문이 묻는 제도·절차를 직접 규정한 조문이 근거에 없으면, 이름이나 성격이 비슷한 다른 제도의 조문으로 "
    "대신 설명하지 마세요. 그 제도를 직접 다룬 자료가 부족하다고 밝히고, 확인이 필요한 사항을 되물으세요."
    + _CONDITION_RULE
)


def _present_layers(passages) -> list[str]:
    """들어온 근거 층의 짧은 이름, 서열 순 — 세무사 사례 > 판례 > 심판례 > 국세청 해석."""
    return [label for corpus, label, _ in KB3_LAYERS if any(getattr(p, "corpus", None) == corpus for p in passages)]


def _topic(names: list[str], every: str = "") -> str:
    """'A·B·C는 모두' / 'A는' — 받침에 맞춘 조사(해석 → 은)."""
    last = names[-1][-1]
    josa = "은" if (ord(last) - 0xAC00) % 28 else "는"
    return "·".join(names) + josa + (f" {every}" if every and len(names) > 1 else "")


def _kb3_grounding_rules(passages) -> str:
    names = _present_layers(passages)
    line1 = ("- 우선순위는 규칙엔진 판정 > " + " > ".join(names) + "입니다. 어떤 근거도 판정을 바꾸지 못합니다.")
    if len(names) > 1:
        line1 += " 근거끼리 충돌하면 앞선 근거를 우선하세요."
    lines = [line1]
    if names:
        lines.append(f"- {_topic(names, '모두')} **다른 사람의 사안**입니다. 거기 나오는 "
                     "인원·금액·연도·업종·명의 같은 사실관계를 사용자의 상황인 것처럼 옮겨 쓰지 마세요. 사용자의 사실은 "
                     "[사용자 질문]과 대화에 나온 것뿐입니다.")
    official = [n for n in ("판례", "심판례", "국세청 해석") if n in names]
    if official:
        present = {getattr(p, "corpus", None) for p in passages}
        examples = [ex for corpus, ex in _KB3_SOURCE_EXAMPLES if corpus in present] or \
                   ["'법원은 유사 사건에서 ~로 판단했습니다'"]
        line = (f"- {_topic(official)} 세무사가 확인한 내용이 아닙니다. {'이것들을' if len(official) > 1 else '이것을'} "
                f"근거로 '세무사들은 ~로 보았습니다'라고 쓰지 말고, {', '.join(examples)}처럼 출처를 밝혀 쓰세요.")
        if "심판례" in official:
            line += " 심판례의 결정유형(인용·기각 등)은 그 사건의 결론일 뿐 사용자 사안의 결론이 아닙니다."
        lines.append(line)
    return "[근거 사용 규칙]\n" + "\n".join(lines) + "\n" + _KB3_FIXED_RULES


def has_kb3(passages) -> bool:
    return any(getattr(p, "corpus", None) in KB3_CORPORA for p in passages or [])


def _grounding_block(passages) -> str:
    """검색 근거 → KB3 층별 라벨 블록 + 사용 규칙. 근거가 없으면 빈 문자열.

    passages: api.rag.retriever.Passage 목록(.content, .corpus) — Kb3Retriever 가 항상 corpus 를 싣는다.
    KB3 층이 아닌 corpus 는 블록에 넣지 않는다(옛 층은 절단 S5 에서 검색에서 빠졌다)."""
    blocks = []
    for name, _, header in KB3_LAYERS:
        layer = [p.content for p in passages if getattr(p, "corpus", None) == name]
        if layer:
            blocks.append(header + "\n" + "\n\n".join(f"- {c}" for c in layer))
    if not blocks:
        return ""
    return "\n\n".join(blocks) + "\n\n" + _kb3_grounding_rules(passages)


def write_segments(user_text: str, verdict_label: str, reason: str,
                   accepted_won: int, amount: int, evidences: list[str],
                   case_refs: list[str], passages: list | None = None,
                   law_block: str = "") -> list[dict]:
    """Solar writes argument segments grounded on the engine result. Returns
    a list of {text, type, framework?, citations?} dicts (ids assigned later).

    passages: 검색된 근거(Passage — KB3, 있으면). 판정은 못 뒤집고,
    법리 설명·인용을 풍부하게 하는 근거로만 쓴다(마스터 §2 — verdict 는 엔진 권위)."""
    rag_block = ""
    grounding_block = _grounding_block(passages or [])
    if grounding_block:
        rag_block = "\n" + grounding_block + "\n"
    grounding = (
        f"[사용자 질문]\n{user_text}\n\n"
        f"[규칙엔진 판정 — 권위 원천, 뒤집지 말 것]\n"
        f"- 판정: {verdict_label}\n"
        f"- 인정금액: {accepted_won:,} / {amount:,}원\n"
        f"- 근거: {reason}\n"
        f"- 필요증빙: {', '.join(evidences) if evidences else '없음'}\n"
        f"- 참고 판례: {', '.join(case_refs) if case_refs else '없음'}\n"
        f"{rag_block}\n"
        f"{law_block + chr(10) + chr(10) if law_block else ''}"
        "위 판정을 설명하는 세그먼트를 작성하세요. 검색 근거가 있으면 근거 사용 규칙에 따라 "
        "법리·인용에 반영하세요."
    )
    grounding = _with_room_style(grounding)
    resp = hedged_create(
        TIMEOUT_WRITE_SEGMENTS,
        model=_chat_model(),
        messages=[{"role": "system", "content": _with_norms(_WRITE_SYSTEM)},
                  {"role": "user", "content": grounding}],
        tools=[_emit_segments_tool()],
        tool_choice={"type": "function", "function": {"name": "emit_segments"}},
        temperature=0.3,
        max_tokens=write_max_tokens(),
    )
    tool_calls = getattr(resp.choices[0].message, "tool_calls", None)
    if not tool_calls:
        # fallback: single conclusion segment carrying the engine reason
        return [{"text": reason, "type": "conclusion"}]
    segs = parse_segments(tool_calls[0].function.arguments)
    return segs if segs else [{"text": reason, "type": "conclusion"}]


# ── 자문 경로 (엔진 규칙 밖 + RAG 지식) ────────────────────────────────────────
# 엔진 규칙은 9개 지출유형뿐이라 4대보험·세액공제·대손금 등은 판정할 수 없다. 예전엔
# 여기서 "미지원"만 안내하고 끝냈다 → 세무사 코멘트로 쌓은 KB 가 통째로 사장됐다.
# 이제 판정은 여전히 안 내리되(엔진 권위 — 마스터 §2), 검색된 근거(지금은 KB3)·현행 조문으로
# 자문을 준다. 이 경로가 "RAG 가 답할 수 있는 범위를 넓힌다"는 논지의 증거다.

# 자문에는 판정형 세그먼트(conclusion/application)를 허용하지 않는다. 판정처럼 읽히는
# 문장이 엔진 없이 나가는 순간 엔진 권위 원칙이 깨진다.
_ADVISORY_SEGMENT_TYPES = [
    "context", "issue_framing", "rule_statement", "evidence_request", "caveat", "follow_up",
]


def _emit_advisory_tool(kb3: bool = False, summary: bool = False, compare: bool = False) -> dict:
    # 결론 문단(answer_display.SUMMARY) — 'summary' 는 판정이 아니라 답 요약이다. conclusion/application 금지는 그대로.
    types = _ADVISORY_SEGMENT_TYPES + (["summary"] if summary else [])
    tool = {
        "type": "function",
        "function": {
            "name": "emit_segments",
            "description": "세무 자문(판정 아님)을 문장 단위 세그먼트 배열로 출력한다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "segments": {
                        "type": "array",
                        "minItems": 1,
                        "items": {
                            "type": "object",
                            "properties": {
                                "text": {"type": "string", "description": "한 문장(자연어)."},
                                "type": {"type": "string", "enum": types},
                                "framework": {"type": "string", "enum": _FRAMEWORKS},
                                # kb3=False 판 문구는 옛 층 이름이지만 LAW_ONLY 턴(근거 = 조문뿐)에 지금도 실려 나간다 —
                                # 바꾸면 답변 바이트가 달라지므로 재측정과 함께 고친다(절단 S5 메모).
                                "citations": {"type": "array", "items": {"type": "string"},
                                              "description": ("위 근거 블록에 실제로 등장한 법령·판례·사건번호·문서번호만."
                                                              if kb3 else
                                                              "검수 선례·참고 사전에 실제로 등장한 법령·판례만.")},
                            },
                            "required": ["text", "type"],
                        },
                    }
                },
                "required": ["segments"],
            },
        },
    }
    if compare:
        params = tool["function"]["parameters"]
        params["properties"]["compare"] = _COMPARE_PROP
        params["required"] = ["segments", "compare"]
    return tool


# 비교표 칸(B①, 10/15) — '차이' 질문에 Markdown 표를 세그먼트로 쓰라는 규칙(_COMPARE_TABLE_RULE)은 운영 X03 2회 모두 무시됐다(산문).
# 도구에 구조 칸을 주고 필수로 하면 채운다 — 표 조립은 코드(_compare_segment). 끄기 ADVISORY_COMPARE_FIELD=off(종전 규칙 문장).
_COMPARE_PROP = {
    "type": "object",
    "description": "두 제도·유형의 차이 비교표. 셀은 짧은 구(句), [관련 법령] 블록·근거 자료에 있는 내용만. 조문 번호는 셀에 쓰지 않는다.",
    "properties": {
        "columns": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 2,
                    "description": "비교하는 두 대상의 이름(예: '간이과세자', '일반과세자')."},
        "rows": {"type": "array", "minItems": 3, "maxItems": 6,
                 "items": {"type": "object",
                           "properties": {"item": {"type": "string", "description": "비교 항목(예: '적용 대상')."},
                                          "values": {"type": "array", "items": {"type": "string"},
                                                     "minItems": 2, "maxItems": 2}},
                           "required": ["item", "values"]}},
    },
    "required": ["columns", "rows"],
}


def compare_field_on(user_text: str) -> bool:
    from api import answer_display
    return (answer_display.TABLES and bool(_COMPARE_Q.search(user_text))
            and os.environ.get("ADVISORY_COMPARE_FIELD", "on") != "off")


# 셀 속 조문 인용 — 하나라도 블록 밖이면 인용 대조가 표 세그먼트째 뺀다(10/15 로컬 X05-3: 셀의 '부가가치세법 제37조'로 표가 사라짐).
# 셀에는 조문을 쓰지 않는다고 했지만 지키지 않아 코드로 지운다(근거는 표 앞뒤 문장·배지가 맡는다).
_CELL_CITE_PAREN = re.compile(r"\s*[(（][^()（）]*제\s?\d+\s?조[^()（）]*[)）]")
_CELL_CITE = re.compile(r"「?[가-힣 ]{0,20}(?:법|령|규칙)」?\s?(?:시행령\s?|시행규칙\s?)?제\s?\d+\s?조(?:의\s?\d+)?(?:\s?제?\d+\s?[항호])*"
                        r"(?:\s?[가-하]목)?\s?(?:에\s?따라|에\s?따른|에서|의)?\s?")


def _md(t) -> str:
    t = _CELL_CITE.sub("", _CELL_CITE_PAREN.sub("", str(t or "")))
    return re.sub(r"\s+", " ", t).replace("|", "\\|").strip(" ,·")


_DIFF_HEAD = re.compile(r"^\s*■\s*[^:：\n]{0,20}(?:차이|다른\s*점|비교)[^:：\n]{0,10}(?:[:：]|$)")
_ANY_HEAD = re.compile(r"^\s*(?:■|\d{1,2}[.)]\s)")


def _drop_diff_prose(segs: list[dict]) -> list[dict]:
    """표가 붙으면 '■ 차이: …' 산문(같은 내용)을 뺀다 — 머리+문장 한 세그먼트면 그것만, 머리만이면 다음 머리·번호 항목·되묻기 전까지
    (10/15 로컬 X03: 표 바로 뒤에 '■ 차이: 간이과세자는 …'으로 표를 다시 읽었다)."""
    out, skipping = [], False
    for s in segs:
        t = s.get("text") or ""
        if s.get("type") != "summary" and _DIFF_HEAD.match(t):
            skipping = not re.sub(r"^\s*■[^:：]*[:：]?", "", t).strip()     # 머리만이면 뒤 문장도
            log.info("비교표 — 차이 산문 제거: %r", t[:50])
            continue
        if skipping and not _ANY_HEAD.match(t) and s.get("type") not in ("follow_up", "summary"):
            continue
        skipping = False
        out.append(s)
    return out


def _compare_segment(arguments: str) -> dict | None:
    """도구 인자의 compare 칸 → Markdown 표 세그먼트 하나(형식이 어긋나면 None — 답은 표 없이 나간다)."""
    try:
        cmp = (json.loads(arguments) or {}).get("compare")
        cols = [_md(c) for c in cmp["columns"]][:2]
        rows = [(_md(r["item"]), [_md(v) for v in r["values"]][:2]) for r in cmp["rows"] if isinstance(r, dict)]
    except (json.JSONDecodeError, TypeError, KeyError, AttributeError):
        return None
    rows = [(k, v) for k, v in rows if k and len(v) == 2 and all(v)][:6]
    if len(cols) != 2 or not all(cols) or len(rows) < 2:
        return None
    lines = [f"| 구분 | {cols[0]} | {cols[1]} |", "| --- | --- | --- |"] + [f"| {k} | {a} | {b} |" for k, (a, b) in rows]
    return {"text": "\n".join(lines), "type": "rule_statement"}


# 근거가 KB3 일 때의 시스템 문구(_advisory_system_kb3) — 들어온 층 이름·어조 예시만 넣는다(10/6 밤, 없는 층 이름을
# 붙여 쓰는 문제). 판정 금지·날조 금지 규칙. KB3 이전의 '세무사 검수 코멘트' 판(_ADVISORY_SYSTEM)은 절단 S5 에서 지웠다.
_ADVISORY_TONE = {
    "세무사 사례": "'세무사 사례에서는 ~로 안내합니다'(세무사 사례)",
    "판례": "'법원은 유사 사건에서 ~로 판단했습니다'(판례)",
    "심판례": "'조세심판원은 유사 사건에서 ~로 결정했습니다'(심판례)",
    "국세청 해석": "'국세청은 질의회신에서 ~로 해석했습니다'(국세청 해석)",
}


# 사례 근거 없이 LLM3 가 고른 현행 조문만 있을 때(LAW_ONLY, 10/7). 조문이 정하는 일반 내용만 안내하고,
# 사용자 사안이 요건을 채우는지는 판단하지 않는다(사실 확인은 되묻기로).
_ADVISORY_SYSTEM_LAW_1013 = (
    "당신은 한국 세무 전문가입니다. 이 질문에는 **판정을 내리지 않고**, 질문을 직접 다룬 심판례·국세청 해석도 "
    "찾지 못했습니다. 주어진 근거는 [관련 법령] 블록의 **현행 조문 원문**뿐입니다. 규칙:\n"
    "1. 조문이 정하는 제도·요건·절차를 **일반론으로** 쉽게 풀어 안내하세요. 사용자의 사안이 요건을 채운다/못 채운다고 "
    "단정하지 말고, '~에 해당하면 ~할 수 있습니다', '~인지 확인이 필요합니다' 처럼 쓰세요.\n"
    "2. 조문 원문에 없는 요건·금액·기한·예외를 덧붙이지 마세요. 판례·해석·실무 관행을 아는 척하지 마세요.\n"
    "3. 조문만으로 답하기 어려운 부분은 솔직히 밝히고, 판단에 필요한 사실을 되물으세요.\n"
    "4. 반드시 emit_segments 도구로만 출력하세요."
)
# 결론 먼저(10/14) — 위 판 규칙 1("사안이 요건을 채운다고 단정하지 말 것")이 Q3 '제조업 = 배제 업종' 같은 조문 그대로의 결론까지
# 막았다. 사용자가 말한 업종·상황을 조문이 직접 정하면 그 결론은 말한다. 말하지 않은 사실만 조건부로.
_ADVISORY_SYSTEM_LAW = (
    "당신은 한국 세무 전문가입니다. 이 질문에는 **판정을 내리지 않고** 현행 법령으로 답합니다. 주어진 근거는 "
    "[관련 법령] 블록의 **현행 조문 원문**입니다. 규칙:\n"
    "1. 조문이 정하는 제도·요건·절차를 쉽게 풀어 안내하세요. 사용자가 말한 업종·상황을 조문이 직접 정하고 있으면 그 결론은 "
    "분명히 말하고, 사용자가 말하지 않은 사실이 요건을 채운다/못 채운다고는 단정하지 말고 '~이면 ~' 처럼 쓰세요.\n"
    "2. 조문 원문에 없는 요건·금액·기한·예외를 덧붙이지 마세요. 판례·해석·실무 관행을 아는 척하지 마세요.\n"
    "3. 조문만으로 답하기 어려운 부분은 솔직히 밝히고, 판단에 필요한 사실을 되물으세요.\n"
    "4. 반드시 emit_segments 도구로만 출력하세요."
)


def _advisory_system_kb3(passages) -> str:
    names = _present_layers(passages)
    tones = [_ADVISORY_TONE[n] for n in names if n in _ADVISORY_TONE]
    return (
        "당신은 한국 세무 전문가입니다. 이 질문에는 **판정을 내리지 않습니다**. "
        f"당신은 판정을 내리는 것이 아니라, 검색된 근거({'·'.join(names)})를 바탕으로 "
        "참고용 자문을 제공합니다. 규칙:\n"
        "1. **인정/부인/안분/조건부 같은 판정을 단언하지 마세요.** '~로 판단됩니다', '전액 인정됩니다' "
        f"같은 확정적 표현 금지. 대신 근거의 출처에 맞춰 {', '.join(tones + ['~인지에 따라 갈립니다'])} 처럼 "
        "자문 어조로 쓰세요.\n"
        "2. **주어진 근거 블록에 있는 내용만** 근거로 쓰세요. 거기에 없는 법령·판례·사건번호·수치를 "
        "지어내지 마세요. 아는 바가 부족하면 '확정적으로 말씀드리기 어렵다'고 하고, "
        "확인이 필요한 사항을 되물으세요.\n"
        "3. 근거가 사용자 질문과 어긋나면 억지로 끼워맞추지 말고, 관련 자료가 부족하다고 "
        "솔직히 밝히세요.\n"
        "4. 반드시 emit_segments 도구로만 출력하세요."
    )


# ── KB3 쟁점 적합성 게이트 (10/6) ─────────────────────────────────────────────────
# 프롬프트 규칙("쟁점이 다른 근거는 쓰지 말 것")만으로는 안 따랐다 — C48(조사 연기)에 중지·가산세 감면
# 사건만 들어오자, 규칙을 넣은 뒤에도 3/3회 연기를 다른 조문으로 설명했다. 그래서 근거를 모델에 주기 **전에**
# 거른다. 판정은 질문↔카드(제목·쟁점 줄)의 대조 한 번이고, 빼는 건 'different' 뿐이다.
ISSUE_FITS = ("same", "related", "different")
_ISSUE_FIT_SYSTEM = (
    "당신은 한국 세무 자료 분류기입니다. 사용자 질문이 묻는 쟁점(어떤 제도·절차·과세 문제인가)과 각 자료가 "
    "다루는 쟁점을 비교해 분류합니다.\n"
    "- same: 자료가 질문과 같은 제도·쟁점을 다룬다.\n"
    "- related: 자료의 주된 쟁점은 다르지만, 질문이 묻는 제도·쟁점에 대한 판단이나 해석이 자료에 들어 있다.\n"
    "- different: 자료는 다른 제도·쟁점을 다루고, 질문과는 단어나 상황만 겹친다.\n"
    "반드시 emit_issue_fit 도구로만, 모든 자료에 대해 출력하세요."
)


def _emit_issue_fit_tool(n: int) -> dict:
    return {
        "type": "function",
        "function": {
            "name": "emit_issue_fit",
            "description": "각 자료가 사용자 질문의 쟁점과 맞는지 분류한다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "items": {
                        "type": "array",
                        "minItems": n,
                        "items": {
                            "type": "object",
                            "properties": {
                                "n": {"type": "integer", "description": "자료 번호"},
                                "fit": {"type": "string", "enum": list(ISSUE_FITS)},
                            },
                            "required": ["n", "fit"],
                        },
                    }
                },
                "required": ["items"],
            },
        },
    }


_ISSUE_LINE = re.compile(r"^쟁점:\s*(.+)$", re.M)


def _issue_view(p) -> str:
    """판정 입력 — 카드 머리줄(종류·번호·제목) + 쟁점 줄(심판례) 또는 본문 앞부분(질의회신·판례).
    사실관계 앞부분을 더하거나 질문·자료의 제도 이름을 먼저 적게 해 봤지만(10/6) 경계 사례 판정이 회차마다
    뒤집혀서(temperature 0 에서도) 이 모양으로 돌아왔다 — 결과는 같은 입력에 3/3 같았다."""
    content = p.content or ""
    head, _, body = content.partition("\n")
    m = _ISSUE_LINE.search(body)
    return f"{head}\n쟁점: {m.group(1).strip()}" if m else f"{head}\n{body[:300]}"


def judge_issue_fit(user_text: str, passages: list) -> dict[str, str] | None:
    """KB3 근거 각각의 쟁점 적합성 {passage.id: same|related|different}. 실패면 None(호출자는 거르지 않는다).

    혼잡(UpstageCongested)은 다른 챗 호출과 같이 올려 보낸다 — 혼잡 안내가 맞는 응답이다."""
    if not passages:
        return {}
    listing = "\n\n".join(f"[자료 {i}]\n{_issue_view(p)}" for i, p in enumerate(passages, 1))
    try:
        resp = bounded_client(TIMEOUT_ISSUE_FIT, retries=0).chat.completions.create(
            model=_chat_model(),
            messages=[{"role": "system", "content": _ISSUE_FIT_SYSTEM},
                      {"role": "user", "content": f"[사용자 질문]\n{user_text}\n\n{listing}"}],
            tools=[_emit_issue_fit_tool(len(passages))],
            tool_choice={"type": "function", "function": {"name": "emit_issue_fit"}},
            temperature=0,
        )
        tool_calls = getattr(resp.choices[0].message, "tool_calls", None)
        if not tool_calls:
            return None
        items = json.loads(tool_calls[0].function.arguments).get("items") or []
        out = {}
        for it in items:
            i, fit = it.get("n"), it.get("fit")
            if isinstance(i, int) and 1 <= i <= len(passages) and fit in ISSUE_FITS:
                out[passages[i - 1].id] = fit
        return out or None
    except upstage_gate.UpstageCongested:
        raise
    except Exception as exc:  # noqa: BLE001 — 게이트는 부가 기능. 실패하면 지금 동작(안 거름)으로
        log.warning("쟁점 적합성 판정 실패 — 거르지 않고 진행: %s", exc)
        return None


# 근거 서열(R4 · A4, 세무사 피드백 Q4 10/10) — "법령이 우선(법이 그렇게 정해져 있으면 그것이 정답), 부족한 부분만 예규·판례가
# 뒷받침." 기준선(10/13 Pro 4)에서 자문 답 91턴 중 약 10턴이 질의회신·심판례를 첫 근거로 썼다(V01·T02·C04·G02). LLM3 가 조문을
# 골랐을 때만 붙인다 — 조문이 없으면 사례 자료가 첫 근거일 수밖에 없다.
_LAW_FIRST_RULE_1013 = (
    "\n[근거 서열 — 법령 > 심판례·판례 > 국세청 해석]\n"
    "- **첫 설명 문장은 [관련 법령] 블록의 조문으로 시작하세요**: '「법령 이름」 제N조는 ~라고 정하고 있습니다' + 쉬운 풀이. "
    "법령 이름을 빼지 마세요('제55조제1항'처럼 번호만 쓰지 말 것).\n"
    "{form}"
    "- 심판례·국세청 해석은 조문 설명 **뒤에**, 조문만으로 모자라거나 적용이 갈리는 지점을 보충할 때만, 질문과 쟁점이 같을 때만 "
    "쓰세요. 해석·판례를 정답처럼 앞세우지 마세요(해석은 법이 아닙니다).\n"
    "- 블록의 조문이 질문에 직접 답하지 못하면 그 점을 밝히고 사례 자료로 보충하세요.\n"
    # 운영 10/13: 이 규칙만 넣었더니 조문 설명이 앞에 붙고 해석 설명도 그대로라 작문 출력이 +11%(541→601토큰) — p50 8초를 넘겼다.
    "- 조문 설명을 앞에 두는 만큼 사례 자료 설명은 1~2문장으로 줄이세요. 답 전체는 6문장 안팎(번호 목록은 항목당 한 문장)."
)
# 결론 먼저(세무사 재평가 10/14 지적 1·3·4) — Q3 "제조업 창업, 간이과세 요건": 법령 선두 규칙이 §61 조문 나열로 시작해 결정적
# 답(제조업 = 배제 업종, 시행령 §109②2호)을 마지막 문장에 묻었다("오히려 퇴보"). 첫 문장은 사용자 사안에 대한 직답, 그다음이
# 조문. 근거 서열(법령 → 심판례 → 해석)은 그대로. 끄기 ADVISORY_CONCLUSION_FIRST=off → 10/13 규칙.
# 질문별 머리는 '■ ' — '①'은 요건 목록 마무리(pipeline._ITEM_MARK)가 번호 항목으로 읽는다.
_LAW_FIRST_RULE = (
    "\n[답 순서 — 결론 먼저 · 근거 서열 법령 > 심판례·판례 > 국세청 해석]\n"
    "- **첫 설명 문장 = 사용자 질문에 대한 직답(결론)**. 사용자가 말한 업종·상황을 [관련 법령] 블록 조문(시행령 포함)이 "
    "직접 정하고 있으면 그 결론을 근거 조문과 함께 먼저 쓰세요(예: '○○업은 「○○법 시행령」 제N조제2항제K호에 따라 ~에 "
    "해당해 원칙적으로 ~할 수 없습니다. 다만 ~는 예외입니다'). 이는 판정이 아니라 조문이 정한 내용을 밝히는 것입니다. "
    "사용자가 말하지 않은 사실(매출·사업장 수 등)은 단정하지 말고 '~이면 ~' 꼴로.\n"
    "- 질문이 둘 이상을 물으면(예: 차이 + 요건) 물은 것마다 나눠 답하세요. 각 부분 첫 세그먼트를 '■ 간이과세 가능 여부: ', "
    "'■ 차이: ' 처럼 '■ 물은 것: '으로 시작하고 그 부분의 결론부터 쓰세요. 사용자 사안의 결론(될 수 있나·해당하나)이 있으면 "
    "그 부분을 맨 앞에, 나머지는 물은 순서대로.\n"
    "- 결론 뒤 설명은 [관련 법령] 블록 조문으로: '「법령 이름」 제N조는 ~라고 정하고 있습니다' + 쉬운 풀이. "
    "법령 이름을 빼지 마세요('제55조제1항'처럼 번호만 쓰지 말 것).\n"
    "{form}"
    "- 심판례·국세청 해석은 조문만으로 모자라거나 적용이 갈리는 지점에서만, 질문과 쟁점이 같을 때만 1~2문장으로 쓰세요. "
    "조문으로 답이 끝나면 쓰지 마세요. 해석·판례를 정답처럼 앞세우지 말고, '심판례·해석을 찾지 못했다'는 말도 쓰지 마세요.\n"
    "- 블록의 조문이 질문에 직접 답하지 못하면 그 점을 밝히고 사례 자료로 보충하세요.\n"
    "- **같은 내용을 두 번 쓰지 마세요**: 번호 목록·세율 표로 보인 요건·구간·세율을 문장으로 다시 풀어 쓰지 마세요. "
    "조문에 [표]가 있는 세율 질문이면 결론 문장은 '○○세율은 「…」 제N조에 따라 과세표준 구간별 N단계 누진세율(최저 ~ 최고)입니다' "
    "한 문장만 — 구간별 금액은 시스템이 표로 붙입니다. 답 전체는 6문장 안팎(번호 목록은 항목당 한 문장)."
)
# 유형별 답변 형식(A3, 10/13 — 세무사 Q3·Q4 "요건은 호·목 번호로", "정의는 법령 → 풀이 → 관련 조문"). 질문 유형(A2)을 알면 그 형식
# 한 줄만, 모르면 종전의 두 형식 안내를 넣는다 — 작문 지시가 길어지지 않게(10/13 실측: 규칙 한 줄이 출력 +11%).
_FORM_RULES = {
    "요건": ("- [형식 — 요건 목록] 조문 소개 한 문장 뒤, 요건을 조문의 호·목 순서대로 **세그먼트 하나에 요건 하나씩** "
             "'1. ', '2. ' 번호로 시작해 쓰고, 각 항목 끝 괄호에 근거 조문을 호까지 적으세요(예: '(「○○법」 제N조제1항제2호)'). "
             "항목은 2~6개, 항목당 한 문장. 블록 조문에 호·목이 없으면 조문 문장을 요건 단위로 나눠 번호를 붙이세요. "
             "질문이 차이·절차 등을 함께 물어도 요건 부분은 반드시 이 번호 목록으로 쓰고, 나머지는 목록 뒤 1~2문장으로.\n"),
    "법령 정의": ("- [형식 — 정의] ① 첫 설명 = 조문의 정의('「○○법」 제N조는 ○○을 ~라고 정하고 있습니다') ② 쉬운 풀이 1~2문장 "
                  "③ '관련 조문: 「○○법」 제N조(제목), …' 한 문장 — [관련 법령] 블록에 있는 다른 조문만 ④ 보충은 그 뒤 1~2문장.\n"),
}
# 정의 깊이(세무사 Q4 10/14 "익금 진입로까지만") — 블록에 위임 시행령·제외 조문이 함께 실린다(pipeline._law_deep). 정의 → 범위 → 제외.
_FORM_RULES_DEEP = {
    "요건": ("- [형식 — 요건 목록] 결론 문장 뒤, 요건을 조문의 호·목 순서대로 **세그먼트 하나에 요건 하나씩** "
             "'1. ', '2. ' 번호로 시작해 쓰고, 각 항목 끝 괄호에 근거 조문을 호까지 적으세요(예: '(「○○법」 제N조제1항제2호)'). "
             "항목은 2~6개, 항목당 한 문장. 시행령이 법률의 '대통령령으로 정하는' 부분을 채우면 그 내용을 해당 항목에 쓰세요. "
             "질문이 차이·절차 등을 함께 물어도 요건 부분은 반드시 이 번호 목록으로 쓰고, 나머지는 그 부분 1~2문장으로.\n"),
    "법령 정의": ("- [형식 — 정의] ① 첫 설명 = 조문의 정의('「○○법」 제N조는 ○○을 ~라고 정하고 있습니다') ② 쉬운 풀이 1문장 "
                  "③ 범위: 블록의 시행령 등이 정한 구체 범위(무엇이 포함되는지 주요 항목)를 조문 이름과 함께 1~2문장 "
                  "④ 제외: 블록에 익금불산입·손금불산입 같은 제외 조문이 있으면 1문장 "
                  "⑤ '관련 조문: 「○○법」 제N조(제목), …' 한 문장 — 블록에 있는 다른 조문만. 정의 답은 8문장 안팎.\n"),
}
_FORM_DEFAULT = ("- 질문이 요건·자격을 물으면 조문의 호·목에 따라 요건을 번호(1. 2. 3.)로 나눠 한 문장씩 쓰세요. 정의·개념을 물으면 "
                 "조문의 정의 → 구성요소 풀이 → 관련 조문 순서로 쓰세요.\n")


# 답 표시 방식(answer_display, 10/14 팀 피드백 — 산문 + 표 + 결론 문단). 결론 문단은 같은 작문 호출 안에서 쓴다.
_SUMMARY_RULE = {
    # 10/14 운영 b1: 결론 문단이 작문 출력 +63토큰(+0.8s) → p50 10.1s. 결론 문단이 첫 설명을 대신하므로 문장 예산 안에서 쓰게 한다.
    "top": ("\n[결론 문단] 첫 세그먼트는 type=summary 하나: 질문 전체에 대한 결론을 1~2문장으로(근거 조문 이름 포함, 질문이 "
            "둘이면 둘 다 한 문장씩). 판정을 단언하지 말고 조문이 정한 결론을 쓰세요. 결론 문단이 첫 설명 문장을 대신합니다 — "
            "그 뒤 설명은 결론을 되풀이하지 말고 근거 조문·조건으로 시작하고, 결론 문단을 포함해 답 전체 문장 수 예산을 지키세요. "
            "summary 는 이 한 개뿐."),
    "bottom": ("\n[결론 문단] 되묻기 앞 마지막 설명 세그먼트는 type=summary 하나: 답 전체의 핵심을 1~2문장으로 정리하세요. "
               "앞 문장을 그대로 되풀이하지 말고 새 숫자·새 조문을 넣지 마세요. summary 는 이 한 개뿐."),
}
_COMPARE_TABLE_RULE = (
    "\n[비교표] 질문이 두 제도·유형의 차이를 물으면, 차이 부분은 Markdown 표 하나를 세그먼트 하나에 통째로 쓰세요"
    "(머리줄 '| 구분 | ○○ | ○○ |', 둘째 줄 '| --- | --- | --- |', 행 3~6개, 셀은 짧게 — [관련 법령] 블록에 있는 내용만). "
    "표 뒤에 같은 내용을 문장으로 다시 쓰지 마세요."
)
_COMPARE_Q = re.compile(r"차이|다른\s*점|비교|vs|VS|어느\s*쪽")
# 구조 칸 판(B①·②, 10/15) — 차이는 표 칸이 맡으므로 결론 문단은 사용자 사정에 대한 결론부터(운영 X05-3 2회 모두 결론 문단이
# '차이'부터 써서 '제조업 = 간이과세 배제'가 결론 문단에 없었다).
_COMPARE_FIELD_RULE = (
    "\n[비교표] 질문이 두 제도·유형의 차이를 물으면 차이는 도구의 compare 칸에 쓰세요(두 대상 이름, 비교 항목 3~6행, 셀은 "
    "짧은 구 — [관련 법령] 블록·근거 자료에 있는 내용만). 시스템이 표로 그려 붙이니 세그먼트에는 차이를 문장으로 다시 쓰지 "
    "마세요. **결론 문단(또는 첫 설명 문장)은 차이를 요약하지 말고, 사용자가 밝힌 사정(업종·상황 등)이 물은 요건·적용에 "
    "해당하는지에 대한 결론부터** 쓰세요."
)

# 복합 사안(E단계 골격, 10/15 — design/E단계_주식양도_복합사안_설계_1014.md §2-2). 세금이 둘 이상 걸린 사례 판단 질문(세무사 10/14
# 캡처: 비상장주식 아들 저가양도 = 양도세 부당행위 + 증여 §35)에 '결론 문단 → 세목·납세자별 → 확인할 점 → 검토할 대안'.
# 10/15 로컬 기준선: 문단 4개짜리 산문, 결론 문단은 조문을 잘못 붙여(같은 법 시행령 §167 을 상증법으로) 통째로 빠졌다 — 결론 문단엔
# 조문 번호를 쓰지 않게 한다. 확인할 점·대안은 블록 조문 근거만(사용자 결정 10/14). 세액은 계산기 전이라 쓰지 않는다 — 세무사 확인
# 문장은 pipeline 이 결정론으로 붙인다. 끄기 ADVISORY_COMPOUND=off.
def _compound_rule(summary: bool) -> str:
    first = ("첫 세그먼트는 type=summary 하나" if summary else "첫 설명 세그먼트")
    return (
        "\n[답 형식 — 세금이 둘 이상 걸린 사안 · 근거 서열 법령 > 심판례·판례 > 국세청 해석]\n"
        "- **세그먼트 하나 = 한 문장(100자 안팎)**. 조문을 길게 옮겨 적지 말고 이 사안에 필요한 기준만 쉬운 말로.\n"
        f"- {first}: 이 거래로 누가 어떤 세금 문제를 지는지 1~2문장. 납세자는 조문이 정한 납세의무자로 쓰고(값을 치르는 쪽이 "
        "아니라), 조문 번호와 새 금액은 쓰지 마세요.\n"
        "- 다음 세그먼트는 '가정: '으로 시작하는 한 문장 — 사용자가 말하지 않았는데 이 답이 전제한 사실(예: 특수관계인 해당 여부, "
        "시가가 세법상 평가액인지).\n"
        "- 이어서 세목마다: 머리 세그먼트 '■ ○○세(납세자)' (그 말만, 문장 아님) → 이 사안에 적용되는지 + 근거 조문 한 문장 → "
        "1~2문장에 [관련 법령] 블록 원문에 있는 기준·세율·계산 방식·신고 기한만(없으면 생략 — '블록에 없다'고 말하지 마세요). "
        "**세액은 계산하지 마세요.**\n"
        "- 그다음 반드시 '■ 확인할 점' 세그먼트 하나, 이어서 '1. ', '2. ' 번호 항목 2~4개(세그먼트 하나에 항목 하나, 항목 끝 "
        "괄호에 근거 조문) — 블록 조문에 근거가 있는 확인 사항만.\n"
        "- 블록 조문에 이 거래를 달리 할 방법·특례가 실제로 있을 때만 마지막에 '■ 검토할 대안: '으로 1문장(근거 조문과 함께). "
        "없으면 이 부분을 아예 쓰지 마세요('대안이 없다'고도 쓰지 말 것). 블록 밖 제도·일반 지식·관행은 쓰지 마세요.\n"
        "- 조문은 매번 법령 이름과 함께('같은 법' 금지). 블록에 실린 조문만 번호로 쓰고, 블록 조문 원문 속에 이름만 나오는 다른 "
        "조문(예: '제60조부터 제66조까지')은 번호로 쓰지 마세요 — 그런 문장은 화면에서 지워집니다('시가 평가 규정'처럼 말로). "
        "심판례·해석은 해당 세목 부분에 1문장까지만. 답 전체 10~12문장."
    )


def _display_rules(user_text: str, compound: bool = False) -> str:
    from api import answer_display
    compare = (_COMPARE_FIELD_RULE if compare_field_on(user_text) else _COMPARE_TABLE_RULE) \
        if answer_display.TABLES and _COMPARE_Q.search(user_text) else ""
    if compound:                # 결론 문단·문장 예산은 복합 사안 형식(_compound_rule)이 정한다
        return compare
    rules = _SUMMARY_RULE.get(answer_display.SUMMARY, "")
    if rules:
        rules += "\n- 답 전체(결론 문단 포함)는 5~6문장 안팎(번호 목록·표는 항목당 한 문장으로 셈)."
    return rules + compare


def conclusion_first() -> bool:
    return os.environ.get("ADVISORY_CONCLUSION_FIRST", "on") != "off"


def _law_first_rule(qtype: str | None) -> str:
    new = conclusion_first()
    rules = _FORM_RULES_DEEP if new else _FORM_RULES
    if qtype in rules:
        form = rules[qtype]
    elif qtype in (None, "기타"):
        form = _FORM_DEFAULT
    else:
        form = ""          # 계산·사례 판단·절차 — 목록·정의 형식이 해당 없다
    return (_LAW_FIRST_RULE if new else _LAW_FIRST_RULE_1013).replace("{form}", form)


def write_advisory(history: list, user_text: str, etype: str | None,
                   passages: list, law_block: str = "", law_first: bool = False,
                   qtype: str | None = None, compound: bool = False,
                   heads: list[str] | None = None) -> list[dict]:
    """엔진 규칙 밖 질문에 대해, 검색된 근거(KB3)·현행 조문으로 **판정 없는** 자문 세그먼트를 쓴다.

    호출 전제: passages 가 비어 있지 않다(비면 pipeline 이 기존 '미지원' 안내로 떨어진다).
    compound: 세금이 둘 이상 걸린 사안(pipeline._compound_case) — 조문이 있을 때만 복합 사안 형식으로 쓴다.
    heads: 복합 사안에서 블록에 조문이 실린 세목(law_select.issue_heads) — 이 세목 머리는 빠뜨리지 않게 지시한다(최소 목록).
    반환: [{text, type, framework?, citations?}] — 판정형 type 은 도구 enum 에서 원천 차단.
    """
    grounding = (
        f"[사용자 질문]\n{user_text}\n\n"
        f"[상태] 판정 없이 자문으로 답합니다(판정 금지).\n\n"
        f"{_grounding_block(passages)}\n\n"
        f"{law_block + chr(10) + chr(10) if law_block else ''}"
        "위 근거에 기대어, 판정이 아닌 **자문**을 작성하세요. "
        "지식이 부족한 부분은 솔직히 밝히고, 필요한 확인 사항을 되물으세요."
    )
    kb3 = has_kb3(passages)
    law_only = not passages and bool(law_block)
    law_system = _ADVISORY_SYSTEM_LAW if conclusion_first() else _ADVISORY_SYSTEM_LAW_1013
    system = law_system if law_only else _advisory_system_kb3(passages)
    compound = compound and law_first
    if compound:
        system += _compound_rule(answer_display.summary_on())
        grounding += ("\n순서: 결론 문단 → '가정: ' → 세목마다 '■ ○○세(납세자)' 머리 + 1~3문장 → '■ 확인할 점' 번호 항목 → (블록에 근거가 "
                      "있을 때만) '■ 검토할 대안: '. 세액은 계산하지 마세요.")
        if heads:
            # 10/16 C1: 증권거래세법 §8·§7·§10 이 블록에 있어도 ■ 증권거래세 머리를 안 썼다 — 판별된 세목을 코드로 넘긴다
            grounding += ("\n다룰 세목(블록에 조문이 실린 것 — 아래 세목은 각각 '■ ○○세(납세자)' 머리로 빠짐없이 쓰고, 이 밖에 "
                          f"질문에 걸린 세목이 있으면 더 쓰세요): {' · '.join(heads)}")
    elif law_first and os.environ.get("ADVISORY_LAW_FIRST", "on") != "off":   # 끄기 = 10/13 이전 작문 규칙
        system += _law_first_rule(qtype if os.environ.get("ADVISORY_QTYPE_FORM", "on") != "off" else None)
        if conclusion_first():
            # 대화가 길면 시스템 규칙보다 앞선 답의 모양을 따랐다(10/14 로컬 X05 3턴째 — 결론 없이 요건부터). 끝에 한 줄로 다시.
            first = ("첫 세그먼트는 type=summary 결론 문단(1~2문장, 근거 조문과 함께)"
                     if answer_display.SUMMARY == "top" else "첫 설명 문장은 사용자 사안에 대한 결론(근거 조문과 함께)")
            if compare_field_on(user_text):
                # 10/15 로컬 X05-3: 시스템 규칙만으로는 4턴째 대화에서 결론 문단이 또 '차이'부터였다 — 끝 줄에서 다시
                first += (" — 결론 문단은 차이 요약이 아니라 사용자가 밝힌 사정(업종·상황)이 물은 요건에 해당하는지부터 "
                          "(차이는 compare 칸에만)")
            grounding += (f"\n순서: {first}. 물은 것이 둘 이상이면 '■ 물은 것: '으로 "
                          "나눠 각각 결론부터. 번호 목록은 한 번만, 목록·표 내용을 문장으로 다시 쓰지 마세요.")
    system += _display_rules(user_text, compound)
    messages = [{"role": "system", "content": _with_norms(system)}]
    messages += _history_to_messages(history)
    messages.append({"role": "user", "content": _with_room_style(grounding)})

    fallback_text = ("관련 법령을 바탕으로 세무사와 확인해 보시기 바랍니다." if law_only else
                     "관련 심판례·국세청 해석 등 참고 자료를 바탕으로 세무사와 확인해 보시기 바랍니다.")
    fallback = [{"text": fallback_text, "type": "caveat"}]
    compare = compare_field_on(user_text)
    try:
        resp = hedged_create(
            TIMEOUT_WRITE_ADVISORY,
            model=_chat_model(),
            messages=messages,
            tools=[_emit_advisory_tool(kb3, summary=answer_display.summary_on(), compare=compare)],
            tool_choice={"type": "function", "function": {"name": "emit_segments"}},
            temperature=0.3,
            max_tokens=write_max_tokens(),
        )
        tool_calls = getattr(resp.choices[0].message, "tool_calls", None)
        if not tool_calls:
            return fallback
        segs = parse_segments(tool_calls[0].function.arguments) or fallback
        table = _compare_segment(tool_calls[0].function.arguments) if compare else None
        if compare:
            log.info("비교표 칸: %s", "표 조립" if table else "비었거나 형식 어긋남")
        if table and segs is not fallback:
            # 결론 문단 앞 '■ 간이과세 가능 여부: ' 머리(10/15 로컬 X03)는 뗀다 — 결론 문단은 진하게 따로 그려진다
            segs = [{**s, "text": re.sub(r"^\s*■[^:：\n]{0,25}[:：]\s*", "", s.get("text") or "")}
                    if s.get("type") == "summary" else s for s in _drop_diff_prose(segs)]
            at = next((i for i, s in enumerate(segs) if s.get("type") != "summary"), len(segs))
            segs = segs[:at] + [table] + segs[at:]      # 결론 문단 바로 뒤
        return segs
    except upstage_gate.UpstageCongested:
        raise   # 혼잡은 폴백 문안으로 가리지 않는다 — main.chat 이 혼잡 안내로 바꾼다
    except Exception:  # noqa: BLE001 — 자문은 부가 기능. 실패해도 미지원 안내는 나가야 한다.
        return fallback


# ── 듣기 응답 (데모 로드맵 R1-c, 10/10 · 결정 D-1) ─────────────────────────────────
# 근거(KB3·조문)가 하나도 없을 때. 예전엔 고정 문장으로 "판정 지원 9개 유형 중 하나로 다시 설명해 달라"고 했다 —
# '모른다'를 '질문을 잘못했다'로 말한 셈이다. 이제 ① 이해한 상황을 되짚고 ② 숫자 없이 일반 확인 포인트 ③ 쟁점을
# 특정할 질문 1개. "법령 조문을 특정하지 못한 일반 안내" 라벨·세무사 연결 제안은 pipeline 이 결정론으로 붙인다.
_LISTENING_SYSTEM = (
    "당신은 한국 세무 상담사입니다. 이 질문을 직접 다룬 법령 조문·사례 자료를 찾지 못했습니다. 그래도 질문을 "
    "잘 들었다는 것이 전해지게 답하세요. 규칙:\n"
    "1. 첫 문장(type=context): 사용자의 질문을 한 문장으로 되짚으세요. 예) '월급에서 세금이 얼마나 빠지는지 "
    "궁금하신 거죠.' 이 규칙 문장을 그대로 옮겨 쓰지 마세요.\n"
    "2. 이어서 2~3문장(type=issue_framing 또는 rule_statement): 이런 질문에서 보통 무엇이 결론을 가르는지 "
    "확인 포인트를 일반론으로 안내하세요. 결론을 단정하지 마세요.\n"
    "3. **숫자(금액·세율·한도·비율·기한·연도·조문 번호)를 쓰지 마세요.** 법령·판례·사건번호도 인용하지 마세요.\n"
    "4. 마지막 문장(type=follow_up): 쟁점을 특정하는 데 가장 도움이 되는 질문 **하나만** 하세요.\n"
    "5. 사용자에게 질문을 다시 설명해 달라거나 정해진 유형 중에서 고르라고 하지 마세요.\n"
    "6. 반드시 emit_segments 도구로만 출력하세요."
)


# 세금과 무관한 질문·서비스 문의(OFF_TOPIC). 검색 없이 무엇을 도울 수 있는지 소개 + 세무 고민 하나 묻기.
_OFF_TOPIC_SYSTEM = (
    "당신은 개인·사업자 세금 상담 AI입니다. 사용자가 세금과 무관한 것을 묻거나 이 서비스가 무엇을 하는지 물었습니다. 규칙:\n"
    "1. 세금과 무관한 질문이면 그 내용에는 답하지 말고, 세금 상담을 돕는 AI라 그 질문엔 답하기 어렵다고 한 문장으로 "
    "부드럽게 말하세요(type=context).\n"
    "2. 도울 수 있는 일을 짧게 소개하세요(type=context): 근로소득세·연말정산·종합소득세·부가가치세·양도소득세·상속·증여 "
    "같은 세금 질문, 병의원 경비 처리 판단, 관련 법령·국세청 해석 근거 안내, 필요하면 세무사 연결.\n"
    "3. 마지막 문장(type=follow_up): 지금 어떤 세금 고민이 있는지 하나 물으세요.\n"
    "4. 숫자·조문 번호를 쓰지 마세요. 반드시 emit_segments 도구로만 출력하세요.\n"
    "5. 앞선 대화가 있으면 인사하거나 처음부터 소개를 반복하지 말고, 앞선 대화에서 이어지게 쓰세요."
)


def write_listening(history: list, user_text: str, topic: str | None = None,
                    off_topic: bool = False) -> list[dict]:
    """근거 0건 갈래의 듣기 응답 세그먼트(off_topic 이면 서비스 소개). 실패하면 결정론 문장 하나."""
    system = _OFF_TOPIC_SYSTEM if off_topic else _LISTENING_SYSTEM
    messages = [{"role": "system", "content": _with_norms(system)}]
    messages += _history_to_messages(history)
    hint = f"\n\n[질문 주제 추정: {topic}]" if topic and topic != "기타" and not off_topic else ""
    messages.append({"role": "user", "content": f"{user_text}{hint}"})
    fallback = [{"text": ("저는 세금 상담을 돕는 AI예요. 근로소득세·연말정산·부가세·양도·상속증여나 병의원 경비 처리처럼 "
                          "세금 고민을 말씀해 주시면 관련 법령과 국세청 해석을 바탕으로 안내해 드릴게요. 어떤 점이 궁금하신가요?"
                          if off_topic else
                          "상황을 조금 더 알려주시면 어떤 점을 확인해야 하는지 함께 짚어 드릴게요. "
                          "어떤 거래나 소득에 관한 질문인지, 언제 있었던 일인지 알려주시겠어요?"),
                 "type": "follow_up"}]
    try:
        resp = hedged_create(
            TIMEOUT_WRITE_ADVISORY,
            model=_chat_model(),
            messages=messages,
            tools=[_emit_advisory_tool(False)],
            tool_choice={"type": "function", "function": {"name": "emit_segments"}},
            temperature=0.3,
            max_tokens=write_max_tokens(),
        )
        tool_calls = getattr(resp.choices[0].message, "tool_calls", None)
        if not tool_calls:
            return fallback
        return parse_segments(tool_calls[0].function.arguments) or fallback
    except upstage_gate.UpstageCongested:
        raise
    except Exception:  # noqa: BLE001 — 듣기 응답 실패해도 질문 한 줄은 나가야 한다
        return fallback


# 근로소득세 계산 갈래(R2-c, 10/10) — 계산은 코드(calc.income_tax)가 끝냈다. Solar 는 결과의 의미를 1~2문장으로만.
# 결론 문장·단계표·가정 문장·질문은 pipeline 이 결정론으로 붙인다(Solar 가 숫자를 새로 만들 자리를 두지 않는다).
_CALC_SYSTEM = (
    "당신은 한국 세무 상담사입니다. 사용자의 근로소득세를 시스템이 법령대로 이미 계산했습니다. [계산 결과]가 권위이며, "
    "결론 문장·계산 단계표·가정·추가 질문은 시스템이 따로 붙입니다. 규칙:\n"
    "1. 사용자의 질문 맥락에 맞춰 계산 결과가 무엇을 뜻하는지 1~2문장(type=application)으로 설명하세요. 예) 월급에서 "
    "매달 떼는 원천징수와 연말정산의 관계, 실제로 내는 세금이 왜 산출세액보다 적은지, 연봉이 오르면 어느 부분이 늘어나는지.\n"
    "2. **숫자를 하나도 쓰지 마세요**(금액·세율·공제액·기한·연도·조문 번호 모두). 금액과 단계는 시스템이 표로 보여 줍니다.\n"
    "3. 계산 단계를 순서대로 다시 풀어 쓰지 마세요. 질문을 하지 마세요.\n"
    "4. 반드시 emit_segments 도구로만 출력하세요."
)


def write_calc(history: list, user_text: str, trace_text: str) -> list[dict]:
    """계산 갈래 해설 1~2문장. 실패하면 빈 목록(결정론 문장만으로 답이 성립한다)."""
    messages = [{"role": "system", "content": _with_norms(_CALC_SYSTEM)}]
    messages += _history_to_messages(history)
    messages.append({"role": "user", "content": f"{user_text}\n\n[계산 결과]\n{trace_text}"})
    try:
        resp = hedged_create(
            TIMEOUT_WRITE_ADVISORY,
            model=_chat_model(),
            messages=messages,
            tools=[_emit_advisory_tool(False)],
            tool_choice={"type": "function", "function": {"name": "emit_segments"}},
            temperature=0.3,
            max_tokens=write_max_tokens(),
        )
        tool_calls = getattr(resp.choices[0].message, "tool_calls", None)
        if not tool_calls:
            return []
        return (parse_segments(tool_calls[0].function.arguments) or [])[:2]
    except upstage_gate.UpstageCongested:
        raise
    except Exception as exc:  # noqa: BLE001 — 해설은 부가 문장
        log.warning("계산 해설 작문 실패 — 결정론 문장만: %s", exc)
        return []


FIELD_HINT = {
    "etype": "어떤 종류의 지출인지(차량·접대·통신·복리후생 등)",
    "amount": "지출 금액",
    # 판정 결정변수 — 엔진 분기에 직접 쓰이므로 추측 없이 반드시 확인해야 한다(되묻기·근거 검증이 함께 쓴다).
    "has_qualified_receipt": "적격증빙(세금계산서·계산서·신용카드·현금영수증) 보유 여부",
    "in_business_name": "사업자 명의로 지출했는지 여부",
    "business_use_ratio": "업무사용비율(예: 70%처럼 입증 가능한 비율)",
    "승용차특례대상": "차량이 업무용승용차 특례 대상인지(경차·화물차·9인승↑이면 비대상)",
    "업무전용보험": "업무전용자동차보험 가입 여부",
    "운행기록부": "운행기록부 작성 여부",
    "상대방_거래처": "접대 상대방이 사업 관련 거래처인지 여부",
    "상대방_기록보유": "접대 상대방·목적 기록을 보유하고 있는지 여부",
    "불특정다수": "불특정 다수를 대상으로 한 지출인지 여부",
    "인당금액": "1인당 금액(원)",
    "전직원_수혜": "전 직원이 대상인지 여부(원장 단독 아님)",
    "사규근거": "사내 복리후생 규정에 근거가 있는지 여부",
    "공식일정증빙": "학회·세미나 등록증 등 공식 일정 증빙 보유 여부",
    "동반가족": "출장에 가족이 동반했는지 여부",
    "별도사업장등록": "자택과 분리된 별도 사업장이 있는지 여부",
}


def _quoted_fields(items: list, fields: list[str], history: list, user_text: str) -> list[str]:
    """검증관이 댄 인용이 사용자 발화에 실제로 있는 필드만(R1-f, 10/10). 검증관도 날조 값을 '말했다'고 통과시켰다
    — '80만원이요' 한 마디 뒤에 접대 기록 보유·적격증빙을 근거 있음으로 보고(로컬 실측), 판정이 가정 없이 났다.
    인용 대조는 공백만 무시한다. 옛 모양(필드 이름 문자열)이 오면 인용이 없으니 통과시키지 않는다."""
    said = re.sub(r"\s+", "", " ".join([user_text] + [s.text for m in history if m.role == "user"
                                                     for s in m.segments]))
    out = []
    for it in items:
        if not isinstance(it, dict) or it.get("field") not in fields:
            continue
        quote = re.sub(r"\s+", "", str(it.get("quote") or ""))
        if quote and quote in said:
            out.append(it["field"])
    return list(dict.fromkeys(out))


# 업무사용비율은 말한 모양이 정해져 있어 코드로도 확인한다 — 검증관이 '업무에만 써요'를 사업자 명의의 근거로 붙이고
# 비율은 빠뜨렸다(운영 E04 2턴, 10/10). 값 자체는 추출기 것을 쓴다(여기선 '말했는가'만 본다).
_RATIO_SAID = re.compile(r"\d+(?:\.\d+)?\s*(?:%|퍼센트|프로)|업무(?:에|용으로|로)\s*만|업무\s*전용|전부\s*업무|반반")


def _ratio_said(history: list, user_text: str) -> bool:
    texts = [user_text] + [s.text for m in history if m.role == "user" for s in m.segments]
    return any(_RATIO_SAID.search(t or "") for t in texts)


def verify_decisive(history: list, user_text: str, fields: list[str]) -> list[str]:
    """추출기가 채운 결정변수 중 **사용자가 실제로 말한 것**만 골라 돌려준다(grounding guard).

    추출 프롬프트에 '추측 금지'를 넣어도 모델은 상식으로 값을 지어낸다(실측: 학회 질문에
    공식일정증빙=false 날조 → 되묻지 않고 '부인'). 판정은 대화에서 확인된 사실만의 함수여야
    하므로, 근거 없는 값은 여기서 떨어내고 pipeline 이 사용자에게 되묻는다.

    보수적 실패: 호출이 실패하면 빈 리스트 → 전부 미확인 취급 → 되묻기(판정 안 함).
    """
    if not fields:
        return []
    tool = {
        "type": "function",
        "function": {
            "name": "report_grounding",
            "description": "각 필드가 사용자 발화에 명시적 근거를 갖는지 보고한다.",
            "parameters": {
                "type": "object",
                "properties": {
                    "supported": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "field": {"type": "string", "enum": fields},
                                "quote": {"type": "string",
                                          "description": "그 사실을 말한 사용자 발화 부분을 글자 그대로 옮긴 것"},
                            },
                            "required": ["field", "quote"],
                        },
                        "description": "사용자가 대화에서 명시적으로 말한 필드만, 근거 발화 인용과 함께. 추론된 것은 제외.",
                    }
                },
                "required": ["supported"],
            },
        },
    }
    sys = (
        "당신은 엄격한 근거 검증관입니다. 아래 필드 목록 중, 사용자가 대화에서 **직접 말한** "
        "사실만 supported 에 넣으세요.\n"
        "- '보통 그렇다', '당연히 그럴 것이다', '맥락상 그렇다' 는 근거가 아닙니다.\n"
        "- 사용자가 언급조차 하지 않은 항목은 절대 넣지 마세요.\n"
        "- 확신이 없으면 넣지 마세요(빠뜨리는 쪽이 안전합니다)."
    )
    messages = [{"role": "system", "content": sys}]
    messages += _history_to_messages(history)
    messages.append({"role": "user", "content": user_text})
    messages.append({"role": "user",
                     "content": "[검증 대상 필드]\n" + "\n".join(f"- {f}: {FIELD_HINT.get(f, f)}" for f in fields)
                                + "\n"
                                "이 중 사용자가 명시적으로 말한 것만, 그 말을 한 사용자 발화를 글자 그대로 "
                                "인용해 보고하세요. 질문에 '네'·'아니요'로 답했다면 그 답을 인용하세요."})
    try:
        resp = bounded_client(TIMEOUT_VERIFY_DECISIVE).chat.completions.create(
            model=_chat_model(),
            messages=messages,
            tools=[tool],
            tool_choice={"type": "function", "function": {"name": "report_grounding"}},
            temperature=0,
        )
        tool_calls = getattr(resp.choices[0].message, "tool_calls", None)
        if not tool_calls:
            return []
        data = json.loads(tool_calls[0].function.arguments)
        out = _quoted_fields(data.get("supported") or [], fields, history, user_text)
        if "business_use_ratio" in fields and "business_use_ratio" not in out and _ratio_said(history, user_text):
            out.append("business_use_ratio")
        return out
    except upstage_gate.UpstageCongested:
        raise   # 혼잡을 '전부 미확인'으로 삼키면 되묻기 호출이 또 줄을 선다
    except Exception:  # noqa: BLE001 — 검증 실패 시 판정하지 않고 되묻는 쪽이 안전
        return []


def write_followup(history: list, user_text: str, missing: list[str]) -> list[dict]:
    """When required fields are missing, Solar asks a clarifying follow-up.
    Returns follow_up/evidence_request segments (no verdict)."""
    sys = (
        "당신은 세무 상담사입니다. 아직 판정에 필요한 정보가 부족합니다. "
        "판정을 내리지 말고, 부족한 정보를 자연스럽게 되묻는 질문을 문장 세그먼트로 작성하세요. "
        "반드시 emit_segments 도구로만 출력하고, type은 follow_up 또는 evidence_request를 사용하세요."
    )
    need = " / ".join(FIELD_HINT.get(k, k) for k in missing)
    questions = AGENT_QUESTIONS.get()
    if questions:   # 3자 방 — 세무사가 정해 둔 확인 질문(되묻기 = 프롬프트, 10/4 결정)
        need += ("\n[이 세무사가 정해 둔 확인 질문 — 부족한 정보와 관련된 것이 있으면 이 표현을 우선 쓰세요]\n"
                 + "\n".join(f"- {q}" for q in questions))
    messages = [{"role": "system", "content": _with_agent(sys)}]
    messages += _history_to_messages(history)
    messages.append({"role": "user", "content": user_text})
    messages.append({"role": "user",
                     "content": f"[부족한 정보: {need}] 이 정보를 되묻는 질문을 작성하세요."})
    resp = bounded_client(TIMEOUT_WRITE_FOLLOWUP).chat.completions.create(
        model=_chat_model(),
        messages=messages,
        tools=[_emit_segments_tool()],
        tool_choice={"type": "function", "function": {"name": "emit_segments"}},
        temperature=0.4,
    )
    tool_calls = getattr(resp.choices[0].message, "tool_calls", None)
    if not tool_calls:
        return [{"text": f"판단을 위해 {need}를 알려주시겠어요?", "type": "follow_up"}]
    try:
        data = json.loads(tool_calls[0].function.arguments)
        segs = data.get("segments") or []
        return segs if segs else [{"text": f"판단을 위해 {need}를 알려주시겠어요?", "type": "follow_up"}]
    except (json.JSONDecodeError, TypeError):
        return [{"text": f"판단을 위해 {need}를 알려주시겠어요?", "type": "follow_up"}]
