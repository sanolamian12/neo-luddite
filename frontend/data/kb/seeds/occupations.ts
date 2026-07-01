import type { KbDocument } from "@/lib/kb-schema";
import { defineSeed } from "./_helpers";

/**
 * 직업군 — 업종별 답변 playbook.
 * 사용자의 업종(occupation)을 확인하면 본 폴더의 해당 가이드를 우선 참조한다.
 */
export const OCCUPATION_SEEDS: KbDocument[] = [
  defineSeed({
    category: "occupation",
    subPath: "clinic/overview",
    frontmatter: {
      title: "병의원 — 개요 (playbook)",
      summary:
        "병의원 원장의 세무 질문에 답할 때 적용할 공통 컨텍스트와 자주 다투는 쟁점 인덱스.",
      occupation: "clinic",
      tags: ["병의원", "원장"],
    },
    body: `
# 병의원 — 개요 playbook

## 사용 시점
사용자의 업종이 **병의원**(원장 / 의료법인 / 개인사업자) 임이 확인된 직후
본 가이드를 활성화한다.

## 업종 컨텍스트 (AI 가 항상 염두에 둘 것)
- 진료 수익은 대부분 **면세** — 부가세 매입세액 공제 시 안분 필요.
- 비급여·비의료 수익은 과세 영역 — 부가세 신고 누락 빈발.
- **원장 개인 비용과 사업 비용의 경계**가 가장 잦은 쟁점.

## 자주 다투는 쟁점 (각 항목별 playbook)
- 업무용 차량 — [[occupations/clinic/vehicle-expenses]]
- 골프 회원권/이용료 — [[occupations/clinic/golf-membership]]
- 헬스장 회원권 — [[occupations/clinic/gym-membership]]

## 공통 답변 패턴
모든 쟁점은 결국 다음 두 축으로 정리:
1. **업무 관련성** — [[interpretation-frameworks/substance-over-form]] + [[glossary/necessary-expense]]
2. **입증 가능성** — [[interpretation-frameworks/burden-of-proof]] + [[glossary/burden-of-proof]]

## 점검 체크리스트 (답변 전 확인)
- [ ] 사용자가 법인인가 개인사업자인가
- [ ] 사용자가 일반과세자인가 면세사업자인가(부가세 관련)
- [ ] 다투는 비용이 **누구의 명의·실사용**인가
- [ ] **증빙**(영수증·운행기록부·계약서·일정) 보유 여부

## 답변 표현 가이드
- 진료 수익 관련 답변에서는 **면세/과세 안분** 점검 권고를 추가한다.
- 가족(자녀·배우자)이 거론되면 [[interpretation-frameworks/substance-over-form]] +
  [[glossary/abuse-of-rights]] 를 추가 검토한다.

## 미커버 영역 (사용자가 물으면)
의약품 폐기손, 의료기기 감가상각, 부동산 임대 — 본 시드에 없음.
"본 가이드 범위 밖이므로 일반 원칙으로 답하나, 전문가 자문 권고" 안내.
`,
  }),

  defineSeed({
    category: "occupation",
    subPath: "clinic/vehicle-expenses",
    frontmatter: {
      title: "병의원 — 차량유지비 playbook",
      summary:
        "원장 차량(리스/구매)의 유지비를 어디까지 비용 인정할지에 대한 답변 패턴.",
      occupation: "clinic",
      tags: ["차량", "리스", "운행기록부"],
    },
    body: `
# 병의원 — 차량유지비 playbook

## 사용 시점
사용자가 차량 관련 비용(리스료·연료비·수리비·보험료) 처리를 물어볼 때.

## 답변 절차
1. **사실관계 확인 (질문해서라도 보강)**
   - 차량 명의: 법인 / 개인사업자 / 원장 개인
   - 차종: 일반 / 고급차·스포츠카 (사회 통념상 업무용 적합성)
   - 사용 현황: 운행기록부 유무, 임직원 전용 보험 가입 여부
   - 가족 동승·사적 사용 여부
2. **해석 원칙 적용**
   - [[interpretation-frameworks/strict-interpretation]] + [[interpretation-frameworks/burden-of-proof]]
3. **결론 도출**
   - 입증 자료 충분 → **업무사용분 안분 인정**
   - 입증 자료 부재 → **세법상 정한 비율(또는 전액) 부인**
   - 임직원 전용 보험·운행기록부 미충족 시 손금 한도 적용 불가

## 답변 표현 (예시)
> 리스료의 전액 손금 처리는 어렵습니다. 차량을 업무용으로 사용한 비율을
> 운행기록부·일정 등으로 입증해야 합니다(입증책임 원칙). 임직원 전용 보험에
> 가입되어 있지 않다면 손금 한도 적용에서도 불리합니다(엄격해석).
>
> 권장:
> 1. 운행기록부 작성·보관
> 2. 임직원 전용 자동차보험 가입
> 3. 사적 사용분은 안분하여 손금 산입 제외

## 인용 자료
- [[case-precedents/josim-2025-gu-1960]]
- [[case-precedents/josim-2025-bu-4364]]
- 소득세법 §33 — [[glossary/necessary-expense]]

## 경고할 패턴
- "100% 비용으로 처리해도 되나요?" → [[pitfalls/overview]] 의 100% 손금 패턴 경고.
`,
    citations: [
      { kind: "case", caseId: "조심2025구1960" },
      { kind: "case", caseId: "조심2025부4364" },
      { kind: "law", ref: "소득세법 §33", label: "필요경비" },
    ],
  }),

  defineSeed({
    category: "occupation",
    subPath: "clinic/golf-membership",
    frontmatter: {
      title: "병의원 — 골프 회원권 playbook",
      summary:
        "골프 회원권/연회비/이용료를 접대비·복리후생·업무무관비 중 어디로 볼지의 결정 가이드.",
      occupation: "clinic",
      tags: ["접대비", "골프"],
    },
    body: `
# 병의원 — 골프 회원권 playbook

## 사용 시점
사용자가 골프 회원권·연회비·라운딩 비용 처리를 물어볼 때.

## 분류 결정 트리
\`\`\`
사용자에게 묻는다: "누가 사용했고, 그 자리에 누가 동석했는가?"
  ├─ 거래처/외부 업무 관계자와 함께  → 접대비 (한도 내 손금)
  ├─ 전 직원 균등 사용 (병의원에서 드묾)  → 복리후생비 (전 직원성 입증 필요)
  └─ 원장 본인·가족·사적 모임  → 업무무관비 (손금불산입 + 부가세 매입세액 불공제)
\`\`\`

## 해석 원칙
- [[interpretation-frameworks/strict-interpretation]] (감면 아니지만 한도 규정 엄격)
- [[interpretation-frameworks/burden-of-proof]] (납세자가 사용 목적 입증)
- [[interpretation-frameworks/substance-over-form]] (명의가 회사여도 실사용자가 누구인가)

## 점검 체크리스트
- [ ] 사용 일자·동석자·업무 안건 기록 보유
- [ ] 영수증·신용카드 명세 보유
- [ ] 회원권이 법인 명의이면, 실제 사용자가 사업 관련자인지 사용 기록으로 입증 가능한가

## 답변 표현 (예시)
> 골프 회원권의 비용 성격은 실제 **누가, 누구와, 무슨 목적으로** 사용했는가에
> 따라 결정됩니다(실질과세). 거래처 접대로 입증되는 부분은 접대비 한도 내 손금,
> 사적 사용분은 업무무관비로 손금불산입과 부가세 매입세액 불공제 대상입니다.

## 인용
- [[case-precedents/josim-2025-bu-4055]]

## 경고할 패턴
- "회사 명의로 사면 자동 인정" — 거짓. 실질과세 + 입증책임 패턴 경고.
`,
    citations: [{ kind: "case", caseId: "조심2025부4055" }],
  }),

  defineSeed({
    category: "occupation",
    subPath: "clinic/gym-membership",
    frontmatter: {
      title: "병의원 — 헬스장 회원권 playbook",
      summary:
        "헬스장 회원권을 직원 복리후생비로 인정받기 위한 요건 점검 가이드.",
      occupation: "clinic",
      tags: ["복리후생비"],
    },
    body: `
# 병의원 — 헬스장 회원권 playbook

## 사용 시점
사용자가 헬스장(또는 유사 시설) 회원권 비용을 물어볼 때.

## 복리후생비 인정 3요건 (모두 충족 필요)
1. **전 직원 대상** 또는 균등 적용 기준 명확
2. 사내 규정·근로계약·취업규칙에 **명문 규정**
3. 사용 기록 등으로 실제 균등 사용 **입증**

하나라도 미충족 → **업무무관비**(원장·가족 위주 사용 시 특히).

## 해석 원칙
- [[interpretation-frameworks/substance-over-form]] + [[interpretation-frameworks/burden-of-proof]]

## 점검 체크리스트
- [ ] 직원 수, 회원권 발급 인원
- [ ] 사내 규정·계약서에 복리후생 명시
- [ ] 사용 기록(출입 기록·운영사 명세)
- [ ] 원장·가족 사용분 분리 여부

## 답변 표현 (예시)
> 헬스장 회원권을 복리후생비로 인정받으려면 전 직원 대상성·사내 규정·실제 사용
> 입증의 3요건이 모두 충족되어야 합니다. 일부 직원만 사용하거나 원장·가족 중심
> 사용이면 업무무관비로 부인될 가능성이 높습니다.

## 인용
- [[case-precedents/josim-2025-gu-1960]]

## 경고할 패턴
- "근로계약에 한 줄 넣었다고 무조건 인정" — 실제 사용 입증 부족 시 부인 가능.
`,
    citations: [{ kind: "case", caseId: "조심2025구1960" }],
  }),
];
