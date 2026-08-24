import { expect, test, type Page } from "@playwright/test";
import { isOnScreen, openProjectHome, openWorkspace, PROJECT_KEYS } from "./helpers";

/**
 * The multi-project system, driven the way the brief describes it: three real
 * plans that must stay independent through switching, reload and reopen.
 *
 * The assertion this whole file exists for is the one in §20 —
 * **creating a project must never replace another one.**
 */

/** Create a project through the real wizard UI. */
async function createProject(page: Page, name: string, venue: RegExp | string): Promise<void> {
  const wizard = page.locator(".quickstart");
  if (!(await wizard.count())) {
    await page.getByRole("button", { name: /新建專案/ }).first().click();
  }
  await wizard.waitFor({ state: "visible" });

  // Step 1 — name.
  const nameInput = wizard.locator(".quickstart__name");
  await nameInput.fill(name);
  await wizard.getByRole("button", { name: /下一步：選場地/ }).click();

  // Step 2 — venue.
  await wizard.getByRole("button", { name: venue }).first().click();

  // Step 3 — create.
  const create = wizard.getByRole("button", { name: "建立專案" });
  if (await create.count()) await create.click();
  await wizard.waitFor({ state: "detached" });
  await page.waitForSelector(".projhome", { state: "hidden" });
}

async function goHome(page: Page): Promise<void> {
  await page.locator(".topbar__home").first().click();
  await page.waitForSelector(".projhome", { state: "visible" });
}

async function cardNames(page: Page): Promise<string[]> {
  return page.locator(".projcard__name").allTextContents();
}

/** A card matched on its exact name — 「8/25 社課」 also substring-matches 「8/25 社課 複本」. */
function card(page: Page, name: string) {
  return page.locator(".projcard").filter({
    has: page.locator(".projcard__name", { hasText: new RegExp(`^${name}$`) }),
  });
}

async function openCard(page: Page, name: string): Promise<void> {
  await card(page, name).getByRole("button", { name: "開啟" }).click();
  await page.waitForSelector(".projhome", { state: "hidden" });
}

/** Object count of the plan currently open in the editor. */
async function objectCount(page: Page): Promise<number> {
  return page.evaluate(() =>
    (window as unknown as { planform: { store: { getState(): { objects: unknown[] } } } })
      .planform.store.getState().objects.length);
}

async function currentName(page: Page): Promise<string> {
  return page.evaluate(() =>
    (window as unknown as { planform: { store: { getState(): { name: string } } } })
      .planform.store.getState().name);
}

/** Add a distinguishing object so each project has its own fingerprint. */
async function addMarkerObjects(page: Page, count: number): Promise<void> {
  await page.evaluate((n) => {
    const app = (window as unknown as {
      planform: { app: { store: { mutate(fn: (p: Record<string, unknown>) => void): void } } };
    }).planform.app;
    app.store.mutate((p) => {
      const objects = p.objects as Record<string, unknown>[];
      for (let i = 0; i < n; i++) {
        objects.push({
          id: `e2e_${Date.now()}_${i}`,
          kind: "table",
          assetId: "builtin:table",
          x: 1 + i * 0.1,
          z: 1,
          rotationDeg: 0,
          width: 1.2,
          depth: 0.6,
          height: 0.74,
          locked: false,
          surface: "floor",
          elevation: 0,
        });
      }
    });
  }, count);
  await page.evaluate(() =>
    (window as unknown as { planform: { store: { flushAutosave(): void } } }).planform.store.flushAutosave());
}

