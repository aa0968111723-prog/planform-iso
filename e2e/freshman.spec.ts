import { expect, test, type Page } from "@playwright/test";
import { enterFreshmanPartnerMode, isOnScreen, openWorkspace, settle } from "./helpers";

const VIEWPORTS = [
  { name: "phone-390x844", width: 390, height: 844 },
  { name: "tablet-834x1112", width: 834, height: 1112 },
  { name: "desktop-1440x1000", width: 1440, height: 1000 },
];

const ENGINEERING = /\bcm\b|公分|\bX\s*[:：]|\bZ\s*[:：]|latitude|longitude|mesh|shader|object id|debug|吸附|rotationDeg/i;

async function freshmanText(page: Page): Promise<string> {
  return page.evaluate(() =>
    [".partnertop", ".partnerdock", ".partnersheet", ".tkumap"]
      .map((sel) => {
        const n = document.querySelector(sel) as HTMLElement | null;
        if (!n || getComputedStyle(n).display === "none") return "";
        return n.innerText;
      })
      .join("\n"));
}

async function noHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("a first-time visitor can find the building and the room", async ({ page }) => {
      await openWorkspace(page);
      await enterFreshmanPartnerMode(page);

      await expect(page.locator("#app")).toHaveClass(/freshman/);
      await expect(page.locator('[data-testid="freshman-headline"]')).toContainText("淡江大學");
      await expect(page.locator('[data-testid="freshman-headline"]')).toContainText("工學大樓");
      await expect(page.locator('[data-testid="freshman-headline"]')).toContainText("E310");
      await expect(page.locator('[data-testid="freshman-stages"] .stagechip')).toHaveCount(4);
      expect(await isOnScreen(page, ".rolechip")).toBe(false);
      expect(await isOnScreen(page, ".left")).toBe(false);
      expect(await isOnScreen(page, ".right")).toBe(false);
      expect(await noHorizontalOverflow(page)).toBe(true);

      await expect(page.locator('[data-testid="tku-map"]')).toBeVisible();
      const mapBox = page.locator('[data-testid="tku-map"]');
      await expect(mapBox).toContainText(/OpenStreetMap|已儲存的校園|校園列表|樓館/);

      await page.locator('[data-testid="tku-map-search"]').fill("E305");
      await settle(page);
      await expect(page.locator(".tkumap__hit").first()).toContainText("E305");
      await expect(page.locator(".tkumap__hit").first()).not.toContainText("E310");

      await page.locator('[data-testid="tku-map-search"]').fill("E310");
      await settle(page);
      await expect(page.locator(".tkumap__hit").first()).toContainText("E310");
      await expect(page.locator(".tkumap__hit").first()).not.toContainText("E305");

      await page.getByRole("button", { name: "進入室內場佈" }).click();
      await settle(page);
      await expect(page.locator("#app")).toHaveAttribute("data-freshman-stage", "layout");
      await expect(page.locator('[data-testid="tku-map"]')).toBeHidden();
      const layout = await freshmanText(page);
      expect(layout).toMatch(/你現在|下一/);
      expect(layout).not.toMatch(ENGINEERING);
      expect(await noHorizontalOverflow(page)).toBe(true);
    });
  });
}

test("map tile failure still shows the campus directory", async ({ page }) => {
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
  await openWorkspace(page);
  await enterFreshmanPartnerMode(page);
  await expect(page.locator('[data-testid="tku-map"]')).toBeVisible();
  const bg = await page.locator('[data-testid="tku-map"]').evaluate((n) => getComputedStyle(n).backgroundColor);
  expect(bg).not.toBe("rgba(0, 0, 0, 0)");
  await expect(page.locator("body")).not.toHaveCSS("background-color", "rgb(255, 255, 255)");
  await page.locator('[data-testid="tku-map-search"]').fill("SG320");
  await settle(page);
  await expect(page.locator(".tkumap__hit").first()).toContainText("SG320");
});
