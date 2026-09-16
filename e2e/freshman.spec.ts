import { expect, test, type Page } from "@playwright/test";
import { enterFreshmanMode, enterPartnerMode, openWorkspace, seedPlan, settle } from "./helpers";

const VIEWPORTS = [
  { name: "phone-390x844", width: 390, height: 844 },
  { name: "tablet-834x1112", width: 834, height: 1112 },
  { name: "desktop-1440x1000", width: 1440, height: 1000 },
] as const;

const ENGINEERING = /\b(latitude|longitude|mesh|shader|debug|inspector|rotationDeg)\b|\b[xz]\s*[:：]|吸附|原點/i;

async function seedE310(page: Page): Promise<void> {
  await seedPlan(page);
  await page.evaluate(() => (window as unknown as {
    planform: { app: { applyVenuePresetById(id: string): boolean } };
  }).planform.app.applyVenuePresetById("venue:tku-e310"));
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return { scroll: root.scrollWidth, view: window.innerWidth };
  });
  expect(overflow.scroll, `scrollWidth ${overflow.scroll} vs ${overflow.view}`).toBeLessThanOrEqual(overflow.view + 1);
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("freshman can read campus → room → indoor layout", async ({ page }) => {
      await openWorkspace(page);
      await seedE310(page);
      await enterFreshmanMode(page);

      await expect(page.locator(".partnerbar__title")).toContainText("淡江大學");
      await expect(page.locator(".partnerbar__title")).toContainText("工學大樓");
      await expect(page.locator(".partnerbar__title")).toContainText("E310");
      await expect(page.locator(".layerchip")).toHaveCount(4);
      await expect(page.locator(".freshmanlayers")).toBeVisible();
      await expect(page.locator(".partnerroles")).toBeHidden();

      await expect(page.locator(".campusmap")).toBeVisible();
      await expect(page.locator(".campusmap__search")).toBeVisible();
      await expect(page.locator(".campusmap__card")).toContainText("入口待現場確認");
      await expect(page.locator(".campusmap")).toContainText("OpenStreetMap");
      await page.locator(".tku-pin__dot, .campusmap__fallback").first().waitFor({ timeout: 8000 }).catch(() => undefined);
      await Promise.race([
        page.locator(".leaflet-tile-loaded").first().waitFor({ timeout: 8000 }),
        page.locator(".campusmap__fallback").waitFor({ timeout: 8000 }),
      ]).catch(() => undefined);
      await expect(page.locator(".left")).toBeHidden();
      await expect(page.locator(".right")).toBeHidden();
      if (process.env.WALKTHROUGH_DIR) {
        await page.screenshot({
          path: `${process.env.WALKTHROUGH_DIR}/freshman_campus_${vp.name}_layout.png`,
          fullPage: false,
        });
      }

      await page.locator(".campusmap__search").fill("E305");
      await expect(page.locator(".campusmap__hit").first()).toContainText("E305");
      await expect(page.locator(".campusmap__results")).not.toContainText("E310 工學大樓教室");

      await page.locator(".campusmap__search").fill("E310");
      await expect(page.locator(".campusmap__hit").first()).toContainText("E310");

      await page.locator('.layerchip[data-layer="indoor"]').click();
      await settle(page);
      if (vp.width <= 600) {
        await expect(page.locator(".campusmap")).toBeHidden();
      }
      await expect(page.locator(".partnerbrief")).toContainText("我們在哪裡");
      await expect(page.locator(".partnerbrief")).toContainText("教室怎麼擺");
      await expect(page.locator(".partnerbrief")).toContainText("下一步去哪裡");
      await expect(page.getByRole("button", { name: "看校園位置" })).toBeVisible();
      if (process.env.WALKTHROUGH_DIR) {
        await page.screenshot({
          path: `${process.env.WALKTHROUGH_DIR}/freshman_indoor_${vp.name}_layout.png`,
          fullPage: false,
        });
      }

      const text = await page.evaluate(() =>
        [".partnertop", ".partnerdock"]
          .map((sel) => (document.querySelector(sel) as HTMLElement | null)?.innerText ?? "")
          .join("\n"));
      expect(text).not.toMatch(ENGINEERING);
      await noHorizontalOverflow(page);
    });
  });
}

test("E305 and E310 stay separate venues in the app", async ({ page }) => {
  await openWorkspace(page);
  const ids = await page.evaluate(() => {
    const app = (window as unknown as {
      planform: { app: {
        applyVenuePresetById(id: string): boolean;
        store: { getState(): { venuePresetId?: string; placeId?: string } };
      } };
    }).planform.app;
    app.applyVenuePresetById("venue:tku-e305");
    const e305 = { ...app.store.getState() };
    app.applyVenuePresetById("venue:tku-e310");
    const e310 = { ...app.store.getState() };
    return { e305: { venue: e305.venuePresetId, place: e305.placeId }, e310: { venue: e310.venuePresetId, place: e310.placeId } };
  });
  expect(ids.e305.venue).toBe("venue:tku-e305");
  expect(ids.e305.place).toBe("E305");
  expect(ids.e310.venue).toBe("venue:tku-e310");
  expect(ids.e310.place).toBe("E310");
});

test("crew partner mode does not open the freshman campus map", async ({ page }) => {
  await openWorkspace(page);
  await seedPlan(page);
  await enterPartnerMode(page);
  await expect(page.locator(".campusmap")).toBeHidden();
  await expect(page.locator(".freshmanlayers")).toBeHidden();
  await expect(page.locator(".rolechip")).toHaveCount(5);
});

test("campus map falls back without a white screen when tiles fail", async ({ page }) => {
  await page.route("https://*.tile.openstreetmap.org/**", (route) => route.abort());
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
  await openWorkspace(page);
  await seedE310(page);
  await enterFreshmanMode(page);
  await expect(page.locator(".campusmap")).toBeVisible();
  await expect(page.locator(".campusmap__fallback")).toBeVisible({ timeout: 8000 });
  await expect(page.locator(".campusmap")).toContainText("地圖暫時沒有載入");
  await expect(page.locator(".campusmap")).toContainText("OpenStreetMap");
  await expect(page.locator(".campusmap__card")).toBeVisible();
  await noHorizontalOverflow(page);
  if (process.env.WALKTHROUGH_DIR) {
    await page.screenshot({
      path: `${process.env.WALKTHROUGH_DIR}/freshman_map_offline_fallback.png`,
      fullPage: false,
    });
  }
});