test.describe("multi-project system", () => {
  test("the wizard is clickable on a first run, not buried under Project Home", async ({ page }) => {
    // Regression: Project Home is a full-screen overlay. With the wizard below
    // it in the stack, every button on a brand new install was dead.
    await openProjectHome(page, { keepWizard: true });
    const wizard = page.locator(".quickstart");
    await expect(wizard).toBeVisible();
    const stacked = await page.evaluate(() => ({
      wizard: Number(getComputedStyle(document.querySelector(".quickstart")!).zIndex),
      home: Number(getComputedStyle(document.querySelector(".projhome")!).zIndex),
    }));
    expect(stacked.wizard).toBeGreaterThan(stacked.home);
    // And it really takes the click, rather than merely looking on top.
    await wizard.locator(".quickstart__name").fill("第一個專案");
    await wizard.getByRole("button", { name: /下一步：選場地/ }).click();
    await expect(wizard.locator(".quickstart__title")).toHaveText("在哪裡辦？");
  });

  test("a new project never replaces the one before it", async ({ page }) => {
    await openProjectHome(page);

    await createProject(page, "E310 30 人社課", /E310/);
    await addMarkerObjects(page, 3);
    await goHome(page);

    await createProject(page, "E310 60 人演講", /E310/);
    await addMarkerObjects(page, 7);
    await goHome(page);

    await createProject(page, "空白測試場地", /空白/);
    await goHome(page);

    // All three are listed — the first two did not get overwritten.
    expect(await cardNames(page)).toEqual(
      expect.arrayContaining(["E310 30 人社課", "E310 60 人演講", "空白測試場地"]),
    );
    expect(await page.locator(".projcard").count()).toBe(3);
  });

  test("editing A, switching to B and back leaves A untouched", async ({ page }) => {
    await openProjectHome(page);
    await createProject(page, "A 社課", /E310/);
    const aBase = await objectCount(page);
    await addMarkerObjects(page, 4);
    expect(await objectCount(page)).toBe(aBase + 4);
    await goHome(page);

    await createProject(page, "B 演講", /E310/);
    await addMarkerObjects(page, 1);
    await goHome(page);

    await openCard(page, "A 社課");
    expect(await currentName(page)).toBe("A 社課");
    // A is exactly as it was left — B's edit did not leak into it.
    expect(await objectCount(page)).toBe(aBase + 4);

    await goHome(page);
    await openCard(page, "B 演講");
    expect(await objectCount(page)).toBe(aBase + 1);
  });

  test("all three survive a reload and a fresh page open", async ({ page }) => {
    await openProjectHome(page);
    await createProject(page, "A 社課", /E310/);
    await addMarkerObjects(page, 2);
    await goHome(page);
    await createProject(page, "B 演講", /E310/);
    await addMarkerObjects(page, 5);
    await goHome(page);
    await createProject(page, "C 空白", /空白/);
    await goHome(page);

    await page.reload();
    await page.waitForSelector(".projhome", { state: "visible" });
    expect(await page.locator(".projcard").count()).toBe(3);

    // "Close the browser and open it again": a brand new page on the same origin.
    const fresh = await page.context().newPage();
    await fresh.goto("/");
    await fresh.waitForFunction(() => !!(window as unknown as { planform?: unknown }).planform);
    await fresh.waitForSelector(".projhome", { state: "visible" });
    expect(await fresh.locator(".projcard").count()).toBe(3);
    // And the plans themselves, not just the cards.
    await openCard(fresh, "B 演講");
    expect(await objectCount(fresh)).toBeGreaterThanOrEqual(5);
    await fresh.close();
  });

  test("reload while on 我的專案 stays on 我的專案", async ({ page }) => {
    await openProjectHome(page);
    await createProject(page, "已經離開的專案", /空白/);
    await goHome(page);
    await page.reload();
    // Walking back to the list is a decision; a reload must not undo it.
    await page.waitForSelector(".projhome", { state: "visible" });
    expect(await page.locator(".projcard").count()).toBe(1);
  });

  test("reload resumes the project that was open", async ({ page }) => {
    await openProjectHome(page);
    await createProject(page, "9/24 禪學社社課", /E310/);
    await addMarkerObjects(page, 2);

    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as { planform?: unknown }).planform);
    // Straight back into the editor, on the same plan — a volunteer mid-setup
    // in E310 must not be sent back to a list.
    await expect(page.locator(".projhome")).toBeHidden();
    expect(await currentName(page)).toBe("9/24 禪學社社課");
  });
});

