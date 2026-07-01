import type { KbDocument } from "@/lib/kb-schema";
import { defineSeed } from "./_helpers";

/**
 * 판례노트 — AI 가 답변 근거로 인용할 케이스.
 * "이 케이스를 인용해야 하는 상황"을 분명히 명시한다.
 */
export const CASE_SEEDS: KbDocument[] = [
  defineSeed({
    category: "case-precedent",
    subPath: "josim-2025-gu-1960",
    frontmatter: {
      title: "조심2025구1960 — 업무용 차량·복리후생비 부인",
      caseId: "조심2025구1960",
      summary:
        "운행기록부 미비 + 사적 사용 실태 → 차량유지비 일부 + 헬스장 회원권 복리후생비 부인.",
      tags: ["차량", "복리후생비", "엄격해석"],
    },
    body: `
# 조심2025구1960

## 사실관계 요지
병의원 원장이 차량 리스료·유지비 100%, 헬스장 회원권을 복리후생비로 처리.
세무조사 결과:
- 운행기록부 미작성, 사적 사용 정황
- 헬스장은 사실상 원장 본인 위주 사용

## 쟁점
- 차량유지비를 100% 손금 처리할 수 있는가
- 헬스장 회원권의 복리후생비 인정 요건 충족 여부

## 판단 (기각 — 과세관청 일부 인용)
- **차량**: 운행기록부 등 업무사용 입증 자료 부재 → **업무사용분만 안분 인정**.
- **헬스장**: 전 직원 대상성·균등 사용 입증 부족 → 복리후생비 부인,
  업무무관비로 재분류.

## 이 케이스를 인용해야 하는 상황 (AI 가이드)
사용자의 질문이 다음 패턴에 부합하면 본 케이스를 인용한다:
- 차량유지비 100% 손금 처리 + 운행기록부 부재
- 직원용으로 등록한 시설이 실제 원장 사용 위주

## 답변에서의 인용 형식
> 조세심판원도 동일 쟁점에서 운행기록부 등 입증 자료 부재 시 업무사용분만 안분
> 인정한 바 있습니다(조심2025구1960).

## 관련 문서
- [[occupations/clinic/vehicle-expenses]] · [[occupations/clinic/gym-membership]]
- [[interpretation-frameworks/strict-interpretation]] · [[interpretation-frameworks/burden-of-proof]]
`,
    citations: [{ kind: "case", caseId: "조심2025구1960" }],
  }),

  defineSeed({
    category: "case-precedent",
    subPath: "josim-2025-bu-4364",
    frontmatter: {
      title: "조심2025부4364 — 리스 차량 손금 한도 요건",
      caseId: "조심2025부4364",
      summary:
        "임직원 전용 보험·운행기록부·업무사용 비율 요건 부분 미충족 시 손금 일부 부인.",
      tags: ["차량", "리스"],
    },
    body: `
# 조심2025부4364

## 쟁점
- 리스 차량의 손금 산입 한도 적용 요건 충족 여부.

## 판단 요지
- 손금 한도 적용을 받으려면:
  1. 임직원 전용 자동차보험 가입
  2. 운행기록부 작성
  3. 업무사용 비율 입증
- 일부 요건 미충족 시 **부분 부인**.

## 이 케이스를 인용해야 하는 상황
- 리스 차량 손금 처리 요건을 사용자가 정확히 모르고 있을 때.
- 임직원 전용 보험 미가입 / 운행기록부 부재 케이스.

## 답변에서의 인용 형식
> 리스 차량의 손금 한도 적용은 임직원 전용 보험·운행기록부·업무사용 입증의
> 세 요건이 모두 필요합니다(조심2025부4364).

## 관련 문서
- [[occupations/clinic/vehicle-expenses]]
- [[interpretation-frameworks/burden-of-proof]]
`,
    citations: [{ kind: "case", caseId: "조심2025부4364" }],
  }),

  defineSeed({
    category: "case-precedent",
    subPath: "josim-2025-bu-4055",
    frontmatter: {
      title: "조심2025부4055 — 골프 회원권 접대비/업무무관비 구분",
      caseId: "조심2025부4055",
      summary:
        "접대 입증분만 접대비 한도 내 손금. 사적 사용분은 업무무관비로 부인 + 부가세 매입세액 불공제.",
      tags: ["접대비", "골프"],
    },
    body: `
# 조심2025부4055

## 쟁점
- 골프 회원권 연회비·이용료를 어떻게 분류할 것인가.

## 판단 요지
- **접대 목적 입증분**(거래처·업무 관계자 동석 등) → 접대비 한도 내 손금.
- **사적 사용분** → 업무무관비. 손금불산입 + 부가세 매입세액 불공제.
- 사용 일지·동석자 기록 등 입증 자료가 핵심.

## 이 케이스를 인용해야 하는 상황
- 골프 비용 전액을 접대비로 처리한 사용자.
- 회사 명의 회원권의 사적 사용 여부가 다투어지는 경우.

## 답변에서의 인용 형식
> 골프 비용은 사용 목적별로 분리 인정됩니다. 접대 입증분만 접대비
> 한도 내 손금이며, 사적 사용분은 업무무관비로 부인됩니다(조심2025부4055).

## 관련 문서
- [[occupations/clinic/golf-membership]]
- [[interpretation-frameworks/burden-of-proof]] · [[interpretation-frameworks/substance-over-form]]
`,
    citations: [{ kind: "case", caseId: "조심2025부4055" }],
  }),
];
