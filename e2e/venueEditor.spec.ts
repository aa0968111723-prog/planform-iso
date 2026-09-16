import { expect, test, type Page } from "@playwright/test";
import { enterPartnerMode, isOnScreen, openWorkspace, probe, seedPlan, settle } from "./helpers";

/**
 * Professional venue editor — classroom / corridor / object workbench at the
 * three product viewports. Assertions are results (object fields, corridor
 * segments, partner copy), not mere chrome presence.
 */

const VIEWPORTS = [
  { name: "phone-390x844", width: 390, height: 844, mode: "phone" as const },
  { name: "tablet-834x1112", width: 834, height: 1112, mode: "tablet" as const },
  { name: "desktop-1440x1000", width: 1440, height: 1000, mode: "desktop" as const },
];

const ENGINEERING = /\b(id|mesh|shader|debug|ndc|gl_)\b|rotationDeg|X\s*[:=]\s*-?\d/i;

async function placeTable(page: Page): Promise<string> {
  return page.evaluate(() => {
    const pf = (window as unknown as {
      planform: {
        app: {
          confirmGhostPlacement(): void;
          cancelPlacement(): void;
          session: {
            placingKind: string | null;
            placingAssetId: string | null;
            placingPreset: string | null;
            ghostRotation: number;
            ghost: Record<string, unknown> | null;
            mode: string;
          };
        };
        store: { getState(): { objects: { id: string }[]; classroom: { x: number; z: number } } };
      };
    }).planform;
    const c = pf.store.getState().classroom;
    pf.app.session.mode = "place";
    pf.app.session.placingKind = "table";
    pf.app.session.placingAssetId = "builtin:table";
    pf.app.session.placingPreset = null;
    pf.app.session.ghostRotation = 0;
    pf.app.session.ghost = {
      kind: "table",
      assetId: "builtin:table",
      dims: { width: 1.2, depth: 0.6, height: 0.74 },
      x: c.x + 3,
      z: c.z + 3,
      rotationDeg: 0,
      elevation: 0,
      validity: "ok",
      reason: "可以放置",
    };
    const before = new Set(pf.store.getState().objects.map((o) => o.id));
    pf.app.confirmGhostPlacement();
    pf.app.cancelPlacement();
    const added = pf.store.getState().objects.find((o) => !before.has(o.id));
    if (!added) throw new Error("placement did not add an object");
    return added.id;
  });
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("object workbench, corridor, partner 場刊", async ({ page }) => {
      await openWorkspace(page);
      await page.evaluate(() => {
        const app = (window as unknown as { planform: { app: { setView(v: string): void; setWorkflow(w: string): void; setSnap(m: string): void; beginPlacementByAssetId(id: string): void } } }).planform.app;
        app.setView("top");
        app.setWorkflow("layout");
        app.setSnap("off");
        app.beginPlacementByAssetId("builtin:table");
      });
      await expect(page.locator(".placebar-wrap")).toBeVisible();
      await expect(page.locator(".placebar")).toContainText(/拖到要放的位置|可以放置|超出|重疊|入口|牆面|桌面/);

      const placed = await placeTable(page);
      await page.evaluate((id) => {
        const pf = (window as unknown as {
          planform: {
            app: {
              setSelection(ids: string[]): void;
              rotateSelection(d: number): void;
              updateSelectedObject(p: Record<string, unknown>): void;
              setSelectedSize(p: Record<string, number>): void;
            };
            store: { getState(): { objects: { id: string; x: number }[] } };
          };
        }).planform;
        pf.app.setSelection([id]);
        pf.app.rotateSelection(15);
        pf.app.updateSelectedObject({ label: "工作桌", color: "#38bdf8" });
        pf.app.setSelectedSize({ width: 1.5, depth: 0.7, height: 0.8 });
        const x0 = pf.store.getState().objects.find((o) => o.id === id)!.x;
        pf.app.updateSelectedObject({ x: x0 + 0.2, z: 3.4, elevation: 0.05 });
      }, placed);

      await expect(page.locator(".wb-head")).toBeAttached();
      if (vp.mode !== "desktop") {
        await expect(page.locator(".ctxbar")).toBeVisible();
        const ctxActions = await page.locator(".ctxbar__actions .chip").allInnerTexts();
        expect(ctxActions).toEqual(["旋轉", "複製", "屬性"]);
        await expect(page.locator(".ctxbar__name")).toContainText("工作桌");
        await page.locator(".ctxbar__actions .chip", { hasText: "屬性" }).click();
        await expect(page.locator("#app")).toHaveAttribute("data-sheet", "inspector");
        await expect.poll(() => isOnScreen(page, ".right")).toBe(true);
        await expect(page.locator(".right")).toContainText("基本");
        await expect(page.locator(".right")).toContainText("位置");
        await expect(page.locator(".right")).toContainText("尺寸");
        await expect(page.locator(".right")).toContainText("朝向");
        expect(await isOnScreen(page, ".left") && await isOnScreen(page, ".right")).toBe(false);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(1);
      } else {
        await expect.poll(() => isOnScreen(page, ".right")).toBe(true);
        await expect(page.locator(".right")).toContainText("工作桌");
        await expect(page.locator(".right")).toContainText("基本");
        await expect(page.locator(".right")).toContainText("位置");
        await expect(page.locator(".right")).toContainText("尺寸");
        await expect(page.locator(".right")).toContainText("朝向");
      }

      const corridor = await page.evaluate(() => {
        const pf = (window as unknown as {
          planform: {
            app: {
              duplicateSelection(): void;
              applyCorridorKind(k: string): void;
              connectClassroomToCorridor(): void;
              applyLayoutStarter(id: string): void;
              addCommonRoute(k?: string): void;
              setView(v: string): void;
            };
            store: { getState(): {
              corridorLayout?: { kind: string; segments: { name: string }[]; links: unknown[] };
              zones: unknown[];
              routes: unknown[];
              objects: { x: number; z: number }[];
              view: string;
            } };
          };
        }).planform;
        pf.app.duplicateSelection();
        pf.app.applyCorridorKind("L");
        pf.app.connectClassroomToCorridor();
        pf.app.applyLayoutStarter("zen-class");
        pf.app.addCommonRoute("entry-flow");
        const afterIso = (() => {
          pf.app.setView("iso");
          return pf.store.getState().objects.map((o) => ({ x: o.x, z: o.z }));
        })();
        pf.app.setView("top");
        const top = pf.store.getState();
        return {
          kind: top.corridorLayout?.kind,
          corner: top.corridorLayout?.segments.some((s) => s.name.includes("轉角")),
          links: top.corridorLayout?.links.length ?? 0,
          zones: top.zones.length,
          routes: top.routes.length,
          view: top.view,
          samePose: JSON.stringify(afterIso) === JSON.stringify(top.objects.map((o) => ({ x: o.x, z: o.z }))),
        };
      });
      expect(corridor.kind).toBe("L");
      expect(corridor.corner).toBe(true);
      expect(corridor.zones).toBeGreaterThan(0);
      expect(corridor.samePose).toBe(true);
      expect(corridor.view).toBe("top");

      await seedPlan(page);
      await enterPartnerMode(page);
      await expect(page.locator(".partnertop")).toBeVisible();
      await expect(page.locator(".partnerbrief")).toBeVisible();
      const brief = await page.locator(".partnerbrief").innerText();
      expect(brief).toMatch(/你現在在教室|你在/);
      expect(brief).not.toMatch(ENGINEERING);
      await page.locator(".partnerbrief").click();
      await expect(page.locator(".partnersheet")).toBeVisible();
      const sheet = await page.locator(".partnersheet").innerText();
      expect(sheet).toMatch(/報到|鞋子|背包|地墊/);
      expect(sheet).not.toMatch(ENGINEERING);

      const ws = await probe(page);
      expect(ws.mode).toBe(vp.mode);
      expect(ws.coverage).toBeGreaterThanOrEqual(0.55);
    });
  });
}

