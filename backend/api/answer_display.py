"""AI 답변 표시 방식 — 내용 쪽 스위치 한 곳(10/14).

화면 쪽(그리는 방법 — 결론 문단 강조·법령 접기)은 `frontend/lib/answer-display.ts`. 여기는 **무엇을 내보낼지**다.
코드 상수라 바꾸면 백엔드 배포(import-credigraph push + deploy.sh)로 반영된다. 사용자 설정이 아니다.

팀 피드백(10/14): 법령 접기보다 "산문 답 + 표 + 한두 문장 결론 문단(진하게·크게)을 위나 아래에".
- SUMMARY: 결론 문단(segment type "summary") 위치. "top" = 안내 문장 바로 뒤(결론 먼저와 같은 자리 — 첫 설명 문장을
  결론 문단이 맡는다) · "bottom" = 답 끝(되묻기 앞) 정리 · "off" = 내보내지 않음(10/14 오전 동작).
  자문 답은 작문 호출 안에서 같이 쓴다(호출 추가 없음). 계산 답은 결정론 결론 문장(총급여 … 세금 …원)을 결론 문단으로 표시.
- TABLES: 표를 Markdown 표 한 세그먼트로(팀 design/answer-tables.md 형식 — 프론트 answer-markdown 이 그린다).
  세율 표(법령 원문 행) · 근로소득세 계산 단계표 · '차이' 질문의 비교표(작문). False 면 종전 '· 행' 줄·① 문장.
"""
from __future__ import annotations

SUMMARY: str = "top"     # "top" | "bottom" | "off"
TABLES: bool = True


def summary_on() -> bool:
    return SUMMARY in ("top", "bottom")
