import { expect, test, type Page } from "@playwright/test";
import { enterPartnerMode, isOnScreen, openWorkspace, probe, seedPlan, settle } from "./helpers";

/**
 * Partner Mode smoke tests.
 *
 * The contract under test is the one a first-time volunteer experiences: the
 * plan fills the screen, there is never a sidebar, the five role views change
 * what is emphasised, and every panel speaks plain Chinese with no engineering
 * vocabulary anywhere on screen.
 */

const VIEWPORTS: { name: string; width: number; height: number; mode: "phone" | "tablet" | "desktop" }[] = [
  { name: "mobile-390x844", width: 390, height: 844, mode: "phone" },
  { name: "mobile-360x800", width: 360, height: 800, mode: "phone" },
  { name: "tablet-768x1024", width: 768, height: 1024, mode: "tablet" },
  { name: "tablet-1024x768", width: 1024, height: 768, mode: "tablet" },
  { name: "desktop-1366x1024", width: 1366, height: 1024, mode: "desktop" },
];

/** Words a partner must never be shown. */
const ENGINEERING = /\bcm\b|公分|\bX\s*[:：]|\bZ\s*[:：]|吸附|snap|Inspector|進階|原點|地磚|rotationDeg/i;

async function partnerText(page: Page): Promise<string> {
  return page.evaluate(() =>
    [".partnertop", ".partnerdock", ".partnersheet"]
      .map((sel) => {
        const n = document.querySelector(sel) as HTMLElement | null;
        if (!n || getComputedStyle(n).display === "none") return "";
        return n.innerText;
      })
      .join("\n"));
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("is canvas-first with no sidebar and no editor chrome", async ({ page }) => {
      await openWorkspace(page);
      await seedPlan(page);
      await enterPartnerMode(page);

      // Every editor surface is gone — not merely covered.
      for (const sel of [".topbar", ".left", ".right", ".bottomnav", ".ctxbar", ".agent-sheet"]) {
        expect(await isOnScreen(page, sel), sel).toBe(false);
      }
      await expect(page.locator(".partnertop")).toBeVisible();
      await expect(page.locator(".partnerdock")).toBeVisible();

      const state = await probe(page);
      expect(state.mode).toBe(vp.mode);
      // No fixed sidebar at any width: the chrome only ever takes horizontal
      // strips, so the usable canvas keeps the full window width.
      expect(Math.round(state.baseRect.width)).toBe(Math.round(state.canvas.width));
      expect(Math.round(state.baseRect.x)).toBe(Math.round(state.canvas.x));
      // The plan, not the chrome, owns the screen.
      expect(state.coverage, `coverage ${(state.coverage * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(0.7);
    });

    test("shows the five role views and a one-glance briefing", async ({ page }) => {
      await openWorkspace(page);
      await seedPlan(page);
      await enterPartnerMode(page);

      await expect(page.locator(".rolechip")).toHaveCount(5);
      expect(await page.locator(".rolechip__label").allInnerTexts())
        .toEqual(["全部", "報到組", "收費組", "引導組", "生活組"]);
      await expect(page.locator('.rolechip[data-role="all"]')).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(".partnerbrief")).toBeVisible();
      await expect(page.locator(".partneraction")).toHaveCount(3);
      await expect(page.locator(".partnerbar__light")).toBeVisible();

      // Picking a role answers "where do I stand / who comes to me / where next".
      await page.locator('.rolechip[data-role="checkin"]').click();
      await expect(page.locator('.rolechip[data-role="checkin"]')).toHaveAttribute("aria-pressed", "true");
      const brief = page.locator(".partnerbrief");
      await expect(brief).toContainText("你在");
      await expect(brief).toContainText("報到區");
      await expect(brief).toContainText("再往");

      // …and the scene emphasises only that team's places and flows.
      const emphasis = await page.evaluate(() => (window as unknown as {
        planform: { app: { session: { partner: { role: string } } } };
      }).planform.app.session.partner.role);
      expect(emphasis).toBe("checkin");
    });

    test("never shows engineering vocabulary", async ({ page }) => {
      await openWorkspace(page);
      await seedPlan(page);
      await enterPartnerMode(page);
      for (const role of ["all", "checkin", "payment", "guide", "life"]) {
        await page.locator(`.rolechip[data-role="${role}"]`).click();
        const text = await partnerText(page);
        expect(text, `${role}: ${text}`).not.toMatch(ENGINEERING);
      }
    });

    test("rehearsal reads as a wall-clock story", async ({ page }) => {
      await openWorkspace(page);
      await seedPlan(page);
      await enterPartnerMode(page);

      await page.locator(".partneraction").first().click();
      await expect(page.locator(".partnersheet")).toBeVisible();
      await expect(page.locator(".timeline__row").first()).toBeVisible();

      const clocks = await page.locator(".timeline__clock").allInnerTexts();
      expect(clocks.length).toBeGreaterThan(1);
      for (const c of clocks) expect(c).toMatch(/^\d{2}:\d{2}$/);
      const texts = (await page.locator(".timeline__text").allInnerTexts()).join(" ");
      expect(texts).toMatch(/進場|排隊|塞車|就位/);
      expect(texts).not.toMatch(ENGINEERING);

      // The dock stays reachable while a sheet is open.
      await expect(page.locator(".partneraction").first()).toBeVisible();
      await page.locator(".partnersheet .chip", { hasText: "收起" }).click();
      await expect(page.locator(".partnersheet")).toBeHidden();
    });

    test("AI優化 is a visual before/after with plain numbers", async ({ page }) => {
      await openWorkspace(page);
      await seedPlan(page);
      await enterPartnerMode(page);

      await page.locator(".partneraction--accent").click();
      await expect(page.locator(".partnersheet")).toBeVisible();
      await expect(page.locator(".beforeafter__img")).toHaveCount(2, { timeout: 20_000 });

      const captions = await page.locator(".beforeafter__cap").allInnerTexts();
      expect(captions).toEqual(["現在的排法", "建議的排法"]);
      for (const src of await page.locator(".beforeafter__img").evaluateAll(
        (els) => els.map((e) => (e as HTMLImageElement).src))) {
        expect(src.startsWith("data:image/")).toBe(true);
      }

      expect(await page.locator(".comparerow__label").allInnerTexts()).toEqual([
        "最多幾個人在排隊", "平均要等多久", "最久要等多久", "多久全部就位",
      ]);
      await expect(page.locator(".partnerverdict")).not.toBeEmpty();
      expect(await partnerText(page)).not.toMatch(ENGINEERING);

      // Both decisions are pinned outside the scroll area.
      const actions = page.locator(".partnersheet__actions .btn");
      await expect(actions).toHaveCount(2);
      await expect(actions.nth(0)).toBeVisible();
      await expect(actions.nth(1)).toBeVisible();
    });
  });
}

test.describe("partner mode boundaries (768x1024)", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test("marks problems on the plan and explains them in plain words", async ({ page }) => {
    await openWorkspace(page);
    await seedPlan(page);
    await enterPartnerMode(page);

    await page.locator(".partnerbar__light").click();
    await expect(page.locator(".partnersheet")).toBeVisible();
    const rows = page.locator(".markrow");
    if (await rows.count()) {
      // Every marked spot is red / orange / green and carries an instruction.
      const classes = await rows.evaluateAll((els) => els.map((e) => e.className));
      for (const c of classes) expect(c).toMatch(/markrow--(bad|warn|ok)/);
      await expect(page.locator(".markrow__action").first()).not.toBeEmpty();
    } else {
      await expect(page.locator(".partnerempty")).toContainText("沒有要注意的地方");
    }
  });

  test("steps sheet opens from the briefing and closes again", async ({ page }) => {
    await openWorkspace(page);
    await seedPlan(page);
    await enterPartnerMode(page);
    await page.locator('.rolechip[data-role="guide"]').click();

    await page.locator(".partnerbrief").click();
    await expect(page.locator(".partnersteps")).toBeVisible();
    const steps = await page.locator(".partnerstep").allInnerTexts();
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(steps.join(" ")).not.toMatch(ENGINEERING);
    // Numbered ①②③-style ordering, rendered as 1..n.
    expect(await page.locator(".partnerstep__no").allInnerTexts())
      .toEqual(steps.map((_, i) => String(i + 1)));

    await page.locator(".partnerbrief").click();
    await expect(page.locator(".partnersheet")).toBeHidden();
  });

  test("is read-only: tapping the plan never edits it", async ({ page }) => {
    await openWorkspace(page);
    await seedPlan(page);
    await enterPartnerMode(page);
    const before = await page.evaluate(() => JSON.stringify((window as unknown as {
      planform: { store: { getState(): unknown } };
    }).planform.store.getState()));

    // Tap, then drag, right across the middle of the plan.
    const safe = (await probe(page)).safeRect;
    const cx = Math.round(safe.x + safe.width / 2);
    const cy = Math.round(safe.y + safe.height / 2);
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 60, cy + 40, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.press("Delete");
    await page.waitForTimeout(300);

    expect(await page.evaluate(() => (window as unknown as {
      planform: { app: { session: { selection: Set<string> } } };
    }).planform.app.session.selection.size)).toBe(0);
    expect(await page.evaluate(() => JSON.stringify((window as unknown as {
      planform: { store: { getState(): unknown } };
    }).planform.store.getState()))).toBe(before);
  });

  test("leaves the professional editor untouched on exit", async ({ page }) => {
    await openWorkspace(page);
    await seedPlan(page);
    const before = await page.evaluate(() => JSON.stringify((window as unknown as {
      planform: { store: { getState(): unknown } };
    }).planform.store.getState()));

    await enterPartnerMode(page);
    await page.locator('.rolechip[data-role="life"]').click();
    await page.locator(".partnerbar__exit").click();
    await expect(page.locator("#app")).not.toHaveClass(/partner/);
    await settle(page);

    // Editor chrome is back…
    await expect(page.locator(".topbar")).toBeVisible();
    expect(await isOnScreen(page, ".bottomnav")).toBe(true);
    expect(await isOnScreen(page, ".partnertop")).toBe(false);
    expect(await isOnScreen(page, ".partnerdock")).toBe(false);
    // …and the plan itself was never modified by looking at it.
    const after = await page.evaluate(() => JSON.stringify((window as unknown as {
      planform: { store: { getState(): unknown } };
    }).planform.store.getState()));
    expect(after).toBe(before);
  });

  test("editor entry points open partner mode", async ({ page }) => {
    await openWorkspace(page);
    await seedPlan(page);
    await page.locator(".topbar__more").click();
    await page.locator(".menuitem", { hasText: "夥伴模式" }).click();
    await expect(page.locator("#app")).toHaveClass(/partner/);
  });
});
