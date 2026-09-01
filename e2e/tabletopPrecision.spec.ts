import { expect, test } from "@playwright/test";
import { settle } from "./helpers";

test.describe("precision tabletop layout", () => {
  test.use({ viewport: { width: 1366, height: 900 } });

  test("a tabletop prop persists, follows its table, copies with it, and keeps an independent label", async ({ page }) => {
    await page.addInitScript(() => {
      for (const key of Object.keys(localStorage)) if (key.startsWith("planform-iso:")) localStorage.removeItem(key);
      localStorage.setItem("planform-iso:boot", "editor");
    });
    await page.goto("/");
    await page.waitForFunction(() => !!(window as unknown as { planform?: unknown }).planform);
    const wizard = page.locator(".quickstart__card");
    await wizard.locator(".quickstart__name").fill("桌面精準測試");
    await wizard.getByText("下一步：選場地").click();
    await wizard.getByText("戶外攤位").click();
    await settle(page);

    const point = await page.evaluate(() => {
      const pf = (window as unknown as {
        planform: {
          store: { getState(): { objects: { id: string; assetId?: string; x: number; z: number }[] } };
          app: { setSelection(ids: string[]): void; enterTabletopLayout(): void; placeBoothProp(id: string): void; scene: { project(x: number, z: number): { x: number; y: number } } };
        };
      }).planform;
      const table = pf.store.getState().objects.find((object) => object.assetId === "custom:booth-table");
      if (!table) throw new Error("missing booth table");
      pf.app.setSelection([table.id]);
      pf.app.enterTabletopLayout();
      pf.app.placeBoothProp("prop_tea_cup");
      return pf.app.scene.project(table.x, table.z);
    });
    await page.mouse.click(point.x, point.y);
    await page.getByRole("button", { name: "完成" }).click();

    const result = await page.evaluate(() => {
      const pf = (window as unknown as {
        planform: {
          store: { getState(): { objects: { id: string; assetId?: string; parentId?: string; x: number; z: number; label?: string; showLabel?: boolean }[] } };
          app: { setSelection(ids: string[]): void; nudgeSelection(dx: number, dz: number): void; duplicateSelection(): void; updateSelectedLabel(patch: { label: string; showLabel: boolean }): void };
        };
      }).planform;
      const before = pf.store.getState();
      const table = before.objects.find((object) => object.assetId === "custom:booth-table")!;
      const cup = before.objects.find((object) => object.assetId?.endsWith("prop_tea_cup"))!;
      const cupStart = { x: cup.x, z: cup.z };
      pf.app.setSelection([table.id]);
      pf.app.nudgeSelection(0.1, 0.05);
      const moved = pf.store.getState();
      const movedCup = moved.objects.find((object) => object.id === cup.id)!;
      pf.app.setSelection([cup.id]);
      pf.app.updateSelectedLabel({ label: "試飲茶杯", showLabel: false });
      pf.app.setSelection([table.id]);
      pf.app.duplicateSelection();
      const after = pf.store.getState();
      return {
        parent: cup.parentId,
        movedX: movedCup.x - cupStart.x,
        movedZ: movedCup.z - cupStart.z,
        copiedTables: after.objects.filter((object) => object.assetId === "custom:booth-table").length,
        copiedCups: after.objects.filter((object) => object.assetId?.endsWith("prop_tea_cup")).length,
        label: after.objects.find((object) => object.id === cup.id)?.label,
        showLabel: after.objects.find((object) => object.id === cup.id)?.showLabel,
      };
    });
    expect(result.parent).toBeTruthy();
    expect(result.movedX).toBeCloseTo(0.1, 3);
    expect(result.movedZ).toBeCloseTo(0.05, 3);
    expect(result.copiedTables).toBe(2);
    expect(result.copiedCups).toBe(2);
    expect(result.label).toBe("試飲茶杯");
    expect(result.showLabel).toBe(false);
  });
});
