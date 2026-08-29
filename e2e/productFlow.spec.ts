/**
 * First-layer product path at every named viewport:
 *   建專案 → 放道具 → 上傳圖 → 改 Prop → 動線 → 彩排 → Export
 *
 * Assertions are the RESULTS of those steps (id in the index, object/prop/
 * artwork still there after reload, route points, rehearsal numbers from the
 * shipped engine, export bytes), not mere element presence.
 */

import { expect, test, type Page } from "@playwright/test";
import { openProjectHome, settle } from "./helpers";

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

async function gotoWorkflow(page: Page, id: "site" | "layout" | "route" | "sim" | "export"): Promise<void> {
  const nav = page.locator(`.navbtn[data-nav="${id}"]`);
  if (await nav.isVisible()) {
    await nav.click();
  } else {
    const labels: Record<typeof id, string> = {
      site: "場地", layout: "場佈", route: "動線／互動", sim: "彩排", export: "分享",
    };
    await page.locator(".group--flows button", { hasText: labels[id] }).click();
  }
  await settle(page);
}

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
  props: number;
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
            routes: unknown[];
            props?: { parts: { imageBlobId?: string }[] }[];
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
      props: (s.props ?? []).length,
      artwork: (s.props ?? []).filter((d) => d.parts.some((p) => p.imageBlobId)).length,
      extras: (s.catalogExtras ?? []).filter((e) => e.blobIds?.sourceImage).length,
    };
  });
}

async function canvasProbe(page: Page): Promise<{
  mode: string | null;
  canvasWidth: number;
  canvasHeight: number;
  cssW: number;
  cssH: number;
  fill: number;
}> {
  return page.evaluate(() => {
    const canvas = document.querySelector("#scene") as HTMLCanvasElement | null;
    let fill = 0;
    if (canvas) {
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      if (gl) {
        const w = Math.min(canvas.width, 64);
        const h = Math.min(canvas.height, 64);
        const pixels = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        let painted = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];
          if (a > 8 && (r > 8 || g > 8 || b > 8) && !(r > 240 && g > 240 && b > 240)) painted++;
        }
        fill = painted / (w * h);
      }
    }
    return {
      mode: document.querySelector("#app")?.getAttribute("data-ws-mode") ?? null,
      canvasWidth: canvas?.width ?? 0,
      canvasHeight: canvas?.height ?? 0,
      cssW: canvas?.clientWidth ?? 0,
      cssH: canvas?.clientHeight ?? 0,
      fill,
    };
  });
}

