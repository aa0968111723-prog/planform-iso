import { expect, test } from "@playwright/test";
import { isOnScreen, openWorkspace, probe, type WorkspaceProbe } from "./helpers";

/**
 * Responsive workspace smoke tests.
 *
 * Every acceptance viewport from the P0 brief is exercised against the real
 * app: the mode split, the single-row tablet header, the "never two docked
 * rails" rule, the canvas-first coverage budget, and the full
 * select -> context bar -> properties -> collapse loop.
 */

const VIEWPORTS: { name: string; width: number; height: number; mode: WorkspaceProbe["mode"] }[] = [
  { name: "phone-360x800", width: 360, height: 800, mode: "phone" },
  { name: "phone-390x844", width: 390, height: 844, mode: "phone" },
  { name: "phone-412x915", width: 412, height: 915, mode: "phone" },
  { name: "compact-600x960", width: 600, height: 960, mode: "phone" },
  { name: "tablet-768x1024", width: 768, height: 1024, mode: "tablet" },
  { name: "tablet-800x1280", width: 800, height: 1280, mode: "tablet" },
  { name: "tablet-962x1280", width: 962, height: 1280, mode: "tablet" },
  { name: "tablet-1024x768", width: 1024, height: 768, mode: "tablet" },
  { name: "tablet-1180x820", width: 1180, height: 820, mode: "tablet" },
  { name: "desktop-1366x1024", width: 1366, height: 1024, mode: "desktop" },
];

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("resolves the right workspace mode and keeps the canvas dominant", async ({ page }) => {
      await openWorkspace(page);
      const app = page.locator("#app");
      await expect(app).toHaveAttribute("data-ws-mode", vp.mode);

      const state = await probe(page);
      expect(state.mode).toBe(vp.mode);
      // Definition of Done: first paint is a canvas, not a settings column.
      expect(state.coverage).toBeGreaterThanOrEqual(0.7);
      expect(state.safeRect.width).toBeGreaterThan(0);
      expect(state.safeRect.height).toBeGreaterThan(0);
      // The safe rect must stay inside the canvas.
      expect(state.safeRect.x).toBeGreaterThanOrEqual(state.canvas.x - 0.5);
      expect(state.safeRect.y).toBeGreaterThanOrEqual(state.canvas.y - 0.5);
      expect(state.safeRect.x + state.safeRect.width).toBeLessThanOrEqual(state.canvas.x + state.canvas.width + 0.5);
      expect(state.safeRect.y + state.safeRect.height).toBeLessThanOrEqual(state.canvas.y + state.canvas.height + 0.5);
    });

    test("chrome matches the docking policy for this mode", async ({ page }) => {
      await openWorkspace(page);
      await expect.poll(() => isOnScreen(page, ".left")).toBe(vp.mode === "desktop");
      const leftVisible = await isOnScreen(page, ".left");
      const rightVisible = await isOnScreen(page, ".right");
      const navVisible = await isOnScreen(page, ".bottomnav");

      if (vp.mode === "desktop") {
        expect(leftVisible).toBe(true);
        expect(navVisible).toBe(false);
      } else {
        // P0: a tablet must never show a permanent left rail + right inspector.
        expect(leftVisible && rightVisible).toBe(false);
        expect(leftVisible).toBe(false);
        expect(rightVisible).toBe(false);
        expect(navVisible).toBe(true);
        // The four primary workflows live in the bottom navigation
        // (檢查 folds into 分享 as the pre-export checklist).
        await expect(page.locator(".bottomnav .navbtn")).toHaveCount(4);
      }
    });

    test("header is a single row with only the allowed compact controls", async ({ page }) => {
      await openWorkspace(page);
      const header = await page.evaluate(() => {
        const el = document.querySelector(".topbar") as HTMLElement;
        const rect = el.getBoundingClientRect();
        const boxes = (Array.from(el.children) as HTMLElement[])
          .map((k) => k.getBoundingClientRect())
          .filter((r) => r.height > 0 && r.width > 0);
        // Two controls are on different rows only when they do not overlap
        // vertically at all — centre alignment alone must not count as a wrap.
        let wrapped = false;
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            if (boxes[i].bottom <= boxes[j].top + 0.5 || boxes[j].bottom <= boxes[i].top + 0.5) wrapped = true;
          }
        }
        return {
          height: rect.height,
          wrapped,
          overflowing: el.scrollWidth > el.clientWidth + 1,
          compact: el.classList.contains("topbar--compact"),
          viewChips: el.querySelectorAll('[data-group="views"] .chip').length,
          flowChips: el.querySelectorAll('[data-group="flows"] .chip').length,
        };
      });

      if (vp.mode === "desktop") {
        expect(header.compact).toBe(false);
        // Desktop keeps the full five-view + five-workflow header.
        expect(header.viewChips).toBe(5);
        expect(header.flowChips).toBe(5);
      } else {
        expect(header.compact).toBe(true);
        expect(header.wrapped).toBe(false);
        expect(header.height).toBeLessThanOrEqual(72);
        expect(header.overflowing).toBe(false);
        // The five views must not all live permanently in a tablet header.
        expect(header.viewChips).toBe(0);
        // Workflows moved to the bottom navigation.
        expect(header.flowChips).toBe(0);
        await expect(page.locator(".topbar__view")).toBeVisible();
        await expect(page.locator(".topbar__more")).toBeVisible();
        await expect(page.locator(".topbar .chip--accent")).toBeVisible();
      }
    });
  });
}

