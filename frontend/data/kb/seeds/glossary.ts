import type { KbDocument } from "@/lib/kb-schema";
import { defineSeed } from "./_helpers";

/**
 * 용어집 — AI 가 답변에 사용할 핵심 세무 용어.
 * "이 용어가 답변에 등장하면 무엇을 추가로 점검할지" 를 명시한다.
 */
export const GLOSSARY_SEEDS: KbDocument[] = [
  defineSeed({
    category: "glossary",
    subPath: "substance-over-form",
    frontmatter: {
      title: "실질과세",
      summary:
        "명의·형식이 아닌 실질에 따라 과세 (국기법 §14). 명의 ≠ 실사용/실귀속일 때 본 용어가 답변에 등장한다.",
      tags: ["원칙"],
    },
    body: `
# 실질과세

## 정의
국세기본법 §14. 과세물건의 귀속·거래 내용은 **명의나 형식이 아니라 실질**에 따라.

## 답변에 이 용어가 등장하면 반드시 점검
- [ ] 명의자와 실사용자/실귀속자가 다른지
- [ ] 계약 문구와 실제 거래 흐름이 다른지
- [ ] 가족·특수관계인이 끼었는지
- [ ] 입증 부담은 누구에게 → [[glossary/burden-of-proof]]

## AI 답변 표현 예시
- "거래의 실질을 보면 …"
- "명의는 X이나 실제 귀속은 Y로 …"

## 관련
- 원칙 적용 가이드: [[interpretation-frameworks/substance-over-form]]
- 특수관계인 거래 함정: [[glossary/abuse-of-rights]]
`,
  }),

  defineSeed({
    category: "glossary",
    subPath: "good-faith",
    frontmatter: {
      title: "신의성실",
      summary:
        "납세자·과세관청 모두 신의에 따라 (국기법 §15). 공적 견해표명에 대한 신뢰는 보호.",
    },
    body: `
# 신의성실

## 정의
국세기본법 §15.

## 답변에 등장 시 점검
- [ ] 사용자가 인용한 공적 견해표명이 실제 존재하는지(예규·국세청 회신 등)
- [ ] 4요소 충족 여부 → [[interpretation-frameworks/good-faith]]
- [ ] 사용자가 "직원이 그렇게 안내했다" 수준이면 단순 행정 안내는 견해표명 아님

## AI 답변 표현 예시
- "공적 견해표명에 기초한 행위였다면 신의성실원칙으로 다툴 여지가 있습니다."
`,
  }),

  defineSeed({
    category: "glossary",
    subPath: "burden-of-proof",
    frontmatter: {
      title: "입증책임",
      summary:
        "과세요건 사실 = 과세관청, 비과세·감면·필요경비 요건 = 납세자.",
    },
    body: `
# 입증책임

## 답변에 등장 시 점검
- [ ] 다투는 사실이 어느 쪽 요건인가
- [ ] 사용자가 보유한 증빙 종류·범위
- [ ] 부족하면 "추가 자료 확보 권고"로 답변 마무리

## 상세 가이드
- [[interpretation-frameworks/burden-of-proof]]

## AI 답변 표현 예시
- "이 요건은 납세자가 입증해야 합니다."
- "거래의 가공 여부는 과세관청이 입증해야 합니다."
`,
  }),

  defineSeed({
    category: "glossary",
    subPath: "necessary-expense",
    frontmatter: {
      title: "필요경비",
      summary:
        "수입을 얻기 위한 직접 지출. 종합소득세 사업소득의 손금 개념(소법 §27 등).",
    },
    body: `
# 필요경비

## 정의
소득세법상 사업소득의 손금 개념. 법인세의 [[glossary/deductible]] 에 대응.

## 3요건 (답변 시 항상 묻는다)
1. **업무 관련성** — 사업과의 직접·간접 인과
2. **통상성** — 사회 통념상 통상적
3. **증빙** — 영수증·세금계산서 등

## 답변에 등장 시 점검
- [ ] 사용자의 비용이 3요건 중 어느 부분에서 약한가
- [ ] [[interpretation-frameworks/burden-of-proof]] 적용

## 관련
- [[glossary/non-business-expense]]
`,
  }),

  defineSeed({
    category: "glossary",
    subPath: "non-business-expense",
    frontmatter: {
      title: "업무무관비",
      summary: "사업과 무관한 지출. 손금불산입 + 부가세 매입세액 불공제.",
    },
    body: `
# 업무무관비

## 답변에 등장 시 점검
- [ ] 손금불산입 처리만 알려주면 안 됨 — **부가세 매입세액 불공제**도 함께 안내
- [ ] 가족 동반·사적 사용 정황이 있는지

## 전형 사례
- 원장·임원의 사적 골프·헬스장 사용
- 가족 동반 여행
- 사업과 무관한 기부

## 관련
- [[glossary/non-deductible]]
- [[interpretation-frameworks/substance-over-form]]
`,
  }),

  defineSeed({
    category: "glossary",
    subPath: "deductible",
    frontmatter: {
      title: "손금산입",
      summary: "법인세법상 비용 인정 항목 (법법 §19~26).",
    },
    body: `
# 손금산입

## 정의
법인세법 §19~26. 사업소득의 [[glossary/necessary-expense]] 와 대응.

## 답변 시 주의
- 사용자가 개인사업자면 "손금" 대신 "필요경비"로 용어 통일.
- 법인이면 손금 한도 규정(접대비 한도 등) 별도 점검.
`,
  }),

  defineSeed({
    category: "glossary",
    subPath: "non-deductible",
    frontmatter: {
      title: "손금불산입",
      summary: "법인세법상 비용 부인 (한도 초과 포함).",
    },
    body: `
# 손금불산입

## 답변에 등장 시 점검
- [ ] 단순 한도 초과인가 vs 본질적 부인인가
- [ ] 부가세 매입세액 불공제까지 함께 적용되는가

## 대표 사유
- [[glossary/non-business-expense]]
- 접대비 한도 초과
- 가산세·벌과금·소득세
- [[glossary/abuse-of-rights]]

## AI 답변 표현 예시
- "이 비용은 손금불산입 대상이며, 동일 거래의 부가세도 매입세액 불공제됩니다."
`,
  }),

  defineSeed({
    category: "glossary",
    subPath: "abuse-of-rights",
    frontmatter: {
      title: "부당행위계산부인",
      summary:
        "특수관계인 거래에서 시가와 다른 가액 → 정상가액으로 재계산 (법법 §52, 소법 §41).",
    },
    body: `
# 부당행위계산부인

## 답변에 등장 시 점검
- [ ] 거래 상대방이 **특수관계인**인가
- [ ] 시가 대비 유리/불리 가액인가
- [ ] 시가 산정 근거(감정평가·유사 거래 등)가 있는가

## 자주 등장하는 패턴
- 원장 가족에게 의료기기·부동산 저가 양도
- 가족 회사 간 임대료 저가
- 가족 직원에게 비현실적 고급여

## 관련
- [[interpretation-frameworks/substance-over-form]]
`,
  }),

  defineSeed({
    category: "glossary",
    subPath: "surtax",
    frontmatter: {
      title: "가산세",
      summary: "신고·납부의무 위반에 대한 행정 제재 (국기법 §47의2 이하).",
    },
    body: `
# 가산세

## 답변에 등장 시 점검
- [ ] 무신고·과소신고·납부지연 중 어느 것인가
- [ ] **부정 행위** 해당 여부 — 가중 적용
- [ ] 본세와 별도로 계산되는 점을 안내

## 대표 종류
- 무신고 가산세
- 과소신고 가산세 (일반/부정)
- 납부지연 가산세
- 원천징수 등 납부지연 가산세
`,
  }),
];
