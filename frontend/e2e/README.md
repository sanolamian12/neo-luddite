# E2E — 검수실/배선실 (정성 평가)

## ⚠ 이 스펙은 **실 DB 를 바꾼다**

`session-eval-review.spec.ts` 는 정성 평가 1건을 실제로 인정→검수 저장→최종 승인한다.
그 결과 Supabase 에 다음이 생긴다:

- `session_evaluations` 1행이 `decision='accepted', review_status='finalized'`
- `ledger_entries` 에 `source_ref.kind='session_eval'` 기여 1건
- `rag.passages` 에 `source_kind='session_eval'` passage 1건 (Upstage 임베딩 실호출)

**실행 후 반드시 원복한다** (아래 스크립트가 자동으로 한다).

## 실행

```bash
# 1) 프로덕션 빌드로 띄운다 — dev 서버는 이 환경에서 하이드레이션이 안 붙는다
#    (HMR 웹소켓 핸드셰이크 실패 → React 가 안 붙어 폼이 먹통).
cd frontend && npx next build && npx next start -p 3012 &

# 2) 백엔드는 프론트의 NEXT_PUBLIC_API_BASE 와 **같은 포트**여야 한다(기본 8787).
#    포트가 다르면 적재 호출이 연결 실패로 조용히 스킵된다(비차단 설계라 최종 승인은 성공).
#    CORS_ORIGINS 에 테스트 오리진을 넣지 않으면 preflight 가 400 으로 막힌다.
cd backend && CORS_ORIGINS="http://127.0.0.1:3012" \
  .venv/Scripts/python.exe -m uvicorn api.main:app --port 8787 --host 127.0.0.1 &

# 3) 실행
cd frontend && E2E_BASE_URL=http://127.0.0.1:3012 npx playwright test

# 4) 원복
python ../supabase/reset_session_eval_review.py
```

## 커버하는 것

| 테스트 | 지키는 것 |
|---|---|
| 사이드바 네 갈래 | 문장 단위/정성 평가 × 검수실/배선실 메뉴 4개 |
| 문장 단위 상세 | 세션 평가 패널이 **없다**(오른쪽을 피드백이 전부 쓴다) |
| 정성 평가 한 바퀴 | 목록 컬럼 7종 · 100자 버킷 · 평점 표기 → 결정 전 [검수 저장] **비활성** → 인정 → 저장 → 일괄 최종 승인 → 배선실 적재 → 연결 끊기/연결하기 토글 → 두 배선실 분리 |

가장 중요한 가드는 **결정 전 [검수 저장] 비활성**과 **배선실 적재**다. 앞엣것은 DB CHECK
(`session_eval_decided_before_save`)의 짝이고, 뒤엣것은 admin UPDATE 가 RLS 에 막혀
0행 갱신으로 조용히 통과하는지를 화면 수준에서 잡아낸다.
