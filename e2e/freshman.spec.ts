import { expect, test, type Page } from "@playwright/test";
import {
  applyVenue,
  enterFreshmanMode,
  isOnScreen,
  openWorkspace,
  pageOverflowsX,
  seedPlan,
  settle,
} from "./helpers";

const VIEWPORTS: { name: string; width: number; height: number }[] = [
  { name: "phone-390x844", width: 390, height: 844 },
  { name: "tablet-834x1112", width: 834, height: 1112 },
  { name: "desktop-1440x1000", width: 1440, height: 1000 },
];

const ENGINEERING = /\bcm\b|公分|\bX\s*[:：]|\bZ\s*[:：]|latitude|longitude|mesh|shader|object ID|debug|吸附|snap|Inspector|進階|原點|rotationDeg/i;

async function freshmanText(page: Page): Promise<string> {
  return page.evaluate(() =>
    [".partnertop", ".partnerdock", ".partnersheet", ".campusmap-host"]
      .map((sel) => {
        const n = document.querySelector(sel) as HTMLElement | null;
        if (!n || getComputedStyle(n).display === "none") return "";
        return n.innerText;
      })
      .join("\n"));
}

async function openFreshmanE310(page: Page): Promise<void> {
  await openWorkspace(page);
  await applyVenue(page, "venue:tku-e310");
  await seedPlan(page);
  await enterFreshmanMode(page);
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("freshman view shows campus, building, floor and room", async ({ page }) => {
      await openFreshmanE310(page);
      await expect(page.locator(".partnerbar__title")).toContainText("淡江大學");
      await expect(page.locator(".partnerbar__title")).toContainText("淡水校園");
      await expect(page.locator(".partnerbar__title")).toContainText("工學大樓");
      await expect(page.locator(".partnerbar__title")).toContainText("E310");
      await expect(page.locator(".partnerbar__title")).toContainText("3F");
      await expect(page.locator(".freshmanq")).toHaveCount(5);
      await expect(page.locator(".freshmanlayer")).toHaveCount(4);
      await expect(page.locator(".rolechip")).toHaveCount(0);
      expect(await freshmanText(page)).not.toMatch(ENGINEERING);
      expect(await pageOverflowsX(page)).toBe(false);
      expect(await isOnScreen(page, ".left")).toBe(false);
      expect(await isOnScreen(page, ".right")).toBe(false);
    });

    test("campus → building → room search keeps E305 and E310 apart", async ({ page }) => {
      await openFreshmanE310(page);
      if (vp.width <= 600) {
        await page.getByRole("button", { name: "🗺️ 地圖" }).click();
        await settle(page);
      }
      const search = page.locator(".campusmap__search").first();
      await expect(search).toBeVisible();
      await search.fill("E305");
      await page.locator(".campusmap__hit", { hasText: "E305" }).first().click();
      await expect(page.locator(".campusmap__headline").first()).toContainText("E305");
      await expect(page.locator(".campusmap__headline").first()).not.toContainText("E310");
      await expect(page.locator(".campusmap__entrance").first()).toContainText("入口待現場確認");
      await expect(page.locator(".campusmap__pin-kind").first()).toContainText("樓館位置");

      await search.fill("E310");
      await page.locator(".campusmap__hit", { hasText: "E310" }).first().click();
      await expect(page.locator(".campusmap__headline").first()).toContainText("E310");
      await expect(page.locator(".campusmap__headline").first()).not.toContainText("E305");
      await expect(page.getByRole("button", { name: "進入室內場佈" })).toBeVisible();
      expect(await pageOverflowsX(page)).toBe(false);
    });

    test("layout pane speaks the walk-in sequence", async ({ page }) => {
      await openFreshmanE310(page);
      await page.locator('.freshmanq[data-q="how-room-laid"]').click();
      await settle(page);
      await expect(page.locator("#app")).toHaveAttribute("data-freshman-pane", /layout|split/);
      const brief = page.locator(".partnerbrief");
      await expect(brief).toContainText(/投影幕|入口|地墊/);
      await brief.click();
      await expect(page.locator(".partnersteps")).toBeVisible();
      const steps = (await page.locator(".partnerstep").allInnerTexts()).join(" ");
      expect(steps).toMatch(/入口/);
      expect(steps).toMatch(/報到/);
      expect(steps).not.toMatch(ENGINEERING);
      expect(await pageOverflowsX(page)).toBe(false);
    });
  });
}

test.describe("map failure fallback (390x844)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("tile errors show the campus directory instead of a white screen", async ({ page }) => {
    await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
    await openFreshmanE310(page);
    await expect(page.locator(".campusmap")).toBeVisible();
    await expect.poll(async () => page.locator(".campusmap__fallback").evaluateAll(
      (els) => els.some((el) => getComputedStyle(el).display !== "none" && (el as HTMLElement).innerText.includes("校園")),
    ), { timeout: 15_000 }).toBe(true);
    const fallback = page.locator(".campusmap__fallback").locator("visible=true").first();
    await expect(fallback).toContainText("地圖暫時無法載入");
    await expect(fallback).toContainText("工學大樓");
    const bg = await page.locator(".campusmap__stage").first().evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).not.toBe("rgba(0, 0, 0, 0)");
    expect(await pageOverflowsX(page)).toBe(false);
  });
});
