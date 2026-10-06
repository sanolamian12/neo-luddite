import { expect, test, type Page } from "@playwright/test";

// Browser-local prototype only. Run this named spec against a production build;
// the other E2E suites have their own live-backend requirements.
async function login(page: Page) {
  await page.goto("/login");
  await expect(page.getByText("프로토타입 · 샘플 데이터", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "아이디", exact: true }).fill("auditor");
  await page.getByRole("textbox", { name: "비밀번호", exact: true }).fill("demo1234");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/audit\/dashboard$/);
}

test("teaching methods retain intake, save it, and resume through production route transitions", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/audit/agents/teach?agent=starter-auditor&method=session");
  await page.getByRole("button", { name: /예시 상담 열기/ }).click();
  await expect(page.getByRole("heading", { name: "채팅·통화 전사문 가져오기", exact: true })).toBeInViewport();
  const transcript = await page.getByRole("textbox", { name: "화자가 구분된 전사문 필수", exact: true }).inputValue();
  await page.getByRole("textbox", { name: "상담 이름 필수", exact: true }).fill("저장 전 상담 초안");
  await page.getByRole("button", { name: "직접 사례 들려주기", exact: true }).click();
  await expect(page).toHaveURL(/method=manual$/);
  await page.getByRole("button", { name: "예시로 시작", exact: true }).click();
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.getByRole("heading", { name: "왜 그렇게 판단했나요?", exact: true })).toBeInViewport();
  await page.getByRole("button", { name: "상담에서 배우기", exact: true }).click();
  await expect(page).toHaveURL(/method=session$/);
  await expect(page.getByRole("textbox", { name: "상담 이름 필수", exact: true })).toHaveValue("저장 전 상담 초안");
  await expect(page.getByRole("textbox", { name: "화자가 구분된 전사문 필수", exact: true })).toHaveValue(transcript);
  await page.getByRole("button", { name: "변경 저장", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "상담 이름 필수", exact: true })).toHaveValue("저장 전 상담 초안");
  await page.getByRole("combobox", { name: "현재 작업", exact: true }).selectOption("overview");
  await page.getByRole("button", { name: "사례 작성 이어가기", exact: true }).click();
  await expect(page).toHaveURL(/method=manual$/);
  await expect(page.getByRole("heading", { name: "왜 그렇게 판단했나요?", exact: true })).toBeInViewport();
});

test("knowledge search and selection follow Back and Forward", async ({ page }) => {
  await login(page);
  await page.goto("/audit/agents/knowledge?agent=starter-auditor&collection=cases&q=first");
  await page.getByRole("button", { name: /확인 질문/ }).click();
  await expect(page).toHaveURL(/collection=questions/);
  await page.getByRole("searchbox", { name: "지식 검색", exact: true }).fill("second");
  await expect(page).toHaveURL(/q=second/);
  await page.goBack();
  await expect(page).toHaveURL(/collection=cases&q=first/);
  await expect(page.getByRole("searchbox", { name: "지식 검색", exact: true })).toHaveValue("first");
  await page.goForward();
  await expect(page.getByRole("searchbox", { name: "지식 검색", exact: true })).toHaveValue("second");
});

test("applied knowledge opens its exact source and a separate autosaved shared proposal", async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/audit/agents/teach?agent=starter-auditor&method=manual");
  await page.getByRole("button", { name: "예시로 시작", exact: true }).click();
  await page.getByRole("textbox", { name: "사례 이름 필수", exact: true }).fill("개인 지식 원본");
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await page.getByRole("button", { name: "검토한 지식 반영", exact: true }).click();
  await page.getByRole("button", { name: "지식 모음에서 확인", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "사례 이름", exact: true })).toHaveValue("개인 지식 원본");
  const caseId = new URL(page.url()).searchParams.get("case");
  expect(caseId).toBeTruthy();
  await page.getByRole("button", { name: "공통 지식에 제안", exact: true }).click();
  await expect(page.getByRole("button", { name: "변경 저장", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "이 지식으로 공유 초안 만들기", exact: true }).click();
  await page.getByRole("textbox", { name: "제안 제목 필수", exact: true }).fill("별도로 다듬은 공유 사본");
  const contributionUrl = page.url();
  await page.getByRole("link", { name: "원래 사례로 돌아가기", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "사례 이름", exact: true })).toHaveValue("개인 지식 원본");
  expect(new URL(page.url()).searchParams.get("case")).toBe(caseId);
  await page.goBack();
  await expect(page.getByRole("textbox", { name: "제안 제목 필수", exact: true })).toHaveValue("별도로 다듬은 공유 사본");
  await page.reload();
  await expect(page.getByRole("link", { name: "원래 사례로 돌아가기", exact: true })).toBeInViewport();
  await expect(page.getByRole("textbox", { name: "제안 제목 필수", exact: true })).toHaveValue("별도로 다듬은 공유 사본");
  await page.goto(contributionUrl.replace("/audit/contributions", "/audit/agents/contributions"));
  await expect(page).toHaveURL(contributionUrl);
  await expect(page.getByRole("textbox", { name: "제안 제목 필수", exact: true })).toHaveValue("별도로 다듬은 공유 사본");
  await page.getByRole("link", { name: "원래 사례로 돌아가기", exact: true }).click();
  await page.getByRole("button", { name: "공통 지식에 제안", exact: true }).click();
  await page.getByRole("button", { name: "새 지식 제안", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "제안 제목 필수", exact: true })).toHaveValue("");
});
