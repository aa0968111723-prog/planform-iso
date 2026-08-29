import { expect, test } from "@playwright/test";

test.describe("production bundle", () => {
  test("opens with the e2e hook gated by the query flag", async ({ page }) => {
    await page.goto("/?e2e");
    await expect(page.locator("#app")).toBeVisible();
    await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { planform?: unknown }).planform))).toBe(true);
  });

  test("stays usable after going offline", async ({ page, context }) => {
    await page.goto("/?e2e");
    await expect(page.locator("#app")).toBeVisible();
    await page.waitForFunction(() => navigator.serviceWorker?.ready.then((r) => Boolean(r)), undefined, {
      timeout: 30_000,
    }).catch(() => undefined);
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#app")).toBeVisible();
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
