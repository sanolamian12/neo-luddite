/**
 * AI 답변 표시 방식 — 화면 쪽 스위치 한 곳(10/14).
 *
 * 내용(결론 문단 위치·표 사용)은 백엔드 `backend/api/answer_display.py` 가 정하고, 여기서는 그 내용을
 * **어떻게 그릴지**만 정한다. 바꾸면 프론트 배포(main push)로 반영된다. 사용자 설정이 아니다.
 *
 * 팀 피드백(10/14): 법령 접기는 법령이 여럿이면 어색하고 Claude·ChatGPT 도 안 쓰는 방식이라 보류 →
 * 산문 + 표 + 한두 문장 결론 문단(진하게·크게)을 위나 아래에.
 */
export const ANSWER_DISPLAY = {
  /** `summary` 세그먼트(결론 문단)를 진하고 조금 크게 그린다. false 면 일반 문장처럼. */
  emphasizeSummary: true,
  /**
   * 법령 배지를 문장 옆에서 빼고 답 끝 "근거 법령 N개" 접기 한 곳에 모은다.
   * 심판례·질의회신 문서번호 배지는 그대로 문장 옆에 둔다. 기본 off(팀 검토 전).
   */
  lawFold: false,
} as const;

/** 출처 배지 중 법령 조문인가 — '소득세법 제55조', '부가가치세법 시행령 제109조 제2항' */
export function isStatuteCitation(citation: string): boolean {
  return /법(?:\s?시행령|\s?시행규칙)?\s?제\s?\d+\s?조/.test(citation);
}
