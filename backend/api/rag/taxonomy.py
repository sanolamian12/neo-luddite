"""KB 세목/주제 taxonomy — "질문 관점" 클러스터링 정책(2026-08-28 결정).

배경: `rag.passages.tax_category`가 프로덕션 전량(521건) "미분류"로 저장돼 있었다.
원인은 표시 로직이 아니라 데이터 자체 — 라이브 채팅을 스냅샷에서 복원할 때
`frontend/services/conversation.ts:76`가 실제 분류 없이 항상 "미분류"를 채워 넣고,
그 값이 배선(ingest)까지 그대로 흘러든다. 세목 분류 로직 자체가 없었던 것.

정책:
  1. 규칙엔진의 9종 지출유형(`clinic_expense_engine.ExpenseType`)은 "손금산입 판정" 전용
     이라 실측 질문의 상당수(자문형 — 상속/증여, 부가세, 인건비, 개원/폐업 등)를 못 담는다
     (메모리 project_operational_flow: 판정형 9종 외 자문형이 55%). 그래서 9종을 포함하되
     KB 실측 내용(407건 샘플링, 2026-08-28)에서 반복 관찰된 주제를 더한 넓은 목록을 쓴다.
  2. 새 지식이 배선될 때(ingest_feedback/ingest_session_eval), 프론트가 넘긴 tax_category
     가 없거나 플레이스홀더("미분류")면 서버가 Upstage(solar-pro3)로 이 목록 중 하나를
     골라 덮어쓴다(`api.llm.classify_tax_category`). 국내 AI 트랙 조건상 분류도 Upstage만
     사용 — 외산 모델 호출 금지(메모리 project_korean_track_compliance).
  3. 목록의 어느 카테고리와도 명확히 안 맞으면 '미분류' 그대로 — 이건 실패가 아니라
     정상 결과다. 강제로 아무 데나 욱여넣지 않는다.
"""

# 앞 9개는 clinic_expense_engine.ExpenseType 멤버명과 동일 — 판정형 질문과 KB 클러스터를
# 같은 이름으로 잇는다. 뒤는 자문형(판정 없음) 질문에서 관찰된 주제.
TAX_CATEGORIES: list[str] = [
    "업무용승용차",
    "임차료",
    "접대성지출",
    "광고선전비",
    "통신비",
    "복리후생비",
    "출장비",
    "소프트웨어구독",
    "가사관련비",
    "인건비·가족직원",
    "퇴직금·4대보험",
    "시설·인테리어",
    "부가가치세",
    "상속·증여",
    "소득세·법인전환·개원폐업",
    "매출관리",
    "기타",
]

UNCLASSIFIED = "미분류"
