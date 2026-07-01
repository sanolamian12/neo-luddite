# Prototype 3 — 계정 · 모드 모델

## 문제 정의
프토 2는 **헤더 토글**(`FlipToAuditButton`)로 챗⇄감사를 전환한다. 실제 제품에서 두 모드는 다른 사람이 사용하므로,
프로토타입에서도 **계정**(account) 객체를 도입하여 모드 전환을 "계정 전환"으로 표현한다.

프로토타입에서는 단순함을 위해 **`viewer` 1개 + `auditor` 1개**, 총 2계정만 둔다.

## 데이터 모델

```ts
// lib/account-schema.ts (NEW)
export type AccountRole = "viewer" | "auditor";

interface AccountBase {
  id: string;
  role: AccountRole;
  label: string;
  avatarColor: string;          // 토큰 (`--brand-blue` 등)
}

export interface ViewerAccount extends AccountBase {
  role: "viewer";
  occupation: string;           // 가변. 현재 직업군 키 (예: "clinic")
}

export interface AuditorAccount extends AccountBase {
  role: "auditor";
  reviewerName: string;         // 평가자 이름 (이전 audit-store에서 이관)
}

export type Account = ViewerAccount | AuditorAccount;
```

### 시드 계정 (2개, 고정)
| id | role | label | 기본값 | avatar |
|---|---|---|---|---|
| `viewer` | `viewer` | 사장님 | `occupation = "clinic"` | `--brand-blue` |
| `auditor` | `auditor` | 평가자 | `reviewerName = "평가자"` | `--brand-green` |

> **occupation은 viewer의 필드**(계정 분리 X). `/select` 플로우 또는 사이드바 푸터의 "업종 변경"이 이 값을 직접 갱신한다.
> 감사 모드는 occupation을 알지 않는다 — 평가자는 모든 직업군의 대화를 검토.

## 스토어

```ts
// lib/account-store.ts (NEW) — Zustand + persist("account-store-v1")
interface AccountState {
  viewer: ViewerAccount;
  auditor: AuditorAccount;
  activeAccountId: "viewer" | "auditor";   // 영속 — 첫 방문은 "viewer"
  setActiveAccount(id: "viewer" | "auditor"): void;
  setViewerOccupation(occupation: string): void;
  setReviewerName(name: string): void;
}
```

### `reviewerName` 마이그레이션
- 프토 2: `useAuditStore.reviewerName` (string)
- 프토 3: `AuditorAccount.reviewerName`
- 마이그레이션 훅: `account-store` rehydrate 시 1회 흡수. `audit-store.reviewerName`은 한 단계 deprecated 유지(B1 말기 제거).

## 사이드바 푸터 전환기

shadcn 사이드바 풋터(`SidebarFooter`)에 **계정 전환 메뉴**를 둔다. 패턴은 shadcn `sidebar-07` 데모와 동일:
`SidebarMenu` → `SidebarMenuItem` → `SidebarMenuButton size="lg"` (아바타 + 라벨 + chevron) + `DropdownMenu`.

```
┌─ Sidebar ──────────────┐
│ ...                    │
│                        │
│ ─────────────────────  │
│ [● 사장님 · 병의원] ⌄  │ ← SidebarMenuButton (lg)
│                        │     클릭 → DropdownMenu
└────────────────────────┘
                  ┌─ DropdownMenu ────────────┐
                  │ ● 사장님       (chat)     │ ← 현재
                  │ ● 평가자       (audit)    │
                  │ ─────────────────         │
                  │ 평가자 이름 수정…          │
                  └───────────────────────────┘
```

- viewer일 때 라벨 보조 텍스트로 현재 occupation 표시 (`사장님 · 병의원`).
- auditor일 때 보조 텍스트는 `reviewerName`.

### 신규 컴포넌트
- `components/ui/dropdown-menu.tsx` (shadcn add — 현재 미설치)
- `components/ui/avatar.tsx` (shadcn add)
- `components/layout/account-switcher.tsx` — `<SidebarFooter>` 내부 사용, **챗·감사 두 셸 공유**.

## 라우팅 동작

| 현재 위치 | 새 활성 계정 | 이동 |
|---|---|---|
| `/chat/...` | `auditor` | `/audit/chat-logs` |
| `/audit/...` | `viewer` | `/chat/<viewer.occupation>` |
| `/select`, `/` | 어느 쪽이든 | viewer→`/chat/<occupation>`, auditor→`/audit/chat-logs` |

- 라우팅 헬퍼: `lib/account-route.ts` — `routeForAccount(account)`.

### 사이드 이펙트
- `FlipToAuditButton` 삭제, 챗 헤더에서 제거.
- `AuditShell` 헤더의 "챗 모드" 링크 삭제.
- `app-sidebar.tsx`, `audit-sidebar.tsx` 모두 footer 슬롯에 `<AccountSwitcher />` 삽입.
- 기존 `/select`는 viewer 모드의 occupation 변경 화면으로 남음. 감사 모드에서는 노출되지 않음.

## 영속·하이드레이션
- 키: `account-store-v1`.
- 영속 필드: `viewer.occupation`, `auditor.reviewerName`, `activeAccountId`.
- 첫 방문(저장소 비어있음): seed 주입 후 `activeAccountId = "viewer"`, `viewer.occupation = "clinic"`.
- SSR 안전: `useAccountHydrated` 훅 — 미수화 동안 푸터는 스켈레톤 표시.

## 인수 기준 (B0)
- [ ] 두 셸 모두 푸터에 계정 전환기 노출, 현재 계정의 라벨·보조 텍스트 정확.
- [ ] 드롭다운에서 다른 계정 선택 → 즉시 해당 모드 라우트로 이동.
- [ ] 새로고침 후 직전 활성 계정 복원.
- [ ] viewer로 `/select`에서 occupation 변경 → footer 보조 텍스트 즉시 갱신.
- [ ] 평가자 이름 변경 → drop-down 내부에서 가능, `auditor`에만 적용.
- [ ] 기존 `useAuditStore.reviewerName`이 있던 사용자 — 마이그레이션으로 자동 복사.
- [ ] 헤더의 모드 토글 링크 / `FlipToAuditButton` 제거 확인.
