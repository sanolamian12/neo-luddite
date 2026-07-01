#!/usr/bin/env python3
"""
Goal 3 Deep Dive: Legal Reasoning Frameworks
=============================================
Extracts and models:
  1. Step-by-step reasoning process for each interpretive framework
  2. Framework selection principles (what triggers which canon)
  3. Multi-canon sequencing patterns
  4. Burden of proof allocation rules
  5. Standard pivot structures per decision outcome

Output:
  data/analysis/reasoning_deep_report.txt
  data/analysis/reasoning_deep_report.json
"""

import json, os, re, sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(__file__))
import config
from collectors.schema import load_jsonl, TaxCase

OUT_DIR = os.path.join(os.path.dirname(__file__), "data", "analysis")
os.makedirs(OUT_DIR, exist_ok=True)


def extract_sections(full_text: str) -> dict[str, str]:
    sections: dict[str, list[str]] = {}
    current = "header"
    for line in full_text.split("\n"):
        clean = line.strip()
        if not clean or "---" in clean:
            continue
        m = re.match(r"^\[([^\]]{2,20})\]$", clean.replace("\xa0", "").replace("　", ""))
        if m:
            key = m.group(1).replace(" ", "").replace("　", "")
            current = key
            sections.setdefault(current, [])
        else:
            sections.setdefault(current, []).append(clean)
    return {k: " ".join(v).strip() for k, v in sections.items()}


# ── Framework detection ────────────────────────────────────────────────────────

FRAMEWORKS = {
    "문언해석": {
        "triggers": [r"문언\s*상", r"문언의\s*의미", r"법문\s*상", r"조문의\s*문언",
                     r"문언대로", r"법문대로", r"문리\s*해석"],
        "desc": "Literal / Textual Interpretation",
    },
    "목적론해석": {
        "triggers": [r"입법\s*취지", r"입법\s*목적", r"규정의\s*취지",
                     r"취지에\s*비추어", r"도입\s*취지", r"입법\s*연혁"],
        "desc": "Purposive / Teleological Interpretation",
    },
    "체계적해석": {
        "triggers": [r"체계\s*적", r"법체계", r"전체적\s*체계",
                     r"관련\s*규정과의", r"다른\s*조항과"],
        "desc": "Systematic / Contextual Interpretation",
    },
    "실질과세원칙": {
        "triggers": [r"실질\s*과세", r"경제적\s*실질", r"형식\s*보다\s*실질",
                     r"실질에\s*따라", r"실질적\s*으로", r"실질\s*귀속"],
        "desc": "Substance-over-Form Principle (국세기본법 §14)",
    },
    "신의성실원칙": {
        "triggers": [r"신의\s*성실", r"신의칙", r"금반언", r"신뢰\s*보호",
                     r"공적\s*견해", r"선행\s*행위에\s*반하는"],
        "desc": "Good Faith / Estoppel Principle",
    },
    "엄격해석": {
        "triggers": [r"엄격\s*하게", r"엄격\s*히", r"조세\s*법률주의",
                     r"과세요건\s*명확", r"합리적\s*이유\s*없이.*확장",
                     r"유추\s*해석.*허용되지"],
        "desc": "Strict Interpretation (조세법률주의)",
    },
    "입증책임": {
        "triggers": [r"입증\s*책임", r"입증하여야", r"입증하지\s*못",
                     r"증명\s*책임", r"소명하여야", r"입증\s*의무"],
        "desc": "Burden of Proof Allocation",
    },
    "유추해석": {
        "triggers": [r"유추\s*적용", r"준용", r"마찬가지로.*적용",
                     r"같은\s*이치", r"유사한\s*경우"],
        "desc": "Analogical Interpretation (generally prohibited in tax law)",
    },
}

# ── Framework selection trigger conditions ─────────────────────────────────────