test.describe("tablet portrait working loop (768x1024)", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test("site -> place -> select -> properties -> collapse keeps the canvas in charge", async ({ page }) => {
    await openWorkspace(page);
    const app = page.locator("#app");

    // 1. 場地 opens as a bottom sheet, and re-tapping collapses it.
    await page.locator('.navbtn[data-nav="site"]').click();
    await expect(app).toHaveAttribute("data-sheet", "workflow");
    await expect(page.locator(".left .sheet-handle")).toBeVisible();
    // The site panel's first level is the five field-facing sections.
    const titles = await page.locator(".left > .section > .section__title").allInnerTexts();
    expect(titles.slice(0, 5)).toEqual(["場地模板", "教室尺寸", "地磚", "現場校正", "固定設施"]);
    expect(titles).toContain("進階設定");
    // Engineering parameters are behind 進階設定, not on the first level.
    await expect(page.locator(".left .field", { hasText: "原點 X (m)" })).toBeHidden();
    await expect(page.locator(".left .field", { hasText: "教室 X (m)" })).toHaveCount(0);
    await page.locator(".left > .section", { hasText: "進階設定" }).locator(".section__title").first().click();
    await expect(page.locator(".left .field", { hasText: "原點 X (m)" })).toBeVisible();
    await page.locator('.navbtn[data-nav="site"]').click();
    await expect(app).toHaveAttribute("data-sheet", "none");

    // 2. Picking an asset auto-collapses the sheet and enters placement.
    await page.locator('.navbtn[data-nav="layout"]').click();
    await expect(app).toHaveAttribute("data-sheet", "workflow");
    await page.locator(".left .libtabs .libtab", { hasText: "桌椅" }).first().click();
    // Only the active category panel is on screen; pick a card from it.
    const assetCard = page.locator(".left .library .cardgrid .card").filter({ visible: true }).first();
    const assetName = (await assetCard.locator(".card__title").innerText()).trim();
    await assetCard.click();
    await expect(app).toHaveAttribute("data-sheet", "none");
    await expect(page.locator(".placebar-wrap")).toBeVisible();
    await expect.poll(() => isOnScreen(page, ".left")).toBe(false);

    // 3. Place it inside the visible canvas rect, then leave placement mode.
    const safe = (await probe(page)).safeRect;
    const cx = Math.round(safe.x + safe.width / 2);
    const cy = Math.round(safe.y + safe.height / 2);
    await page.mouse.move(cx, cy);
    await page.waitForTimeout(120);
    await page.mouse.click(cx, cy);
    await page.locator(".placebar", { hasText: "完成" }).getByText("完成").click();
    await expect(page.locator(".placebar-wrap")).toBeHidden();
    expect(await page.evaluate(() => (window as unknown as {
      planform: { store: { getState(): { objects: unknown[] } } };
    }).planform.store.getState().objects.length)).toBeGreaterThan(0);

    // 4. Selecting shows the compact context bar — never the full inspector.
    await page.mouse.move(cx, cy);
    await page.mouse.click(cx, cy);
    await expect(page.locator(".ctxbar")).toBeVisible();
    await expect(app).toHaveAttribute("data-sheet", "none");
    await expect.poll(() => isOnScreen(page, ".right")).toBe(false);
    const ctxActions = await page.locator(".ctxbar__actions .chip").allInnerTexts();
    expect(ctxActions).toEqual(["旋轉", "複製", "屬性"]);
    await expect(page.locator(".ctxbar__name")).toHaveText(assetName);
    await expect(page.locator(".ctxbar__size")).toContainText("cm");

    // 5. 屬性 opens the inspector sheet; the context bar steps aside.
    await page.locator(".ctxbar__actions .chip", { hasText: "屬性" }).click();
    await expect(app).toHaveAttribute("data-sheet", "inspector");
    await expect.poll(() => isOnScreen(page, ".right")).toBe(true);
    await expect(page.locator(".ctxbar")).toBeHidden();

    // 6. Tapping a workflow tab collapses straight back to a full canvas.
    await page.locator('.navbtn[data-nav="layout"]').click();
    await expect(app).toHaveAttribute("data-sheet", "none");
    await expect.poll(() => isOnScreen(page, ".right")).toBe(false);
    expect((await probe(page)).coverage).toBeGreaterThanOrEqual(0.7);
  });

  test("More sheet holds labels / recenter / snap instead of the header", async ({ page }) => {
    await openWorkspace(page);
    await page.locator(".topbar__more").click();
    const menu = page.locator(".menusheet");
    await expect(menu).toBeVisible();
    const labels = await menu.locator(".menuitem__label").allInnerTexts();
    expect(labels).toContain("顯示名稱");
    expect(labels).toContain("置中 / 重新框選");
    expect(labels).toContain("交點");
    await menu.locator(".menuitem", { hasText: "置中 / 重新框選" }).click();
    await expect(menu).toBeHidden();
  });

  test("compact view control switches views without a permanent five-chip row", async ({ page }) => {
    await openWorkspace(page);
    await page.locator(".topbar__view").click();
    const menu = page.locator(".menusheet");
    await expect(menu.locator(".menuitem")).toHaveCount(5);
    await menu.locator(".menuitem", { hasText: "俯視" }).click();
    await expect(page.locator(".topbar__view")).toHaveText("俯視");
    expect(await page.evaluate(() => (window as unknown as {
      planform: { store: { getState(): { view: string } } };
    }).planform.store.getState().view)).toBe("top");
  });
});

