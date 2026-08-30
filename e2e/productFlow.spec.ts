/**
 * First-layer product path at every named viewport, driven as a volunteer
 * would: tap the library, tap the visible canvas, open Prop Studio, draw a
 * route, press ▶ 開始彩排, export a 場刊.
 *
 * Assertions are RESULTS (new object, artwork blob, renamed prop, route
 * points, rehearsal numbers, export bytes), not mere element presence.
 */

import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { clickSafeCanvas, gotoWorkflow, openProjectHome, probe, settle } from "./helpers";

const RED_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==",
  "base64",
);

const VIEWPORTS = [
  { name: "360×800", width: 360, height: 800, mode: "phone" },
  { name: "390×844", width: 390, height: 844, mode: "phone" },
  { name: "412×915", width: 412, height: 915, mode: "phone" },
  { name: "768×1024", width: 768, height: 1024, mode: "tablet" },
  { name: "800×1280", width: 800, height: 1280, mode: "tablet" },
  { name: "1024×768", width: 1024, height: 768, mode: "tablet" },
] as const;

async function createProject(page: Page, name: string): Promise<void> {
  const wizard = page.locator(".quickstart");
  if (!(await wizard.count())) {
    await page.getByRole("button", { name: /新建專案/ }).first().click();
  }
  await wizard.waitFor({ state: "visible" });
  await wizard.locator(".quickstart__name").fill(name);
  await wizard.getByRole("button", { name: /下一步：選場地/ }).click();
  await wizard.getByRole("button", { name: "淡江教室模板" }).first().click();
  const create = wizard.getByRole("button", { name: "建立專案" });
  if (await create.count()) await create.click();
  await wizard.waitFor({ state: "detached" });
  await page.waitForSelector(".projhome", { state: "hidden" });
  await settle(page);
}

interface Snapshot {
  projectId: string;
  name: string;
  objects: number;
  routes: number;
  routePoints: number;
  props: number;
  propNames: string[];
  artwork: number;
  extras: number;
}

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const pf = (window as unknown as {
      planform: {
        app: { currentProjectId: string | null };
        store: {
          getState(): {
            name: string;
            objects: unknown[];
            routes: { points: unknown[] }[];
            props?: { name: string; parts: { imageBlobId?: string }[] }[];
            catalogExtras?: { blobIds?: { sourceImage?: string } }[];
          };
        };
      };
    }).planform;
    const s = pf.store.getState();
    return {
      projectId: pf.app.currentProjectId ?? "",
      name: s.name,
      objects: s.objects.length,
      routes: s.routes.length,
      routePoints: s.routes.reduce((n, r) => n + r.points.length, 0),
      props: (s.props ?? []).length,
      propNames: (s.props ?? []).map((p) => p.name),
      artwork: (s.props ?? []).filter((d) => d.parts.some((p) => p.imageBlobId)).length,
      extras: (s.catalogExtras ?? []).filter((e) => e.blobIds?.sourceImage).length,
    };
  });
}

/** Whole drawing buffer, not a 64×64 corner. */
async function canvasProbe(page: Page): Promise<{
  mode: string | null;
  canvasWidth: number;
  canvasHeight: number;
  cssW: number;
  cssH: number;
  innerW: number;
  innerH: number;
  dpr: number;
  fill: number;
}> {
  return page.evaluate(() => {
    const canvas = document.querySelector("#scene") as HTMLCanvasElement | null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let fill = 0;
    if (canvas) {
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (gl && canvas.width > 0 && canvas.height > 0) {
        const w = canvas.width;
        const h = canvas.height;
        const pixels = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let painted = 0;
        const n = w * h;
        for (let i = 0; i < n; i++) {
          const o = i * 4;
          const r = pixels[o], g = pixels[o + 1], b = pixels[o + 2], a = pixels[o + 3];
          if (a > 8 && (r > 8 || g > 8 || b > 8) && !(r > 240 && g > 240 && b > 240)) painted++;
        }
        fill = painted / n;
      }
    }
    return {
      mode: document.querySelector("#app")?.getAttribute("data-ws-mode") ?? null,
      canvasWidth: canvas?.width ?? 0,
      canvasHeight: canvas?.height ?? 0,
      cssW: canvas?.clientWidth ?? 0,
      cssH: canvas?.clientHeight ?? 0,
      innerW: window.innerWidth,
      innerH: window.innerHeight,
      dpr,
      fill,
    };
  });
}

