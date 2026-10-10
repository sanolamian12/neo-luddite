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
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace
import re

import os

import clinic_expense_engine as eng
from calc import income_tax as itax
from calc import income_tax_extract as itax_extract
from calc import income_tax_slots as itax_slots
from calc import income_tax_view as itax_view
from api import engine_adapter as adapter
from api import handoff
from api import law_select
from api import llm
from api import numeric_guard
from api import upstage_gate
from api.rag import get_retriever
from api.rag.retriever import FusionRetriever, Kb3Retriever, NullRetriever
from api.schema import ChatMeta, ChatResponse, Message, Segment

log = logging.getLogger("api.pipeline")

# ③ 판례 사건번호 정규식 — 이제 RAG 의 보조(엔진 근거 안의 직접 인용)일 뿐.
# 실 그라운딩은 get_retriever()(rag.passages 벡터 검색)가 담당(마스터 §5 step4).
_CASE_REF = re.compile(r"조심\s?\d{4}[가-힣]{1,2}\d+")


def _rag_top_k() -> int:
    return int(os.environ.get("RAG_TOP_K", "5"))


def _rag_source_label(retriever, passages) -> str:
    """meta.ragSource / chat_turns.rag_source 값. fusion 결과는 코퍼스가 섞여 있어
    passages[0] 하나로 추정하면 1위가 kb2 냐에 따라 'kb2'/'rag' 로 오기록된다 — 그래서
    검색기 종류로 먼저 가른다. 그 외 갈래는 종전 규칙 그대로."""
    if not passages:
        return "none"
    if isinstance(retriever, FusionRetriever):
        return "fusion"
    if isinstance(retriever, Kb3Retriever):
        return "kb3"
    return "kb2" if passages[0].source_kind == "kb2" else "rag"


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


def _issue_gate(user_text: str, passages: list) -> tuple[list, list[dict]]:
    """KB3 근거 중 질문과 쟁점이 다른 것('different')을 뺀다 — (남긴 근거, 뺀 근거의 계측 행).

    KB3 가 없거나, KB3_ISSUE_GATE=off 거나, 판정이 실패하면 그대로 돌려준다(지금 동작).
    KB3 아닌 근거(검수 선례·사전)는 판정하지 않는다."""
    kb3 = [p for p in passages if p.corpus in llm.KB3_CORPORA]
    if not kb3 or os.environ.get("KB3_ISSUE_GATE", "on") == "off":
        return passages, []
    fits = llm.judge_issue_fit(user_text, kb3)
    if not fits:
        return passages, []
    kept = [p for p in passages if fits.get(p.id) != "different"]
    dropped = [{"corpus": p.corpus, "sourceKind": p.source_kind, "score": round(float(p.score), 4),
                "rank": None, "id": p.id, "issueFit": "different"}
               for p in passages if fits.get(p.id) == "different"]
    if dropped:
        log.info("쟁점 적합성 게이트: KB3 %d건 중 %d건 제외 %s", len(kb3), len(dropped),
                 [p.case_refs for p in passages if fits.get(p.id) == "different"])
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


def _law_step(user_text: str, passages: list, extra_texts: list[str]) -> _LawStep | None:
    """LLM3(10/7) — 관련 법령 선택. 꺼져 있거나 저장소·선택이 실패하면 None(지금 동작 그대로)."""
    if not law_select.enabled():
        return None
    cands = law_select.candidates(user_text, passages)
    picks = law_select.select(user_text, cands)
    if picks is None:
        return None
    log.info("LLM3 법령: 후보 %d · 선택 %s", len(cands), [p.article.label() for p in picks])
    return _LawStep(
        passages=law_select.strip_card_law_lines(passages),
        block=law_select.law_block(picks),
        allowed=law_select.allowed_keys(picks, [user_text] + extra_texts),
        labels=law_select.pick_labels(picks),
        texts=[law_select.numeric_view(p.article.text) for p in picks],
    )


