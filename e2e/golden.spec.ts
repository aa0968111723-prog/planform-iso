/**
 * Golden Flows — the three real-usage scenarios Planform 1.0 must survive
 * end-to-end, one per workspace tier:
 *
 *   1. 30 人社課（phone 390×844）: Quick Start → 淡江模板 → 30 人 → 建立場佈
 *      → 畫報到動線 → 匯出場佈總覽 → 夥伴模式 → 存成圖
 *   2. 60 人＋收費（tablet 768×1024）: Quick Start（勾收費）→ 模擬 → 人話結果
 *      → ✦ 幫我改善 → 套用 → 匯出動線圖
 *   3. 完全自訂（desktop 1366×1024）: 空白場地 → 自訂尺寸/地磚/區域
 *      → 儲存為我的場地 → reload → 再次套用
 */

import { expect, test, type Page } from "@playwright/test";
import { settle } from "./helpers";

/** Open the app as a真 first-run user: wizard visible, storage clean. */
async function openFresh(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Only wipe on the FIRST load — a later reload must behave like a real
    // returning user (their project intact, wizard already seen).
    if (!sessionStorage.getItem("e2e-fresh-done")) {
      sessionStorage.setItem("e2e-fresh-done", "1");
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("planform-iso:")) localStorage.removeItem(key);
      }
    }
    // Outside the guard on purpose: these flows are about the editor, and the
    // reload in Flow 3 must land there too rather than on 我的專案.
    localStorage.setItem("planform-iso:boot", "editor");
  });
  await page.goto("/");
  await page.waitForFunction(() => !!(window as unknown as { planform?: unknown }).planform);
  await settle(page);
}

interface ProjectProbe {
  zones: { type: string }[];
  groups: unknown[];
  routes: { type: string }[];
  objects: { serviceRole?: string; kind: string }[];
  classroom: { length: number };
  name: string;
}

function probeProject(page: Page): Promise<ProjectProbe> {
  return page.evaluate(() => {
    const pf = (window as unknown as {
      planform: { store: { getState: () => unknown } };
    }).planform;
    const s = pf.store.getState() as {
      zones: { type: string }[];
      groups: unknown[];
      routes: { type: string }[];
      objects: { serviceRole?: string; kind: string }[];
      classroom: { length: number };
      name: string;
    };
    return {
      zones: s.zones.map((z) => ({ type: z.type })),
      groups: [...s.groups],
      routes: s.routes.map((r) => ({ type: r.type })),
      objects: s.objects.map((o) => ({ serviceRole: o.serviceRole, kind: o.kind })),
      classroom: { length: s.classroom.length },
      name: s.name,
    };
  });
}

async function fillNeedsAndCreate(page: Page, opts: { participants: number; togglePayment?: boolean; untickAll?: boolean }): Promise<void> {
  const card = page.locator(".quickstart__card");
  await expect(card.locator(".quickstart__title")).toHaveText("這次活動需要什麼？");
  if (opts.togglePayment) await card.locator(".quickstart__needs .chip", { hasText: "收費" }).first().click();
  if (opts.untickAll) {
    for (const label of ["地墊", "報到", "鞋子區", "背包區"]) {
      await card.locator(".quickstart__needs .chip", { hasText: label }).first().click();
    }
  }
  await card.locator('input[type="number"]').fill(String(opts.participants));
  await card.locator("button", { hasText: "建立場佈" }).click();
  await settle(page);
}

