import { test, expect, type Page } from "@playwright/test";

/**
 * sync 레이어 회복력 — 최초 적재가 실패해도 화면이 죽지 않는가.
 *
 * 왜 필요한가: 로그인 직후 곧바로 다른 화면으로 이동하면 진행 중이던 Supabase fetch 가
 * 취소된다(ERR_ABORTED). 이 스펙은 **요청을 실제로 끊거나 매달아 놓고** 화면이 스스로
 * 회복하는지 본다.
 *
 * ⚠ 이 스펙을 쓸 때 주의할 점 — 가짜로 통과하기 쉽다.
 * sync 레이어에는 원래 `bindAuthRehydrate` 가 있어서 로그인(SIGNED_IN) 시 모든 컬렉션을
 * 재-fetch 한다. 그래서 "한두 번 끊고 회복하는가"만 보면 **재시도 로직이 없어도 통과한다**
 * (auth 이벤트가 우연히 두 번째 시도를 만들어 주기 때문). 실제로 첫 버전이 그렇게
 * 헛통과했다. 그래서 여기서는 auth 재하이드레이션으로는 설명되지 않는 것만 검증한다:
 *   ① 시도 횟수 자체 (백오프 루프가 있어야만 나오는 횟수)
 *   ② 매달린 요청의 타임아웃 (없으면 "로딩 중…"에 영구히 갇힘)
 *   ③ online/탭 복귀 시 재적재 (auth 이벤트와 무관한 트리거)
 *
 * 이 스펙은 DB 를 바꾸지 않는다(읽기만).
 */

const ADMIN = { username: "admin", password: "demo1234" };
const EVAL_ROUTE = "**/rest/v1/session_evaluations*";

async function login(page: Page) {
  await page.goto("/login");
  const submit = page.getByRole("button", { name: "로그인" });
  await expect(page.locator("#username")).toBeVisible();
  await expect
    .poll(
      async () => {
        await page.locator("#username").fill(ADMIN.username);
        await page.locator("#password").fill(ADMIN.password);
        return submit.isEnabled();
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  await submit.click();
  await page.waitForURL("**/admin/dashboard", { timeout: 30_000 });
}

test.describe.configure({ mode: "serial" });

// 여기에 "시도 횟수를 세어 백오프 루프를 확인한다"는 테스트를 두려다 **버렸다.**
// 재시도 코드를 떼고 돌려 봤더니 그대로 통과했기 때문이다 — 한 문서 안에서도
// auth 재하이드레이션·세션 복원 등이 겹쳐 시도 횟수가 쉽게 4회를 넘겼다.
// 횟수는 이 레이어에서 신뢰할 수 있는 판별자가 아니다.
// 아래 두 테스트는 실제로 재시도 코드를 떼면 **실패하는 것**만 남긴 것이고,
// 백오프 루프 자체는 ②가 타임아웃 4회를 소진해야만 끝나므로 함께 검증된다.

test("매달린 요청이 화면을 '로딩 중'에 가두지 않는다", async ({ page }) => {
  // 응답을 영원히 주지 않는다(중단도 아니다). 타임아웃이 없으면 hydrate 가 끝나지
  // 않아 onHydrated 가 영영 안 불리고 화면은 "로딩 중…"에 갇힌다.
  await page.route(EVAL_ROUTE, () => {
    /* 의도적으로 아무 응답도 하지 않는다 */
  });

  await login(page);
  await page.goto("/admin/inspection-eval");

  await expect(
    page.getByText("로딩 중", { exact: false }),
    "매달린 요청에 타임아웃이 없어 화면이 '로딩 중'에 갇힘",
  ).toHaveCount(0, { timeout: 120_000 });

  // 데이터는 없지만 화면 자체는 살아 있어야 한다(빈 상태 안내).
  // 데스크톱 표 + 모바일 카드 두 벌이 렌더되므로 first() 로 좁힌다.
  await expect(
    page.getByText("검수할 정성 평가가 없습니다").first(),
  ).toBeVisible();
});

test("복귀(탭 재활성) 시 실패한 컬렉션을 다시 당긴다", async ({ page }) => {
  let blocking = true;
  let attempts = 0;
  await page.route(EVAL_ROUTE, async (route) => {
    attempts += 1;
    if (blocking) await route.abort("failed");
    else await route.continue();
  });

  await login(page);
  await page.goto("/admin/inspection-eval");

  // 재시도를 모두 소진해 빈 상태로 내려앉을 때까지 기다린다.
  await expect(
    page.getByText("검수할 정성 평가가 없습니다").first(),
  ).toBeVisible({ timeout: 90_000 });
  const afterGiveUp = attempts;

  // 네트워크가 돌아온 뒤 탭이 다시 보이는 상황을 만든다.
  blocking = false;
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await expect
    .poll(() => page.locator("table tbody tr").count(), {
      timeout: 60_000,
      message: "복귀 이벤트로 재적재되지 않음",
    })
    .toBeGreaterThan(1);

  expect(attempts, "복귀 후 추가 요청이 없음").toBeGreaterThan(afterGiveUp);
});
