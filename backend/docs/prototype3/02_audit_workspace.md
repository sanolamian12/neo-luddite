# Prototype 3 — 감사 워크스페이스

감사 모드의 **정보 구조(IA)** 와 **3-pane 레이아웃**을 정의한다.
챗 UI를 그대로 빌리지 않고, 어노테이션 도구(Outlier 등)의 패턴을 차용한다.

## 정보 구조 (라우트)

```
/audit                                    → /audit/chat-logs 로 리다이렉트
/audit/chat-logs                          큐 인덱스 (대화 미선택)
/audit/chat-logs/[conversationId]         3-pane 워크스페이스
/audit/knowledge                          KB 인덱스 (문서 미선택)
/audit/knowledge/[slug]                   KB 리더
/audit/knowledge/[slug]/edit              KB 에디터 (사용자 문서만)
/audit/knowledge/new                      KB 신규 작성
```

> `/audit/[conversationId]`(프토 2 라우트)는 `/audit/chat-logs/[conversationId]`로 영구 이동. 기존 링크는 리다이렉트.

## 감사 모드 사이드바 (재설계)

```
┌─ Sidebar (AuditShell) ─────────────┐
│ ClipboardCheck  상담 평가          │ ← Header
│                                    │
│  ▣ 챗 로그 감사   (active)         │ ← Section Nav (탭형)
│  □ 지식 베이스                     │
│                                    │
│  ─ (Section별 컨텍스트) ────────── │
│  • 챗 로그 섹션:                    │
│      필터 (전체/검토중/완료)        │
│      세션 목록은 사이드바 X — 워크  │
│      스페이스 좌측 큐 스트립으로    │
│      이동.                          │
│  • KB 섹션:                         │
│      카테고리 트리 (주제/프레임)    │
│      "+ 새 문서"                    │
│                                    │
│  ───────────────────────────────   │
│  [● 평가자]   ⌄                    │ ← Footer (AccountSwitcher)
└────────────────────────────────────┘
```

> 프토 2의 "평가 대상 세션" 메뉴는 **사이드바에서 제거**되고, 워크스페이스의 큐 스트립으로 이관된다.
> 사이드바가 두 섹션 간 전환에 집중하도록 함.

## 워크스페이스 — 챗 로그 감사 (3-pane)