SELECTION_SIGNALS = {
    "literal_default": [
        r"조세법규의\s*해석은.*법문대로",
        r"특별한\s*사정이\s*없는\s*한.*법문대로",
        r"명문\s*규정이\s*있으므로",
    ],
    "literal_to_purposive_bridge": [
        r"문언.*불분명",
        r"문언만으로.*판단하기\s*어렵",
        r"문언.*해석에\s*한계",
        r"문리적.*해석.*결과가.*부당",
        r"입법취지.*고려",
    ],
    "purposive_override": [
        r"형해화",
        r"입법취지.*몰각",
        r"실질적으로.*무의미",
        r"입법취지에\s*반한다",
    ],
    "substance_trigger": [
        r"형식.*불구하고",
        r"실질이.*다른",
        r"가장\s*행위",
        r"조세\s*회피",
        r"형식적으로만",
        r"경제적\s*실질이\s*동일",
    ],
    "good_faith_trigger": [
        r"과세관청.*안내",
        r"처분청.*확인",
        r"공적\s*견해\s*표명",
        r"납세자.*신뢰",
        r"종전.*해석",
    ],
    "strict_applies_when": [
        r"감면\s*요건",
        r"비과세\s*요건",
        r"특혜\s*규정",
        r"과세요건.*법률로",
        r"감면.*열거",
    ],
}

BURDEN_RULES = {
    "tax_authority_bears": [
        r"과세요건사실.*과세관청",
        r"과세관청이.*증명",
        r"처분청이.*입증",
        r"과세근거.*과세관청에",
    ],
    "taxpayer_bears": [
        r"손금.*납세자에게",
        r"공제.*납세자가.*입증",
        r"비과세.*납세자가.*입증",
        r"감면.*납세자",
        r"납세자에게.*입증책임",
        r"청구인이.*입증하여야",
    ],
}


def detect_framework(text: str) -> dict[str, int]:
    result = {}
    for fw, info in FRAMEWORKS.items():
        count = sum(len(re.findall(p, text, re.IGNORECASE)) for p in info["triggers"])
        if count:
            result[fw] = count
    return result


def detect_selection_signals(text: str) -> dict[str, int]:
    result = {}
    for sig, patterns in SELECTION_SIGNALS.items():
        count = sum(len(re.findall(p, text, re.IGNORECASE)) for p in patterns)
        if count:
            result[sig] = count
    return result


def detect_burden(text: str) -> dict[str, int]:
    result = {}
    for rule, patterns in BURDEN_RULES.items():
        count = sum(len(re.findall(p, text, re.IGNORECASE)) for p in patterns)
        if count:
            result[rule] = count
    return result


def find_multi_canon_sequence(text: str) -> list[tuple[str, int]]:
    """Return ordered list of (framework, position) for multi-canon cases."""
    positions = []
    for fw, info in FRAMEWORKS.items():
        for pat in info["triggers"]:
            m = re.search(pat, text, re.IGNORECASE)
            if m:
                positions.append((fw, m.start()))
                break
    positions.sort(key=lambda x: x[1])
    return positions


def extract_decision_pivot(text: str):
    """Extract the key pivot sentence (살피건대 → conclusion)."""
    m = re.search(r"살피건대(.{50,400}?)(?:따라서|이상과\s*같|이\s*건\s*심판)", text, re.DOTALL)
    if m:
        return m.group(0)[:300].replace("\n", " ").strip()
    return None


def analyse_case(case: TaxCase) -> dict:
    secs = extract_sections(case.full_text) if case.full_text else {}
    reasoning = secs.get("이유", case.full_text or case.summary or "")

    canons = detect_framework(reasoning)
    sequence = find_multi_canon_sequence(reasoning)
    canon_sequence = [fw for fw, _ in sequence]

    return {
        "case_id": case.case_id,
        "case_number": case.case_number,
        "source": case.source,
        "tax_category": case.tax_category,
        "decision_type": case.decision_type,
        "canons_used": canons,
        "canon_sequence": canon_sequence,
        "selection_signals": detect_selection_signals(reasoning),
        "burden_patterns": detect_burden(reasoning),
        "pivot_sentence": extract_decision_pivot(reasoning),
        "reasoning_len": len(reasoning),
        "canon_count": len(canons),
    }


# ── Aggregate analyses ─────────────────────────────────────────────────────────

