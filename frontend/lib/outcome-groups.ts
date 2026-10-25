/**
 * rag.chat_turns.outcome(답변 갈래) → 화면 이름·묶음. 관리자 사용 현황이 쓰는 한 곳(설계 1021 §2.6-5).
 * 새 갈래가 백엔드에 생기면 여기 OUTCOME_LABEL·OUTCOME_GROUP 두 줄만 더한다(빠지면 "기타" 로 묶인다).
 */

export type OutcomeGroup = "answered" | "asked_back" | "no_material" | "off_topic" | "congested" | "handoff" | "other";

export const OUTCOME_LABEL: Record<string, string> = {
  verdict: "판정 답변",
  advisory: "자문형 답변",
  law_advisory: "법령 안내",
  calc: "세액 계산",
  stock_calc: "주식 세금 계산",
  gift_calc: "증여세 계산",
  missing_inputs: "되묻기",
  calc_ask: "계산 되묻기",
  calc_missing: "계산 입력 부족",
  stock_missing: "주식 입력 부족",
  gift_missing: "증여 입력 부족",
  ratio_guide: "비율 안내",
  no_precedent: "근거 없음",
  undecided: "판정 보류",
  off_issue: "쟁점 밖",
  off_topic: "세무 외 질문",
  congested: "혼잡 안내",
  handoff_request: "세무사 연결 요청",
  unsupported_occupation: "미지원 업종",
  unknown: "기타",
};

export const OUTCOME_GROUP: Record<string, OutcomeGroup> = {
  verdict: "answered",
  advisory: "answered",
  law_advisory: "answered",
  calc: "answered",
  stock_calc: "answered",
  gift_calc: "answered",
  missing_inputs: "asked_back",
  calc_ask: "asked_back",
  calc_missing: "asked_back",
  stock_missing: "asked_back",
  gift_missing: "asked_back",
  ratio_guide: "asked_back",
  no_precedent: "no_material",
  undecided: "no_material",
  off_issue: "no_material",
  off_topic: "off_topic",
  congested: "congested",
  handoff_request: "handoff",
};

/** 화면에 늘어놓는 순서. */
export const OUTCOME_GROUPS: { key: OutcomeGroup; label: string; hint: string }[] = [
  { key: "answered", label: "답함", hint: "판정·자문·법령 안내·계산" },
  { key: "asked_back", label: "되묻기", hint: "필요한 정보를 물어봄" },
  { key: "no_material", label: "자료 없음", hint: "근거 없음·판정 보류·쟁점 밖" },
  { key: "off_topic", label: "세무 외", hint: "세무와 관계없는 질문" },
  { key: "handoff", label: "세무사 요청", hint: "세무사 연결을 직접 요청" },
  { key: "congested", label: "혼잡", hint: "동시 접속이 많아 안내만" },
  { key: "other", label: "기타", hint: "미지원 업종·분류 안 된 갈래" },
];

export const outcomeLabel = (outcome: string | null | undefined) => (outcome ? OUTCOME_LABEL[outcome] ?? outcome : "기록 없음");
export const outcomeGroup = (outcome: string | null | undefined): OutcomeGroup => (outcome ? OUTCOME_GROUP[outcome] ?? "other" : "other");

/** 갈래별 수 → 묶음별 수(OUTCOME_GROUPS 순서, 0 인 묶음 포함). */
export function groupOutcomes(byOutcome: Record<string, number>): { key: OutcomeGroup; label: string; hint: string; count: number; outcomes: [string, number][] }[] {
  return OUTCOME_GROUPS.map((g) => {
    const outcomes = Object.entries(byOutcome).filter(([k]) => outcomeGroup(k) === g.key).sort((a, b) => b[1] - a[1]);
    return { ...g, count: outcomes.reduce((a, [, n]) => a + n, 0), outcomes };
  });
}

/** 묶음 → 그 묶음에 드는 outcome 원값(질문 목록 거르기 RPC 에 넘긴다). "기타" 는 알려진 갈래 밖이라 원값 목록을 따로 받는다. */
export function outcomesOf(group: OutcomeGroup, seen: string[] = []): string[] {
  if (group === "other") return [...new Set([...seen, "unknown", "unsupported_occupation"].filter((k) => outcomeGroup(k) === "other"))];
  return Object.keys(OUTCOME_GROUP).filter((k) => OUTCOME_GROUP[k] === group);
}