test.describe("camera framing uses the visible canvas rect", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test("recenter puts the plan centre in the middle of the safe rect", async ({ page }) => {
    await openWorkspace(page);
    const result = await page.evaluate(() => {
      const pf = (window as unknown as {
        planform: {
          app: {
            recenterView(): void;
            scene: { project(x: number, z: number): { x: number; y: number } };
            store: { getState(): { classroom: { x: number; z: number; length: number; width: number } } };
          };
          workspace: () => WorkspaceProbe;
        };
      }).planform;
      pf.app.recenterView();
      const s = pf.app.store.getState();
      const centre = pf.app.scene.project(s.classroom.x + s.classroom.length / 2, s.classroom.z + s.classroom.width / 2);
      const ws = pf.workspace();
      return { centre, safeRect: ws.safeRect, canvas: ws.canvas };
    });

    const safeCx = result.safeRect.x + result.safeRect.width / 2;
    const safeCy = result.safeRect.y + result.safeRect.height / 2;
    const canvasCy = result.canvas.y + result.canvas.height / 2;
    // The classroom is offset inside the plan, so allow a generous band — the
    // point is that framing tracks the safe rect rather than the window.
    expect(Math.abs(result.centre.x - safeCx)).toBeLessThan(result.safeRect.width * 0.35);
    expect(Math.abs(result.centre.y - safeCy)).toBeLessThan(result.safeRect.height * 0.35);
    // Header (52) and nav (~58) differ, so the two centres are not the same
    // pixel; the safe centre must be the closer of the two.
    expect(Math.abs(result.centre.y - safeCy)).toBeLessThanOrEqual(Math.abs(result.centre.y - canvasCy) + 1);
  });

  test("focusing a validation issue lands it inside the visible canvas", async ({ page }) => {
    await openWorkspace(page);
    const inside = await page.evaluate(() => {
      const pf = (window as unknown as {
        planform: {
          app: {
            store: { getState(): { classroom: { x: number; z: number; length: number; width: number } } };
            scene: { focusOn(x: number, z: number): void; project(x: number, z: number): { x: number; y: number } };
          };
          workspace: () => WorkspaceProbe;
        };
      }).planform;
      const s = pf.app.store.getState();
      // A corner of the room — the worst case for a naive window-centred focus.
      const tx = s.classroom.x + 0.5;
      const tz = s.classroom.z + 0.5;
      pf.app.scene.focusOn(tx, tz);
      const p = pf.app.scene.project(tx, tz);
      const r = pf.workspace().focusRect;
      return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
    });
    expect(inside).toBe(true);
  });

  test("rotating tablet portrait to landscape keeps the plan framed", async ({ page }) => {
    await openWorkspace(page);
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(250);
    const state = await probe(page);
    expect(state.mode).toBe("tablet");
    expect(state.coverage).toBeGreaterThanOrEqual(0.7);
    const framed = await page.evaluate(() => {
      const pf = (window as unknown as {
        planform: {
          app: {
            store: { getState(): { classroom: { x: number; z: number; length: number; width: number } } };
            scene: { project(x: number, z: number): { x: number; y: number } };
          };
          workspace: () => WorkspaceProbe;
        };
      }).planform;
      const s = pf.app.store.getState();
      const r = pf.workspace().safeRect;
      const corners = [
        [s.classroom.x, s.classroom.z],
        [s.classroom.x + s.classroom.length, s.classroom.z + s.classroom.width],
      ] as const;
      return corners.every(([x, z]) => {
        const p = pf.app.scene.project(x, z);
        return p.x >= r.x - 2 && p.x <= r.x + r.width + 2 && p.y >= r.y - 2 && p.y <= r.y + r.height + 2;
      });
    });
    expect(framed).toBe(true);
  });
});