```
┌─ /audit/chat-logs/[conversationId] ─────────────────────────────────┐
│ ┌─ Queue Strip ──┐ ┌─ Transcript ────────────┐ ┌─ Inspector ─────┐ │
│ │ 차량유지비  ●  │ │ 제목 / 페르소나         │ │ ▣ 피드백        │ │
│ │ 골프 회원권  ○ │ │ ────────────────────    │ │ □ 평가          │ │
│ │ 헬스장       ✓ │ │ user: …                 │ │ □ 근거(deferred)│ │
│ │                │ │ assistant: …            │ │ ──────────────  │ │
│ │ ─ 필터 ────    │ │   ▸ seg (선택 가능)     │ │ [선택 문장]      │ │
│ │ 전체/검토/완료 │ │   ▸ seg                 │ │ 코멘트 textarea │ │
│ │                │ │   ▸ seg                 │ │ 태그 칩 3종      │ │
│ │                │ │ ────────────────────    │ │ 저장             │ │
│ └────────────────┘ └─────────────────────────┘ └──────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### Pane 책임
| Pane | 너비 | 책임 | 재사용 |
|---|---|---|---|
| 좌 — 큐 스트립 | 220px (접기 가능) | 동일 페르소나의 세션 목록, 상태 배지, 필터 | `components/audit/chat-logs/queue-strip.tsx` (NEW) |
| 중 — 전사 | flex | 전사 직접 렌더, 문장 단위 선택 | 프토 2 `audit-transcript.tsx` + `audit-segment.tsx` 그대로 |
| 우 — 인스펙터 | 360px | 탭 3종 (피드백 · 평가 · 근거) | 프토 2 `line-feedback-panel.tsx`, `session-eval-panel.tsx` |

### 인스펙터 탭
- **피드백 (default)** — 라인 피드백 패널 (기존). 미선택 상태에서는 "왼쪽에서 문장을 선택하세요" 플레이스홀더.
- **평가** — 세션 평가 패널 (기존). 항상 활성.
- **근거 (deferred)** — Tier 2 그라운딩 패널의 자리. v1에서는 "추후 제공" placeholder만 노출하여 슬롯 확보.

### 큐 상태 (Queue State)
| 상태 | 정의 (파생) |
|---|---|
| `untouched` | 해당 conversationId 의 피드백 0건 + 세션 평가 없음 |
| `in_progress` | 피드백 ≥ 1건이고 세션 평가 없음 |
| `completed` | 세션 평가 존재 |

> 상태는 `audit-store`에서 파생; 별도 필드 추가 없음.

### Top bar (워크스페이스 상단)
```
[대화 제목]   [페르소나·세금 카테고리]              [내보내기 ⬇]  [상태 배지]
```
- 프토 2의 `audit-summary` 기능 일부를 흡수.

## KB 워크스페이스 — `/audit/knowledge/...`
3-pane이 아닌 **2-pane**으로 단순화한다 (폴더 트리 + 리더/에디터). 자세한 내용은 [03_knowledge_base.md](03_knowledge_base.md).

```
┌─ Sidebar (KB section) ─┐ ┌─ Main ────────────────────────────┐
│ ▾ 해석론/              │ │ # 스킬.md  (인덱스 진입 시)        │
│   엄격해석             │ │ 또는 선택한 문서의 리더/에디터      │
│   …                    │ │ summary · citations · 관련 링크    │
│ ▾ 직업군/              │ │ ─────────────────────────          │
│   ▾ 병의원/            │ │ 마크다운 본문 (위키 링크 [[경로]]) │
│     차량유지비         │ │                                    │
│   …                    │ │                                    │
│ ▾ 판례노트/            │ │                                    │
│ ▾ 용어집/              │ │                                    │
│ ▾ 오류패턴/            │ │                                    │
│ [+ 새 문서]            │ │                                    │
└────────────────────────┘ └────────────────────────────────────┘
```

`/audit/knowledge` 인덱스의 메인은 `스킬.md` 마스터 문서를 렌더한다(독자가 가장 먼저 보는 문서).

## 컴포넌트 재구성

| 위치 | 변경 |
|---|---|
| `components/audit/audit-experience.tsx` | **재작성** — 라우트 별 3-pane / 2-pane 컨테이너로. |
| `components/audit/audit-transcript.tsx` | 변경 없음 (중앙 pane에서 그대로 호출) |
| `components/audit/audit-segment.tsx` | 변경 없음 |
| `components/audit/line-feedback-panel.tsx` | 인스펙터 탭 컴포넌트로 흡수 (props 시그니처 유지) |
| `components/audit/session-eval-panel.tsx` | 동상 |
| `components/audit/audit-summary.tsx` | 상단 Top bar로 흡수 (`audit-topbar.tsx` 신규) |
| `components/audit/flip-to-audit-button.tsx` | **삭제** (계정 전환기로 대체) |
| `components/layout/audit-shell.tsx` | 헤더 토글 제거, 사이드바 IA 갱신 |
| `components/layout/audit-sidebar.tsx` | 섹션 내비로 재작성, 세션 목록 제거 |
| `components/audit/chat-logs/queue-strip.tsx` | **신규** |
| `components/audit/chat-logs/inspector.tsx` | **신규** — 탭 컨테이너 |
| `components/audit/audit-topbar.tsx` | **신규** |

## 인수 기준 (B1·B2)
- [ ] `/audit` → `/audit/chat-logs` 리다이렉트.
- [ ] 사이드바에 두 섹션 탭 노출, 현재 라우트에 따른 active.
- [ ] 챗 로그 큐 스트립에서 세션 클릭 → 라우트 변경, 인스펙터 상태 초기화.
- [ ] 큐 상태 배지 정확(untouched/in_progress/completed) — 피드백·평가 시점에 즉시 갱신.
- [ ] 인스펙터 탭 3종 전환, 현재 선택 문장 컨텍스트 유지.
- [ ] 상단 내보내기 버튼 동작(프토 2 기능 유지).
- [ ] 키보드 접근성 — 큐 스트립 화살표 ↑↓ 이동(스택 한정 v1).
- [ ] 작은 뷰포트(< 1024px): 큐 스트립 자동 접힘 토글.
