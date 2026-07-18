import { test, expect, type Page } from "@playwright/test";

/**
 * 검수실 (정성 평가) → 배선실 (정성 평가) 한 바퀴.
 *
 * 이 시나리오가 지키는 것: 정성 평가는 0015 이전까지 아무도 결정하지 않았고 RAG 로도
 * 흐르지 않던 갈래다. 여기서 확인하는 건 "화면이 뜬다"가 아니라 **결정이 실제로 DB 에
 * 꽂히고 그 결과가 RAG 까지 도달하는가** 다. 특히 admin 의 UPDATE 는 RLS 가 막으면
 * 에러가 아니라 0행 갱신으로 조용히 통과하므로, 화면의 상태 변화로 그걸 잡아낸다.
 *
 * 실행 전제: next dev(3011) + 백엔드(8791) 기동, 0015 적용 완료.
 * 정리: 이 스펙은 DB 를 실제로 바꾼다. 러너 스크립트가 실행 후 원복한다.
 */

const ADMIN = { username: "admin", password: "demo1234" };

/**
 * 로그인.
 *
 * 하이드레이션 경합 주의: 폼이 SSR 로 먼저 뜨고 React 가 뒤늦게 붙으면서 리마운트되면
 * 먼저 채운 값이 날아가고 [로그인] 이 disabled 로 남는다(Playwright 는 "element was
 * detached from the DOM" 으로 본다). 값을 채운 뒤 버튼이 실제로 활성화될 때까지
 * 확인하고, 안 되면 다시 채운다.
 */
async function login(page: Page) {
  await page.goto("/login");
  const user = page.locator("#username");
  const pass = page.locator("#password");
  const submit = page.getByRole("button", { name: "로그인" });

  await expect(user).toBeVisible();
  await expect
    .poll(
      async () => {
        await user.fill(ADMIN.username);
        await pass.fill(ADMIN.password);
        return submit.isEnabled();
      },
      { timeout: 30_000, message: "하이드레이션 후에도 [로그인] 이 활성화되지 않음" },
    )
    .toBe(true);

  await submit.click();
  await page.waitForURL("**/admin/dashboard", { timeout: 30_000 });
}

test.describe.configure({ mode: "serial" });

test("사이드바에 네 갈래 메뉴가 있다", async ({ page }) => {
  await login(page);
  const nav = page.locator("nav, aside").first();
  for (const label of [
    "검수실 (문장 단위)",
    "검수실 (정성 평가)",
    "배선실 (문장 단위)",
    "배선실 (정성 평가)",
  ]) {
    await expect(
      page.getByRole("link", { name: label }),
      `사이드바에 "${label}" 없음`,
    ).toBeVisible();
  }
  void nav;
});

