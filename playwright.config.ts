import { defineConfig, devices } from "@playwright/test";

/**
 * Browser smoke tests for the responsive workspace. They drive the real app in
 * Chromium at every acceptance viewport (phone, tablet portrait/landscape,
 * desktop) and assert the canvas-first contract holds.
 *
 * `PLAYWRIGHT_CHROMIUM_EXECUTABLE` lets CI point at a preinstalled browser; on
 * a normal machine Playwright's own download is used.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5183",
    launchOptions: {
      executablePath,
      // Software GL so the WebGL scene renders on a headless CI box.
      args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev -- --port 5183 --strictPort",
    url: "http://127.0.0.1:5183",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
