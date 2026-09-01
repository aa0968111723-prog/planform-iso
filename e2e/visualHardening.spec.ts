import { expect, test } from "@playwright/test";
import { openProjectHome, probe, settle } from "./helpers";

/** One real, photo-grounded scene at the tablet viewport used for acceptance. */
async function openE310ClubGolden(page: Parameters<typeof openProjectHome>[0]): Promise<void> {
  await openProjectHome(page, { keepWizard: true });
  const wizard = page.locator(".quickstart__card");
  await wizard.locator(".quickstart__name").fill("E310 視覺驗收");
  await wizard.getByRole("button", { name: "下一步：選場地" }).click();
  await wizard.getByRole("button", { name: "建立 30 人實景場佈" }).click();
  await settle(page);
}

test.describe("visual legibility hardening", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("tablet keeps a useful scene, a compact calibration entry and bounded labels", async ({ page }, testInfo) => {
    await openE310ClubGolden(page);

    const visual = await page.evaluate(() => {
      let textLabels = 0;
      const scene = (window as unknown as {
        planform: { app: { scene: { scene: { traverse(cb: (node: { type?: string; visible?: boolean; userData?: { textLabel?: boolean } }) => void): void } } } };
      }).planform.app.scene.scene;
      scene.traverse((node) => {
        if (node.type === "Sprite" && node.visible && node.userData?.textLabel) textLabels++;
      });
      return textLabels;
    });
    // Tablet has a 9-label budget; tolerate the selected live affordance only
    // if a browser reports it as a separate sprite.
    expect(visual).toBeLessThanOrEqual(10);
    expect(page.locator(".calibration-banner")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "開啟現場校正" })).toHaveText("尺寸待校正");
    await page.screenshot({ path: testInfo.outputPath("e310-tablet.png"), fullPage: false });

    await page.getByRole("button", { name: "開啟現場校正" }).click();
    await expect(page.locator(".left")).toContainText("現場校正");
    expect((await probe(page)).safeRect.height).toBeGreaterThan(400);
  });
});

test.describe("booth readability hardening", () => {
  test.use({ viewport: { width: 1366, height: 900 } });

  test("keeps the compact desktop header to one row and fades, rather than removes, ISO tent roofs", async ({ page }, testInfo) => {
    await openProjectHome(page, { keepWizard: true });
    const wizard = page.locator(".quickstart__card");
    await wizard.locator(".quickstart__name").fill("雙棚視覺驗收");
    await wizard.getByRole("button", { name: "下一步：選場地" }).click();
    await wizard.getByRole("button", { name: "⛺ 戶外攤位（3×3 帳篷）" }).click();
    await settle(page);

    const booth = await page.evaluate(() => {
      const app = (window as unknown as {
        planform: { app: { scene: { currentView: string; scene: { traverse(cb: (node: {
          userData?: { roof?: boolean }; visible?: boolean; material?: { opacity?: number; transparent?: boolean } | { opacity?: number; transparent?: boolean }[];
        }) => void): void } } } };
      }).planform.app;
      const roofs: { visible: boolean; opacity: number; transparent: boolean }[] = [];
      app.scene.scene.traverse((node) => {
        if (!node.userData?.roof) return;
        const material = Array.isArray(node.material) ? node.material[0] : node.material;
        roofs.push({ visible: Boolean(node.visible), opacity: material?.opacity ?? 1, transparent: Boolean(material?.transparent) });
      });
      return { view: app.scene.currentView, roofs };
    });
    expect(booth.view).toBe("iso");
    expect(booth.roofs.length).toBeGreaterThan(0);
    expect(booth.roofs.every((roof) => roof.visible && roof.transparent && roof.opacity <= 0.36)).toBe(true);
    expect(await page.locator(".topbar").evaluate((node) => node.getBoundingClientRect().height)).toBeLessThanOrEqual(66);
    await page.screenshot({ path: testInfo.outputPath("booth-iso.png"), fullPage: false });
  });
});