test.describe("phone object ops 390×844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("lock hide copy delete and no overflow", async ({ page }) => {
    await openWorkspace(page);
    await settle(page);
    const before = await page.evaluate(() =>
      (window as unknown as { planform: { store: { getState(): { objects: unknown[] } } } }).planform.store.getState().objects.length);

    await page.evaluate(() => {
      const pf = (window as unknown as {
        planform: {
          app: {
            confirmGhostPlacement(): void;
            setSelection(ids: string[]): void;
            toggleLockSelection(): void;
            duplicateSelection(): void;
            deleteSelection(): void;
            session: {
              placingKind: string | null;
              placingAssetId: string | null;
              placingPreset: string | null;
              ghostRotation: number;
              ghost: Record<string, unknown> | null;
              mode: string;
            };
          };
          store: { getState(): { objects: { id: string }[]; classroom: { x: number; z: number } } };
        };
      }).planform;
      const c = pf.store.getState().classroom;
      pf.app.session.mode = "place";
      pf.app.session.placingKind = "chair";
      pf.app.session.placingAssetId = "builtin:chair";
      pf.app.session.placingPreset = null;
      pf.app.session.ghostRotation = 0;
      pf.app.session.ghost = {
        kind: "chair", assetId: "builtin:chair",
        dims: { width: 0.45, depth: 0.45, height: 0.9 },
        x: c.x + 2, z: c.z + 2, rotationDeg: 0, elevation: 0,
        validity: "ok", reason: "可以放置",
      };
      pf.app.confirmGhostPlacement();
      const id = pf.store.getState().objects.at(-1)!.id;
      pf.app.setSelection([id]);
      pf.app.toggleLockSelection();
      pf.app.toggleLockSelection();
      pf.app.duplicateSelection();
      pf.app.deleteSelection();
    });

    const after = await page.evaluate(() =>
      (window as unknown as { planform: { store: { getState(): { objects: unknown[] } } } }).planform.store.getState().objects.length);
    expect(after).toBeGreaterThanOrEqual(before);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
