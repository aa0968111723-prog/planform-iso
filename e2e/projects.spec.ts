/**
 * 我的專案 — the multi-project contract, end to end.
 *
 * The unit tests prove the bytes; these prove the two claims a user can
 * actually check: creating a project never replaces another one, and the
 * library screen is usable on a phone.
 */

import { expect, test, type Page } from "@playwright/test";
import { isOnScreen, settle } from "./helpers";

/**
 * A returning user, on 我的專案.
 *
 * The first load is a genuine first run and therefore lands in the editor with
 * one project — that IS the first-run contract. The reload afterwards is the
 * returning visit, and it must come up on 我的專案 with no boot override in
 * play, which is what requirement 1 actually claims.
 */
async function openLibrary(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-projects-wiped")) {
      sessionStorage.setItem("e2e-projects-wiped", "1");
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("planform-iso:")) localStorage.removeItem(key);
      }
      localStorage.setItem("planform-iso:quickstart", "1");
    }
  });
  await page.goto("/");
  await page.waitForFunction(() => !!(window as unknown as { planform?: unknown }).planform);
  await page.reload();
  await page.waitForFunction(() => !!(window as unknown as { planform?: unknown }).planform);
  await page.waitForFunction(() => !!document.getElementById("app")?.dataset.wsMode);
  await settle(page);
}

/** Straight into the editor, wizard already seen. */
async function openEditor(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-projects-wiped")) {
      sessionStorage.setItem("e2e-projects-wiped", "1");
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("planform-iso:")) localStorage.removeItem(key);
      }
      localStorage.setItem("planform-iso:quickstart", "1");
    }
    localStorage.setItem("planform-iso:boot", "editor");
  });
  await page.goto("/");
  await page.waitForFunction(() => !!(window as unknown as { planform?: unknown }).planform);
  await page.waitForFunction(() => !!document.getElementById("app")?.dataset.wsMode);
  await settle(page);
}

function projectCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const pf = (window as unknown as {
      planform: { repo: { listProjects: () => unknown[] } };
    }).planform;
    return pf.repo.listProjects().length;
  });
}

function projectNames(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const pf = (window as unknown as {
      planform: { repo: { listProjects: () => { name: string }[] } };
    }).planform;
    return pf.repo.listProjects().map((m) => m.name);
  });
}

/** One zone, so "did this project keep its own content?" has an answer. */
async function addZone(page: Page, type: string): Promise<void> {
  await page.evaluate((t) => {
    const pf = (window as unknown as {
      planform: { app: { addZone(type: string): void; setSelection(ids: string[]): void } };
    }).planform;
    pf.app.addZone(t);
    pf.app.setSelection([]);
  }, type);
  await page.waitForTimeout(150);
}

function activeId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const pf = (window as unknown as { planform: { projects: { activeId: string | null } } }).planform;
    return pf.projects.activeId;
  });
}

async function open(page: Page, id: string): Promise<void> {
  await page.evaluate((target) => {
    const pf = (window as unknown as {
      planform: { projects: { openProject(id: string): boolean } };
    }).planform;
    pf.projects.openProject(target);
  }, id);
  await settle(page);
}

function zoneTypes(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const pf = (window as unknown as {
      planform: { store: { getState: () => { zones: { type: string }[] } } };
    }).planform;
    return pf.store.getState().zones.map((z) => z.type);
  });
}

test.describe("專案彼此獨立（桌機）", () => {
  test.use({ viewport: { width: 1366, height: 1024 } });

  test("存 A → 新建 B → reload → 兩份都在，A 可以開回來", async ({ page }) => {
    await openEditor(page);
    await addZone(page, "registration");
    const aId = await page.evaluate(() => {
      const pf = (window as unknown as {
        planform: { projects: { activeId: string | null } };
      }).planform;
      return pf.projects.activeId;
    });
    expect(aId).toBeTruthy();

    await page.evaluate(() => {
      const pf = (window as unknown as {
        planform: { projects: { createProject(o: { name: string; open: boolean }): unknown } };
      }).planform;
      pf.projects.createProject({ name: "B 活動", open: true });
    });
    await settle(page);
    await addZone(page, "life");

    expect(await projectCount(page)).toBe(2);
    // B has its own zone and none of A's.
    expect(await zoneTypes(page)).toEqual(["life"]);

    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as { planform?: unknown }).planform);
    await settle(page);
    expect(await projectCount(page)).toBe(2);

    await page.evaluate((id) => {
      const pf = (window as unknown as {
        planform: { projects: { openProject(id: string): boolean } };
      }).planform;
      pf.projects.openProject(id!);
    }, aId);
    await settle(page);
    expect(await zoneTypes(page)).toEqual(["registration"]);
  });

  test("壞掉的 index 會從磁碟上的 body 復原", async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => {
      const pf = (window as unknown as {
        planform: { projects: { createProject(o: { name: string; open: boolean }): unknown } };
      }).planform;
      pf.projects.createProject({ name: "B 活動", open: true });
      pf.projects.createProject({ name: "C 活動", open: true });
    });
    await settle(page);
    expect(await projectCount(page)).toBe(3);

    await page.evaluate(() => localStorage.setItem("planform-iso:projects:index", "[not json"));
    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as { planform?: unknown }).planform);
    await settle(page);

    // The bodies are still on disk, so the library rebuilds itself from them.
    expect(await projectCount(page)).toBe(3);
    expect(await page.evaluate(() => localStorage.getItem("planform-iso:projects:index:backup"))).toBe("[not json");
  });
});

