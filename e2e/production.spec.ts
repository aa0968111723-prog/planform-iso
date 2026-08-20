import { expect, test } from "@playwright/test";

test.describe("production bundle", () => {
  test("opens with the e2e hook gated by the query flag", async ({ page }) => {
    await page.goto("/?e2e");
    await expect(page.locator("#app")).toBeVisible();
    await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { planform?: unknown }).planform))).toBe(true);
  });

  test("serves a build version and exposes the update-banner surface", async ({ page, request }) => {
    const version = await request.get("/version.json");
    expect(version.ok()).toBeTruthy();
    await page.goto("/?e2e");
    await expect(page.locator("#app")).toBeVisible();
    await page.evaluate(() => {
      const hook = (window as unknown as { planform?: { showUpdateBanner?: () => void } }).planform;
      hook?.showUpdateBanner?.();
    });
    await expect(page.locator(".update-banner")).toContainText("有新版本可以使用");
  });
});