test.describe("Golden Flow 1 — 30 人社課（手機）", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("quick start → 場佈 → 畫動線 → 匯出 → 夥伴模式存圖", async ({ page }) => {
    await openFresh(page);

    // Quick Start shows on first run; pick the 淡江 template.
    await expect(page.locator(".quickstart__title")).toHaveText("今天要排什麼？");
    await page.locator(".quickstart__card button", { hasText: "淡江教室模板" }).click();
    await fillNeedsAndCreate(page, { participants: 30 });

    // A ready-to-edit starting point exists.
    const p1 = await probeProject(page);
    expect(p1.zones.map((z) => z.type)).toEqual(
      expect.arrayContaining(["registration", "shoe", "backpack"]),
    );
    expect(p1.groups.length).toBeGreaterThan(0);
    expect(p1.objects.some((o) => o.serviceRole === "checkin")).toBe(true);
    expect(p1.routes.map((r) => r.type)).toContain("entry");

    // Draw a 報到 route with canvas taps.
    await page.locator('.navbtn[data-nav="route"]').click();
    await settle(page);
    await page.locator(".left .chip", { hasText: "報到" }).first().click();
    await settle(page);
    const canvas = page.locator("#scene");
    await canvas.click({ position: { x: 160, y: 320 } });
    await canvas.click({ position: { x: 220, y: 380 } });
    await canvas.click({ position: { x: 280, y: 430 } });
    // The floating route bar keeps 完成 on screen even with the sheet closed.
    await page.locator(".placebar-wrap button", { hasText: "完成繪製" }).click();
    const p2 = await probeProject(page);
    expect(p2.routes.map((r) => r.type)).toContain("registration");

    // Export the overview plan (share falls back to a download here).
    await page.locator('.navbtn[data-nav="export"]').click();
    await settle(page);
    const dl1 = page.waitForEvent("download");
    await page.locator(".left button", { hasText: "場佈總覽圖" }).click();
    expect((await dl1).suggestedFilename()).toContain("場佈總覽");

    // Partner mode from the More sheet, then 存成圖.
    await page.locator('.navbtn[data-nav="export"]').click();
    await settle(page);
    await page.locator(".topbar__more").click();
    await page.locator(".menusheet button", { hasText: "夥伴模式" }).click();
    await settle(page);
    await expect(page.locator("#app")).toHaveClass(/partner/);
    const dl2 = page.waitForEvent("download");
    await page.locator(".partneractions button", { hasText: "存成圖" }).click();
    expect((await dl2).suggestedFilename()).toContain("夥伴觀看圖");
    await page.locator(".partnertop button", { hasText: "離開" }).click();
    await expect(page.locator("#app")).not.toHaveClass(/partner/);
  });
});

test.describe("Golden Flow 2 — 60 人＋收費（平板）", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test("模擬 → 人話結果 → 幫我改善 → 套用 → 匯出動線圖", async ({ page }) => {
    await openFresh(page);
    await page.locator(".quickstart__card button", { hasText: "淡江教室模板" }).click();
    await fillNeedsAndCreate(page, { participants: 60, togglePayment: true });
    const p = await probeProject(page);
    expect(p.zones.map((z) => z.type)).toContain("payment");
    expect(p.objects.some((o) => o.serviceRole === "payment")).toBe(true);

    // Simulation quick setup speaks volunteer, not engineer.
    await page.locator('.navbtn[data-nav="route"]').click();
    await settle(page);
    const onsite = page.locator(".left .field", { hasText: "其中現場繳費" }).locator("input");
    await onsite.fill("20");
    await onsite.dispatchEvent("change");
    await page.locator(".left button", { hasText: "▶ 模擬" }).click();
    await expect(page.locator(".left .readout", { hasText: "最多排隊" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".left .readout", { hasText: "全部完成" })).toBeVisible();
    // Engineering vocabulary stays folded in 進階.
    await expect(page.locator(".left details:not([open])", { hasText: "進階" })).toHaveCount(1);
    await expect(page.locator(".left .readout", { hasText: "利用率" })).toBeHidden();

    // ✦ 幫我改善 routes into the AI sheet with a preview to accept.
    await page.locator(".left button", { hasText: "幫我改善" }).click();
    await expect(page.locator(".agent-sheet")).toBeVisible();
    await expect(page.locator(".agent-preview-bar")).toBeVisible({ timeout: 20_000 });
    await page.locator(".agent-preview-bar button", { hasText: "套用" }).click();
    await page.locator(".agent-sheet button", { hasText: "關閉" }).click();

    // Export the route map.
    await page.locator('.navbtn[data-nav="export"]').click();
    await settle(page);
    const dl = page.waitForEvent("download");
    await page.locator(".left button", { hasText: "動線圖" }).first().click();
    expect((await dl).suggestedFilename()).toContain("動線圖");
  });
});