test.describe("三個專案的驗收（桌機）", () => {
  test.use({ viewport: { width: 1366, height: 1024 } });

  test("E310 範例 ＋ 兩個活動，來回切換互不污染，複製也是整份", async ({ page }) => {
    await openEditor(page);

    // 1. The E310 sample fills the pristine project boot created, rather than
    //    minting a ghost beside it.
    await page.locator(".topbar__more").click();
    await page.locator(".menusheet button", { hasText: "快速開始" }).click();
    await page.locator(".quickstart__card button", { hasText: "E310 演講範例" }).click();
    await settle(page);
    expect(await projectCount(page)).toBe(1);
    const e310Id = await activeId(page);
    const e310Zones = await zoneTypes(page);
    expect(e310Zones.length).toBeGreaterThan(0);

    // 2. Two more activities, each with a zone of its own.
    await page.evaluate(() => {
      const pf = (window as unknown as {
        planform: { projects: { createProject(o: { name: string; open: boolean }): unknown } };
      }).planform;
      pf.projects.createProject({ name: "秋季茶會", open: true });
    });
    await settle(page);
    await addZone(page, "registration");
    const bId = await activeId(page);

    await page.evaluate(() => {
      const pf = (window as unknown as {
        planform: { projects: { createProject(o: { name: string; open: boolean }): unknown } };
      }).planform;
      pf.projects.createProject({ name: "新生說明會", open: true });
    });
    await settle(page);
    await addZone(page, "life");
    const cId = await activeId(page);

    expect(await projectCount(page)).toBe(3);

    // 3. Switch back and forth: each project keeps exactly its own content.
    await open(page, e310Id!);
    expect(await zoneTypes(page)).toEqual(e310Zones);
    await open(page, bId!);
    expect(await zoneTypes(page)).toEqual(["registration"]);
    await open(page, cId!);
    expect(await zoneTypes(page)).toEqual(["life"]);
    await open(page, e310Id!);
    expect(await zoneTypes(page)).toEqual(e310Zones);

    // 4. Survives a reload.
    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as { planform?: unknown }).planform);
    await settle(page);
    expect(await projectCount(page)).toBe(3);
    await open(page, bId!);
    expect(await zoneTypes(page)).toEqual(["registration"]);

    // 5. 複製 takes the whole project and leaves the original alone.
    const copyId = await page.evaluate((id) => {
      const pf = (window as unknown as {
        planform: { projects: { duplicateProject(id: string): { id: string } | null } };
      }).planform;
      return pf.projects.duplicateProject(id!)?.id ?? null;
    }, bId);
    expect(copyId).toBeTruthy();
    expect(await projectCount(page)).toBe(4);

    await open(page, copyId!);
    expect(await zoneTypes(page)).toEqual(["registration"]);
    await addZone(page, "shoe");
    await open(page, bId!);
    expect(await zoneTypes(page)).toEqual(["registration"]);
  });
});