_LAW_POOL = ThreadPoolExecutor(max_workers=4, thread_name_prefix="law3")


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


def _law_checked(raw: list[dict], law: _LawStep | None, where: str) -> list[dict]:
    """작문 뒤 코드 대조 — LLM3 가 고른 조문·엔진 근거·사용자 발화 밖 법령을 인용한 문장(LAW_CITE_CHECK=drop 이면 뺀다)."""
    if law is None:
        return raw
    out = raw
    if law_select.check_mode() != "off":
        out, rep = law_select.check_answer(raw, law.allowed)
        if rep.flagged:
            log.info("법령 인용 대조(%s): 허용 밖 %s · 제외 %d", where, [f["cites"] for f in rep.flagged], rep.dropped)
    return law_select.trim_answer(out)


def _search_query(history: list[Message], user_text: str, extracted: dict) -> str:
    """KB3·LLM3·쟁점 게이트에 쓸 질의(R1-a, 10/10). 추출기가 대화 전체를 반영해 다시 쓴 독립 질의를 쓰고,
    대화 첫 턴이거나 비었으면 이번 발화 그대로(첫 턴은 다시 쓸 맥락이 없다 — 기준선 동작 유지)."""
    q = (extracted.get("search_query") or "").strip() if isinstance(extracted.get("search_query"), str) else ""
    if not q or not any(m.role == "user" for m in history):
        return user_text
    if q != user_text:
        log.info("검색 질의 재작성: %r → %r", user_text[:40], q[:80])
    return q


_STATUTE = re.compile(r"제\s?\d+\s?조|§\s?\d+|\d+조의?\d*\s?제?\d*항")
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
        add = [r for r in refs + laws if r in seg.text and r not in have]
        out.append(seg.model_copy(update={"citations": have + add}) if add else seg)
    shown = {c for seg in out for c in (seg.citations or [])}
    if refs and not any(r in shown for r in refs):
        i = anchor if 0 <= anchor < len(out) else len(out) - 1
        have = out[i].citations or []
        out[i] = out[i].model_copy(update={"citations": have + [r for r in refs[:CITATION_ANCHOR_MAX] if r not in have]})
    return _tidy_citations(out)


def _tidy_citations(segments: list[Segment]) -> list[Segment]:
    """배지 정리(사용자 10/6 밤) — solar 가 같은 번호 5~6개를 문장마다 반복해 붙여 화면이 번잡했다.
    ① 한 답에서 같은 번호는 한 문장에만: 본문에 그 번호가 적힌 첫 문장, 없으면 처음 붙은 문장 ② 한 문장 최대 3개."""
    home: dict[str, int] = {}
    for i, seg in enumerate(segments):
        for c in seg.citations or []:
            if c in seg.text and c not in home:
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
    )
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
_CALC_TAX_WORD = re.compile(r"소득세|세금|세액|원천징수|실수령|떼")
_CALC_ASK_WORD = re.compile(r"얼마|몇|계산|떼|나와|나오|바뀌|구간|실수령")
_DEDUCTION_Q = re.compile(r"신용카드|체크카드|의료비|교육비|월세|기부금|연금저축|IRP|청약|주택자금|보험료\s*공제|부모님?\s*(?:기본)?공제")
_TAKEHOME = re.compile(r"실수령|손에\s*쥐|통장에\s*들어")
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
        keys = [_CALC_SLOT_QUESTIONS[s.text] for s in m.segments if s.text in _CALC_SLOT_QUESTIONS]
        if not seen_last:
            last, seen_last = keys, True
        asked.update(keys)
    return asked, last


def _calc_context(history: list[Message]) -> bool:
    """앞선 답이 계산 갈래였나 — 계산 답에는 고정 고지(NOT_MODELED)나 슬롯 질문이 반드시 있다."""
    return any(s.text == itax_slots.NOT_MODELED or s.text in _CALC_SLOT_QUESTIONS
               for m in history if m.role == "assistant" for s in m.segments)


