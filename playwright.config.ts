import { defineConfig, devices } from "@playwright/test";

/**
 * Browser smoke tests for the responsive workspace. They drive the real app in
 * Chromium at every acceptance viewport (phone, tablet portrait/landscape,
 * desktop) and assert the canvas-first contract holds.
 *
 * `PLAYWRIGHT_CHROMIUM_EXECUTABLE` lets CI point at a preinstalled browser; on
 * a normal machine Playwright's own download is used.
 *
 * The browser is launched under a UTF-8 locale. Planform names its exports in
 * Chinese (場佈總覽, 動線圖 …) because that is what a volunteer wants to see in
 * their LINE gallery, and Chromium running under a POSIX/C locale silently
 * sanitises those filenames down to a bare "download". That turns a real,
 * passing export into a confusing test failure on any box that has not set a
 * locale — so we set one here rather than weaken the assertion.
 */
const utf8Locale = {
  LC_ALL: process.env.LC_ALL || "C.utf8",
  LANG: process.env.LANG || "C.utf8",
};
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
      env: utf8Locale,
      // Software GL so the WebGL scene renders on a headless CI box.
      args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"],
    },
  },
  projects: [
    {
      name: "chromium",
      testIgnore: "**/production.spec.ts",
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:5183" },
    },
    {
      name: "production",
      testMatch: "**/production.spec.ts",
      use: { ...devices["Desktop Chrome"], baseURL: "http://127.0.0.1:4180" },
    },
  ],
  webServer: [
    {
      command: "npm run dev -- --port 5183 --strictPort",
      url: "http://127.0.0.1:5183",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "npm run build && npm run preview -- --port 4180 --strictPort",
      url: "http://127.0.0.1:4180",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