def build_report(analyses: list[dict]) -> dict:
    # Framework frequency
    fw_counter = Counter()
    fw_case_counter = Counter()
    for a in analyses:
        for fw, n in a["canons_used"].items():
            fw_counter[fw] += n
            fw_case_counter[fw] += 1

    # Framework by decision type
    fw_by_decision: dict[str, Counter] = defaultdict(Counter)
    for a in analyses:
        dt = a["decision_type"] or "N/A"
        for fw in a["canons_used"]:
            fw_by_decision[dt][fw] += 1

    # Framework by tax category
    fw_by_cat: dict[str, Counter] = defaultdict(Counter)
    for a in analyses:
        for fw in a["canons_used"]:
            fw_by_cat[a["tax_category"]][fw] += 1

    # Multi-canon sequencing: most common 2-step and 3-step patterns
    two_step: Counter = Counter()
    three_step: Counter = Counter()
    for a in analyses:
        seq = a["canon_sequence"]
        # deduplicate consecutive same
        deduped = [seq[0]] if seq else []
        for s in seq[1:]:
            if s != deduped[-1]:
                deduped.append(s)
        for i in range(len(deduped) - 1):
            two_step[(deduped[i], deduped[i+1])] += 1
        for i in range(len(deduped) - 2):
            three_step[(deduped[i], deduped[i+1], deduped[i+2])] += 1

    # Selection signal frequency
    sig_counter: Counter = Counter()
    for a in analyses:
        sig_counter.update(a["selection_signals"])

    # Burden of proof patterns
    burden_counter: Counter = Counter()
    for a in analyses:
        burden_counter.update(a["burden_patterns"])

    # Canon count distribution
    solo_canon = sum(1 for a in analyses if a["canon_count"] == 1)
    multi_canon = sum(1 for a in analyses if a["canon_count"] >= 2)
    zero_canon = sum(1 for a in analyses if a["canon_count"] == 0)

    total = len(analyses)
    return {
        "total_cases": total,
        "framework_frequency": {
            fw: {
                "total_mentions": fw_counter[fw],
                "cases_using": fw_case_counter[fw],
                "case_rate_pct": round(fw_case_counter[fw] / total * 100, 1),
                "desc": FRAMEWORKS[fw]["desc"],
            }
            for fw in sorted(fw_counter, key=lambda x: -fw_counter[x])
        },
        "framework_by_decision": {
            dt: dict(c.most_common(6))
            for dt, c in sorted(fw_by_decision.items(), key=lambda x: -sum(x[1].values()))
        },
        "framework_by_category": {
            cat: dict(c.most_common(4))
            for cat, c in sorted(fw_by_cat.items(), key=lambda x: -sum(x[1].values()))
        },
        "common_two_step_sequences": [
            {"step1": a, "step2": b, "count": n}
            for (a, b), n in two_step.most_common(10)
        ],
        "common_three_step_sequences": [
            {"step1": a, "step2": b, "step3": c, "count": n}
            for (a, b, c), n in three_step.most_common(8)
        ],
        "selection_signals": dict(sig_counter.most_common()),
        "burden_patterns": dict(burden_counter.most_common()),
        "canon_count_distribution": {
            "zero": zero_canon,
            "single": solo_canon,
            "multi": multi_canon,
        },
    }


# ── Render ──────────────────────────────────────────────────────────────────────