test("검수실 (문장 단위) 상세에 세션 평가 패널이 없다", async ({ page }) => {
  await login(page);
  await page.goto("/admin/inspection");
  const firstRow = page.locator("table tbody tr").first();
  await expect(firstRow).toBeVisible({ timeout: 30_000 });
  await firstRow.getByRole("link").nth(1).click();
  await page.waitForURL("**/admin/inspection/**");

  // 오른쪽 인스펙터가 "평가자 피드백" 만 갖고, 세션 평가는 흔적도 없다.
  await expect(page.getByRole("heading", { name: "평가자 피드백" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator("aside")).not.toContainText("세션 평가");
  await expect(page.locator("aside")).not.toContainText("문장력");
});

test("정성 평가: 인정 → 검수 저장 → 일괄 최종 승인 → 배선실 적재", async ({
  page,
}) => {
  await login(page);
  await page.goto("/admin/inspection-eval");

  // ── 목록: 요구한 컬럼이 다 있는가 ──────────────────────────────────
  for (const col of [
    "Task",
    "대화",
    "평가자",
    "피드백",
    "제출일",
    "평점",
    "상태",
  ]) {
    await expect(
      page.getByRole("columnheader", { name: col, exact: false }).first(),
      `컬럼 "${col}" 없음`,
    ).toBeVisible({ timeout: 30_000 });
  }

  const row = page.locator("table tbody tr").first();
  await expect(row).toBeVisible({ timeout: 30_000 });

  // 피드백 = 100자 단위 버킷, 평점 = 문장 n/5 · 법률 n/5
  await expect(row).toContainText(/\d00자 (이하|이상)/);
  await expect(row).toContainText(/문장 [1-5]\/5/);
  await expect(row).toContainText(/법률 [1-5]\/5/);
  await expect(row).toContainText("검수 대기");

  const title = (await row.locator("td").nth(1).innerText()).trim();

  // ── 상세: 오른쪽 전체가 세션 평가, 버튼 3개 ────────────────────────
  await row.getByRole("button", { name: "검수" }).click();
  await page.waitForURL("**/admin/inspection-eval/**");

  // 오른쪽 패널이 통째로 세션 평가다(탭 라벨은 heading 이 아니라 div).
  await expect(page.getByRole("heading", { name: "평점" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByRole("heading", { name: /세션 전체 평가의견/ }),
  ).toBeVisible();
  await expect(page.locator("aside")).toContainText("세션 평가");
  // 문장 단위 검수의 잔재(평가자 피드백 패널)가 넘어오지 않았는지
  await expect(page.getByRole("heading", { name: "평가자 피드백" })).toHaveCount(
    0,
  );

  const accept = page.getByRole("button", { name: "인정", exact: true });
  const reject = page.getByRole("button", { name: "거절", exact: true });
  const save = page.getByRole("button", { name: "검수 저장" });
  await expect(accept).toBeVisible();
  await expect(reject).toBeVisible();
  await expect(save).toBeVisible();
  // 이 화면에 최종 승인 버튼은 없다(목록에서 일괄로 한다)
  await expect(page.getByRole("button", { name: "최종 승인" })).toHaveCount(0);

  // ── 핵심 가드: 결정 전에는 검수 저장을 못 누른다 ────────────────────
  await expect(save, "결정 전 [검수 저장] 이 활성화됨").toBeDisabled();

  await accept.click();
  await expect(save, "인정 후에도 [검수 저장] 이 비활성").toBeEnabled({
    timeout: 20_000,
  });
  await expect(page.locator("footer")).toContainText("인정 · 기여");

  await save.click();
  await expect(page.locator("footer")).toContainText("저장됨", {
    timeout: 20_000,
  });

  // ── 목록: 일괄 최종 승인 ───────────────────────────────────────────
  await page.goto("/admin/inspection-eval");
  const savedRow = page.locator("table tbody tr", { hasText: title }).first();
  await expect(savedRow).toContainText("검수 저장", { timeout: 30_000 });

  await savedRow.getByRole("checkbox").check();
  const bulk = page.getByRole("button", { name: /일괄 최종 승인 \(1건\)/ });
  await expect(bulk).toBeEnabled();

  page.once("dialog", (d) => d.accept());
  await bulk.click();

  await expect(page.getByText(/1건을 최종 승인했습니다/)).toBeVisible({
    timeout: 60_000,
  });
  await expect(savedRow).toContainText("최종 승인");

  // ── 배선실 (정성 평가): 적재됐는가 + 연결 토글 ──────────────────────
  await page.goto("/admin/packaging-eval");
  const shipment = page.locator("li", { hasText: title }).first();
  await expect(shipment, "배선실 (정성 평가) 에 적재되지 않음").toBeVisible({
    timeout: 60_000,
  });
  await expect(shipment).toContainText("연결됨");

  await shipment.getByRole("button").first().click();
  await expect(page.getByText("세션 전체 평가의견")).toBeVisible();

  await page.getByRole("button", { name: "연결 끊기" }).click();
  await expect(shipment).toContainText("연결 해제", { timeout: 30_000 });
  await page.getByRole("button", { name: "연결하기" }).click();
  await expect(shipment).toContainText("연결됨", { timeout: 30_000 });

  // ── 두 배선실이 서로 섞이지 않는가 ─────────────────────────────────
  await page.goto("/admin/packaging");
  await expect(page.getByRole("columnheader", { name: "세무사 ID" })).toBeVisible(
    { timeout: 30_000 },
  );
  await expect(page.getByRole("columnheader", { name: "규모" })).toBeVisible();
});