test.describe("Golden Flow 3 — 完全自訂（桌機）", () => {
  test.use({ viewport: { width: 1366, height: 1024 } });

  test("空白場地 → 自訂尺寸/地磚/區域 → 儲存我的場地 → reload → 再用", async ({ page }) => {
    page.on("dialog", (d) => void d.accept());
    await openFresh(page);
    await page.locator(".quickstart__card button", { hasText: "空白自訂場地" }).click();
    await fillNeedsAndCreate(page, { participants: 10, untickAll: true });
    const p0 = await probeProject(page);
    expect(p0.zones).toHaveLength(0);
    expect(p0.groups).toHaveLength(0);

    // Customize room + tile.
    await page.locator(".topbar .chip", { hasText: "場地" }).first().click();
    const lenInput = page.locator(".left .field", { hasText: "長 (m)" }).first().locator("input");
    await lenInput.fill("12");
    await lenInput.dispatchEvent("change");
    await page.locator(".left button", { hasText: "40×40" }).first().click();

    // Custom zone via tap-to-place.
    await page.locator(".topbar .chip", { hasText: "場佈" }).first().click();
    await page.locator(".left .libtabs .libtab", { hasText: "區域" }).click();
    await page.locator(".left .card", { hasText: "自訂區" }).click();
    await page.locator("#scene").click({ position: { x: 700, y: 450 } });
    const p1 = await probeProject(page);
    expect(p1.zones.map((z) => z.type)).toContain("custom");

    // Save as my venue, reload, reuse.
    await page.locator(".topbar .chip", { hasText: "場地" }).first().click();
    await page.locator('.left input[placeholder*="場地名稱"]').fill("測試教室");
    await page.locator(".left button", { hasText: "儲存為我的場地" }).click();
    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as { planform?: unknown }).planform);
    await settle(page);
    await page.locator(".topbar .chip", { hasText: "場地" }).first().click();
    await expect(page.locator(".left .chip", { hasText: "測試教室" })).toBeVisible();
    // Apply it onto the (restored) project — dialog auto-accepted above.
    await page.locator(".left .chip", { hasText: "測試教室" }).click();
    await settle(page);
    const p2 = await probeProject(page);
    expect(p2.classroom.length).toBe(12);
  });
});

test.describe("Golden Flow 4 — E310 演講範例", () => {
  test.use({ viewport: { width: 1366, height: 1024 } });

  test("一鍵範例 → 模擬 → 匯出含走廊的場刊圖", async ({ page }) => {
    await openFresh(page);
    await page.locator(".quickstart__card button", { hasText: "E310 演講範例（60 人）" }).click();
    await settle(page);

    const p = await probeProject(page);
    expect(p.name).toBe("E310 演講活動（範例）");
    expect(p.groups.length).toBeGreaterThan(0);
    expect(p.routes.map((r) => r.type)).toContain("entry");

    await page.locator(".topbar .chip", { hasText: "動線" }).first().click();
    await settle(page);
    await page.locator(".left button", { hasText: "▶ 模擬" }).click();
    await expect(page.locator(".left .readout", { hasText: "全部完成" })).toBeVisible({ timeout: 20_000 });

    await page.locator(".topbar .chip", { hasText: "分享" }).first().click();
    await settle(page);
    const download = page.waitForEvent("download");
    await page.locator(".left button", { hasText: "場佈總覽圖" }).click();
    expect((await download).suggestedFilename()).toContain("場佈總覽");
  });
});
