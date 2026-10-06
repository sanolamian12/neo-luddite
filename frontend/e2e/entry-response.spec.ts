import { expect, test } from "@playwright/test";
import { expertFixture, liveTransport } from "./live-fixtures";

test.beforeEach(async ({ page }) => {
  await liveTransport(page);
  await page.route("**/rest/v1/rpc/list_experts", (route) => route.fulfill({ json: [expertFixture] }));
});

// Intercept only the API boundary; exercise the real store, route and response UI.
// Run against a frontend built with NEXT_PUBLIC_DATA_MODE=live and a local API base.
test("live entry preserves source anchors, cards and real data through reload", async ({ page }) => {
  await page.route("**/api/chat", async (route) => {
    await route.fulfill({ json: {
      message: {
        id: "api-answer", role: "assistant", order: 1,
        segments: [{ id: "api-evidence", type: "conclusion", text: "서버가 제공한 답변입니다.", framework: "입증책임", citations: ["API 출처 확인용 기록"] }],
        uiBlocks: [
          { kind: "verdict_card", verdict: "조건부", title: "서버 판정", summary: "서버의 판정 설명" },
          { kind: "evidence_checklist", title: "서버 확인 자료", items: [{ label: "서버가 요청한 자료", required: true }] },
          { kind: "expert_handoff", reason: "서버의 상담 연결 사유" },
        ],
      }, meta: {},
    } });
  });
  await page.goto("/chat/clinic");
  await page.getByRole("textbox", { name: "질문 또는 상황을 입력하세요" }).fill("입구 상담 표시 확인");
  await page.getByRole("button", { name: "질문 보내기" }).click();
  await expect(page.getByText("서버 판정", { exact: true })).toBeVisible();
  await expect(page.locator('[data-segment-id="api-evidence"]')).toContainText("API 출처 확인용 기록");
  await expect(page.getByText("서버가 요청한 자료", { exact: true })).toBeVisible();
  await expect(page.getByText("서버의 상담 연결 사유", { exact: true })).toBeVisible();
  await expect(page.getByText("판정 표시 예시", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-segment-id="api-evidence"]')).toContainText("API 출처 확인용 기록");
  await expect(page.getByText("판정 표시 예시", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "세무사 보기", exact: true }).click();
  await expect(page.getByRole("heading", { name: "내 고민에 맞는 세무사" })).toBeVisible();
  await expect(page.locator('a[href^="/login"]').filter({ hasText: "로그인하고 상담 신청" })).toHaveAttribute("href", /\/login\?next=/);
  await expect(page.getByRole("button", { name: "신청하기", exact: true })).toHaveCount(0);
});

test("owner replies save without an AI handoff recommendation and recover from failed saving", async ({ page }) => {
  await liveTransport(page, "viewer");
  const saved: Record<string, unknown>[] = [];
  let fail = true;
  await page.route("**/rest/v1/conversations?**", async (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ json: [] });
    if (fail) return route.fulfill({ status: 500, json: { message: "fixture save failure" } });
    saved.push(route.request().postDataJSON());
    await route.fulfill({ json: null });
  });
  await page.route("**/api/chat", (route) => route.fulfill({ json: {
    message: { id: "owner-answer", role: "assistant", order: 1, segments: [{ id: "owner-source", type: "follow_up", text: "서버의 확인 질문" }] }, meta: {},
  } }));
  await page.goto("/chat/clinic");
  await page.getByRole("textbox", { name: "질문 또는 상황을 입력하세요" }).fill("내 상담 저장 확인");
  await page.getByRole("button", { name: "질문 보내기" }).click();
  await expect(page.getByText("상담 연결을 준비하지 못했어요. 대화는 보관되어 있습니다.")).toBeVisible();
  expect(saved).toHaveLength(0);
  fail = false;
  await page.getByRole("button", { name: "다시 준비하기" }).click();
  await expect(page.getByRole("button", { name: "세무사와 상담 이어가기" })).toBeVisible();
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ source: "live", owner_id: "viewer", turn_count: 2 });
  expect(JSON.stringify(saved[0])).toContain("owner-source");
  expect(JSON.stringify(saved[0])).not.toContain("판정 표시 예시");
});

test("live replies without optional metadata stay unembellished after reload", async ({ page }) => {
  await page.route("**/api/chat", (route) => route.fulfill({ json: {
    message: { id: "api-followup", role: "assistant", order: 1, segments: [{ id: "api-question", type: "follow_up", text: "서버가 사실을 추가로 확인합니다." }] }, meta: {},
  } }));
  await page.goto("/chat/clinic");
  await page.getByRole("textbox", { name: "질문 또는 상황을 입력하세요" }).fill("추가 확인이 필요한 질문");
  await page.getByRole("button", { name: "질문 보내기" }).click();
  await expect(page.locator('[data-role="assistant"]')).toContainText("서버가 사실을 추가로 확인합니다.");
  await page.reload();
  await expect(page.locator('[data-role="assistant"]')).toContainText("서버가 사실을 추가로 확인합니다.");
  await expect(page.getByText("판정 표시 예시", { exact: true })).toHaveCount(0);
  await expect(page.getByText("상담 준비 안내 · 가상 출처 예시", { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-slot="card"]')).toHaveCount(0);
});
