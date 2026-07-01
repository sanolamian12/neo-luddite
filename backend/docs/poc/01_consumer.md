# Consumer 셸 — PoC 변경점

> **읽기 전제:** [00_concept.md](00_concept.md).
> Consumer 측은 **이미 prototype 1·3 에서 구현됨**. 본 PoC 에서는 **최소한의 hook 추가**만.

## 0. 한 줄 정의

Consumer 가 chat 을 종료하거나 1턴 이상 진행하면, 해당 ChatSession 이 **자동으로 admin 측 감사 후보 풀에 적재**된다. UI 는 그대로.

---

## 1. 변경 사항 (최소)

### 1.1 ChatSession 종료 시 후보 풀 적재

#### 트리거 지점
prototype 1 의 chat 페이지에서:
- 사용자가 새 세션 시작 후 **assistant 응답이 최소 1턴 완료**되면 후보 자격 획득.
- 다음 하나가 발생하면 `services/pool.add(conversationId)` 호출:
  - 사용자가 같은 페이지에서 `[새 상담]` 클릭 (이전 세션 마감 → 적재).
  - 사이드바에서 다른 세션 선택 (현 세션 떠남 → 적재).
  - 페이지 unload (best-effort, beforeunload hook).
- 이미 풀에 있는 conversationId 는 idempotent (재호출 무해).

#### 코드 위치 (예정)
- `lib/conversation-store.ts` — 종료 hook 노출 (`onConversationCommit`).
- `services/pool.ts` (신규) — `add`, `exclude`, `listCandidates`, `summary`.
- chat 페이지 컴포넌트에서 위 hook 을 subscribe.

> 별도 동의 / 표시는 v1 에서 없음. **데모 가정**: 모든 chat 은 감사 대상이 될 수 있다.

### 1.2 후보 풀 metadata 채우기

ChatSession 이 풀에 들어갈 때 함께 저장되는 필드 (admin 측 필터링용):
- `occupation` — chat 라우트의 segment (`/chat/clinic` → `"clinic"`).
- `topic` — prototype 1 의 결정적 시드에서 추출 가능한 경우만 (없으면 `null`).
- `turnCount`, `firstUserMessage` (snippet, ~80자), `assistantTokenEstimate` (rough).

### 1.3 사이드바 / 헤더 — 변경 없음

Consumer 셸의 chat 사이드바, 세션 목록, 상담 시작 플로우는 prototype 1·3 그대로 유지.

> 단, 계정 전환기에 `admin` 항목이 새로 추가되므로 viewer ↔ auditor ↔ admin 3-way 드롭다운으로 확장 (이건 `/lib/account-store` 변경이며 본 문서 외에 [00_concept.md](00_concept.md) §5 와 admin doc 의 P0 에서 다룸).

---

## 2. Service 시그니처

```ts
// services/pool.ts
async function add(input: {
  conversationId: string;
  occupation: string;
  topic?: string;
  turnCount: number;
  firstUserMessage?: string;
}): Promise<PoolCandidate>;

async function exclude(conversationId: string, reason?: string): Promise<void>;

async function listCandidates(filter?: {
  occupation?: string;
  status?: "new" | "assigned" | "excluded";
  q?: string;
}): Promise<{ items: PoolCandidate[]; total: number }>;

async function summary(): Promise<{
  newSinceLastVisit: number;
  totalActive: number;
  byOccupation: Record<string, number>;
}>;
```

```ts
interface PoolCandidate {
  conversationId: string;
  occupation: string;
  topic?: string;
  turnCount: number;
  firstUserMessage?: string;
  assistantTokenEstimate?: number;
  addedAt: number;                          // candidacy.addedAt
  status: "new" | "assigned" | "excluded";  // 'assigned' = 어떤 Task 에 포함됨
  excludedReason?: string;
}
```

> 시그니처는 백엔드 컨트랙트로 그대로 옮길 수 있도록 `Promise<T>` 와 `{ items, total }` 패턴 유지.

---

## 3. 데이터 흐름

```
[Consumer chat page]
       │
       │ chat 종료 트리거 (새 상담 / 세션 전환 / unload)
       ▼
services/pool.add({ conversationId, occupation, ... })
       │
       │ (현재 PoC: Zustand pool-store 에 upsert)
       │ (백엔드 연결 후: POST /api/pool)
       ▼
[Admin shell — /admin/pool 사이드바 배지 +1]
[Admin shell — /admin/dashboard '후보 풀' 카드 증가]
```

