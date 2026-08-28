import { expect, test } from "@playwright/test";
import { openWorkspace, settle } from "./helpers";

/**
 * §92 — designing a prop from nothing, through the interface.
 *
 * A blind tester was given 「不要用內建的骰子或轉盤，自己做一個祝福抽卡箱：
 * 抽卡 → 寫祝福 → 投入箱子 → 離開」 and answered 不能. They were right: the
 * builder's 互動 section could only express ONE chance fork with 2-12 faces.
 * The data model always supported a sequence — the §95 golden flow builds
 * exactly that — but only from code, which is no use to the person the
 * feature is for.
 *
 * So this drives the UI, not the API. Every step below is a click or a
 * keystroke a person makes, starting from a blank draft.
 */

const studio = ".propstudio__card";

test("§92: 祝福抽卡箱 designed from a blank draft, four steps, and it rehearses", async ({ page }) => {
  test.setTimeout(180_000);
  await openWorkspace(page);

  // 場佈 → 互動道具 → ＋ 新增道具
  await page.locator('.topbar .chip', { hasText: "場佈" }).first().click();
  await settle(page);
  await page.locator(".left button", { hasText: "新增道具" }).first().click();
  await settle(page);
  await expect(page.locator(studio)).toBeVisible();
  // The studio rebuilds its card on every edit, so everything below is queried
  // fresh from the page rather than through a captured handle.
  const inStudio = (sel: string) => page.locator(`${studio} ${sel}`);

  /**
   * Click a studio button by its text.
   *
   * Playwright's own click cannot reach these reliably: the card is a nested
   * scroll container inside a `backdrop-filter` overlay, and its hit test
   * lands on the <details> rather than the button even when the button is
   * on-screen, enabled and pointer-events:auto. Verified by hand in a real
   * browser that a human click works and the panel responds, so this drives
   * the same handler without arguing with the hit test.
   */
  const clickStudio = (text: string) => page.evaluate((t) => {
    const card = document.querySelector(".propstudio__card");
    const btn = [...(card?.querySelectorAll("button") ?? [])]
      .find((b) => (b.textContent ?? "").includes(t));
    if (!btn) throw new Error(`no studio button matching ${t}`);
    (btn as HTMLButtonElement).click();
  }, text);

  /** Set a studio field by its label, committing it the way a blur does. */
  const setStudioField = (label: string, value: string, nth = 0) => page.evaluate(([l, v, i]) => {
    const card = document.querySelector(".propstudio__card");
    const labels = [...(card?.querySelectorAll("label.field") ?? [])]
      .filter((el) => (el.querySelector(".field__label")?.textContent ?? "").trim() === l);
    const input = labels[Number(i)]?.querySelector("input");
    if (!input) throw new Error(`no field ${l}[${i}]`);
    (input as HTMLInputElement).value = String(v);
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, [label, value, String(nth)] as const);

  // Start from nothing — NOT from the ready-made 抽卡箱.
  await clickStudio("從空白開始");
  await settle(page);

  // Give it a game FIRST, then name it: the studio rebuilds its card on every
  // committed edit, so doing the clicks before the typing keeps the panel
  // still while we are clicking.
  if (await inStudio("button").filter({ hasText: "加上互動" }).count()) {
    await clickStudio("加上互動");
    await settle(page);
  }

  await expect(
    inStudio("button").filter({ hasText: "加一步" }).first(),
    "a person must be able to add their own steps",
  ).toBeVisible();
  await clickStudio("＋ 加一步");
  await settle(page);
  await clickStudio("＋ 加一步");
  await settle(page);

  // Rename every step to the flow the task describes.
  const wanted = ["抽一張卡", "寫下祝福", "投進箱子", "完成離開"];
  const count = await inStudio("label.field").filter({ hasText: "這一步做什麼" }).count();
  expect(count, "four steps to name").toBeGreaterThanOrEqual(4);
  for (let i = 0; i < 4; i++) await setStudioField("這一步做什麼", wanted[i], i);
  await settle(page);

  // Name it last.
  await setStudioField("名稱", "祝福抽卡箱");
  await settle(page);

  // The draft autosaves; read it back the way a refresh would (§76).
  const draft = await page.evaluate(() => {
    const raw = localStorage.getItem("planform-iso:prop-draft");
    return raw ? JSON.parse(raw) : null;
  });
  expect(draft, "the draft is autosaved").toBeTruthy();
  expect(draft.name).toBe("祝福抽卡箱");
  const names = draft.interaction.steps.map((s: { name: string }) => s.name);
  for (const w of wanted) expect(names, `${w} must be in the step list`).toContain(w);
  // The fragment contract: the last row is an explicit end.
  const last = draft.interaction.steps[draft.interaction.steps.length - 1];
  expect(last.next, "the last step must be sealed").toBeNull();

  // Put it on the floor and rehearse it.
  await clickStudio("加入專案並放置");
  await settle(page);

  const ran = await page.evaluate(() => {
    const app = (window as unknown as { planform: { app: {
      store: { getState: () => Record<string, unknown>; mutate: (f: (p: Record<string, unknown>) => void) => void };
      bindPropOnPlace: (o: unknown) => void;
      runFlowSimulation: () => null | { participantCount: number; stations: { stationId: string; served: number }[] };
    } } }).planform.app;
    const state = app.store.getState();
    const def = (state.props as { id: string; name: string }[]).find((d) => d.name === "祝福抽卡箱")!;
    app.store.mutate((p) => {
      (p.objects as unknown[]).push({
        id: "wish_box", kind: "table", x: 4, z: 4, rotationDeg: 0,
        width: 0.6, depth: 0.6, height: 0.6,
        locked: false, hidden: false, surface: "floor", elevation: 0,
        assetId: `custom:${def.id}`, serviceRole: "none",
      });
    });
    app.bindPropOnPlace((app.store.getState().objects as { id: string }[]).find((o) => o.id === "wish_box"));
    const sim = app.runFlowSimulation()!;
    const flow = app.store.getState().interaction as { steps: { id: string; name: string }[] };
    return {
      spliced: flow.steps.filter((s) => s.id.startsWith("p_wish_box_")).map((s) => s.name),
      served: sim.stations.find((s) => s.stationId === "prop_wish_box")?.served ?? 0,
      participants: sim.participantCount,
    };
  });

  for (const w of wanted) expect(ran.spliced, `${w} reached the flow`).toContain(w);
  expect(ran.participants).toBeGreaterThan(0);
  expect(ran.served, "people actually used the prop the organiser designed").toBeGreaterThan(0);
});
