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
  await page.goto("/audit/agents/teach?agent=live-two&method=manual");
  await expect(page.getByRole("button", { name: "직접 사례 들려주기", exact: true })).toHaveAttribute("aria-pressed", "true");
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

test("live session teaching takes pasted transcripts only and saves the case to the server", async ({ page }) => {
  await liveTransport(page, "auditor");
  let rows = [{ agent_id: "live-one", created_at: 1, is_room_agent: true, agent: { ...createAgent("auditor"), id: "live-one", name: "live-one", practice: createPractice() } as Agent }];
  const writes: typeof rows[] = [];
  await page.route("**/rest/v1/expert_agents?**", async (route) => {
    const method = route.request().method();
    if (method === "POST") { rows = route.request().postDataJSON(); writes.push(rows); }
    await route.fulfill({ json: method === "GET" ? rows : null });
  });
  const posted: Record<string, string>[] = [];
  await page.route("**/api/kb3/expert/cases", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { ok: true, cases: [] } });
    posted.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true, case: { ...posted.at(-1), id: "server-session-case", publishState: "draft", updatedAt: Date.now() } } });
  });
  await page.goto("/audit/agents/overview?agent=live-one");
  await page.getByRole("button", { name: /상담에서 배우기/ }).click();
  await expect(page.getByRole("button", { name: "상담 전사문으로 가르치기", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "완료한 상담으로 시작" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /예시 상담 열기/ })).toHaveCount(0);
  await page.getByRole("textbox", { name: "상담 이름 필수", exact: true }).fill("전사문 가르치기 확인");
  await page.getByRole("textbox", { name: "화자가 구분된 전사문 필수", exact: true }).fill("[00:01] 고객: 노트북을 사서 업무와 집에서 같이 씁니다.\n[00:05] 전문가: 업무 사용 비율을 기록해 두셨나요?\n[00:09] 고객: 아니요.\n[00:12] 전문가: 사용 내역을 정리한 뒤 업무 비율만큼 경비로 보시면 됩니다.");
  await page.getByRole("button", { name: "원문으로 초안 만들기", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "동의와 권한" })).toBeVisible();
  await page.getByRole("checkbox", { name: /내가 진행한 상담이며/ }).check();
  await page.getByRole("button", { name: "원문으로 초안 만들기", exact: true }).click();
  await expect(page.getByText("가져온 전사문 · 4개 발화")).toBeVisible();
  await page.getByRole("textbox", { name: "판단한 이유 필수", exact: true }).fill("공용 자산은 업무 비율 입증이 핵심입니다.");
  await page.getByRole("textbox", { name: "적용할 상황 필수", exact: true }).fill("개인사업자가 업무·개인 겸용 장비를 산 경우");
  await page.getByRole("textbox", { name: "검색어 필수", exact: true }).fill("노트북, 겸용");
  await page.getByRole("checkbox", { name: "원문과 비교해 사실, 화자, 결론을 확인했습니다." }).check();
  await page.getByRole("textbox", { name: "다르게 시험할 상황", exact: true }).fill("업무 전용이라면?");
  await page.getByRole("textbox", { name: "그 상황에서 기대하는 답변", exact: true }).fill("전액 경비 처리를 검토합니다.");
  await page.getByRole("checkbox", { name: "다른 상황의 답변과 적용 범위를 검토했습니다." }).check();
  await page.getByRole("button", { name: "내 에이전트에 반영", exact: true }).click();
  await expect(page.getByText(/답변 사례를 서버에 초안으로 저장했습니다/)).toBeVisible();
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({ agentId: "live-one", title: "전사문 가르치기 확인", conclusion: "사용 내역을 정리한 뒤 업무 비율만큼 경비로 보시면 됩니다." });
  await expect(page.getByRole("button", { name: "공통 지식에 제안" })).toHaveCount(0);
  await expect(page.getByText("지식 모음에서 게시한 뒤 공용 KB 로 보낼 수 있습니다.")).toBeVisible();
  await page.getByRole("button", { name: "변경 저장", exact: true }).click();
  await expect(page.getByText("서버에 저장됨", { exact: true })).toBeVisible();
  const saved = writes.at(-1)?.[0].agent.practice;
  expect(saved?.learning?.sessions).toHaveLength(1);
  expect(saved?.learning?.sessions[0].turns).toHaveLength(4);
  expect(saved?.cases.some((item) => item.title === "전사문 가르치기 확인")).toBe(true);
  await page.reload();
  await expect(page.getByText("가져온 전사문 · 4개 발화")).toBeVisible();
});

test("live admin keeps the existing KB3 approval while hiding the prototype proposal workflow", async ({ page }) => {
  await liveTransport(page, "admin");
  await page.goto("/admin/dashboard");
  await expect(page.getByRole("link", { name: "공용 KB 공유 승인", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "공통 지식 기여", exact: true })).toHaveCount(0);
  await page.goto("/admin/knowledge-contributions");
  await expect(page.getByRole("heading", { name: "페이지를 찾을 수 없습니다" })).toBeVisible();
});