PoC 에서는 같은 브라우저 안에서 즉시 반영되지만, 실 백엔드 연결 시 admin 측은 polling 또는 SSE 로 보강.

---

## 4. AI 응답 service 추상화 (preparation only)

향후 실 모델 연결을 위해, prototype 1 의 deterministic replay 를 **service 함수로 한 번 래핑**한다. UI 변경은 없음.

```ts
// services/ai-model.ts
async function askAi(input: {
  prompt: string;
  conversationContext: Message[];
  occupation: string;
}): Promise<{
  reply: string;
  segments: Segment[];                    // 문장 단위 (prototype 1·2 가 이미 분할 사용)
  modelVersionId?: string;                // mock — 현재 production version
}>;
```

- PoC 구현: prototype 1 의 시드 매칭 그대로, 그러나 호출은 이 service 경유.
- 백엔드 연결 시: `POST /api/inference` 로 교체.
- `modelVersionId` 는 admin pipeline 의 production version 에서 가져옴 — auditor 측 결과물에 "이 응답이 만들어진 모델 버전" 을 표시하는 데 활용 가능 (v1 옵션).

---

## 5. 변경되지 않는 것

| 항목 | 상태 |
|---|---|
| 챗 UI / assistant-ui | 그대로 |
| 라우트 `/chat/<occupation>`, `/select` | 그대로 |
| Conversation seed 데이터 (`prototype/data/conversations/*`) | 그대로 |
| 사용자 작성 chat 의 영속 (sidebar 세션 목록) | 그대로 |
| `viewer` 계정 + 사이드바 푸터 전환기 | 그대로 (어 |
| Occupation 변경 플로우 | 그대로 |

---

## 6. 인수 기준

- [ ] `/chat/clinic` 에서 새 상담 1턴 진행 → "새 상담" 클릭 → admin 의 `/admin/pool` 에 후보 1건 추가됨.
- [ ] 같은 세션 종료 hook 이 여러 번 호출돼도 풀에 중복 진입하지 않음 (idempotent).
- [ ] 풀 적재 시 `occupation`, `firstUserMessage` snippet 정확.
- [ ] 후보가 Task 에 포함되면 풀 목록에서 `assigned` 표시 (제거되지는 않음).
- [ ] admin 에서 `[제외]` 처리한 conversation 은 다시 consumer 가 같은 세션을 종료해도 풀로 돌아오지 않음 (status `excluded` 유지).

---

## 7. 작업량 추정

- `services/pool.ts` 신규 — ~80 LOC.
- chat 페이지 hook 추가 — ~20 LOC (이벤트 1~2개 subscribe).
- `services/ai-model.ts` 래퍼 — ~40 LOC (시그니처 정리만).
- 합계: **반나절 미만**. 본 PoC 에서 가장 작은 워크스트림.

---

## 8. 구현 현황

✅ **완료** (커밋 `476a358`).

| 항목 | 구현 위치 | 비고 |
|---|---|---|
| Pool 자동 적재 hook | `components/chat/chat-experience.tsx` | visibleCount ≥ 2 시 1회만 호출 (Set 으로 중복 방지) |
| `services/pool.ts` | `prototype/services/pool.ts` | `add` · `exclude` · `listCandidates` · `markAssigned` · `summary` |
| Pool 스토어 + 시드 | `lib/pool-store.ts`, `data/poc-seeds/pool.json` | 시드 3건 (clinic-vehicle/golf/gym) · timestamp 자동 보정 |
| Registry key 사용 | `getConversationKeyById` 경유 | `script.id` (내부) ≠ registry key — 풀에는 registry key 저장 |

**미구현 (Out-of-PoC):**
- `services/ai-model.ts` 래퍼 — 결정적 재생만 사용하는 현 단계에서 service 함수로 분리할 필요성이 약해 deferred. 실 모델 연결 단계에서 추가.
- 페이지 unload 시 풀 적재 — 1턴 완료 즉시 적재로 충분히 커버되므로 미구현.

**인수 기준 통과 여부:**
- [x] `/chat/clinic` 1턴 → `/admin/pool` 에 후보 1건 (E2E 검증).
- [x] 동일 세션 idempotent (Set ref + service `add` 의 upsert).
- [x] `occupation` + `firstUserMessage` 80자 snippet 정확.
- [x] Task 에 포함된 conversation 풀에서 `assigned` 표시 (admin/pool-table.tsx 의 sync effect).
- [x] `[제외]` 후 재진입 시 status 유지.
