/**
 * The app on a store that has run out of room.
 *
 * Safari private mode, an embedded webview, a genuinely full 5 MiB origin. The
 * repository is honest — it throws, or returns false — and everything here is
 * about whether the screen says so. A button that does nothing, twice, with no
 * message is how a volunteer concludes the tool is broken and goes back to
 * paper.
 *
 * These run in a real browser because that is the only place the claim lives:
 * the unit tests in `test/storageFailure.test.ts` pin the repository contract,
 * and these pin what a person sees.
 */

import { expect, test, type Page } from "@playwright/test";
import { openProjectHome } from "./helpers";

/** Make writes to project bodies throw the way a full quota does. */
async function fillTheDisk(page: Page): Promise<void> {
  await page.evaluate(() => {
    const real = Storage.prototype.setItem;
    (window as unknown as { __restoreDisk: () => void }).__restoreDisk = () => {
      Storage.prototype.setItem = real;
    };
    Storage.prototype.setItem = function patched(key: string, value: string) {
      if (/^planform-iso:projects:prj_/.test(key)) {
        const err = new Error("QuotaExceededError");
        err.name = "QuotaExceededError";
        throw err;
      }
      return real.call(this, key, value);
    };
  });
}

async function freeTheDisk(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __restoreDisk: () => void }).__restoreDisk());
}

async function createProject(page: Page, name: string): Promise<void> {
  const wizard = page.locator(".quickstart");
  if (!(await wizard.count())) {
    await page.getByRole("button", { name: /新建專案/ }).first().click();
  }
  await wizard.waitFor({ state: "visible" });
  await wizard.locator(".quickstart__name").fill(name);
  await wizard.getByRole("button", { name: /下一步：選場地/ }).click();
  await wizard.getByRole("button", { name: /空白/ }).first().click();
  const create = wizard.getByRole("button", { name: "建立專案" });
  if (await create.count()) await create.click();
  await wizard.waitFor({ state: "detached" });
}

async function goHome(page: Page): Promise<void> {
  await page.locator(".topbar__home").first().click();
  await page.waitForSelector(".projhome", { state: "visible" });
}

function card(page: Page, name: string) {
  return page.locator(".projcard").filter({
    has: page.locator(".projcard__name", { hasText: new RegExp(`^${name}$`) }),
  });
}

test.describe("a full store", () => {
  test("複製 says the disk is full instead of doing nothing", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await openProjectHome(page);
    await createProject(page, "上週社課");
    await goHome(page);
    expect(await page.locator(".projcard").count()).toBe(1);

    await fillTheDisk(page);
    await card(page, "上週社課").getByRole("button", { name: "複製" }).click();

    await expect(page.locator(".toast")).toContainText(/儲存空間已滿/);
    expect(await page.locator(".projcard").count()).toBe(1);
    // The click handler used to abort on an uncaught StorageFullError, which
    // is why nothing happened AND nothing was said.
    expect(pageErrors).toEqual([]);
  });

  test("a failed 復原 keeps the undo bar, so the plan is still recoverable", async ({ page }) => {
    await openProjectHome(page);
    await createProject(page, "期初茶會");
    await goHome(page);

    page.on("dialog", (d) => void d.accept());
    await card(page, "期初茶會").getByRole("button", { name: "刪除" }).click();
    await expect(page.locator(".projhome__undo")).toBeVisible();

    // The body is already gone from storage; this snapshot is the last copy.
    await fillTheDisk(page);
    await page.locator(".projhome__undo").getByRole("button", { name: "復原" }).click();
    await expect(page.locator(".toast")).toContainText(/還沒復原成功/);
    // The bar must survive — throwing the snapshot away here would destroy the
    // project permanently, behind one apologetic toast.
    await expect(page.locator(".projhome__undo")).toBeVisible();

    await freeTheDisk(page);
    await page.locator(".projhome__undo").getByRole("button", { name: "復原" }).click();
    await expect(page.locator(".toast")).toContainText(/已復原/);
    await expect(card(page, "期初茶會")).toHaveCount(1);
  });
});
