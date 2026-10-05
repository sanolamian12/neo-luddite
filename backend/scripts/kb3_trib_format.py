r"""
심판례 포맷팅 — 조세심판원 결정 전문 → Solar 구조화 추출(사실관계·쟁점·주장·판단·결론) → 기계 검증
(새RAG_KB3_구축설계 §2 포맷팅 파이프라인, 2026-10-05)

D9(국내 AI 트랙 역할 경계): 카드 문장은 **전부 Solar(solar-pro3) 가 만든다.** 이 스크립트는 원문을 넘기고
결과를 기계로 검사할 뿐 내용을 고치지 않는다. 검사에 떨어진 건은 재추출하거나 제외한다.

입력 = 팀 산출 `cases.jsonl`(credigraph `data/rag/fact-clarification-v3-20260930/`, sha256 df172b47…).
전문(`full_text`)·코드 절단 사실관계(`fact_base`)·결정유형(`decision_type`)을 쓴다.

근거 인용은 **문장 번호**로 받는다. 코드가 전문을 문장 단위로 잘라 [S1] [S2]… 번호를 붙여 넘기고, Solar 는 근거
문장 번호만 고른다 → 인용 텍스트는 코드가 원문에서 꺼내므로 원문과 다를 수 없다. (1차 파일럿은 Solar 에게 원문
복사를 시켰는데 일치 48% — 어미를 고치고 문장을 합쳐 썼다.)

기계 검사(카드 1장마다):
  ids         근거 문장 번호가 실제 있는 번호인가
  fact_span   사실관계 근거 문장 중 하나 이상이 코드 절단 fact_base 범위와 겹치는가 — 사실관계를 엉뚱한 데서 뽑았나
  over        근거 번호를 상한(사실관계 5·판단 3)보다 많이 냈나 — 2차에서 981개까지 나열한 건이 있었다
  numbers     카드 문장의 숫자가 전부 전문에 있는가 — 날조 수치
  laws        카드 조문(호·류·항 포함)이 전문에 나오는가
  leak        사실관계 문장에 이 사건 판단 표현이 섞였나(검색 단위가 사실관계라 결론이 새면 안 된다).
              '취소'·'기각'·'심판원은' 은 앞선 소송·심판의 사실로도 나와(1·2차 오탐) 판단 어구만 본다

결정유형(기각·취소·경정·재조사)은 Solar 에게 묻지 않는다 — 원문 머리말 [결정유형] 이 정답이고, 재조사 주문은
'재조사하여 … 경정한다' 꼴이라 모델이 경정으로 읽었다(2차 4/20). 카드에는 원문 값(decision_type)을 붙인다.

사용 (backend/ 에서):
    .\.venv\Scripts\python.exe scripts\kb3_trib_format.py pilot --n 20
    .\.venv\Scripts\python.exe scripts\kb3_trib_format.py report
    .\.venv\Scripts\python.exe scripts\kb3_trib_format.py scope      # 국세 범위 필터 집계(세무사 가이드)
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(_BACKEND / ".env")

from api import llm  # noqa: E402

DEFAULT_CASES = Path(r"C:\Users\user\credigraph\data\rag\fact-clarification-v3-20260930\cases.jsonl")
OUT_DIR = _BACKEND / "data" / "kb3" / "trib_pilot"

MAX_CHARS = 40_000          # 상위 1% 가 41k — 파일럿은 이보다 긴 건을 뽑지 않는다
TIMEOUT_FORMAT = 240        # 파일럿 3차 실측 중앙 4.9초·최대 10.5초. 전량엔 7만 자대 결정문이 있어 넉넉히
WORKERS = 3                 # upstage_gate 기본 동시 상한과 같다

SAMPLE_PATH = OUT_DIR / "sample_ids.json"   # 회차 간 같은 표본으로 비교하려고 굳힌다(2차 표본)
MAX_SITUATION_IDS = 5
MAX_JUDGMENT_IDS = 3

# 범위 = 국세(세법)만 — 세무사 가이드(2026-10-05, 파일럿 20건 검토 후): 관세법 제외 · 지방세법도 되도록 제외.
# 기준 = 원문 머리말 [세목](= tax_category · URL semok · 사건번호 심판부와 전부 일치 확인).
#   관세 152(관 심판부, semok 90) · 지방세 51(취득 37·재산 13·기타 1, 지·방 심판부) 제외
#   종합부동산세 중 지방세법 조문을 인용한 25건 제외(재산세 과세대상 구분 다툼) — 사용자 결정
EXCLUDED_CATEGORIES = {"관세", "지방세"}


def in_scope(case: dict) -> tuple[bool, str]:
    """(범위 안?, 제외 사유). 국세 심판례만 남긴다."""
    if case.get("tax_category") in EXCLUDED_CATEGORIES:
        return False, case["tax_category"]
    if any("지방세" in law for law in case.get("law_articles") or []):
        return False, "지방세법 인용"
    return True, ""

_SYSTEM = (
    "당신은 조세심판원 결정문을 세무 상담 AI 의 근거 카드로 정리하는 도구입니다. "
    "카드는 '비슷한 처지의 사용자'에게 이 사건을 참고 사례로 보여 주는 데 쓰입니다.\n"
    "규칙:\n"
    "1. 원문에 없는 사실·숫자·날짜·조문을 절대 추가하지 마세요. 익명 처리된 값(OOO 등)은 그대로 두고 추정하지 마세요.\n"
    "2. situation(사실관계)에는 처분에 이르기까지 실제로 있었던 일과 다툼이 된 사실만 쓰세요. "
    "이 사건에 대한 심판원의 판단·결론·평가(예: '잘못이 없다', '이유 없다')를 섞지 마세요. "
    "당사자의 주장은 확정 사실과 구분해 '청구인은 ~라고 주장한다'처럼 쓰세요.\n"
    "3. 쉬운 말로 쓰되 법률 용어는 원문 표현을 유지하세요.\n"
    "4. 결정문은 문장마다 [S번호] 가 붙어 있습니다. situation_ids·judgment_ids 에는 근거가 된 문장 번호(정수)만 넣으세요.\n"
    "5. 근거 문장 번호는 가장 직접적인 것만 고르세요 — situation_ids 최대 5개, judgment_ids 최대 3개. "
    "범위를 통째로 나열하지 마세요.\n"
    "emit_case_card 도구로만 응답하세요."
)


def _tool() -> dict:
    s = {"type": "string"}
    ints = {"type": "array", "items": {"type": "integer"}}
    return {
        "type": "function",
        "function": {
            "name": "emit_case_card",
            "description": "조세심판원 결정 한 건의 구조화 카드",
            "parameters": {
                "type": "object",
                "properties": {
                    "situation": {**s, "description": "사실관계 — 3~6문장. 이 사건 판단·결론 금지"},
                    "issue": {**s, "description": "쟁점 — 무엇이 다퉈졌나, 1~2문장"},
                    "claimant": {**s, "description": "청구인 주장 요지 — 1~2문장"},
                    "authority": {**s, "description": "처분청 의견 요지 — 1~2문장"},
                    "judgment": {**s, "description": "심판원 판단과 그 이유 — 2~4문장"},
                    "law_articles": {"type": "array", "items": s, "description": "판단에 쓰인 조문(예: 소득세법 제89조)"},
                    "situation_ids": {**ints, "maxItems": MAX_SITUATION_IDS, "description": "사실관계 근거 문장 번호 2~5개"},
                    "judgment_ids": {**ints, "maxItems": MAX_JUDGMENT_IDS, "description": "판단 근거 문장 번호 1~3개"},
                },
                "required": ["situation", "issue", "claimant", "authority", "judgment",
                             "law_articles", "situation_ids", "judgment_ids"],
            },
        },
    }


# ── 문장 번호 ────────────────────────────────────────────────────────────────

_SENT_END = re.compile(r"(?<=[다음함임됨])\.(?=\s)")
_HTML_HEAD = 'id="xmlData">'   # 수집 원문 첫머리에 남은 HTML 속성 조각 — 번호를 주지 않는다


def segment(full_text: str) -> list[tuple[int, int]]:
    """전문 → 문장 구간 [(start, end)] — **원본 full_text 오프셋**(fact_base char_start/end 와 같은 단위).
    줄바꿈으로 먼저 자르고, 줄 안에서는 '~다. / ~음. / ~함.' 뒤에서 자른다. 공백뿐인 구간은 버린다."""
    raw = []
    for m in re.finditer(r"[^\n]+", full_text):
        start, line = m.start(), m.group(0)
        cut = 0
        for e in _SENT_END.finditer(line):
            raw.append((start + cut, start + e.end()))
            cut = e.end()
        raw.append((start + cut, start + len(line)))
    out = []
    for a, b in raw:
        seg = full_text[a:b]
        a2, b2 = a + len(seg) - len(seg.lstrip()), a + len(seg.rstrip())
        if b2 > a2 and full_text[a2:b2] != _HTML_HEAD:
            out.append((a2, b2))
    return out


def numbered(full_text: str, spans: list[tuple[int, int]]) -> str:
    return "\n".join(f"[S{i}] {full_text[a:b]}" for i, (a, b) in enumerate(spans, 1))


def format_case(case: dict) -> dict:
    """Solar 한 번 호출 → 카드(dict) 또는 {'error': …}. 재시도는 SDK 1회."""
    text = numbered(case["full_text"], segment(case["full_text"]))
    t0 = time.time()
    try:
        resp = llm.bounded_client(TIMEOUT_FORMAT).chat.completions.create(
            model=llm._chat_model(),
            messages=[{"role": "system", "content": _SYSTEM},
                      {"role": "user", "content": f"[결정문]\n{text}"}],
            tools=[_tool()],
            tool_choice={"type": "function", "function": {"name": "emit_case_card"}},
            temperature=0,
        )
        calls = getattr(resp.choices[0].message, "tool_calls", None)
        if not calls:
            return {"error": "no_tool_call", "sec": round(time.time() - t0, 1)}
        card = json.loads(calls[0].function.arguments)
        usage = getattr(resp, "usage", None)
        card["_meta"] = {"sec": round(time.time() - t0, 1),
                         "prompt_tokens": getattr(usage, "prompt_tokens", None),
                         "completion_tokens": getattr(usage, "completion_tokens", None),
                         "model": llm._chat_model()}
        return card
    except Exception as e:  # noqa: BLE001 — 파일럿은 실패도 기록한다
        return {"error": f"{type(e).__name__}: {str(e)[:200]}", "sec": round(time.time() - t0, 1)}


# ── 기계 검사 ────────────────────────────────────────────────────────────────

def _nospace(s: str) -> str:
    return re.sub(r"\s+", "", s)


_NUM = re.compile(r"\d[\d,.]*\d|\d")
_LEAK = re.compile(r"잘못이 없|이유 없|이유 있|받아들이기 어렵|타당한 것으로|정당한 것으로|위법하지 않")
# 조문 외 근거(HS 품목번호 '제4202호'·'제39류', 항·호)도 번호 단위로 대조한다(2차 오탐)
_LAW = re.compile(r"(제\s*\d+\s*(?:조(?:\s*의\s*\d+)?|호|류|항))")


def check(case: dict, card: dict) -> dict:
    full = case["full_text"]
    full_ns = _nospace(full)
    spans = segment(full)
    fb = case.get("fact_base") or {}
    fb_a, fb_b = fb.get("char_start"), fb.get("char_end")

    def valid(i) -> bool:
        return isinstance(i, int) and 1 <= i <= len(spans)

    sid, jid = card.get("situation_ids") or [], card.get("judgment_ids") or []
    s_spans = [spans[i - 1] for i in sid if valid(i)]
    j_spans = [spans[i - 1] for i in jid if valid(i)]

    prose = " ".join(card.get(k, "") for k in ("situation", "issue", "claimant", "authority", "judgment"))
    # 숫자 검사는 공백 무시 비교. 한 자리 숫자는 목록 번호와 섞여 의미가 없어 두 자리 이상만 본다.
    nums = [n.strip(".,") for n in _NUM.findall(prose)]
    nums = [n for n in nums if len(re.sub(r"\D", "", n)) >= 2]
    num_missing = sorted({n for n in nums if n not in full_ns})

    law_missing = []
    for law in card.get("law_articles") or []:
        arts = [_nospace(a) for a in _LAW.findall(law)]
        # 조가 있으면 조 단위로만 본다 — 원문 항은 '①②' 동그라미라 '제2항' 문자열이 없다(3차 오탐)
        arts = [a for a in arts if a.endswith("조") or "조의" in a] or arts
        if arts:
            if any(a not in full_ns for a in arts):
                law_missing.append(law)
        elif _nospace(law)[:10] not in full_ns:   # 번호 없는 근거(지침 이름 등)는 앞머리로 대조
            law_missing.append(law)

    return {
        "ids_total": len(sid) + len(jid),
        "ids_bad": [i for i in sid + jid if not valid(i)],
        "fact_span_hit": (any(a < fb_b and b > fb_a for a, b in s_spans)
                          if fb_a is not None and fb_b is not None else None),
        "situation_quotes": [full[a:b] for a, b in s_spans],
        "judgment_quotes": [full[a:b] for a, b in j_spans],
        "ids_over": len(sid) > MAX_SITUATION_IDS or len(jid) > MAX_JUDGMENT_IDS,
        "num_missing": num_missing,
        "law_missing": law_missing,
        "leak": _LEAK.findall(card.get("situation", "")),
        "situation_chars": len(card.get("situation", "")),
    }


def passed(c: dict) -> bool:
    """카드 합격 = 근거 번호 유효·상한 안 · 날조 수치 0 · 원문에 없는 조문 0 · 사실관계에 결론 안 샘.
    fact_span 은 합격 조건이 아니다 — 사실관계를 '사실관계 및 판단' 절에서 다시 정리하는 결정이 있다."""
    return (c["ids_total"] > 0 and not c["ids_bad"] and not c["ids_over"]
            and not c["num_missing"] and not c["law_missing"] and not c["leak"])


# ── 표본 ─────────────────────────────────────────────────────────────────────

def load_cases(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as f:
        return [json.loads(line) for line in f]


def sample(cases: list[dict], n: int, seed: int) -> list[dict]:
    """세목 층화 — 세목마다 최소 1건, 나머지는 세목 비율대로. 세목 안에서는 결정유형을 돌려 뽑는다
    (기각 74% 라 그냥 뽑으면 취소·경정이 거의 안 나온다)."""
    rng = random.Random(seed)
    by_cat: dict[str, list[dict]] = {}
    for c in cases:
        if len(c["full_text"]) <= MAX_CHARS and in_scope(c)[0]:
            by_cat.setdefault(c.get("tax_category") or "기타", []).append(c)
    cats = sorted(by_cat)
    total = sum(len(v) for v in by_cat.values())
    quota = {k: 1 + round((n - len(cats)) * len(by_cat[k]) / total) for k in cats}
    biggest = max(cats, key=lambda k: len(by_cat[k]))
    quota[biggest] += n - sum(quota.values())
    out = []
    for k in cats:
        by_type: dict[str, list[dict]] = {}
        for c in by_cat[k]:
            by_type.setdefault(c.get("decision_type") or "?", []).append(c)
        for v in by_type.values():
            rng.shuffle(v)
        types = sorted(by_type, key=lambda t: -len(by_type[t]))
        got, i = 0, 0
        while got < quota[k] and any(by_type.values()):
            bucket = by_type[types[i % len(types)]]
            if bucket:
                out.append(bucket.pop())
                got += 1
            i += 1
    return out


# ── 명령 ─────────────────────────────────────────────────────────────────────

def cmd_pilot(args) -> None:
    cases = load_cases(Path(args.cases))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if SAMPLE_PATH.exists() and not args.resample:
        by_id = {c["case_id"]: c for c in cases}
        picked = [by_id[i] for i in json.loads(SAMPLE_PATH.read_text(encoding="utf-8"))]
    else:
        picked = sample(cases, args.n, args.seed)
        SAMPLE_PATH.write_text(json.dumps([c["case_id"] for c in picked], ensure_ascii=False, indent=1),
                               encoding="utf-8")
    print(f"표본 {len(picked)}건 · 세목 {dict(Counter(c.get('tax_category') for c in picked))} · "
          f"결정 {dict(Counter(c.get('decision_type') for c in picked))}")
    with ThreadPoolExecutor(WORKERS) as ex:
        cards = list(ex.map(format_case, picked))
    out = OUT_DIR / "cards.jsonl"
    with out.open("w", encoding="utf-8") as f:
        for case, card in zip(picked, cards):
            f.write(json.dumps(make_row(case, card), ensure_ascii=False) + "\n")
    print(f"→ {out}")
    cmd_report(args)


def make_row(case: dict, card: dict) -> dict:
    return {"case_id": case["case_id"], "case_number": case.get("case_number"),
            "title": case.get("title"), "tax_category": case.get("tax_category"),
            "decision_type": case.get("decision_type"), "decision_date": case.get("decision_date"),
            "source_url": case.get("source_url"), "summary": case.get("summary"),
            "law_articles_src": case.get("law_articles") or [], "full_text_chars": len(case["full_text"]),
            "card": card, "checks": None if "error" in card else check(case, card)}


# ── 전량 ─────────────────────────────────────────────────────────────────────
# 산출 = 덧붙이기 jsonl(시도마다 한 줄). 같은 사건의 마지막 줄이 현재 값이다. 한 건 끝날 때마다 쓰므로
# 중간에 멈춰도(절전·연결 끊김) 다시 실행하면 합격한 건은 건너뛰고 이어서 한다. 9/27 질의회신 수집의 교훈.
RUN_DIR = _BACKEND / "data" / "kb3" / "trib_cards"
MAX_ATTEMPTS = 2   # 사건당 시도 상한 — 기계 검사 불합격·호출 실패면 한 번 더 묻는다


def _latest(path: Path) -> tuple[dict, Counter]:
    latest, attempts = {}, Counter()
    if path.exists():
        for line in path.open(encoding="utf-8"):
            r = json.loads(line)
            latest[r["case_id"]] = r
            attempts[r["case_id"]] += 1
    return latest, attempts


def _ok(row: dict) -> bool:
    return bool(row.get("checks")) and passed(row["checks"])


def cmd_run(args) -> None:
    import threading
    cases = [c for c in load_cases(Path(args.cases)) if in_scope(c)[0]]
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    out = RUN_DIR / "cards.jsonl"
    latest, attempts = _latest(out)
    todo = [c for c in cases
            if not (c["case_id"] in latest and _ok(latest[c["case_id"]])) and attempts[c["case_id"]] < MAX_ATTEMPTS]
    if args.limit:
        todo = todo[:args.limit]
    print(f"범위 안 {len(cases)} · 합격 {sum(_ok(r) for r in latest.values())} · 이번에 처리 {len(todo)}", flush=True)
    lock, done, t0 = threading.Lock(), [0, 0], time.time()

    def work(case: dict) -> None:
        row = make_row(case, format_case(case))
        with lock:
            with out.open("a", encoding="utf-8") as f:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
            done[0] += 1
            done[1] += _ok(row)
            if done[0] % 50 == 0 or done[0] == len(todo):
                rate = (time.time() - t0) / done[0]
                print(f"  {done[0]}/{len(todo)} · 합격 {done[1]} · 남은 시간 약 {rate * (len(todo) - done[0]) / 60:.0f}분",
                      flush=True)

    with ThreadPoolExecutor(WORKERS) as ex:
        list(ex.map(work, todo))
    cmd_run_report(args)


def cmd_run_report(args) -> None:
    latest, attempts = _latest(RUN_DIR / "cards.jsonl")
    rows = list(latest.values())
    ok = [r for r in rows if _ok(r)]
    err = [r for r in rows if not r.get("checks")]
    bad = [r for r in rows if r.get("checks") and not passed(r["checks"])]
    why = Counter()
    for r in bad:
        c = r["checks"]
        for k, hit in (("근거번호", bool(c["ids_bad"]) or c["ids_over"] or not c["ids_total"]),
                       ("수치", bool(c["num_missing"])), ("조문", bool(c["law_missing"])), ("누출", bool(c["leak"]))):
            if hit:
                why[k] += 1
    print(f"사건 {len(rows)} · 합격 {len(ok)} · 불합격 {len(bad)} {dict(why)} · 호출 실패 {len(err)} "
          f"· 2회 시도 {sum(1 for v in attempts.values() if v >= 2)}")
    for r in err[:10]:
        print(f"  실패 {r['case_number']} ({r['full_text_chars']:,}자): {r['card'].get('error')}")


def cmd_report(args) -> None:
    rows = [json.loads(l) for l in (OUT_DIR / "cards.jsonl").open(encoding="utf-8")]
    ok_rows = [r for r in rows if r["checks"]]
    errs = [r for r in rows if not r["checks"]]
    lines = ["# 심판례 포맷팅 파일럿 — 기계 검사", "", f"표본 {len(rows)} · 호출 실패 {len(errs)}", ""]
    if ok_rows:
        cs = [r["checks"] for r in ok_rows]
        it, ib = sum(c["ids_total"] for c in cs), sum(len(c["ids_bad"]) for c in cs)
        fs = [c["fact_span_hit"] for c in cs if c["fact_span_hit"] is not None]
        metas = [r["card"]["_meta"] for r in ok_rows]
        lines += [
            "| 검사 | 결과 |", "|---|---|",
            f"| **카드 합격**(근거·수치·조문·누출 모두 통과) | **{sum(passed(c) for c in cs)}/{len(cs)}** |",
            f"| 근거 문장 번호 유효 | {it - ib}/{it} |",
            f"| 근거 번호 상한 초과 카드 | {sum(c['ids_over'] for c in cs)}/{len(cs)} |",
            f"| 사실관계 근거가 코드 절단 fact_base 와 겹침 | {sum(fs)}/{len(fs)} |",
            f"| 날조 의심 수치 있는 카드 | {sum(bool(c['num_missing']) for c in cs)}/{len(cs)} |",
            f"| 원문에 없는 조문 있는 카드 | {sum(bool(c['law_missing']) for c in cs)}/{len(cs)} |",
            f"| 사실관계에 판단 표현 섞인 카드 | {sum(bool(c['leak']) for c in cs)}/{len(cs)} |",
            f"| 사실관계 길이(중앙) | {sorted(c['situation_chars'] for c in cs)[len(cs) // 2]}자 |",
            f"| 호출 시간 중앙/최대 | {sorted(m['sec'] for m in metas)[len(metas) // 2]}s / {max(m['sec'] for m in metas)}s |",
            f"| 토큰 합계(입력/출력) | {sum(m['prompt_tokens'] or 0 for m in metas):,} / "
            f"{sum(m['completion_tokens'] or 0 for m in metas):,} |",
            "", "## 건별", "",
            "| 사건 | 세목 | 결정 | 근거번호(사실/판단) | fact_span | 수치 | 조문 | 누출 | 합격 |",
            "|---|---|---|---|---|---|---|---|---|",
        ]
        for r in ok_rows:
            c = r["checks"]
            lines.append(
                f"| {r['case_number']} | {r['tax_category']} | {r['decision_type']} "
                f"| {len(r['card'].get('situation_ids') or [])}/{len(r['card'].get('judgment_ids') or [])}"
                f"{' ⚠' if c['ids_bad'] else ''} | {c['fact_span_hit']} "
                f"| {', '.join(c['num_missing']) or '-'} | {'; '.join(c['law_missing']) or '-'} "
                f"| {', '.join(c['leak']) or '-'} | {'✅' if passed(c) else '❌'} |")
    for r in errs:
        lines.append(f"- 실패 {r['case_number']}: {r['card']['error']}")
    rep = OUT_DIR / "report.md"
    rep.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines[:16]))
    print(f"→ {rep}")


def cmd_scope(args) -> None:
    cases = load_cases(Path(args.cases))
    why = Counter(in_scope(c)[1] or "범위 안" for c in cases)
    kept = [c for c in cases if in_scope(c)[0]]
    print(f"전체 {len(cases)} → 범위 안 {len(kept)} · 제외 {dict((k, v) for k, v in why.items() if k != '범위 안')}")
    print("범위 안 세목:", dict(Counter(c.get("tax_category") for c in kept).most_common()))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("pilot")
    p.add_argument("--n", type=int, default=20)
    p.add_argument("--seed", type=int, default=20261005)
    p.add_argument("--cases", default=str(DEFAULT_CASES))
    p.add_argument("--resample", action="store_true", help="굳힌 표본(sample_ids.json)을 버리고 새로 뽑는다")
    p.set_defaults(func=cmd_pilot)
    r = sub.add_parser("report")
    r.set_defaults(func=cmd_report)
    ru = sub.add_parser("run", help="범위 안 전량 포맷팅(이어하기 가능)")
    ru.add_argument("--cases", default=str(DEFAULT_CASES))
    ru.add_argument("--limit", type=int, default=0, help="이번 회차 처리 상한(시험용)")
    ru.set_defaults(func=cmd_run)
    rr = sub.add_parser("run-report", help="전량 산출 집계")
    rr.set_defaults(func=cmd_run_report)
    sc = sub.add_parser("scope", help="국세 범위 필터 집계(세무사 가이드)")
    sc.add_argument("--cases", default=str(DEFAULT_CASES))
    sc.set_defaults(func=cmd_scope)
    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
