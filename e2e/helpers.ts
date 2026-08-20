import { expect, type Page } from "@playwright/test";

export interface WorkspaceProbe {
  mode: "phone" | "tablet" | "desktop";
  canvas: { x: number; y: number; width: number; height: number };
  baseRect: { x: number; y: number; width: number; height: number };
  safeRect: { x: number; y: number; width: number; height: number };
  focusRect: { x: number; y: number; width: number; height: number };
  coverage: number;
}

/** Load the app with the first-run overlay already dismissed. */
export async function openWorkspace(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("planform-iso:quickstart", "1");
    localStorage.removeItem("planform-iso:autosave");
  });
  await page.goto("/");
  await page.waitForFunction(() => !!(window as unknown as { planform?: unknown }).planform);
  await page.waitForFunction(() => !!document.getElementById("app")?.dataset.wsMode);
  await page.waitForTimeout(200);
  await settle(page);
}

/** Wait until no sheet is mid-transition, so measurements are stable. */
export async function settle(page: Page): Promise<void> {
  const read = () => page.evaluate(() =>
    [".left", ".right", ".partnersheet"].map((sel) => {
      const n = document.querySelector(sel);
      return n ? Math.round(n.getBoundingClientRect().top) : 0;
    }).join(","));
  await expect
    .poll(read, { timeout: 5000, intervals: [100, 100, 100, 150, 200] })
    .toBe(await page.evaluate(async () => {
      await new Promise((r) => setTimeout(r, 350));
      return [".left", ".right", ".partnersheet"].map((sel) => {
        const n = document.querySelector(sel);
        return n ? Math.round(n.getBoundingClientRect().top) : 0;
      }).join(",");
    }));
}

export async function probe(page: Page): Promise<WorkspaceProbe> {
  return page.evaluate(() => {
    const w = (window as unknown as { planform: { workspace: () => WorkspaceProbe } }).planform;
    return JSON.parse(JSON.stringify(w.workspace()));
  });
}

/** Visible on screen (not translated off the fold, not display:none). */
export async function isOnScreen(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const node = document.querySelector(sel);
    if (!node) return false;
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const r = node.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    return r.top < window.innerHeight - 1 && r.bottom > 1 && r.left < window.innerWidth - 1 && r.right > 1;
  }, selector);
}

/**
 * Seed a realistic event plan: registration / shoe / backpack / group / life
 * zones, a check-in and a payment desk, a door and the four main flows. Partner
 * Mode has nothing to say about an empty room, so every partner test starts here.
 */
export async function seedPlan(page: Page): Promise<void> {
  await page.evaluate(() => {
    const pf = (window as unknown as {
      planform: {
        app: { addZone(t: string): void; nudgeSelection(x: number, z: number): void; setSelection(ids: string[]): void };
        store: { mutate(fn: (p: Record<string, unknown>) => void): void };
      };
    }).planform;
    const place = (type: string, dx: number, dz: number) => {
      pf.app.addZone(type);
      pf.app.nudgeSelection(dx, dz);
    };
    place("registration", -1.5, -2.2);
    place("shoe", -3, 1.5);
    place("backpack", 0.5, 1.5);
    place("group", 1.5, 0.5);
    place("life", 3, -2);
    pf.app.setSelection([]);
    pf.store.mutate((p) => {
      const objects = p.objects as Record<string, unknown>[];
      const routes = p.routes as Record<string, unknown>[];
      const desk = (id: string, x: number, role: string) => ({
        id, kind: "regTable", x, z: 6.2, rotationDeg: 0, width: 1.8, depth: 0.6, height: 0.75,
        locked: false, hidden: false, surface: "floor", elevation: 0,
        assetId: "builtin:regTable", serviceRole: role,
      });
      objects.push(desk("o-reg", 3.4, "checkin"));
      objects.push(desk("o-pay", 5.6, "payment"));
      objects.push({
        id: "o-door", kind: "door", x: 5, z: 8, rotationDeg: 0, width: 0.9, depth: 0.1, height: 2,
        locked: false, hidden: false, surface: "wall", elevation: 0, assetId: "builtin:door",
      });
      routes.push({ id: "r-entry", name: "入場動線", color: "#f97316", type: "entry", visible: true, points: [{ x: 1, z: 9 }, { x: 5, z: 9 }, { x: 5, z: 7.2 }] });
      routes.push({ id: "r-reg", name: "報到動線", color: "#38bdf8", type: "registration", visible: true, points: [{ x: 5, z: 7.2 }, { x: 3.4, z: 5.4 }, { x: 5.6, z: 5.4 }] });
      routes.push({ id: "r-shoe", name: "鞋子動線", color: "#fbbf24", type: "shoe", visible: true, points: [{ x: 5.6, z: 5.4 }, { x: 2, z: 4 }, { x: 2, z: 2 }] });
      routes.push({ id: "r-seat", name: "入座動線", color: "#34d399", type: "seating", visible: true, points: [{ x: 2, z: 2 }, { x: 6, z: 2.5 }] });
      p.name = "2026 領袖禪訓營 · 報到";
    });
  });
  await page.waitForTimeout(200);
}

export async function enterPartnerMode(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as {
    planform: { app: { enterPartnerMode(): void } };
  }).planform.app.enterPartnerMode());
  await expect(page.locator("#app")).toHaveClass(/partner/);
  await settle(page);
}
