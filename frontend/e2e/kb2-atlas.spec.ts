import { test, expect } from "@playwright/test";
const stamp = 1700000000000;
const groups = [
  {
    id: "g1",
    label: "소득과 사업",
    status: "active",
    createdAt: stamp,
    updatedAt: stamp,
  },
  {
    id: "g2",
    label: "재산과 상속",
    status: "active",
    createdAt: stamp,
    updatedAt: stamp,
  },
];
const documents = ["필요경비와 증빙", "사업소득 구분", "상속재산 평가"].map(
  (title, i) => ({
    id: `d${i + 1}`,
    title,
    taxCategory: title,
    groupId: i < 2 ? "g1" : "g2",
    status: "active",
    createdAt: stamp,
    updatedAt: stamp,
  }),
);
const sentence = {
  id: "s1",
  documentId: "d1",
  orderIndex: 0,
  content: "사업 관련 지출은 증빙자료와 함께 검토합니다.",
  sourcePassageIds: ["p1"],
  attribution: [{ auditorId: "전문가", weight: 1 }],
  lockedByAuditor: false,
  version: 1,
  createdAt: stamp,
  updatedAt: stamp,
  lockedBy: null,
  effectivelyLocked: false,
  status: "active",
};
// Intercept HTTP and WebSocket traffic before navigation: no live backend writes.
test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  await context.addInitScript(() =>
    localStorage.setItem(
      "account-store-v1",
      JSON.stringify({ state: { session: "auditor" }, version: 3 }),
    ),
  );
  await context.routeWebSocket("**/*", (socket) => {
    if (
      socket
        .url()
        .replace(/^ws/, "http")
        .startsWith(origin + "/")
    )
      socket.connectToServer();
    else socket.close();
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith("/api/") && url.origin === origin)
      return route.continue();
    let data: unknown = { dbConfigured: true };
    if (url.pathname.endsWith("/groups")) data = { groups, dbConfigured: true };
    else if (url.pathname.endsWith("/documents"))
      data = { documents, dbConfigured: true };
    else if (url.pathname.endsWith("/atlas/search"))
      data = {
        results: [
          {
            id: "s1",
            documentId: "d1",
            documentTitle: documents[0].title,
            content: sentence.content,
          },
        ],
        dbConfigured: true,
      };
    else if (
      url.pathname.includes("/documents/") &&
      url.pathname.endsWith("/sentences")
    )
      data = {
        sentences: url.pathname.includes("/d1/") ? [sentence] : [],
        dbConfigured: true,
      };
    else if (url.pathname.endsWith("/sources"))
      data = {
        passages: [
          {
            id: "p1",
            content: "상담 원문: 지출 증빙을 확인합니다.",
            auditorId: "전문가",
          },
        ],
        dbConfigured: true,
      };
    else if (url.pathname.endsWith("/versions"))
      data = { versions: [], dbConfigured: true };
    else if (url.pathname.endsWith("/lock"))
      data = { ok: true, lockedBy: "auditor", dbConfigured: true };
    else if (url.pathname.startsWith("/rest/")) data = [];
    await route.fulfill({ json: data });
  });
});
test("map, evidence, URL restoration and reading stay synchronized", async ({
  page,
}) => {
  await page.goto("/audit/kb2/atlas");
  await expect(
    page.getByRole("heading", { name: "지식 지도", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "소득과 사업 탐색", exact: true })
    .click();
  await page
    .getByRole("button", { name: "필요경비와 증빙 열기", exact: true })
    .click();
  await expect(page).toHaveURL(/document=d1/);
  await page.getByRole("button", { name: /사업 관련 지출은 증빙자료/ }).click();
  await expect(
    page.getByText("상담 원문: 지출 증빙을 확인합니다."),
  ).toBeVisible();
  await expect(page).toHaveURL(/sentence=s1/);
  await page.reload();
  await expect(
    page.getByText("상담 원문: 지출 증빙을 확인합니다."),
  ).toBeVisible();
  await page.getByRole("button", { name: "읽기 보기", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /사업 관련 지출은 증빙자료/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "전체 지도", exact: true }).click();
  await page.goBack();
  await expect(
    page.getByText("상담 원문: 지출 증빙을 확인합니다."),
  ).toBeVisible();
});
test("failed save preserves draft and retry commits it", async ({ page }) => {
  let fail = true;
  await page.route("**/api/kb2/sentences/s1", async (route) => {
    if (fail)
      return route.fulfill({ status: 503, json: { error: "unavailable" } });
    if (route.request().postDataJSON().expectedVersion !== 1) {
      return route.fulfill({
        status: 409,
        json: { detail: "Missing version guard" },
      });
    }
    await route.fulfill({
      json: {
        sentence: {
          ...sentence,
          content: route.request().postDataJSON().content,
          version: 2,
          lockedByAuditor: true,
        },
        dbConfigured: true,
      },
    });
  });
  await page.goto("/audit/kb2/atlas?document=d1&sentence=s1");
  await page.getByRole("button", { name: "문장 수정", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "문장 내용", exact: true });
  await expect(editor).toBeFocused();
  await editor.fill("실패해도 보존되는 전문가 초안");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(editor).toHaveValue("실패해도 보존되는 전문가 초안");
  await expect(
    page.getByRole("complementary", { name: "문장과 근거" }).getByRole("alert"),
  ).toContainText("유지");
  fail = false;
  await page.getByRole("button", { name: "다시 저장", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "저장했습니다" }),
  ).toBeVisible();
});
test("search opens evidence on mobile without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/audit/kb2/atlas");
  await page
    .getByRole("searchbox", { name: "지식 검색", exact: true })
    .fill("증빙자료");
  await page
    .getByRole("button", { name: /필요경비와 증빙.*사업 관련/ })
    .click();
  await expect(
    page.getByText("상담 원문: 지출 증빙을 확인합니다."),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("heading", { name: "선택한 문장", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: "test-results/kb2-atlas-mobile.png",
    fullPage: true,
  });
});

