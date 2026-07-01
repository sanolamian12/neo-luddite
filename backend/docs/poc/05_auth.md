# 세션 / 로그인 / RoleGuard

> **읽기 전제:** [00_concept.md](00_concept.md).
> 본 문서는 PoC 의 인증 / 권한 모델을 정리한다. P0 후속으로 추가된 트랙.

## 0. 한 줄 정의

세 역할 (`viewer` / `auditor` / `admin`) 모두 **명시적 로그인**으로 시작한다.
초기 진입은 `/login` — 데모 자격 증명으로 역할 선택 → 셸 진입.
각 셸은 `RoleGuard` 컴포넌트로 보호 — 다른 역할로 진입 시 본인 랜딩으로 리다이렉트, 비로그인 시 `/login`.

> ⚠️ **PoC 보안 모델:** 클라이언트 전용 mock 인증. localStorage 의 session 값은 누구나 수정 가능 — **실 보안 아님**.
> 실 백엔드 연결 단계에서 HttpOnly cookie + 서버 검증으로 교체.

---

## 1. 데이터 모델

`lib/account-schema.ts`:

```ts
export type AccountId = "viewer" | "auditor" | "admin";

export const DEMO_PASSWORD = "demo1234";

export interface DemoCredential {
  username: string;
  password: string;
  accountId: AccountId;
  roleLabel: string;
}

export const DEMO_CREDENTIALS: DemoCredential[] = [
  { username: "owner",   password: DEMO_PASSWORD, accountId: "viewer",  roleLabel: "사장님" },
  { username: "auditor", password: DEMO_PASSWORD, accountId: "auditor", roleLabel: "평가자" },
  { username: "admin",   password: DEMO_PASSWORD, accountId: "admin",   roleLabel: "운영자" },
];
```

`lib/account-store.ts` 의 `AccountState`:
- `session: AccountId | null` — 로그인된 역할 (영속).
- `login(username, password)` — 검증 후 session 설정, 성공 시 AccountId 반환.
- `logout()` — session 을 null 로.

영속 키: `account-store-v1` (v3).
v2 → v3 마이그레이션: `session` 필드 추가 (기본 null).

---

## 2. 라우트

### `/login` — 로그인 페이지

`app/login/page.tsx`. 2-column 레이아웃 (브랜드 패널 + 폼):
- LHS: 브랜드 그라데이션 + 모션 블러브 + 한 줄 카피.
- RHS: 아이디 / 비밀번호 + 에러 시 흔들림 애니메이션.
- 하단: **데모 자격 증명 박스** — 3개 계정의 username/password 노출 (PoC 편의).

이미 로그인 상태로 진입하면 본인 랜딩으로 즉시 리다이렉트.

### 로그인 후 랜딩
```ts
const LANDING: Record<AccountId, string> = {
  viewer:  "/select",            // 업종 선택부터
  auditor: "/audit/dashboard",
  admin:   "/admin/dashboard",
};
```

---

## 3. RoleGuard

`components/auth/role-guard.tsx` — 클라이언트 게이트 컴포넌트.
각 셸 레이아웃이 children 을 `<RoleGuard role="...">` 로 감싼다.

동작:
- 미하이드레이션 → 스켈레톤 표시.
- session 이 `null` → `/login` 으로 replace.
- session 이 다른 역할 → 본인 랜딩으로 replace.
- 일치할 때만 children 렌더.

적용 위치:
```
components/layout/admin-shell.tsx        → <RoleGuard role="admin">
components/layout/audit-shell.tsx        → <RoleGuard role="auditor">
components/layout/app-shell.tsx          → <RoleGuard role="viewer">
```

---

## 4. 계정 전환기 → 로그아웃

당초 계획 ([00_concept.md §5](00_concept.md#5-화면-구조-3-shell)) 의 "사이드바 푸터 계정 전환기" 는
**드롭다운에서 다른 역할 선택 → 그 셸로 이동** 이었다.
세션이 도입되면서 이 의미는 사라졌다 — 다른 역할 진입은 로그아웃 후 재로그인.

현재 (`components/layout/account-switcher.tsx`):
- 로그인한 계정의 라벨 + 보조 텍스트 (occupation / reviewerName / operatorName).
- 클릭 시 드롭다운:
  - `auditor` 인 경우 평가자 이름 인라인 편집.
  - `admin` 인 경우 운영자 이름 인라인 편집.
  - `[로그아웃]` 항목 → `logout()` → `/login` 으로 replace.

---

## 5. 진입점 흐름

```
첫 방문
  → /login
  → 로그인 (예: admin / demo1234)
  → session=admin 저장 → /admin/dashboard
  → 새로고침 → /admin/dashboard 유지 (session 영속)
  → 로그아웃 → session=null → /login

비로그인 상태에서 /admin/foo 진입
  → RoleGuard → /login replace

admin 으로 로그인하고 /audit/work 진입
  → RoleGuard → routeForAccount(auditor 계정) → /audit/dashboard 가 아닌
    auditor 의 랜딩으로 리다이렉트
  → (실제로는 admin 이 다른 셸 보고 싶으면 로그아웃 → 재로그인 필요)
```

---

## 6. 보안 한계 (PoC)

| 한계 | 사유 |
|---|---|
| 클라이언트 전용 인증 | localStorage 의 session 은 DevTools 로 수정 가능. |
| 비밀번호 평문 비교 | 데모 credentials 가 JS 번들에 평문. |
| 토큰 / 만료 X | session 은 단순 enum. |
| RoleGuard 가 클라이언트 가드 | SSR 단계에선 막을 수 없음 (Next.js 서버 컴포넌트가 보호하지 않음). |

**실 백엔드 연결 시 교체:**
- HttpOnly cookie + 서버 세션 (or JWT).
- Next.js middleware (또는 server action) 에서 검증.
- 비밀번호는 서버에서 해시 비교.
- RoleGuard 는 보조 가드로 유지 (UX 용).

---

## 7. 구현 현황

✅ **완료** — 별도 트랙.

| 항목 | 위치 |
|---|---|
| Schema | `lib/account-schema.ts` — `DEMO_CREDENTIALS`, `DemoCredential` |
| Store | `lib/account-store.ts` — `session`, `login`, `logout`, v2→v3 migrate |
| 로그인 페이지 | `app/login/page.tsx` |
| Role guard | `components/auth/role-guard.tsx` |
| 셸 적용 | `admin-shell.tsx`, `audit-shell.tsx`, `app-shell.tsx` 모두 RoleGuard wrapping |
| Account switcher | `components/layout/account-switcher.tsx` — 로그아웃 버튼 |

E2E 검증:
- [x] `/login` 데모 자격 증명 표시.
- [x] 잘못된 자격 증명 → shake + 에러 메시지.
- [x] 올바른 자격 증명 → 역할별 랜딩으로 redirect.
- [x] 새로고침 시 세션 유지.
- [x] 로그아웃 시 `/login` 으로 이동, 다른 셸 진입 차단.
- [x] 비로그인 시 `/admin/*` / `/audit/*` 접근 → `/login` 리다이렉트.
