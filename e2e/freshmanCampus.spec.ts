import { expect, test, type Page } from "@playwright/test";
import { enterPartnerMode, isOnScreen, openWorkspace, probe, seedPlan, settle } from "./helpers";

const ENGINEERING = /latitude|longitude|\blat\b|\blng\b|mesh|shader|object id|debug|rotationDeg|\bX\s*[:：]|\bZ\s*[:：]/i;

const VIEWPORTS = [
  { name: "phone-390x844", width: 390, height: 844, mode: "phone" as const },
  { name: "tablet-834x1112", width: 834, height: 1112, mode: "tablet" as const },
  { name: "desktop-1440x1000", width: 1440, height: 1000, mode: "desktop" as const },
];

async function seedTamkangPlan(page: Page): Promise<void> {
  await seedPlan(page);
  await page.evaluate(() => {
    const pf = (window as unknown as {
      planform: { store: { mutate(fn: (p: Record<string, unknown>) => void): void } };
    }).planform;
    pf.store.mutate((p) => {
      p.placeId = "E310";
      p.venuePresetId = "venue:tku-e310";
      p.name = "E310 新生場佈";
    });
  });
}

async function enterFreshman(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as {
    planform: { app: { enterFreshmanPartnerMode(): void } };
  }).planform.app.enterFreshmanPartnerMode());
  await expect(page.locator("#app")).toHaveClass(/freshman/);
  await settle(page);
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("freshman view shows campus → room without engineering words", async ({ page }) => {
      await openWorkspace(page);
      await seedTamkangPlan(page);
      await enterFreshman(page);

      expect(await isOnScreen(page, ".left")).toBe(false);
      expect(await isOnScreen(page, ".right")).toBe(false);
      await expect(page.locator(".partnertop")).toContainText("淡江大學");
      await expect(page.locator(".partnertop")).toContainText("工學大樓");
      await expect(page.locator(".partnertop")).toContainText("E310");
      await expect(page.locator(".layerchip")).toHaveCount(4);
      await expect(page.locator(".campusmap")).toBeVisible();
      await expect(page.locator(".campuschip")).toHaveCount(3);
      await expect(page.locator(".campusmap__attr")).toContainText("OpenStreetMap");
      const text = await page.locator(".partnertop, .partnerdock, .campusmap").allInnerTexts();
      expect(text.join("\n")).not.toMatch(ENGINEERING);
      await noHorizontalOverflow(page);
      const state = await probe(page);
      expect(state.mode).toBe(vp.mode);
    });

    test("searching E305 does not land on E310", async ({ page }) => {
      await openWorkspace(page);
      await seedTamkangPlan(page);
      await enterFreshman(page);
      await page.locator(".campusmap__search").fill("E305");
      await expect(page.locator(".campusmap__hit").first()).toContainText("E305");
      await expect(page.locator(".campusmap__hit").first()).not.toContainText("E310");
      await page.locator(".campusmap__search").press("Enter");
      await expect(page.locator(".campusmap__where")).toContainText("E305");
      await expect(page.locator(".photocard__tag").first()).toContainText("待現場確認");
    });

    test("indoor layout shows you-are-here and the next stop", async ({ page }) => {
      await openWorkspace(page);
      await seedTamkangPlan(page);
      await enterFreshman(page);
      await page.locator('.layerchip[data-layer="indoor"]').click();
      await settle(page);
      await expect(page.locator(".freshmanplan")).toBeVisible();
      await expect(page.locator(".fplan__label--here")).toContainText("你在這裡");
      await expect(page.locator(".freshmanplan__legend")).toContainText("入口");
      await expect(page.locator(".freshmanplan__legend")).toContainText("地墊");
      await page.locator(".freshmanactions .freshmanaction--accent").click();
      await expect(page.locator(".partnerbrief")).toContainText("你在這裡");
      await noHorizontalOverflow(page);
    });
  });
}

test.describe("campus map failure and old projects", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("blocked OSM tiles fall back to the stored directory", async ({ page }) => {
    await page.route("**/tile.openstreetmap.org/**", (route) => route.abort());
    await openWorkspace(page);
    await seedTamkangPlan(page);
    await enterFreshman(page);
    await expect(page.locator(".campusmap__fail")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".campusmap__fallback")).toBeVisible();
  });

  test("staff partner mode is unchanged", async ({ page }) => {
    await openWorkspace(page);
    await seedPlan(page);
    await enterPartnerMode(page);
    await expect(page.locator(".rolechip")).toHaveCount(5);
    await expect(page.locator(".partneraction").first()).toContainText("彩排");
    await expect(page.locator(".freshmanlayers")).toBeHidden();
  });
});