test.describe("project management", () => {
  test("duplicate copies the whole plan into an independent project", async ({ page }) => {
    await openProjectHome(page);
    await createProject(page, "8/25 社課", /E310/);
    await addMarkerObjects(page, 6);
    const original = await objectCount(page);
    await goHome(page);

    await card(page, "8/25 社課").getByRole("button", { name: "複製" }).click();
    expect(await page.locator(".projcard").count()).toBe(2);

    await openCard(page, "8/25 社課 複本");
    expect(await objectCount(page)).toBe(original);
    // Editing the copy leaves the original alone.
    await addMarkerObjects(page, 3);
    await goHome(page);
    await openCard(page, "8/25 社課");
    expect(await objectCount(page)).toBe(original);
  });

  test("rename updates the card and the plan", async ({ page }) => {
    await openProjectHome(page);
    await createProject(page, "舊名字", /空白/);
    await goHome(page);

    page.once("dialog", (d) => void d.accept("9/1 社課"));
    await card(page, "舊名字").getByRole("button", { name: "重新命名" }).click();
    await expect(page.locator(".projcard__name")).toHaveText("9/1 社課");

    await openCard(page, "9/1 社課");
    expect(await currentName(page)).toBe("9/1 社課");
  });

  test("delete asks first, and can be undone", async ({ page }) => {
    await openProjectHome(page);
    await createProject(page, "會被刪掉的", /空白/);
    await goHome(page);
    await createProject(page, "留下來的", /空白/);
    await goHome(page);

    // Dismissing the confirm must keep the project.
    page.once("dialog", (d) => void d.dismiss());
    await card(page, "會被刪掉的").getByRole("button", { name: "刪除" }).click();
    expect(await page.locator(".projcard").count()).toBe(2);

    page.once("dialog", (d) => void d.accept());
    await card(page, "會被刪掉的").getByRole("button", { name: "刪除" }).click();
    expect(await page.locator(".projcard").count()).toBe(1);

    await page.locator(".projhome__undo").getByRole("button", { name: "復原" }).click();
    expect(await page.locator(".projcard").count()).toBe(2);
    expect(await cardNames(page)).toEqual(expect.arrayContaining(["會被刪掉的", "留下來的"]));
  });

  test("deleting two in a row can still get the first one back", async ({ page }) => {
    // Tidying up several old plans is one gesture, not two unrelated ones.
    // With a single undo slot the first project's bytes were already off disk
    // and the second delete dropped the only copy left — silently.
    await openProjectHome(page);
    await createProject(page, "舊的一", /空白/);
    await goHome(page);
    await createProject(page, "舊的二", /空白/);
    await goHome(page);
    await createProject(page, "留著的", /空白/);
    await goHome(page);

    page.once("dialog", (d) => void d.accept());
    await card(page, "舊的一").getByRole("button", { name: "刪除" }).click();
    page.once("dialog", (d) => void d.accept());
    await card(page, "舊的二").getByRole("button", { name: "刪除" }).click();
    expect(await page.locator(".projcard").count()).toBe(1);

    // One undo row per delete, newest first.
    const bars = page.locator(".projhome__undo");
    await expect(bars).toHaveCount(2);
    await expect(bars.first()).toContainText("舊的二");

    await bars.last().getByRole("button", { name: "復原" }).click();
    await bars.first().getByRole("button", { name: "復原" }).click();
    expect(await cardNames(page)).toEqual(
      expect.arrayContaining(["舊的一", "舊的二", "留著的"]),
    );
  });

  test("an AI preview does not follow you into the next project", async ({ page }) => {
    // 預覽就緒 is position:fixed and lives outside .agent-sheet, so it used to
    // survive the trip through 我的專案 — and 套用 commits the draft into
    // whatever project is bound by then, name and all.
    await openProjectHome(page);
    await createProject(page, "先開這個", /E310/);
    await goHome(page);
    await createProject(page, "後開這個", /空白/);
    const untouched = await objectCount(page);
    await goHome(page);

    await openCard(page, "先開這個");
    await page.getByRole("button", { name: /AI/ }).first().click();
    await page.getByRole("button", { name: /幫我排場佈/ }).click();
    await expect(page.locator(".agent-preview-bar")).toBeVisible();

    await goHome(page);
    await openCard(page, "後開這個");

    await expect(page.locator(".agent-preview-bar")).toBeHidden();
    expect(await currentName(page)).toBe("後開這個");
    // The blank venue ships its own fixtures, so "unchanged" is the number this
    // project was created with — not zero.
    expect(await objectCount(page)).toBe(untouched);
  });

  test("＋ 新建專案 from inside the editor does not overwrite the open project", async ({ page }) => {
    await openProjectHome(page);
    await createProject(page, "原本這個", /E310/);
    await addMarkerObjects(page, 4);
    const before = await objectCount(page);

    await page.locator(".topbar__more").first().click();
    await page.getByRole("menuitem", { name: /新建專案/ }).click();
    await createProject(page, "另外開的", /空白/);

    expect(await currentName(page)).toBe("另外開的");
    await goHome(page);
    await openCard(page, "原本這個");
    expect(await objectCount(page)).toBe(before);
  });
});

