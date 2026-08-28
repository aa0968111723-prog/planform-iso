/**
 * 分享前先確認 — the traffic light next to the button that sends the plan to
 * twenty volunteers.
 *
 * 檢查 was folded into 分享 as the pre-export checklist, but the guard that
 * re-runs validation was left pointing at the folded-away `check` workflow,
 * which nothing can select any more. The light therefore read a cached issue
 * list that had never been filled: it was green because nothing had looked,
 * not because the plan was clean.
 *
 * These tests park a table across the only door and demand that 分享 notices.
 */

import { expect, test, type Page } from "@playwright/test";
import { openWorkspace, settle } from "./helpers";

/** Drop a table centred on the door, so it blocks the doorway clearance. */
async function blockTheDoor(page: Page): Promise<void> {
  await page.evaluate(() => {
    const pf = (window as unknown as {
      planform: { store: { getState(): Record<string, unknown>; mutate(fn: (p: Record<string, unknown>) => void): void } };
    }).planform;
    pf.store.mutate((p) => {
      const objects = p.objects as Record<string, unknown>[];
      const door = objects.find((o) => o.kind === "door");
      if (!door) throw new Error("this venue has no door to block");
      objects.push({
        id: "o-blocker", kind: "table",
        x: door.x, z: (door.z as number) - 0.6,
        rotationDeg: 0, width: 1.8, depth: 0.6, height: 0.74,
        locked: false, hidden: false, surface: "floor", elevation: 0,
        assetId: "builtin:table",
      });
    });
  });
  await page.waitForTimeout(150);
}

function checklistText(page: Page): Promise<string> {
  return page.locator(".left").innerText();
}

test.describe("分享前先確認 actually checks", () => {
  test.use({ viewport: { width: 1366, height: 1024 } });

  test("a table across the door turns the light red in 分享", async ({ page }) => {
    await openWorkspace(page);
    // Give the plan a door + something to validate against.
    await page.evaluate(() => (window as unknown as {
      planform: { app: { applyVenuePresetById(id: string): boolean } };
    }).planform.app.applyVenuePresetById("venue:tku-e310"));
    await settle(page);

    await blockTheDoor(page);

    // Straight to 分享 without ever visiting any other workflow: this is the
    // path that was silently green.
    await page.evaluate(() => (window as unknown as {
      planform: { app: { setWorkflow(w: string): void } };
    }).planform.app.setWorkflow("export"));
    await settle(page);

    const text = await checklistText(page);
    expect(text).toContain("分享前先確認");
    expect(text, "分享 reported a clean plan while a table sat across the door")
      .not.toContain("目前沒有阻擋分享的問題");
  });

  test("moving the blocker away turns it green again, without leaving 分享", async ({ page }) => {
    await openWorkspace(page);
    await page.evaluate(() => (window as unknown as {
      planform: { app: { applyVenuePresetById(id: string): boolean } };
    }).planform.app.applyVenuePresetById("venue:tku-e310"));
    await settle(page);
    await blockTheDoor(page);
    await page.evaluate(() => (window as unknown as {
      planform: { app: { setWorkflow(w: string): void } };
    }).planform.app.setWorkflow("export"));
    await settle(page);
    expect(await checklistText(page)).not.toContain("目前沒有阻擋分享的問題");

    // Fix the plan while standing in 分享. A verdict that only updates on
    // entry is a stale verdict.
    await page.evaluate(() => {
      const pf = (window as unknown as {
        planform: { store: { mutate(fn: (p: Record<string, unknown>) => void): void } };
      }).planform;
      pf.store.mutate((p) => {
        p.objects = (p.objects as Record<string, unknown>[]).filter((o) => o.id !== "o-blocker");
      });
    });
    await page.waitForTimeout(600); // past the 250 ms validation debounce
    await settle(page);

    expect(await checklistText(page), "the verdict stayed stale after the plan was fixed")
      .toContain("目前沒有阻擋分享的問題");
  });
});
