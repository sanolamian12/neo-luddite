import { expect, test } from "@playwright/test";
import { createAgent, type Agent } from "../lib/agent-studio";
import { createPractice } from "../lib/agent-practice";
import type { ServerExpertCase } from "../services/expert-kb3";
import { liveTransport } from "./live-fixtures";

test("live studio retains server saving, room assignment, KB3 publication, sharing and AI preview", async ({ page }) => {
  await liveTransport(page, "auditor");
  let rows = ["live-one", "live-two"].map((id) => ({ agent_id: id, created_at: 1, is_room_agent: id === "live-one", agent: { ...createAgent("auditor"), id, name: id, practice: createPractice() } as Agent }));
  const writes: typeof rows[] = [];
  await page.route("**/rest/v1/expert_agents?**", async (route) => {
    const method = route.request().method();
    if (method === "POST") { rows = route.request().postDataJSON(); writes.push(rows); }
    await route.fulfill({ json: method === "GET" ? rows : null });
  });
  let savedCase: ServerExpertCase | undefined;
  let failSave = true;
  await page.route("**/api/kb3/expert/cases", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { ok: true, cases: savedCase ? [savedCase] : [] } });
    if (failSave) return route.fulfill({ status: 503, json: { detail: "검증용 저장 실패" } });
    savedCase = { ...route.request().postDataJSON(), id: "server-case", publishState: "draft", updatedAt: Date.now() };
    await route.fulfill({ json: { ok: true, case: savedCase } });
  });
  await page.route("**/api/kb3/expert/cases/server-case/publish", async (route) => {
    savedCase = { ...savedCase!, publishState: route.request().postDataJSON().published ? "published" : "draft" };
    await route.fulfill({ json: { ok: true, case: savedCase } });
  });
  await page.route("**/api/kb3/expert/share", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ ids: ["server-case"] });
    savedCase = { ...savedCase!, shareState: "pending" };
    await route.fulfill({ json: { ok: true, cases: [savedCase] } });
  });
  await page.route("**/api/kb3/expert/preview", async (route) => {
    expect(route.request().postDataJSON().text).toBe("연동 확인 질문");
    await route.fulfill({ json: { message: { segments: [{ id: "preview", type: "conclusion", text: "실제 시험칸 연동 응답" }] }, meta: { ragPassages: [{ corpus: "kb3_expert", id: "server-case", rank: 1, score: 1 }] } } });
  });
  await page.goto("/audit/agents/teach?agent=live-two&method=session");
  await expect(page.getByRole("button", { name: "상담에서 배우기", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "공통 지식 기여", exact: true })).toHaveCount(0);
  await page.getByRole("checkbox", { name: "연결 상담방에서 쓰는 에이전트" }).check();
  await page.getByRole("button", { name: "예시로 시작", exact: true }).click();
  await page.getByRole("textbox", { name: "사례 이름 필수", exact: true }).fill("서버 저장 통합 확인");
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await page.getByRole("button", { name: "검토한 지식 반영", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "검증용 저장 실패" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "사례 이름 필수", exact: true })).toHaveValue("서버 저장 통합 확인");
  failSave = false;
  await page.getByRole("button", { name: "검토한 지식 반영", exact: true }).click();
  await expect(page.getByText(/답변 사례를 서버에 초안으로 저장했습니다/)).toBeVisible();
  await page.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(page.getByText("서버에 저장됨", { exact: true })).toBeVisible();
  expect(writes.at(-1)?.find((row) => row.agent_id === "live-two")?.is_room_agent).toBe(true);
  expect(writes.at(-1)?.find((row) => row.agent_id === "live-two")?.agent.practice?.questions.some((item) => item.origin === "expert")).toBe(true);
  await page.getByRole("button", { name: "지식 모음에서 확인", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "사례 이름", exact: true })).toHaveValue("서버 저장 통합 확인");
  await page.getByRole("button", { name: "게시", exact: true }).click();
  await expect(page.getByRole("button", { name: "내리기", exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "서버 저장 통합 확인 공유 선택" }).check();
  await page.getByRole("button", { name: "공용 KB 로 보내기", exact: true }).click();
  await expect(page.getByText("RAG 반영 · 게시 · 공용 KB 승인 대기")).toBeVisible();
  await page.getByRole("link", { name: "미리보기", exact: true }).click();
  await page.getByRole("region", { name: "실제 AI 시험" }).getByRole("textbox", { name: "고객 질문" }).fill("연동 확인 질문");
  await page.getByRole("button", { name: "답변 받기", exact: true }).click();
  await expect(page.getByText("실제 시험칸 연동 응답", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "연결 상담방에서 쓰는 에이전트" })).toBeChecked();
  await page.getByRole("link", { name: "지식 모음", exact: true }).click();
  await page.getByRole("button", { name: /서버 저장 통합 확인/ }).click();
  await expect(page.getByText("RAG 반영 · 게시 · 공용 KB 승인 대기")).toBeVisible();
  await page.goto("/audit/contributions");
  await expect(page.getByRole("heading", { name: "페이지를 찾을 수 없습니다" })).toBeVisible();
});

test("live admin keeps the existing KB3 approval while hiding the prototype proposal workflow", async ({ page }) => {
  await liveTransport(page, "admin");
  await page.goto("/admin/dashboard");
  await expect(page.getByRole("link", { name: "공용 KB 공유 승인", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "공통 지식 기여", exact: true })).toHaveCount(0);
  await page.goto("/admin/knowledge-contributions");
  await expect(page.getByRole("heading", { name: "페이지를 찾을 수 없습니다" })).toBeVisible();
});
