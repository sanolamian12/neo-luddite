import type { KbDocument } from "@/lib/kb-schema";
import { defineSeed } from "./_helpers";

/**
 * 해석론 — AI 가 적용할 조세법 해석 원칙.
 * `selection-principles` 가 선택 결정 트리이며 나머지 8 종이 개별 원칙.
 */

const SELECTION_PRINCIPLES = defineSeed({
  category: "interpretation-framework",
  subPath: "selection-principles",
  frontmatter: {
    title: "해석 원칙 선택 결정 트리",
    summary:
      "질문 유형에 따라 어떤 해석 원칙(framework)을 적용할지 결정하는 가이드. 모든 답변은 본 트리를 거친다.",
    tags: ["메타", "프레임워크 선택"],
  },
  body: `
# 해석 원칙 선택 결정 트리

세무 질문에 답하기 전, 다음 결정 트리에 따라 적용할 framework 를 선택한다.
복수 선택 가능하며, 우선순위는 §우선순위 규칙 참조.

## Step 1 — 사용자 사실관계 vs 법문 형식
- 형식과 실질이 일치 → **[[interpretation-frameworks/literal]]** + **[[interpretation-frameworks/strict-interpretation]]**
- 형식과 실질이 다름(명의 ≠ 실사용자, 계약 ≠ 실제 거래) → **[[interpretation-frameworks/substance-over-form]]** 우선

## Step 2 — 법문 자체의 명확성
- 법문 명확 → **[[interpretation-frameworks/literal]]** 으로 종결
- 법문 모호·복수 해석 가능 → **[[interpretation-frameworks/systematic]]** + **[[interpretation-frameworks/teleological]]** 검토
- 명시 없는 사안 → **[[interpretation-frameworks/analogical]]** 검토 (조세 영역에서는 원칙적 금지)

## Step 3 — 입증 부담의 분배
- 과세요건 사실 → 과세관청 입증
- 비과세·감면·필요경비·손금 요건 → 납세자 입증
- 입증이 쟁점이면 **[[interpretation-frameworks/burden-of-proof]]** 적용

## Step 4 — 관청의 견해 표명
- 일관된 공적 견해 표명 + 사용자가 그에 기초하여 행위 → **[[interpretation-frameworks/good-faith]]** 추가 검토

## 우선순위 규칙
1. **감면·특혜 규정** → 엄격해석 > 목적론해석. 확장 해석 금지.
2. **명백한 법문 위반** → 어떤 원칙도 이를 뒤집을 수 없다.
3. **실질과세는 확장 해석의 도구가 아니다** — 엄격해석과 충돌하면 사실관계 입증부터.
4. **유추해석은 납세자에게 유리한 방향에서만 비교적 관대** — 과세 확장 유추는 금지.

## 자주 등장하는 조합

| 질문 유형 | 적용 framework 조합 |
|---|---|
| 비용 인정(차량유지비·접대비·복리후생비 등) | 엄격해석 + 입증책임 |
| 가족·특수관계인 거래 | 실질과세 + (부당행위계산부인 검토) |
| 명의신탁·차명거래 | 실질과세 + 입증책임 |
| 감면·특혜 규정 적용 여부 | 엄격해석 + 문언해석 |
| 과세관청의 종전 견해 변경 | 신의성실 + 체계적해석 |

## 답변에서의 표기
선택한 framework 는 답변의 §2(적용한 해석 원칙) 섹션에서 **이름과 이유**를
함께 적는다. 예:

> 적용 원칙: 엄격해석 + 입증책임 — 비용 인정 다툼이므로 납세자(원장)가
> 업무 관련성·증빙을 입증해야 한다.

## 관련
- 마스터: [[skill]]
- 개별 원칙: 본 폴더 내 8 종 참조.
`,
});