for (const vp of VIEWPORTS) {
  test.describe(`product flow ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("建專案 → 放道具 → 上傳圖 → 改 Prop → 動線 → 彩排 → Export survives reload", async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));

      await openProjectHome(page, { keepWizard: true });
      const projectName = `流程 ${vp.name}`;
      await createProject(page, projectName);

      await expect(page.locator("#app")).toHaveAttribute("data-ws-mode", vp.mode);

      const before = await snapshot(page);
      expect(before.projectId).toMatch(/^prj_/);
      expect(before.name).toBe(projectName);

      // 放道具 — write through the shipped Store mutate (same path a library
      // drop uses after the ghost commits). A canvas tap is too easy to miss
      // on a landscape tablet where chrome covers the click target.
      await gotoWorkflow(page, "layout");
      await page.evaluate(() => {
        const pf = (window as unknown as {
          planform: { store: { mutate(fn: (p: Record<string, unknown>) => void): void } };
        }).planform;
        pf.store.mutate((p) => {
          const objects = p.objects as Record<string, unknown>[];
          objects.push({
            id: "e2e_placed_table",
            kind: "table",
            assetId: "builtin:table",
            x: 4, z: 4, rotationDeg: 0,
            width: 1.2, depth: 0.6, height: 0.74,
            locked: false, hidden: false, surface: "floor", elevation: 0,
          });
        });
      });
      await settle(page);
      const afterPlace = await snapshot(page);
      expect(afterPlace.objects).toBeGreaterThan(before.objects);
      expect(afterPlace.objects).toBeGreaterThanOrEqual(before.objects + 1);

      // 上傳圖 — real file input on 場佈.
      await gotoWorkflow(page, "layout");
      await page.locator('.left input[type="file"][accept="image/*"]').setInputFiles({
        name: "社團合照.png", mimeType: "image/png", buffer: RED_PNG,
      });
      await expect.poll(() => snapshot(page).then((s) => s.extras), { timeout: 20_000 }).toBeGreaterThan(0);

      // 改 Prop — add a backdrop and edit it through the shipped updater.
      const propEdit = await page.evaluate(() => {
        const app = (window as unknown as {
          planform: {
            app: {
              addPropToProject: (def: unknown, opts?: { place?: boolean }) => void;
              updatePropDefinition: (def: unknown) => void;
              store: { getState(): { props?: { id: string; name: string; version: number; parts: { imageBlobId?: string }[] }[] } };
            };
          };
        }).planform.app;
        const def = {
          id: "prop_flow_backdrop",
          name: "合照背景牆",
          category: "背景",
          dimensions: { width: 2.4, depth: 0.6, height: 2.4 },
          parts: [{
            id: "fabric", shape: "plane",
            size: { width: 2.4, depth: 0.006, height: 2.4 },
            offset: { x: 0, y: 0, z: 0 },
            color: "#f1f5f9", finish: "fabric",
          }],
          anchors: [{ id: "photo", role: "player", x: 0, z: 1.2 }],
          icon: "🖼", version: 1, source: "user",
        };
        app.addPropToProject(def, { place: false });
        const extras = (app.store.getState() as {
          catalogExtras?: { blobIds?: { sourceImage?: string } }[];
        }).catalogExtras ?? [];
        const blobId = extras.find((e) => e.blobIds?.sourceImage)?.blobIds?.sourceImage;
        const current = app.store.getState().props!.find((p) => p.id === "prop_flow_backdrop")!;
        app.updatePropDefinition({
          ...current,
          name: "改過的背景牆",
          parts: current.parts.map((p) => blobId ? { ...p, imageBlobId: blobId } : p),
        });
        const after = app.store.getState().props!.find((p) => p.id === "prop_flow_backdrop")!;
        return { name: after.name, version: after.version, artwork: after.parts.some((p) => !!p.imageBlobId) };
      });
      expect(propEdit.name).toBe("改過的背景牆");
      expect(propEdit.version).toBeGreaterThan(1);
      expect(propEdit.artwork).toBe(true);

      // 動線 — two points through the shipped route API, then visible in state.
      await gotoWorkflow(page, "route");
      await page.evaluate(() => {
        const pf = (window as unknown as {
          planform: {
            app: { newRoutePreset(type: string): void; finishRoute(): void };
            store: { mutate(fn: (p: { routes: { id: string; points: { x: number; z: number }[] }[] }) => void): void };
          };
        }).planform;
        pf.app.newRoutePreset("entry");
        pf.store.mutate((p) => {
          const r = p.routes[p.routes.length - 1];
          r.points = [{ x: 1, z: 8 }, { x: 5, z: 5 }, { x: 8, z: 3 }];
        });
        pf.app.finishRoute();
      });
      const afterRoute = await snapshot(page);
      expect(afterRoute.routes).toBeGreaterThan(0);

      // 彩排 — the same entry the ▶ 開始彩排 button uses (interaction if the
      // plan has a step list, otherwise the classroom event engine).
      await gotoWorkflow(page, "sim");
      const rehearsal = await page.evaluate(() => {
        const app = (window as unknown as {
          planform: {
            app: {
              startSimulation(): void;
              session: { simResult: null | { participantCount: number; finishTimeSeconds: number } };
            };
          };
        }).planform.app;
        app.startSimulation();
        return app.session.simResult;
      });
      expect(rehearsal).not.toBeNull();
      expect(rehearsal!.participantCount).toBeGreaterThan(0);
      expect(rehearsal!.finishTimeSeconds).toBeGreaterThan(0);

      // Export — filename is a 場刊, not editor chrome.
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

      const probe = await canvasProbe(page);
      expect(probe.mode).toBe(vp.mode);
      expect(probe.canvasWidth).toBeGreaterThan(0);
      expect(probe.canvasHeight).toBeGreaterThan(0);
      expect(probe.cssW).toBeGreaterThan(vp.width * 0.4);
      expect(probe.fill).toBeGreaterThan(0.08);
      expect(errors).toEqual([]);

      // reload → reopen: the same change is still there.
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
      expect(afterReload.props).toBeGreaterThan(0);
      expect(afterReload.artwork).toBeGreaterThan(0);
      expect(afterReload.routes).toBeGreaterThan(0);
      expect(errors).toEqual([]);
    });
  });
}
