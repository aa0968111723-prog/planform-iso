import { expect, type Page } from "@playwright/test";

export interface WorkspaceProbe {
  mode: "phone" | "tablet" | "desktop";
  canvas: { x: number; y: number; width: number; height: number };
  baseRect: { x: number; y: number; width: number; height: number };
  safeRect: { x: number; y: number; width: number; height: number };
  focusRect: { x: number; y: number; width: number; height: number };
  coverage: number;
}

/** Storage keys owned by the multi-project library. */
export const PROJECT_KEYS = {
  index: "planform-iso:projects:index",
  bodyPrefix: "planform-iso:projects:",
  active: "planform-iso:active-project",
  migrated: "planform-iso:projects:migrated",
} as const;

/**
 * Seed one project and mark it active, so the app boots straight into the
 * editor the way it does for a returning user. Bodies are normalised by
 * migrateProject on read, so a name is a complete enough seed.
 *
 * Playwright serialises the callback, so it must be a plain arrow function with
 * its data passed as the single argument — a bound function stringifies to
 * "[native code]" and silently seeds nothing.
 */
export async function seedProject(
  page: Page,
  seed: { name?: string; id?: string } = {},
): Promise<void> {
  await page.addInitScript(({ name, id }) => {
    const now = Date.now();
    localStorage.setItem("planform-iso:projects:index", JSON.stringify({
      version: 1,
      entries: [{ id, name, createdAt: now, updatedAt: now }],
    }));
    localStorage.setItem(`planform-iso:projects:${id}`, JSON.stringify({ name }));
    localStorage.setItem("planform-iso:active-project", id);
    localStorage.setItem("planform-iso:projects:migrated", "1");
    localStorage.removeItem("planform-iso:autosave");
  }, { name: seed.name ?? "E2E 專案", id: seed.id ?? "prj_e2e_seed" });
}

/** Load the app in the editor, on a seeded project. */
export async function openWorkspace(page: Page): Promise<void> {
  await seedProject(page);
  await page.goto("/");
  await page.waitForFunction(() => !!(window as unknown as { planform?: unknown }).planform);
  await page.waitForFunction(() => !!document.getElementById("app")?.dataset.wsMode);
  // Project Home is a full-screen overlay — if the seed did not take, every
  // later click would time out on it instead of saying why.
  await page.waitForSelector(".projhome", { state: "hidden" });
  await page.waitForTimeout(200);
  await settle(page);
}

/**
 * Load the app with an empty project library, landing on 我的專案.
 * The new-project wizard opens itself on a first run — dismiss it unless the
 * test wants it.
 */
export async function openProjectHome(page: Page, opts: { keepWizard?: boolean } = {}): Promise<void> {
  await page.addInitScript(() => {
    // Only wipe on the FIRST load. addInitScript runs on every navigation, so
    // an unguarded clear() would also wipe on reload — and then "everything
    // survives a reload" would be testing the wipe, not the product.
    if (!sessionStorage.getItem("e2e-home-cleared")) {
      sessionStorage.setItem("e2e-home-cleared", "1");
      localStorage.clear();
      localStorage.setItem("planform-iso:projects:migrated", "1");
    }
  });
  await page.goto("/");
  await page.waitForFunction(() => !!(window as unknown as { planform?: unknown }).planform);
  await page.waitForSelector(".projhome", { state: "visible" });
  if (!opts.keepWizard) {
    const wizard = page.locator(".quickstart");
    if (await wizard.count()) {
      await wizard.getByRole("button", { name: "取消" }).first().click();
      await wizard.waitFor({ state: "detached" });
    }
  }
}

/** Wait until no sheet is mid-transition, so measurements are stable. */
export async function settle(page: Page): Promise<void> {
  const read = () => page.evaluate(() =>
    [".left", ".right", ".partnersheet"].map((sel) => {
      const n = document.querySelector(sel);
      return n ? Math.round(n.getBoundingClientRect().top) : 0;
    }).join(","));
  // Stability, not equality with a single sample. The previous version read an
  // "expected" position once, 350ms in, and then waited for the panels to come
  // back to it. Taken while a sheet was still animating, that value was a
  // position the panel passed through and never returned to, so the poll ran
  // out the clock — a failure with nothing to do with the test that hit it.
  let previous = await read();
  await expect
    .poll(async () => {
      const current = await read();
      const unchanged = current === previous;
      previous = current;
      return unchanged;
    }, { timeout: 5000, intervals: [100, 100, 100, 150, 200] })
    .toBe(true);
}

export async function probe(page: Page): Promise<WorkspaceProbe> {
  return page.evaluate(() => {
    const w = (window as unknown as { planform: { workspace: () => WorkspaceProbe } }).planform;
    return JSON.parse(JSON.stringify(w.workspace()));
  });
}

/** First-layer workflow tab: bottom nav on compact, header chips on desktop. */
export async function gotoWorkflow(
  page: Page,
  id: "site" | "layout" | "route" | "sim" | "export",
): Promise<void> {
  const labels: Record<typeof id, string> = {
    site: "場地", layout: "場佈", route: "動線／互動", sim: "彩排", export: "分享",
  };
  const current = await page.evaluate(() =>
    (window as unknown as { planform: { app: { session: { workflow: string } } } })
      .planform.app.session.workflow);
  const sheet = await page.locator("#app").getAttribute("data-sheet");
  const compact = (await page.locator("#app").getAttribute("data-ws-mode")) !== "desktop";
  // Re-tapping the active compact tab CLOSES the sheet. Don't do that when
  // the caller wants the panel.
  if (current === id && (!compact || sheet === "workflow")) {
    await settle(page);
    return;
  }
  const clickTab = async (): Promise<void> => {
    const nav = page.locator(`.navbtn[data-nav="${id}"]`);
    if (await nav.isVisible()) await nav.click();
    else await page.locator(".group--flows button", { hasText: labels[id] }).click();
  };
  await clickTab();
  await settle(page);
  // Closing the inspector leaves the sheet at "none". A volunteer who wants
  // 場佈 / 彩排 has to tap the tab again — do that for them here so callers
  // always get the panel.
  if (compact && (await page.locator("#app").getAttribute("data-sheet")) !== "workflow") {
    await clickTab();
    await settle(page);
  }
}

/**
 * Click the centre of the visible canvas (safeRect), not a corner that chrome
 * or the iso void can swallow. Move first so the placement ghost follows.
 */
export async function clickSafeCanvas(page: Page): Promise<{ x: number; y: number }> {
  const safe = (await probe(page)).safeRect;
  const x = Math.round(safe.x + safe.width / 2);
  const y = Math.round(safe.y + safe.height / 2);
  await page.mouse.move(x, y);
  await page.waitForTimeout(80);
  await page.mouse.click(x, y);
  return { x, y };
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