test("connection failure is recoverable and an empty corpus is explicit", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/api/kb2/groups", (route) =>
    fail
      ? route.fulfill({ status: 503 })
      : route.fulfill({ json: { groups: [], dbConfigured: true } }),
  );
  await page.route("**/api/kb2/documents", (route) =>
    route.fulfill({ json: { documents: [], dbConfigured: true } }),
  );
  await page.goto("/audit/kb2/atlas");
  await expect(
    page.getByText("지식 지도를 불러오지 못했습니다."),
  ).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "다시 불러오기" }).click();
  await expect(page.getByText(/아직 등록된 주제가 없습니다/)).toBeVisible();
});

test("lock denial does not open an editor", async ({ page }) => {
  await page.route("**/api/kb2/sentences/s1/lock", (route) =>
    route.fulfill({
      json: { ok: false, lockedBy: "another", dbConfigured: true },
    }),
  );
  await page.goto("/audit/kb2/atlas?document=d1&sentence=s1");
  await page.getByRole("button", { name: "문장 수정", exact: true }).click();
  await expect(
    page.getByText(/다른 전문가가 수정 중이거나 연결할 수 없습니다/),
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "문장 내용" })).toHaveCount(0);
});

test("a draft survives leaving the statement and returning", async ({
  page,
}) => {
  await page.goto("/audit/kb2/atlas?document=d1&sentence=s1");
  await page.getByRole("button", { name: "문장 수정", exact: true }).click();
  await page
    .getByRole("textbox", { name: "문장 내용" })
    .fill("다시 돌아와서 이어 쓸 초안");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "전체 지도", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "소득과 사업 탐색", exact: true }),
  ).toBeVisible();
  await page.goBack();
  await page.getByRole("button", { name: "문장 수정", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "문장 내용" })).toHaveValue(
    "다시 돌아와서 이어 쓸 초안",
  );
});

test("a slower previous document never replaces the selected document", async ({
  page,
}) => {
  let release!: () => void;
  let started!: () => void;
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/kb2/documents/d1/sentences", async (route) => {
    started();
    await pending;
    await route.fulfill({
      json: { sentences: [sentence], dbConfigured: true },
    });
  });
  await page.goto("/audit/kb2/atlas?document=d1");
  await requested;
  await page
    .getByRole("button", { name: "사업소득 구분", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("아직 문장이 없습니다. 다른 주제를 탐색해 보세요."),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole("button", { name: /사업 관련 지출은 증빙자료/ }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(/document=d2/);
});

test("desktop overview and inspector remain legible", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/audit/kb2/atlas");
  await expect(
    page.getByRole("button", { name: "소득과 사업 탐색", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/kb2-atlas-desktop.png" });
  await page
    .getByRole("button", { name: "필요경비와 증빙 열기", exact: true })
    .click();
  await page.getByRole("button", { name: /사업 관련 지출은 증빙자료/ }).click();
  await expect(
    page.getByText("상담 원문: 지출 증빙을 확인합니다."),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/kb2-atlas-evidence.png" });
});

test("version conflicts preserve the draft and explain how to recover", async ({
  page,
}) => {
  await page.route("**/api/kb2/sentences/s1", (route) =>
    route.fulfill({ status: 409, json: { detail: "Version changed" } }),
  );
  await page.goto("/audit/kb2/atlas?document=d1&sentence=s1");
  await page.getByRole("button", { name: "문장 수정", exact: true }).click();
  const draft = page.getByRole("textbox", { name: "문장 내용" });
  await draft.fill("충돌해도 남아 있는 초안");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(draft).toHaveValue("충돌해도 남아 있는 초안");
  await expect(page.getByText(/문장 버전이 변경되었습니다/)).toBeVisible();
});