const STRICT_INTERPRETATION = defineSeed({
  category: "interpretation-framework",
  subPath: "strict-interpretation",
  frontmatter: {
    title: "엄격해석",
    framework: "엄격해석",
    summary:
      "조세법규는 법문대로. 합리적 이유 없는 확장·유추 금지. 감면·특혜 규정은 더 엄격.",
    tags: ["조세법률주의", "조세공평"],
  },
  body: `
# 엄격해석

## 언제 적용하는가
다음 신호가 있으면 본 원칙을 우선 검토:
- 사용자가 **감면·세액공제·특례** 적용 여부를 묻는 경우
- 사용자가 법문에 명시되지 않은 사안을 "비슷하니까 되지 않냐"고 묻는 경우
- 행정청이 법문을 넘어 확장한 해석을 하고 있다고 사용자가 주장하는 경우

## 적용 절차
1. 법문 원문을 인용(또는 사용자에게 확인 요청)한다.
2. 사용자가 주장하는 사안이 법문 범위 내인지 vs 확장이 필요한지 판별한다.
3. 확장이 필요하면 **원칙적으로 부정**한다.
4. 예외(목적론해석 등)를 검토할 수 있는지 [[interpretation-frameworks/selection-principles]]
   로 돌아가 결정.

## 충돌 / 한계
- [[interpretation-frameworks/teleological]] 과 자주 충돌. 감면·특혜에서는 본 원칙 우선.
- [[interpretation-frameworks/substance-over-form]] 도 본 원칙을 우회하는 도구가 될 수 없다.

## 답변 시 표현
- "조세법규는 법문대로 해석함이 원칙이며 …"
- "감면 규정은 더 엄격히 해석되므로 …"

## 인용 가능 케이스 / 법령
- 대법원 2008.10.23. 선고 2008두7830 판결 (대표 인용)
- [[case-precedents/josim-2025-gu-1960]]

## 관련
- [[interpretation-frameworks/literal]] · [[interpretation-frameworks/analogical]]
`,
  citations: [
    { kind: "case", caseId: "조심2025구1960" },
    { kind: "case", caseId: "조심2025부4364" },
    { kind: "case", caseId: "조심2025부4055" },
  ],
});

const TELEOLOGICAL = defineSeed({
  category: "interpretation-framework",
  subPath: "teleological",
  frontmatter: {
    title: "목적론해석",
    framework: "목적론해석",
    summary:
      "법문 모호 / 형식 해석이 입법목적을 훼손할 때 입법취지로 보완.",
    tags: ["입법취지"],
  },
  body: `
# 목적론해석

## 언제 적용하는가
- 법문이 두 가지 이상으로 해석되어 모호한 경우
- 형식 해석만 따르면 입법목적이 명백히 훼손되는 경우
- 사용자가 "입법 취지상 …" 을 거론하는 경우

## 적용 절차
1. 법문이 명확하다면 본 원칙을 적용하지 않는다 — [[interpretation-frameworks/literal]] 로 종결.
2. 입법자료(기재부 보도자료·국회 심사보고서·법률 제·개정 이유)를 인용 가능한 한
   제시한다(없으면 그 자체를 명시).
3. 입법목적에 부합하는 해석안을 도출하고, 이것이 [[interpretation-frameworks/strict-interpretation]]
   과 충돌하는지 확인.

## 한계
- **감면·특혜** 규정에는 적용하지 않는다 — 엄격해석 우선.
- 입법취지를 빌어 확장 해석으로 미끄러지지 않도록 자신을 검열한다.

## 답변 시 표현
- "입법취지를 고려하여 합목적적으로 해석하면 …"

## 관련
- [[interpretation-frameworks/strict-interpretation]] · [[interpretation-frameworks/systematic]]
`,
});