async function screenshotViewport(page: Page, name: string, tag: string): Promise<void> {
  mkdirSync("test-results/viewports", { recursive: true });
  await page.screenshot({ path: `test-results/viewports/${name}-${tag}.png`, fullPage: false });
  const extra = process.env.PLANFORM_VIEWPORT_SHOTS;
  if (extra) {
    mkdirSync(extra, { recursive: true });
    await page.screenshot({ path: `${extra}/${name}-${tag}.png`, fullPage: false });
  }
}

for (const vp of VIEWPORTS) {
  test.describe(`product flow ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("建專案 → 放道具 → 上傳圖 → 改 Prop → 動線 → 彩排 → Export survives reload", async ({ page }) => {
      test.setTimeout(120_000);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));

      await openProjectHome(page, { keepWizard: true });
      const projectName = `流程 ${vp.name}`;
      await createProject(page, projectName);
      await expect(page.locator("#app")).toHaveAttribute("data-ws-mode", vp.mode);
      await screenshotViewport(page, vp.name, "01-created");

      const before = await snapshot(page);
      expect(before.projectId).toMatch(/^prj_/);
      expect(before.name).toBe(projectName);

      // --- 放道具: library card → visible canvas tap -----------------------
      await gotoWorkflow(page, "layout");
      const tableCard = page.locator(".left .cardgrid .card").filter({ hasText: "桌子" }).first();
      await expect(tableCard).toBeVisible();
      await tableCard.click();
      await settle(page);
      await expect(page.locator(".placebar-wrap")).toBeVisible();
      const afterPick = await snapshot(page);
      await clickSafeCanvas(page);
      await settle(page);
      await expect.poll(async () => (await snapshot(page)).objects, { timeout: 8_000 })
        .toBeGreaterThan(afterPick.objects);
      const done = page.locator(".placebar-wrap button", { hasText: "完成" });
      if (await done.isVisible()) await done.click();
      await settle(page);
      const afterPlace = await snapshot(page);
      expect(afterPlace.objects).toBeGreaterThan(before.objects);
      await screenshotViewport(page, vp.name, "02-placed");

      // --- 上傳圖: 場佈 file input ------------------------------------------
      await gotoWorkflow(page, "layout");
      await page.locator('.left input[type="file"][accept="image/*"]').setInputFiles({
        name: "社團合照.png", mimeType: "image/png", buffer: RED_PNG,
      });
      await expect.poll(() => snapshot(page).then((s) => s.extras), { timeout: 20_000 }).toBeGreaterThan(0);

      // --- 改 Prop: Studio UI, photo, save, then 編輯 rename ----------------
      await gotoWorkflow(page, "layout");
      await page.locator(".left button", { hasText: "＋ 新增道具" }).scrollIntoViewIfNeeded();
      await page.locator(".left button", { hasText: "＋ 新增道具" }).click();
      const studio = page.locator(".propstudio");
      await expect(studio).toBeVisible();
      if (await studio.locator("button", { hasText: "丟掉重來" }).count()) {
        await studio.locator("button", { hasText: "丟掉重來" }).click();
      }
      await studio.locator("button", { hasText: "地面" }).click();
      const nameField = studio.locator(".field", { hasText: "名稱" }).locator("input");
      await nameField.fill("合照背景牆");
      await nameField.blur();
      await studio.locator("input.propstudio__photo").first().setInputFiles({
        name: "社團合照.png", mimeType: "image/png", buffer: RED_PNG,
      });
      await expect(studio.locator(".hint", { hasText: "已貼圖" })).toBeVisible({ timeout: 10_000 });
      await studio.locator("button", { hasText: "加入專案並放置" }).click();
      await expect(studio).toHaveCount(0);
      await settle(page);
      if (await page.locator(".placebar-wrap").isVisible()) {
        await clickSafeCanvas(page);
        await settle(page);
        const finish = page.locator(".placebar-wrap button", { hasText: "完成" });
        if (await finish.isVisible()) await finish.click();
      }
      await expect.poll(async () => (await snapshot(page)).props, { timeout: 8_000 }).toBeGreaterThan(0);
      expect((await snapshot(page)).artwork).toBeGreaterThan(0);

      // 改 Prop: the placed object is selected — 屬性 → 編輯這個道具.
      const ctxProps = page.locator(".ctxbar .chip", { hasText: "屬性" });
      if (await ctxProps.isVisible()) await ctxProps.click();
      const editPlaced = page.getByRole("button", { name: /編輯這個道具/ });
      if (await editPlaced.count()) {
        await editPlaced.click();
      } else {
        await gotoWorkflow(page, "layout");
        const row = page.locator(".left .list__row", { hasText: "合照背景牆" });
        await row.scrollIntoViewIfNeeded();
        await row.locator("button", { hasText: "編輯" }).click();
      }
      await expect(page.locator(".propstudio")).toBeVisible();
      const editName = page.locator(".propstudio .field", { hasText: "名稱" }).locator("input");
      await editName.fill("改過的背景牆");
      await editName.blur();
      await page.locator(".propstudio button", { hasText: "儲存修改" }).click();
      await expect(page.locator(".propstudio")).toHaveCount(0);
      await expect.poll(async () => (await snapshot(page)).propNames, { timeout: 8_000 })
        .toContain("改過的背景牆");
      await screenshotViewport(page, vp.name, "03-prop");

      // --- 動線: 入場 chip → two taps on the visible canvas → 完成繪製 ------
      const routesBefore = (await snapshot(page)).routePoints;
      await gotoWorkflow(page, "route");
      await page.locator(".left .chip", { hasText: "入場" }).first().click();
      await settle(page);
      await clickSafeCanvas(page);
      const safe = (await probe(page)).safeRect;
      await page.mouse.click(
        Math.round(safe.x + safe.width * 0.6),
        Math.round(safe.y + safe.height * 0.55),
      );
      await settle(page);
      const finishRoute = page.locator(".placebar-wrap button", { hasText: "完成繪製" });
      if (await finishRoute.isVisible()) await finishRoute.click();
      else await page.locator(".left button", { hasText: "完成繪製" }).click();
      await settle(page);
      const afterRoute = await snapshot(page);
      expect(afterRoute.routePoints).toBeGreaterThan(routesBefore);
      await screenshotViewport(page, vp.name, "04-route");

      // --- 彩排: first-layer tab, the ▶ button, numbers in the readout ------
      await gotoWorkflow(page, "sim");
      await page.locator(".left button", { hasText: "▶ 開始彩排" }).click();
      await expect(page.locator(".left .readout", { hasText: "全部完成" })).toBeVisible({ timeout: 20_000 });
      const rehearsal = await page.evaluate(() => {
        const r = (window as unknown as {
          planform: { app: { session: { simResult: null | { participantCount: number; finishTimeSeconds: number } } } };
        }).planform.app.session.simResult;
        return r;
      });
      expect(rehearsal).not.toBeNull();
      expect(rehearsal!.participantCount).toBeGreaterThan(0);
      expect(rehearsal!.finishTimeSeconds).toBeGreaterThan(0);
      await screenshotViewport(page, vp.name, "05-rehearsal");

      // --- Export -----------------------------------------------------------
      await gotoWorkflow(page, "export");
      const download = page.waitForEvent("download");
      await page.locator(".left button", { hasText: "場佈總覽圖" }).click();
      const file = await download;
      const filename = file.suggestedFilename();
      expect(filename).toContain("場佈總覽");
      expect(filename).not.toMatch(/selection|anchor|debug|chrome/i);
      const stream = await file.createReadStream();
      const chunks: Buffer[] = [];
      if (stream) {
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      }
      const bytes = Buffer.concat(chunks);
      expect(bytes.byteLength).toBeGreaterThan(1000);
      expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      await screenshotViewport(page, vp.name, "06-export");

      const c = await canvasProbe(page);
      expect(c.mode).toBe(vp.mode);
      expect(c.cssW).toBeGreaterThanOrEqual(vp.width - 2);
      expect(c.cssH).toBeGreaterThanOrEqual(vp.height - 2);
      expect(c.canvasWidth).toBeGreaterThanOrEqual(Math.round(c.cssW * c.dpr) - 1);
      expect(c.canvasHeight).toBeGreaterThanOrEqual(Math.round(c.cssH * c.dpr) - 1);
      expect(c.fill).toBeGreaterThan(0.15);
      expect(errors).toEqual([]);

      await page.reload();
      await page.waitForFunction(() => !!(window as unknown as { planform?: unknown }).planform);
      await page.waitForSelector(".projhome, #app[data-route='editor']");
      if (await page.locator(".projhome").isVisible()) {
        await page.locator(".projcard").filter({ hasText: projectName }).getByRole("button", { name: "開啟" }).click();
        await page.waitForSelector(".projhome", { state: "hidden" });
      }
      await settle(page);
      const afterReload = await snapshot(page);
      expect(afterReload.name).toBe(projectName);
      expect(afterReload.objects).toBeGreaterThanOrEqual(afterPlace.objects);
      expect(afterReload.propNames).toContain("改過的背景牆");
      expect(afterReload.artwork).toBeGreaterThan(0);
      expect(afterReload.routePoints).toBeGreaterThan(0);
      expect(errors).toEqual([]);
    });
  });
}
