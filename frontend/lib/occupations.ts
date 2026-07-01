/**
 * 직업군 메타데이터 + 대화 데이터 매핑.
 * 활성(active) 직업군만 챗 진입 가능. 나머지는 "준비중".
 */

export type OccupationKey = "general" | "clinic" | "online-seller" | "beauty";
export type OccupationStatus = "active" | "coming";

export interface Occupation {
  key: OccupationKey;
  label: string;
  description: string;
  emoji: string;
  status: OccupationStatus;
  /** load-conversation 레지스트리의 대화 ID 목록 (active일 때) */
  conversationIds?: string[];
}

export const OCCUPATIONS: Occupation[] = [
  {
    key: "clinic",
    label: "병의원",
    description: "원장 비용처리·면세/과세 구분 등 의료 세무",
    emoji: "🩺",
    status: "active",
    conversationIds: ["clinic-vehicle", "clinic-golf", "clinic-gym"],
  },
  {
    key: "online-seller",
    label: "온라인 셀러",
    description: "부가세·매입세액·영세율 등 이커머스 세무",
    emoji: "🛒",
    status: "coming",
  },
  {
    key: "beauty",
    label: "미용",
    description: "현금매출·간이과세 등 뷰티샵 세무",
    emoji: "💇",
    status: "coming",
  },
  {
    key: "general",
    label: "소상공인 (일반)",
    description: "종소세·부가세 일반 상담",
    emoji: "🏪",
    status: "coming",
  },
];

export function getOccupation(key: string): Occupation | undefined {
  return OCCUPATIONS.find((o) => o.key === key);
}

export function isActiveOccupation(key: string): boolean {
  return getOccupation(key)?.status === "active";
}
