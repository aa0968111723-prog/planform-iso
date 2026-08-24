import { expect, test, type Page } from "@playwright/test";
import { settle } from "./helpers";

async function openE310(page: Page, participants: number): Promise<void> {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("planform-iso:")) localStorage.removeItem(key);
    }
    localStorage.setItem("planform-iso:boot", "editor");
  });
  await page.goto("/");
  await page.locator(".quickstart__card button", { hasText: "自訂 E310" }).click();
  const card = page.locator(".quickstart__card");
  await card.locator('input[type="number"]').fill(String(participants));
  await card.locator("button", { hasText: "建立場佈" }).click();
  await settle(page);
}

const viewports = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "desktop", width: 1440, height: 1000 },
] as const;

for (const viewport of viewports) {
  test.describe(`Visual Realism Gate — ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const participants of [30, 60, 100]) {
      test(`${participants} 人 keeps rendering without overflow or frame starvation`, async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => {
          if (message.type() === "error") errors.push(message.text());
        });
        await openE310(page, participants);
        const probe = await page.evaluate(async () => {
          const canvas = document.querySelector("#scene") as HTMLCanvasElement | null;
          const state = (window as unknown as { planform: { store: { getState(): { description?: string; groups: unknown[] } } } }).planform.store.getState();
          const start = performance.now();
          let frames = 0;
          await new Promise<void>((resolve) => {
            const tick = () => {
              frames++;
              if (performance.now() - start >= 500) resolve();
              else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });
          return {
            frames,
            canvasWidth: canvas?.width ?? 0,
            canvasHeight: canvas?.height ?? 0,
            scrollWidth: document.documentElement.scrollWidth,
            innerWidth,
            mode: document.querySelector("#app")?.getAttribute("data-ws-mode"),
            description: state.description,
            groups: state.groups.length,
          };
        });
        expect(probe.mode).toBe(viewport.name);
        expect(probe.description).toContain(`${participants} 人`);
        expect(probe.groups).toBeGreaterThan(0);
        expect(probe.canvasWidth).toBeGreaterThan(0);
        expect(probe.canvasHeight).toBeGreaterThan(0);
        expect(probe.scrollWidth).toBeLessThanOrEqual(probe.innerWidth + 1);
        // Headless Chromium uses SwiftShader in CI. The gate is continuity —
        // more than one animation frame in the sample — not a gaming-FPS SLA.
        expect(probe.frames).toBeGreaterThanOrEqual(3);
        expect(errors).toEqual([]);
      });
    }
  });
}