test.describe("Quick Start 建立新專案（桌機）", () => {
  test.use({ viewport: { width: 1366, height: 1024 } });

  test("跑一次精靈不會蓋掉目前的專案，也不會問「要取代嗎」", async ({ page }) => {
    await openEditor(page);
    await addZone(page, "registration");

    let dialogs = 0;
    page.on("dialog", (d) => {
      dialogs += 1;
      void d.dismiss();
    });

    await page.locator(".topbar__more").click();
    await page.locator(".menusheet button", { hasText: "快速開始" }).click();
    await expect(page.locator(".quickstart__title")).toHaveText("今天要排什麼？");
    await page.locator(".quickstart__card button", { hasText: "空白" }).first().click();
    const card = page.locator(".quickstart__card");
    await card.locator('input[type="number"]').fill("10");
    await card.locator("button", { hasText: "建立場佈" }).click();
    await settle(page);

    expect(dialogs).toBe(0);
    expect(await projectCount(page)).toBe(2);

    // The first project still has its own content.
    const names = await projectNames(page);
    expect(names).toHaveLength(2);
    await page.evaluate(() => {
      const pf = (window as unknown as {
        planform: {
          repo: { listProjects: () => { id: string; name: string }[] };
          projects: { openProject(id: string): boolean };
        };
      }).planform;
      const first = pf.repo.listProjects().find((m) => m.name === "未命名平面圖");
      if (first) pf.projects.openProject(first.id);
    });
    await settle(page);
    expect(await zoneTypes(page)).toEqual(["registration"]);
  });

  test("第一次開 app 走完精靈，我的專案只有一份", async ({ page }) => {
    await page.addInitScript(() => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("planform-iso:")) localStorage.removeItem(key);
      }
    });
    await page.goto("/");
    await page.waitForFunction(() => !!(window as unknown as { planform?: unknown }).planform);
    await expect(page.locator(".quickstart__title")).toHaveText("今天要排什麼？");
    await page.locator(".quickstart__card button", { hasText: "空白" }).first().click();
    const card = page.locator(".quickstart__card");
    await card.locator('input[type="number"]').fill("10");
    await card.locator("button", { hasText: "建立場佈" }).click();
    await settle(page);

    // No ghost 未命名平面圖 card left behind by boot.
    expect(await projectCount(page)).toBe(1);
  });
});

test.describe("我的專案的畫面契約（手機）", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("編輯器的東西全部收掉，卡片單欄，不會橫向捲動", async ({ page }) => {
    await openLibrary(page);
    await expect(page.locator("#app")).toHaveAttribute("data-screen", "home");

    // The list is hardcoded on purpose, and it is the thing that has to grow
    // when new editor chrome appears: the AI 預覽就緒 bar is `position: fixed`
    // at the highest z-index in the app and was missed by the first version.
    for (const sel of [".topbar", ".left", ".right", ".bottomnav", ".ctxbar", "#scene",
                       ".calibration-banner", ".agent-sheet", ".agent-preview-bar"]) {
      expect(await isOnScreen(page, sel), `${sel} must be hidden on 我的專案`).toBe(false);
    }
    expect(await isOnScreen(page, ".projecthome")).toBe(true);

    const columns = await page.evaluate(() =>
      getComputedStyle(document.querySelector(".projecthome__grid")!).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(1);

    const overflows = await page.evaluate(() =>
      document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflows).toBe(false);
  });

  test("刪除後的「復原」看得見也按得到", async ({ page }) => {
    await openLibrary(page);
    await page.evaluate(() => {
      const pf = (window as unknown as {
        planform: { projects: { createProject(o: { name: string; open: boolean }): unknown; goHome(): void } };
      }).planform;
      pf.projects.createProject({ name: "要刪掉的活動", open: false });
      pf.projects.createProject({ name: "留下來的活動", open: false });
      pf.projects.goHome();
    });
    await page.waitForTimeout(200);
    const before = await page.locator(".projectcard").count();
    expect(before).toBeGreaterThanOrEqual(2);

    page.once("dialog", (d) => void d.accept());
    await page.locator(".projectcard", { hasText: "要刪掉的活動" }).locator(".projectcard__more").click();
    await page.locator(".menusheet button", { hasText: "刪除" }).click();
    await page.waitForTimeout(200);
    expect(await page.locator(".projectcard").count()).toBe(before - 1);

    // The toast has to sit ABOVE Project Home or the undo ships invisible.
    expect(await isOnScreen(page, ".toast")).toBe(true);
    await page.locator(".toast button", { hasText: "復原" }).click();
    await page.waitForTimeout(200);
    expect(await page.locator(".projectcard").count()).toBe(before);
    await expect(page.locator(".projectcard", { hasText: "要刪掉的活動" })).toHaveCount(1);
  });

  test("在我的專案按 Delete 不會動到還開著的專案", async ({ page }) => {
    await openEditor(page);
    await addZone(page, "registration");
    await page.evaluate(() => {
      const pf = (window as unknown as {
        planform: {
          app: { setSelection(ids: string[]): void };
          store: { getState: () => { zones: { id: string }[] } };
          projects: { goHome(): void };
        };
      }).planform;
      pf.app.setSelection([pf.store.getState().zones[0].id]);
      pf.projects.goHome();
    });
    await page.waitForTimeout(200);

    for (const key of ["Delete", "d", "ArrowLeft", "Backspace"]) {
      await page.keyboard.press(key);
    }
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      const pf = (window as unknown as {
        planform: { projects: { activeId: string | null; openProject(id: string): boolean } };
      }).planform;
      if (pf.projects.activeId) pf.projects.openProject(pf.projects.activeId);
    });
    await settle(page);
    expect(await zoneTypes(page)).toEqual(["registration"]);
  });
});