FRAMEWORK_PROCESS = {
    "엄격해석": {
        "title": "엄격해석 (Strict Interpretation) — 조세법률주의 기반 기본 원칙",
        "steps": [
            "① ENTRY CONDITION: 과세요건 or 감면요건 or 비과세요건이 쟁점인가?",
            "② RULE STATEMENT: '조세법규의 해석은 특별한 사정이 없는 한 법문대로'",
            "③ PROHIBITION: '합리적 이유 없이 확장해석하거나 유추해석하는 것은 허용되지 않는다'",
            "④ EXTRA STRICTNESS: 감면·특혜규정은 더욱 엄격히 (조세공평 원칙)",
            "⑤ CITATION: 대법원 2008두7830 등 확립 판례 인용",
        ],
        "trigger": "과세/비과세/감면 요건의 존부가 쟁점인 모든 사건에서 기본 출발점",
        "real_quote": (
            "'조세법률주의의 원칙상 과세요건이나 비과세요건 또는 조세감면요건을 막론하고 "
            "조세법규의 해석은 특별한 사정이 없는 한 법문대로 해석할 것이고 합리적 이유 없이 "
            "확장해석하거나 유추해석하는 것은 허용되지 아니하며, 특히 감면요건 규정 가운데에 "
            "명백히 특혜규정이라고 볼 수 있는 것은 엄격하게 해석하는 것이 조세공평의 원칙에도 "
            "부합한다 (대법원 2008두7830)'"
        ),
    },
    "문언해석": {
        "title": "문언해석 (Literal Interpretation) — 법 텍스트의 통상적 의미",
        "steps": [
            "① ISOLATE THE TEXT: 쟁점 조문/단어를 정확히 특정한다",
            "② ORDINARY MEANING: 사전적·통상적 의미로 해석한다 (예: '~까지'의 사전 의미)",
            "③ CONSISTENCY CHECK: 동일 법령 내 같은 단어의 다른 용례와 비교",
            "④ RESULT CHECK: 문언대로 해석 시 결과가 부당하지 않은지 확인",
            "⑤ STOP RULE: 문언이 명백하면 목적론적 해석으로 나아갈 필요 없다",
        ],
        "trigger": "조문의 특정 단어·구문이 쟁점인 경우; 감면 요건 충족 여부",
        "real_quote": (
            "'\"취득일까지\"에서 ~까지의 사전적 의미는 어떤 일이나 상태 따위에 관련되는 "
            "범위의 끝임을 나타내는 보조사로 그 상태의 범위가 ~까지 유지될 때를 의미하는 것' "
            "→ 벤처기업 지위가 취득일 현재도 유지되어야 한다 (조심 2025전2337)"
        ),
    },
    "목적론해석": {
        "title": "목적론적 해석 (Purposive Interpretation) — 입법취지·목적 추구",
        "steps": [
            "① TRIGGER: 문언이 불분명하거나, 문언대로 해석하면 입법취지가 몰각되는 경우",
            "② IDENTIFY PURPOSE: 입법연혁, 개정이유서, 제도 도입 배경을 확인",
            "③ PURPOSE STATEMENT: '○○ 제도는 ~~를 지원하기 위해 도입된 것이므로'",
            "④ APPLICATION: '입법취지에 비추어 합목적적으로 해석하면 ~~이 된다'",
            "⑤ BOUNDARY: 목적론 해석도 문언의 가능한 범위 내에서만 허용",
        ],
        "trigger": "문언이 복수 해석 가능하거나, 새로운 사실관계를 기존 조문에 적용하는 경우",
        "real_quote": (
            "'쟁점세액공제는 벤처창업자 등이 투자자금을 원활히 회수할 수 있도록 지원하고 "
            "신기술의 확산을 장려하기 위해 도입된 제도인바, 이러한 입법취지를 고려하여 "
            "합목적적으로 해석하여야 하고, 단순히 문언해석에 따라 적용하면 입법취지가 "
            "몰각된다' (조심 2025서4062)"
        ),
    },
    "체계적해석": {
        "title": "체계적 해석 (Systematic Interpretation) — 법체계 내 정합성",
        "steps": [
            "① MAP THE SYSTEM: 쟁점 조문이 속한 장·절 구조와 다른 조문과의 관계를 파악",
            "② FIND CONFLICT: 동일 법 또는 관련 법 간의 용어·범위 충돌 여부 확인",
            "③ HARMONY RULE: '○○법과 △△법은 서로 양립할 수 없는 택일적 관계인지?'",
            "④ RESOLVE: 특별법 우선, 신법 우선, 목적에 부합하는 해석 선택",
            "⑤ CROSS-CHECK: 해석 결과가 상위 법령(헌법, 국세기본법)에 반하지 않는지",
        ],
        "trigger": "복수 법령에 걸쳐 있는 요건(조특법+환경법 등); 동일 법 내 조문 간 충돌",
        "real_quote": (
            "'조특법 시행규칙 [별표 8의3]는 에너지절약시설, [별표 8의5]는 환경보전시설로 "
            "별도 규정하고 있으므로, 두 시설이 서로 양립할 수 없는 택일적 관계로 규정되어 "
            "있다고 보기 어렵다 — 소득분류 체계도 마찬가지로 사업소득 우선, "
            "그 다음 양도소득 순 (조심 2025서2600)'"
        ),
    },
    "실질과세원칙": {
        "title": "실질과세 원칙 (Substance-over-Form) — 국세기본법 §14",
        "steps": [
            "① FORM-SUBSTANCE GAP: 법적 형식과 경제적 실질이 다른지 확인",
            "② SUBSTANCE IDENTIFICATION: 거래의 경제적 실질은 무엇인가?",
            "③ SHAM TEST: '가장행위' 또는 '조세회피 목적'의 거래인가?",
            "④ RECHARACTERIZATION: 실질에 따라 거래를 재구성 (예: 합병=사업양수도)",
            "⑤ PROPORTIONALITY: 납세자에게 불이익인 재구성은 엄격히 제한",
        ],
        "trigger": "형식은 다르나 경제적 결과가 동일한 거래; 특수관계인 간 비정상 거래; 명의신탁",
        "real_quote": (
            "'완전자본잠식된 자회사를 무증자합병하는 것은 합병법인이 결손상태인 피합병법인의 "
            "사업부를 사실상 사업양수도(무상)한 후 피합병법인을 청산하는 것과 경제적 실질이 "
            "동일하므로, 과세형평상 쟁점포합주식가액은 손금에 산입되는 것으로 봄이 타당하다' "
            "(조심 2025서1909)"
        ),
    },
    "신의성실원칙": {
        "title": "신의성실 원칙 (Good Faith / Estoppel) — 국세기본법 §15",
        "steps": [
            "① AUTHORITY REPRESENTATION: 과세관청이 납세자에게 공적 견해를 표명했는가?",
            "② RELIANCE: 납세자가 그 표명을 신뢰하여 행동했는가?",
            "③ DETRIMENT: 그 신뢰에 반하는 과세처분으로 납세자에게 불이익이 생기는가?",
            "④ ESTOPPEL APPLICATION: 세 요건 충족 시 과세관청은 이전 견해에 구속됨",
            "⑤ LIMIT: 단순한 내부 검토나 비공식 발언은 '공적 견해 표명' 아님",
        ],
        "trigger": "과세관청 안내·예규를 믿고 행동한 납세자; 세무조사 약속 위반; 선행처분과 모순된 처분",
        "real_quote": (
            "'민사 판결문을 가져오면 부과하지 않겠다고 했던 처분청 담당자의 약속(신의성실)은 "
            "반드시 지켜져야 하며, 조세심판원에서도 동일 사안에 대해 인용 결정을 내린바 있음에도 "
            "처분청이 이를 무시하는 것은 부당하다' (조심 2026부0917)"
        ),
    },
    "입증책임": {
        "title": "입증책임 (Burden of Proof) — 과세관청 vs 납세자",
        "steps": [
            "① DEFAULT RULE: 과세요건사실 → 과세관청이 증명",
            "② EXCEPTION: 비과세·공제·감면 요건 → 납세자가 입증",
            "③ SPECIFIC APPLICATION: 매입세액 공제(명의위장 미인식) → 납세자 입증",
            "④ REVERSAL CASES: 경정청구·감액주장 → 납세자가 과다신고 입증",
            "⑤ SHIFT TRIGGER: 세금계산서 가공 의심 → 납세자에게 실물거래 입증의무 이전",
        ],
        "trigger": "사실관계 다툼이 있고 어느 당사자가 증거를 보유하는가의 문제",
        "real_quote": (
            "'과세요건사실의 존부 및 과세근거로 되는 과세표준의 증명책임은 과세관청에 있는 것이며 "
            "(대법원 2022두51031), 손금의 존부 및 범위에 관한 입증책임은 이를 주장하는 납세자에게 있다 "
            "— 매입세액 공제의 경우 명의위장 사실을 알지 못하였고 과실이 없다는 점은 "
            "매입세액의 공제를 주장하는 자가 입증하여야 한다 (대법원)'"
        ),
    },
}

