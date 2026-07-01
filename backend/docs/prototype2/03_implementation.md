# Prototype 2 — 구현 기록 (Phase A0–A5)

사람 평가자용 챗 라인 단위 감사/피드백 모드. 프로토타입 1 코드베이스(`prototype/`) 위에 구축.
챗 경로는 무변경, 감사는 별도 모드/라우트(`/audit/[conversationId]`) + 헤더 flip.

## 빌드/상태
- 전 Phase `npm run build` 통과(Next 16, TypeScript). 라우트: `/`, `/select`, `/chat/[occupation]`, `/audit/[conversationId]`.
- ⚠️ 인터랙션(클릭→피드백 저장, 영속, 하이드레이션 후 요약) 육안 QA는 Chrome 미연결로 **사용자 확인 필요**(아래 체크리스트).

## Phase별 산출물
| Phase | 산출물 |
|---|---|
| A0 | `lib/audit-schema.ts`(Zod: FeedbackTag 3종, LineFeedback, SessionEvaluation), `lib/audit-store.ts`(Zustand+persist `audit-store-v1`, `useAuditHydrated`) |
| A1 | `app/audit/[conversationId]/page.tsx`(await params·404), `app/audit/layout.tsx`, `components/layout/audit-shell.tsx`, `audit-sidebar.tsx` |
| A2 | `components/audit/audit-experience.tsx`, `audit-transcript.tsx`(직접 렌더+UiBlocks), `audit-segment.tsx`(선택/하이라이트) |
| A3 | `components/ui/textarea.tsx`(shadcn), `components/audit/line-feedback-panel.tsx`(코멘트+태그 3종+삭제) |
| A4 | `components/audit/score-control.tsx`(1–5), `session-eval-panel.tsx`(정성+정량 2종) |
| A5 | `components/audit/audit-summary.tsx`(카운트·평가상태·JSON export), `flip-to-audit-button.tsx`, `app-shell.tsx`(flip 추가), `lib/load-conversation.ts`(`getConversationKeyById`) |

## 핵심 구현 노트
- **식별자**: 감사 외래키 = **레지스트리 키**(`clinic-vehicle`, URL 파라미터). 챗 `replay-store.script.id`는 내부 id(`conv_clinic_vehicle_001`)라 `getConversationKeyById`로 역조회해 flip. (A2에서 이 불일치로 렌더 0건 버그 → 키 일원화로 수정.)
- **직접 렌더**: 감사 전사는 assistant-ui 미사용, `Conversation`에서 직접 렌더(챗 무영향).
- **하이드레이션 가드**: `useAuditHydrated`로 피드백 카운트·요약을 SSR에서 숨겨 mismatch 방지. `selectedSegmentId`는 영속 제외.
- **재사용**: `chat/ui-blocks.tsx`, 챗 버블 className, Badge 메타, 브랜드 토큰(`--brand-blue` 선택/`--brand-green` 피드백), shadcn primitives.

## 브라우저 QA 체크리스트 (`cd prototype && npm run dev`)
- [ ] `/chat/clinic`→스타터 클릭→세션 재생→헤더 "감사 모드" 활성(스타터 화면에선 비활성).
- [ ] "감사 모드"→`/audit/<key>` 전문 표시(컴포저 없음, 17문장).
- [ ] 문장 클릭→파란 링 선택, 우측 패널에 선택 문장 표시.
- [ ] 코멘트+태그 2개 저장→목록 추가, 문장에 초록 강조+카운트, 사이드바 세션 카운트 증가.
- [ ] 피드백 삭제→목록·카운트 감소.
- [ ] 세션 점수 2종(문장력/법률적 정확성)+정성 입력→저장→요약 "평가 완료".
- [ ] 하드 리로드→피드백·카운트·평가 영속(localStorage), 콘솔 하이드레이션 경고 없음.
- [ ] 감사 사이드바에서 세션 전환→대화별 격리.
- [ ] "챗 모드"→`/chat/clinic` 복귀, 챗 정상(애니메이션 유지).
- [ ] "내보내기"→`audit-<key>.json` 다운로드(피드백+평가 포함).