test.describe("AI 預覽不會跨到別的專案（桌機）", () => {
  test.use({ viewport: { width: 1366, height: 1024 } });

  test("回到我的專案會收掉預覽，套用不到另一份專案", async ({ page }) => {
    await openEditor(page);
    await addZone(page, "registration");

    // A real local preview — MockProvider, no network.
    const previewing = await page.evaluate(async () => {
      const pf = (window as unknown as {
        planform: { agent: { run(r: { text: string }): Promise<unknown>; isPreviewActive(): boolean } };
      }).planform;
      await pf.agent.run({ text: "幫我排場佈" });
      return pf.agent.isPreviewActive();
    });
    expect(previewing).toBe(true);

    await page.evaluate(() => {
      const pf = (window as unknown as {
        planform: { projects: { createProject(o: { name: string; open: boolean }): unknown } };
      }).planform;
      pf.projects.createProject({ name: "另一個活動", open: true });
    });
    await settle(page);

    // Committing it now would replace THIS project's zones, objects, routes and
    // even its name with a draft generated from the previous one.
    const stillPreviewing = await page.evaluate(() => {
      const pf = (window as unknown as {
        planform: { agent: { isPreviewActive(): boolean } };
      }).planform;
      return pf.agent.isPreviewActive();
    });
    expect(stillPreviewing).toBe(false);
    expect(await isOnScreen(page, ".agent-preview-bar")).toBe(false);
    expect(await zoneTypes(page)).toEqual([]);
  });

  test("從我的專案開啟後，平面圖是照編輯器的可視範圍框的", async ({ page }) => {
    await openEditor(page);
    await addZone(page, "registration");
    await page.evaluate(() => {
      const pf = (window as unknown as {
        planform: { projects: { createProject(o: { name: string; open: boolean }): unknown; goHome(): void } };
      }).planform;
      pf.projects.createProject({ name: "第二個活動", open: true });
      pf.projects.goHome();
    });
    await page.waitForTimeout(250);

    const framed = await page.evaluate(() => {
      const pf = (window as unknown as {
        planform: {
          repo: { listProjects: () => { id: string; name: string }[] };
          projects: { openProject(id: string): boolean };
          app: {
            recenterView(): void;
            scene: { project(x: number, z: number): { x: number; y: number } };
            store: { getState(): { classroom: { x: number; z: number; length: number; width: number } } };
          };
        };
      }).planform;
      // The scale the room is drawn at — the thing that goes wrong when the
      // camera is framed against a screen where every rail is display:none.
      const span = () => {
        const s = pf.app.store.getState();
        const a = pf.app.scene.project(s.classroom.x, s.classroom.z);
        const b = pf.app.scene.project(s.classroom.x + s.classroom.length, s.classroom.z);
        return Math.hypot(b.x - a.x, b.y - a.y);
      };
      const target = pf.repo.listProjects().find((m) => m.name === "第二個活動")!;
      pf.projects.openProject(target.id);
      const onOpen = span();
      // What the same call produces once the editor is demonstrably measured.
      pf.app.recenterView();
      return { onOpen, correct: span() };
    });

    // Framed against Home's insets the room comes up over-zoomed, and the only
    // fix the user has is to find 置中 themselves. Both numbers come from the
    // same projection, so a real difference here is a real difference on screen.
    expect(framed.correct).toBeGreaterThan(0);
    const drift = Math.abs(framed.onOpen - framed.correct) / framed.correct;
    expect(drift).toBeLessThan(0.02);
  });
});

test.describe("我的專案的畫面契約（平板）", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test("平板兩欄，而且 E310 專案不會在這裡蓋出校正橫幅", async ({ page }) => {
    await openEditor(page);
    await page.evaluate(() => {
      const pf = (window as unknown as {
        planform: {
          projects: { createProject(o: { name: string; open: boolean }): unknown; goHome(): void };
        };
      }).planform;
      pf.projects.createProject({ name: "第二個活動", open: false });
      pf.projects.goHome();
    });
    await page.waitForTimeout(250);

    const columns = await page.evaluate(() =>
      getComputedStyle(document.querySelector(".projecthome__grid")!).gridTemplateColumns.split(" ").length);
    expect(columns).toBe(2);
    // The banner is position:fixed at z 55 and would otherwise float over the
    // cards on any project whose venue still needs calibrating.
    expect(await isOnScreen(page, ".calibration-banner")).toBe(false);
  });
});