SELECTION_PRINCIPLES = """
┌──────────────────────────────────────────────────────────────────────────────┐
│       FRAMEWORK SELECTION DECISION TREE (해석론 선택 원칙)                    │
└──────────────────────────────────────────────────────────────────────────────┘

STEP 0 — 출발 원칙 (Default Rule)
  조세법규 해석의 기본 = 엄격해석 (strict)
  → '특별한 사정이 없는 한 법문대로 해석한다'
  → 확장/유추해석은 원칙적으로 금지

STEP 1 — 문언이 명백한가? (Is the text clear?)

  YES → 문언해석으로 종결
       "법문이 명확한 경우 규정 자체를 문언대로 해석·적용하여야"
       → 목적론 해석으로 나아갈 필요 없다

  NO  → 다음 단계로

STEP 2 — 경제적 실질과 법적 형식의 괴리가 있는가? (Substance Gap?)

  YES AND: 법적 형식이 다를 뿐 경제적 결과는 동일하다
       → 실질과세원칙 적용 (국세기본법 §14)
       "형식보다 실질에 따라 과세한다"

  YES AND: 가장행위 또는 조세회피 목적이 명백하다
       → 실질과세원칙 + 거래 재구성 (recharacterization)

  NO  → 다음 단계로

STEP 3 — 복수의 법령 또는 동일 법 내 복수 조문이 충돌하는가? (System Conflict?)

  YES → 체계적 해석 적용
       - 특별법 우선
       - 법 내 다른 용어와의 정합성 검토
       - '두 조문이 서로 양립할 수 없는 택일적 관계인가?'

  NO  → 다음 단계로

STEP 4 — 문언 해석이 입법취지를 무력화하는가? (Purpose Defeat?)

  YES → 목적론적 해석 보충 적용
       "규정의 취지와 목적에 비추어 볼 때 타당하지 않다"
       → 입법연혁, 개정이유서, 관련 법령 체계 근거로 목적 특정

  단, 목적론 해석도 문언이 허용하는 범위 내에서만 가능

STEP 5 — 과세관청의 공적 견해 표명이 있었는가? (Authority Representation?)

  YES + 납세자 신뢰 + 불이익 = 신의성실 원칙 적용 (국세기본법 §15)
       금반언 (estoppel): 과세관청은 선행 견해에 구속됨

STEP 6 — 비슷한 사안이지만 조문이 명시적으로 적용되지 않는가? (Coverage Gap?)

  → 원칙: 유추해석 금지
  → 예외: 목적론으로 포섭 가능한 경우, '마찬가지로 해석됨' 논리
  → 감면·특혜규정은 유추 절대 금지

SPECIAL RULE — 입증책임
  ┌──────────────────────────────────┬───────────────────────────────┐
  │ 과세관청이 입증                  │ 납세자가 입증                 │
  ├──────────────────────────────────┼───────────────────────────────┤
  │ 과세요건사실 존재               │ 비과세·감면·공제 요건 충족    │
  │ 과세표준·세액의 산정 근거       │ 손금의 존재와 범위             │
  │ 세무조사 지연의 정당한 사유     │ 세금계산서 선의 수취(과실 없음)│
  │ 10년 장기제척 적용 요건        │ 경정청구의 과다신고 사실       │
  └──────────────────────────────────┴───────────────────────────────┘

SEQUENCING PATTERNS (실제 사건에서의 순서)
  Most common multi-step sequences observed:
  1. 엄격해석 → 문언해석      (감면 요건 검토 표준 흐름)
  2. 문언해석 → 목적론해석    (문언 불명확 → 취지로 보완)
  3. 실질과세 → 문언해석      (실질 확인 후 조문 적용)
  4. 엄격해석 → 실질과세      (원칙 천명 후 실질 검토)
  5. 입증책임 → 실질과세      (사실관계 입증 실패 → 실질과세로 재구성)
"""


