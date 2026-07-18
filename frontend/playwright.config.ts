import { defineConfig, devices } from "@playwright/test";

/**
 * E2E 설정 — 이미 떠 있는 프론트 서버를 향한다(dev/prod 어느 쪽이든 통과).
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
    // ⚠ 127.0.0.1 이 아니라 localhost — dev 서버는 localhost 오리진만 기본 신뢰하고,
    // 그 외에서 온 HMR 웹소켓을 끊어 React 하이드레이션 자체가 막힌다(폼·버튼 먹통).
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3012",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "ko-KR",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