def _calc_slots(history: list[Message], user_text: str, extracted: dict) -> dict:
    users = [s.text for m in sorted(history, key=lambda m: m.order) if m.role == "user" for s in m.segments]
    slots = itax_extract.merge_slots(extracted, users + [user_text])
    _, last = _calc_asked(history)
    slots.update(itax_extract.read_reply(user_text, last))
    return slots


def _is_calc_turn(history: list[Message], user_text: str, extracted: dict, slots: dict) -> bool:
    """근로소득세 계산으로 답할 턴인가. 경비 유형이 잡혔으면 아니다. 주제가 근로소득세여도 계산 의도(금액·'얼마')가
    없으면(“의료비 공제 요건이 뭐야?”) 자문 갈래 그대로. 앞 턴이 계산이었으면 짧은 답("부양가족 2명")도 이어 받는다."""
    if not _calc_enabled() or extracted.get("etype") in adapter.SUPPORTED_ETYPES:
        return False
    topic = extracted.get("tax_topic")
    if _calc_context(history):
        return topic in (adapter.CALC_TOPIC, "기타", None, "종합소득세") and not _DEDUCTION_Q.search(user_text)
    if topic != adapter.CALC_TOPIC:
        return False
    users = [s.text for m in history if m.role == "user" for s in m.segments] + [user_text]
    if any(_DEDUCTION_Q.search(t) for t in users):
        return False
    return any(_CALC_TAX_WORD.search(t) and _CALC_ASK_WORD.search(t) for t in users)


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

    users = [s.text for m in history if m.role == "user" for s in m.segments] + [user_text]
    lead = [{"text": itax_view.headline(filled, result), "type": "conclusion"}]
    change = itax_extract.read_salary_change(users)
    if change and change[1] == filled.inp.total_salary + (slots.get("nontaxable") or 0):
        lead.append({"text": itax_view.change_line(change[0] - (slots.get("nontaxable") or 0), filled, result),
                     "type": "conclusion"})
    if any(_TAKEHOME.search(t) for t in users):
        lead.append({"text": itax_view.takehome(slots["total_salary"], result), "type": "conclusion"})
    raw = lead + explain
    rows = itax_view.step_rows(result)
    raw += [{"text": r.text, "type": "application", "citations": r.citations} for r in rows]
    raw.append({"text": itax_view.option_note(result), "type": "caveat"})
    raw += itax_slots.assumption_segments(filled, result)
    raw += [{"text": q.question, "type": "follow_up"} for q in questions]
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
    """occupation = 요청의 직군(R1-e · D-2, 10/10). clinic 외 직군도 같은 파이프라인으로 받되 엔진 판정(병의원 경비
    9종)은 clinic 전용 — 그 외 직군은 지출유형을 잡아도 자문 경로로 답한다. 검색 축은 clinic 그대로(KB3 는 직군 무관).
    agent_expert_id = 이 대화가 연결된 세무사(그 세무사의 게시 사례까지 검색) · preview_expert_id =
    스튜디오 시험칸(그 세무사의 초안까지). 둘 다 없으면 공용 KB3 만(0043, 10/6).
    room_mode = 3자 방(0044, api/room_agent.py) — 이미 세무사와 연결된 방이라 명시 연결 요청엔 연결 카드 대신 고정 문장
    (다른 갈래의 블록은 room_agent 가 버리고 텍스트만 방 메시지로 올린다)."""
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
    extracted = llm.extract_engine_inputs(history, user_text, tool) or {}
    if extracted:
        adapter.normalize_etype(extracted)   # '접대비' → '접대성지출' (enum 은 소프트 제약)
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

    # 근로소득세 계산 갈래(R2-c) — 직군 무관. 경비 판정·자문보다 먼저 가른다(계산 의도가 있을 때만).
    calc_slots = _calc_slots(history, user_text, extracted)
    if _is_calc_turn(history, user_text, extracted, calc_slots):
        return _calc_response(conversation_id, history, user_text, extracted, calc_slots,
                              message_id, order, occupation, rag_source_override)

    missing = adapter.missing_required(extracted) if extracted else list(adapter.REQUIRED_FOR_VERDICT)

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
        segments = _ensure_follow_up(_clean_segment_dicts(raw, message_id))
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
        # 세금과 무관한 질문·서비스 문의 — 검색하지 않고 무엇을 도울 수 있는지 소개(R1-c 보강, 10/10).
        # outcome 'off_topic' 은 G3 분모 밖이다(검색 미도달 → rag_searched None).
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
        retriever = get_retriever(force_enabled=rag_override, source=rag_source_override,
                              agent_expert_id=agent_expert_id, preview_expert_id=preview_expert_id)
        # 검색기가 실제로 살아 있었나 — RAG off(?rag=false / admin 토글)든 DB 미설정이든
        # NullRetriever 로 수렴한다. 계측에는 "선례가 없었다"와 "애초에 안 찾아봤다"를
        # 가르는 값이라, ragHits=0 하나로 뭉뚱그리면 G3 지표가 RAG off 회차에 오염된다.
        rag_searched = not isinstance(retriever, NullRetriever)
        passages = retriever.retrieve(query, k=_rag_top_k(), occupation="clinic")
        rag_source_used = _rag_source_label(retriever, passages)   # 게이트 전 — 전부 빠져도 'none' 이 아니다
        # LLM3 는 쟁점 게이트와 **동시에** 돈다(10/8 지연 진단 — 둘 다 검색 결과만 있으면 되는 Solar 호출 1회씩).
        # 후보는 게이트 전 근거로 만든다 — 쟁점이 다른 카드의 조문이 섞여도 LLM3 가 질문 적합성으로 거른다.
        law_future = _LAW_POOL.submit(_law_step, query, passages, []) if law_select.enabled() else None
        # 쟁점이 다른 KB3 근거는 작문 전에 뺀다(10/6). 뺀 것도 계측에는 남긴다(rank=None, issueFit).
        passages, gated_out = _issue_gate(query, passages)
        law = _law_result(law_future, passages)
        case_refs = sorted({ref for p in passages for ref in p.case_refs})
        # 검색을 탄 갈래는 근거가 0건이어도 {} / [] 를 남긴다 — null(미도달)과 다른 사실이다.
        corpora, corpus_raw = _corpus_distribution(passages)
        corpus_raw += gated_out

        # 사례 근거 0건 — 질문에 직접 맞는 현행 조문이 있으면 조문만으로 일반 안내(LAW_ONLY, 10/7).
        # C48(세무조사 연기)처럼 심판례·해석은 다른 쟁점뿐이어도 국기법 §81의7 이 바로 답인 질문이 있다.
        # 선두 안내에 "규칙엔진의 판정 대상이 아닙니다"를 붙이던 것은 뺐다(R1-b) — 근거 수준만 밝힌다.
        if not passages and law_select.law_only_enabled():
            if law and law.labels:
                raw = [{"text": ("이 질문을 직접 다룬 심판례·국세청 해석은 찾지 못해, 현행 법령 조문을 "
                                 "바탕으로 일반적인 내용을 안내드립니다(세무사가 이 사안을 확인한 내용은 아닙니다)."),
                        "type": "caveat"}]
                sources, own = _number_sources(history, user_text, [])
                raw += _law_checked(numeric_guard.drop_unsourced_numbers(
                    llm.write_advisory(history, user_text, etype, [], law_block=law.block),
                    sources + law.texts, own, where=f"law_advisory {message_id}"), law, f"law_advisory {message_id}")
                segments = _clean_segment_dicts(raw, message_id)
                segments = _attach_citations(segments, [], anchor=0, laws=law.labels)
                blocks, offered = _offer(history, "advisory")
                return _recorded(
                    ChatResponse(
                        message=Message(id=message_id, role="assistant", order=order, segments=segments,
                                        uiBlocks=blocks),
                        meta=ChatMeta(engine=engine_name, extracted=extracted,
                                      ragHits=0, ragSource=rag_source_used, ragCorpora=corpora,
                                      ragPassages=corpus_raw, followUp=False, advisory=True, handoff=offered),
                    ),
                    conversation_id, occupation, "law_advisory", rag_source_override,
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
        # 근거가 참고 사전(kbdict)뿐이면 "세무사 검수 의견"이라고 말하는 순간 거짓이다(로드맵 P4).
        # KB3(판례·심판례·질의회신)도 세무사 검수가 아니다 — 들어온 층 이름을 그대로 밝힌다(D5, 10/5).
        kb3_names = [label for corpus, label, _ in llm.KB3_LAYERS
                     if any(p.corpus == corpus for p in passages)]
        # "○○ 사안은 규칙엔진의 판정 대상이 아닙니다." 머리는 뺐다(R1-b) — 근거 수준만 밝히는 참고 안내 문장.
        if llm.has_reviewed(passages) and kb3_names:
            lead = (f"아래는 유사 사례에 세무사들이 남긴 검수 의견과 {'·'.join(kb3_names)} 자료를 "
                    "바탕으로 한 참고 안내입니다.")
        elif llm.has_reviewed(passages):
            lead = "아래는 유사 사례에 세무사들이 남긴 검수 의견을 바탕으로 한 참고 안내입니다."
        elif kb3_names:
            lead = (f"아래는 유사 사건의 {'·'.join(kb3_names)} 자료를 바탕으로 한 참고 안내입니다"
                    "(세무사가 이 사안을 확인한 내용은 아닙니다).")
        else:
            lead = ("아래는 일반 세무 용어·법리 자료를 바탕으로 한 참고 안내입니다"
                    "(세무사가 이 사안을 확인한 내용은 아닙니다).")
        raw = [{"text": lead, "type": "caveat"}]
        sources, own = _number_sources(history, user_text, passages)
        if law:
            sources += law.texts
        raw += _law_checked(numeric_guard.drop_unsourced_numbers(
            llm.write_advisory(history, user_text, etype, law.passages if law else passages,
                               law_block=law.block if law else ""),
            sources, own, where=f"advisory {message_id}"), law, f"advisory {message_id}")
        segments = _clean_segment_dicts(raw, message_id)
        segments = _attach_citations(segments, passages, anchor=0,   # 맨 앞 = '…자료를 참고해' 안내 문장
                                     laws=law.labels if law else None)
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
            conversation_id, occupation, "advisory", rag_source_override,
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
        segments = _ensure_follow_up(_clean_segment_dicts(raw, message_id))
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

    # ③ RAG 검색 — 세무사 코멘트(C)/판례 KB 벡터 검색이 정규식 스텁을 대체.
    #    KB 가 비면(제품 출발 상태) passages=[] → 스텁 refs 만으로 graceful.
    retriever = get_retriever(force_enabled=rag_override, source=rag_source_override,
                              agent_expert_id=agent_expert_id, preview_expert_id=preview_expert_id)
    rag_searched = not isinstance(retriever, NullRetriever)
    passages = retriever.retrieve(query, k=_rag_top_k(), occupation="clinic")
    stub_refs = _CASE_REF.findall(result.근거)
    rag_refs = [ref for p in passages for ref in p.case_refs]
    case_refs = sorted(set(stub_refs) | set(rag_refs))
    # 프롬프트의 "참고 판례" 줄은 [규칙엔진 판정 — 권위 원천] 블록 안이다. KB3 문서번호(질의회신·심판례)를
    # 거기 넣으면 엔진이 댄 판례처럼 읽힌다 → KB3 번호는 빼고 각자 라벨 블록 본문에서만 보이게 한다.
    # meta.ragCaseRefs(화면·계측)는 종전대로 전부 싣는다.
    engine_refs = sorted(set(stub_refs) | {ref for p in passages if p.corpus not in llm.KB3_CORPORA
                                            for ref in p.case_refs})
    rag_source_used = _rag_source_label(retriever, passages)
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
