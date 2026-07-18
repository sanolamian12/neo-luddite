import { defineConfig, devices } from "@playwright/test";

/**
 * E2E 설정 — 이미 떠 있는 dev 서버(3011)를 향한다.
 *
 * webServer 를 두지 않는 이유: 이 스펙은 백엔드(Seam A, RAG 적재)까지 함께 필요해서
 * 두 서버를 러너 스크립트가 먼저 띄운다. Playwright 가 프론트만 띄우면 최종 승인 뒤
 * 배선실이 비어 실패한다(적재 경로가 백엔드를 지나므로).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3011",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "ko-KR",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