const SYSTEMATIC = defineSeed({
  category: "interpretation-framework",
  subPath: "systematic",
  frontmatter: {
    title: "체계적해석",
    framework: "체계적해석",
    summary: "조문 간·법령 간 정합성을 고려한 해석. 별표·시행규칙·관련 법령 비교.",
    tags: ["조문 정합성"],
  },
  body: `
# 체계적해석

## 언제 적용하는가
- 동일 용어가 여러 조문·법령에서 다르게 사용되는지 확인이 필요한 경우
- 시행령·시행규칙이 모법의 위임 한계를 벗어났는지 의심되는 경우
- 별표·서식이 본문 규정과 충돌하는 경우

## 적용 절차
1. 쟁점이 된 조문의 상·하위 법령을 함께 본다.
2. 동일 용어가 다른 조문에서 어떻게 정의·사용되는지 확인한다.
3. 충돌이 있다면 **상위 법령이 우선**.
4. 시행령이 위임 범위를 벗어났다면 본 원칙으로 비판할 수 있다.

## 한계
- 다른 조문 한 줄로 결론을 단정하지 않는다 — 전체 체계를 본다.

## 관련
- [[interpretation-frameworks/literal]] · [[interpretation-frameworks/teleological]]
`,
});

const SUBSTANCE_OVER_FORM = defineSeed({
  category: "interpretation-framework",
  subPath: "substance-over-form",
  frontmatter: {
    title: "실질과세원칙",
    framework: "실질과세원칙",
    summary:
      "거래의 형식이 아닌 실질에 따라 과세. 명의·계약서 ≠ 실제 귀속·실제 거래일 때.",
    tags: ["실질귀속", "실질거래"],
  },
  body: `
# 실질과세원칙

## 언제 적용하는가
다음 신호가 있으면 본 원칙을 우선 검토:
- 명의자와 실제 사용자·이익 귀속자가 다르다
- 계약서 문구와 실제 거래 흐름이 다르다
- 가족·특수관계인을 끼운 거래
- 차명거래·명의신탁·우회거래로 보이는 경우

근거: 국세기본법 §14.

## 적용 절차
1. **사실관계 정리** — 누가·무엇을·누구에게·어떻게.
2. **명의 vs 실질 비교** — 차이가 어디에서 나타나는가?
3. **실질에 따른 과세 결과 도출** — 실질 귀속자·실질 거래로 재구성.
4. **입증 부담 확인** — 사실관계 입증은 누구에게 있는가 → [[interpretation-frameworks/burden-of-proof]]

## 충돌 / 한계
- [[interpretation-frameworks/strict-interpretation]] 과 충돌 시: 본 원칙을 확장 해석의
  도구로 쓰지 않는다.
- 사실관계 입증이 충분하지 않다면 단정하지 않고 "사실관계 확인 시 …" 형태로 답.

## 답변 시 표현
- "거래의 실질을 보면 …"
- "명의는 X이나 실제 귀속은 Y로 판단되어 …"

## 관련
- [[glossary/substance-over-form]] · [[glossary/abuse-of-rights]]
`,
});

const GOOD_FAITH = defineSeed({
  category: "interpretation-framework",
  subPath: "good-faith",
  frontmatter: {
    title: "신의성실원칙",
    framework: "신의성실원칙",
    summary:
      "납세자·과세관청 모두 신의에 따라. 관청의 공적 견해표명에 대한 신뢰는 보호.",
    tags: ["신뢰보호"],
  },
  body: `
# 신의성실원칙

## 언제 적용하는가
- 과세관청이 **종전과 다른** 해석으로 과세하는 경우
- 사용자가 **공적 견해표명**(예규·국세청 회신·국세상담 답변)에 따라 행위했다고 주장하는 경우

근거: 국세기본법 §15.

## 신뢰보호 4요소
모두 충족해야 본 원칙으로 처분을 다툴 수 있다:
1. **공적 견해표명** 존재
2. 견해표명이 **정당하다고 신뢰**할 만한 사정
3. 신뢰에 기초한 **납세자의 행위**
4. 신뢰에 반하는 처분으로 인한 **불이익**

## 적용 절차
1. 사용자에게 견해표명의 문서·출처를 확인 요청한다(없으면 본 원칙 적용 곤란).
2. 4요소를 하나씩 점검한다.
3. 일부 미충족이면 적용 한계를 명시한다.

## 답변 시 표현
- "공적 견해표명이 있었고 사용자가 그에 따라 행위했다면 신의성실원칙으로 다툴 여지가 있다."

## 관련
- [[glossary/good-faith]]
`,
});