test.describe("migration and recovery", () => {
  test("a legacy single autosave becomes a real project instead of vanishing", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.clear();
      // The pre-multi-project world: one global autosave, no library.
      localStorage.setItem("planform-iso:autosave", JSON.stringify({ name: "去年的場佈" }));
    });
    await page.goto("/");
    await page.waitForFunction(() => !!(window as unknown as { planform?: unknown }).planform);
    await page.waitForSelector(".projhome", { state: "visible" });

    expect(await cardNames(page)).toContain("去年的場佈");
    // The legacy key is preserved, not deleted.
    expect(await page.evaluate(() => localStorage.getItem("planform-iso:autosave"))).toBeTruthy();
  });

  test("one corrupt project does not take the library down", async ({ page }) => {
    await openProjectHome(page);
    await createProject(page, "好的專案", /空白/);
    await goHome(page);
    await createProject(page, "壞掉的專案", /空白/);
    await goHome(page);

    await page.evaluate((indexKey) => {
      const index = JSON.parse(localStorage.getItem(indexKey)!);
      const bad = index.entries.find((e: { name: string }) => e.name === "壞掉的專案");
      localStorage.setItem(`planform-iso:projects:${bad.id}`, "<<not json>>");
    }, PROJECT_KEYS.index);

    await page.reload();
    await page.waitForSelector(".projhome", { state: "visible" });

    // Project Home still opens and still lists both.
    expect(await page.locator(".projcard").count()).toBe(2);
    await expect(page.locator(".projcard--broken")).toHaveCount(1);
    await expect(page.locator(".projcard--broken .projcard__sub")).toHaveText("這份專案需要復原");
    // The healthy one still opens normally.
    await openCard(page, "好的專案");
    expect(await currentName(page)).toBe("好的專案");
  });
});

test.describe("Project Home on a phone and a tablet", () => {
  test("phone shows a single column of cards, no sidebar", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openProjectHome(page);
    await createProject(page, "9/24 禪學社社課", /E310/);
    await goHome(page);

    const grid = page.locator(".projhome__grid");
    await expect(grid).toBeVisible();
    expect(await page.evaluate(() =>
      getComputedStyle(document.querySelector(".projhome__grid")!).gridTemplateColumns.split(" ").length)).toBe(1);

    // The card must not overflow the phone, and 新建專案 stays reachable.
    const box = (await page.locator(".projcard").first().boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(390);
    await expect(page.locator(".projhome__new")).toBeVisible();
    // No docked rails on Project Home, and Home owns no rail of its own.
    for (const sel of [".left", ".right"]) {
      expect(await isOnScreen(page, sel)).toBe(false);
    }
    expect(await page.locator(".projhome .left, .projhome .right").count()).toBe(0);
  });

  test("tablet lays cards out in two columns", async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 1180 });
    await openProjectHome(page);
    await createProject(page, "A", /空白/);
    await goHome(page);
    await createProject(page, "B", /空白/);
    await goHome(page);
    expect(await page.evaluate(() =>
      getComputedStyle(document.querySelector(".projhome__grid")!).gridTemplateColumns.split(" ").length)).toBe(2);
  });
});

test.describe("editor still reaches Project Home", () => {
  test("the back control is present on every size and flushes first", async ({ page }) => {
    for (const size of [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1366, height: 900 }]) {
      await page.setViewportSize(size);
      await openWorkspace(page);
      await expect(page.locator(".topbar__home").first()).toBeVisible();

      await page.evaluate(() => {
        const app = (window as unknown as {
          planform: { app: { store: { mutate(fn: (p: { description: string }) => void, o: { history: boolean }): void } } };
        }).planform.app;
        app.store.mutate((p) => (p.description = "離開前寫進去"), { history: false });
      });
      await page.locator(".topbar__home").first().click();
      await page.waitForSelector(".projhome", { state: "visible" });

      // Leaving flushed the pending autosave rather than dropping it.
      const saved = await page.evaluate(() => {
        const id = localStorage.getItem("planform-iso:active-project") ?? "prj_e2e_seed";
        return localStorage.getItem(`planform-iso:projects:${id}`) ?? "";
      });
      expect(saved).toContain("離開前寫進去");
    }
  });
});