def render_report(report: dict) -> str:
    W = 75
    lines: list[str] = []

    def header(t):
        lines.extend(["", "═" * W, f"  {t}", "═" * W])

    def section(t):
        lines.extend(["", f"── {t} " + "─" * max(0, W - len(t) - 4)])

    header("GOAL 3 DEEP DIVE: LEGAL REASONING FRAMEWORKS")
    lines.append(f"  Cases analysed: {report['total_cases']:,}")

    # ── Framework frequency
    section("1. FRAMEWORK USAGE FREQUENCY")
    lines.append(f"  {'Framework':<25} {'Cases':>6} {'Rate':>7} {'Mentions':>9}  Description")
    lines.append("  " + "-" * 70)
    for fw, d in report["framework_frequency"].items():
        bar = "█" * min(d["cases_using"] // 8, 20)
        lines.append(
            f"  {fw:<25} {d['cases_using']:>6} {d['case_rate_pct']:>6.1f}% "
            f"{d['total_mentions']:>9}  {bar}"
        )

    # ── Framework processes
    section("2. STEP-BY-STEP REASONING PROCESS PER FRAMEWORK")
    for fw_name, info in FRAMEWORK_PROCESS.items():
        lines.append(f"\n  ▶ {info['title']}")
        lines.append(f"    Trigger condition: {info['trigger']}")
        lines.append("    Process:")
        for step in info["steps"]:
            lines.append(f"      {step}")
        quote_lines = [info["real_quote"][i:i+68] for i in range(0, len(info["real_quote"]), 68)]
        lines.append("    Actual case quote:")
        for ql in quote_lines:
            lines.append(f"      {ql}")

    # ── Selection principles
    section("3. FRAMEWORK SELECTION PRINCIPLES")
    lines.append(SELECTION_PRINCIPLES)

    # ── Multi-canon sequencing
    section("4. MULTI-CANON SEQUENCING PATTERNS")
    dist = report["canon_count_distribution"]
    total = report["total_cases"]
    lines.append(f"\n  Cases with 0 frameworks detected: {dist['zero']} ({dist['zero']/total*100:.0f}%)")
    lines.append(f"  Cases with single framework:       {dist['single']} ({dist['single']/total*100:.0f}%)")
    lines.append(f"  Cases with multiple frameworks:    {dist['multi']} ({dist['multi']/total*100:.0f}%)")

    lines.append("\n  Most common 2-step sequences:")
    for item in report["common_two_step_sequences"][:8]:
        lines.append(f"    {item['step1']} → {item['step2']}  ({item['count']}건)")

    lines.append("\n  Most common 3-step sequences:")
    for item in report["common_three_step_sequences"][:5]:
        lines.append(f"    {item['step1']} → {item['step2']} → {item['step3']}  ({item['count']}건)")

    # ── Framework by decision outcome
    section("5. FRAMEWORK BY DECISION OUTCOME")
    lines.append("  Which frameworks appear more in 인용/취소 vs 기각?\n")
    for dt, canons in sorted(report["framework_by_decision"].items()):
        if dt in ("인용", "취소", "기각", "재조사", "경정"):
            lines.append(f"  [{dt}]")
            for fw, n in list(canons.items())[:5]:
                lines.append(f"    {fw:<25} {n:>4}")

    # ── Burden of proof
    section("6. BURDEN OF PROOF PATTERNS")
    bp = report["burden_patterns"]
    ta = bp.get("tax_authority_bears", 0)
    tp = bp.get("taxpayer_bears", 0)
    lines.append(f"\n  Tax authority bears burden: {ta} mentions")
    lines.append(f"  Taxpayer bears burden:      {tp} mentions")
    lines.append(f"\n  Ratio (authority:taxpayer): {ta}:{tp}")

    # ── Framework by tax category
    section("7. FRAMEWORK BY TAX CATEGORY")
    for cat, canons in list(report["framework_by_category"].items())[:8]:
        tops = "  ".join(f"{fw.split('(')[0].strip()}({n})" for fw, n in list(canons.items())[:3])
        lines.append(f"  {cat:<20}  {tops}")

    lines.extend(["", "═" * W])
    return "\n".join(lines)


def main():
    path = os.path.join(config.PROCESSED_DIR, "all_cases.jsonl")
    if not os.path.exists(path):
        print("Run main.py first.")
        return

    cases = load_jsonl(path)
    cases_with_text = [c for c in cases if len(c.full_text) > 100 or len(c.summary) > 50]
    print(f"Loaded {len(cases)} total, {len(cases_with_text)} with text.")

    print("Analysing frameworks...")
    analyses = [analyse_case(c) for c in cases_with_text]

    report = build_report(analyses)
    txt = render_report(report)
    print(txt)

    txt_path = os.path.join(OUT_DIR, "reasoning_deep_report.txt")
    json_path = os.path.join(OUT_DIR, "reasoning_deep_report.json")
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(txt)
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    print(f"\nSaved: {txt_path}")
    print(f"Saved: {json_path}")


if __name__ == "__main__":
    main()