const BURDEN_OF_PROOF = defineSeed({
  category: "interpretation-framework",
  subPath: "burden-of-proof",
  frontmatter: {
    title: "입증책임",
    framework: "입증책임",
    summary:
      "과세요건 사실 = 과세관청. 비과세·감면·필요경비·손금 요건 = 납세자.",
    tags: ["증빙"],
  },
  body: `
# 입증책임

## 언제 적용하는가
- 사실관계의 진위가 다투어지는 경우
- 비용 인정·감면 적용 여부가 쟁점인 경우

## 분배 규칙
| 다투는 사실 | 입증책임 |
|---|---|
| 과세요건 (수입의 존재·소득의 귀속 등) | 과세관청 |
| 비과세·감면 적용 요건 | 납세자 |
| 필요경비·손금 요건(업무 관련성·통상성·증빙) | 납세자 |
| 거래의 가공·허위 여부 | 과세관청 |

## 적용 절차
1. 쟁점이 어느 쪽 요건에 해당하는지 식별.
2. 사용자에게 보유 증빙(영수증·세금계산서·운행기록부·계약서·일정 등)을 확인.
3. 부족하면 "추가 자료 확보 권고" 로 답변을 마무리.

## 답변 시 표현
- "이 비용은 사업과의 관련성을 납세자가 입증해야 하므로 …"
- "이 거래의 가공 여부는 과세관청이 입증해야 한다."

## 관련
- [[glossary/burden-of-proof]] · [[glossary/necessary-expense]]
- 케이스: [[case-precedents/josim-2025-bu-4055]]
`,
  citations: [{ kind: "case", caseId: "조심2025부4055" }],
});

const ANALOGICAL = defineSeed({
  category: "interpretation-framework",
  subPath: "analogical",
  frontmatter: {
    title: "유추해석",
    framework: "유추해석",
    summary: "명시 규정이 없는 사안에 유사 규정 적용. 조세에서는 원칙 금지.",
    tags: ["조세법률주의"],
  },
  body: `
# 유추해석

## 적용 원칙
조세 영역에서 유추해석은 **원칙 금지**다. 다만:
- 납세자에게 **유리한 방향**의 유추는 비교적 관대.
- 과세를 **확장**하는 유추는 엄격히 금지.

## AI 가 해야 할 것
1. 사용자가 "비슷하니까 적용 가능 아닌가요"라고 물으면 **신중하게 답한다**.
2. 명시 규정 부재를 분명히 짚는다.
3. 사용자에게 유리한 유추라도 **단정 대신** "다툼의 여지가 있다" 톤으로.

## 관련
- [[interpretation-frameworks/strict-interpretation]] · [[interpretation-frameworks/teleological]]
`,
});

const LITERAL = defineSeed({
  category: "interpretation-framework",
  subPath: "literal",
  frontmatter: {
    title: "문언해석",
    framework: "문언해석",
    summary: "법문의 사전적 의미·통상 용법. 엄격해석의 기본 도구.",
    tags: ["사전적 의미"],
  },
  body: `
# 문언해석

## 언제 적용하는가
- 거의 모든 답변의 **출발점**. 법문 문구가 명확하면 여기서 결론이 난다.

## 적용 절차
1. 법문 원문을 가져온다.
2. 정의 규정이 있는지 확인. 있으면 정의에 따른다.
3. 정의가 없으면 사전적·통상적 의미.

## 한계
- 문구가 모호하면 [[interpretation-frameworks/systematic]] 또는
  [[interpretation-frameworks/teleological]] 로 진행.

## 관련
- [[interpretation-frameworks/strict-interpretation]]
`,
});

export const FRAMEWORK_SEEDS: KbDocument[] = [
  SELECTION_PRINCIPLES,
  STRICT_INTERPRETATION,
  TELEOLOGICAL,
  SYSTEMATIC,
  SUBSTANCE_OVER_FORM,
  GOOD_FAITH,
  BURDEN_OF_PROOF,
  ANALOGICAL,
  LITERAL,
];
