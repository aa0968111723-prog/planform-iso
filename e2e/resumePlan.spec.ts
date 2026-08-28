/**
 * Coming back to a plan must not quietly change it.
 *
 * The app resumes straight into the editor after a refresh — a 場務組 volunteer
 * who reloads mid-setup wants their plan back, not a list. That resume path
 * used not to seed the session from the plan, so the panel silently held the
 * class DEFAULTS (陸續到 / 20 分 / 報到 1 人) while the plan on disk said
 * 快開始才到 / 15 分 / 報到 2 人 — and the first press of ▶ 模擬 wrote the
 * defaults back over the shipped example. On disk.
 *
 * Measured on the golden at the time: average wait 392 s → 760 s, peak queue
 * 20 → 34, finish 1507 s → 2839 s. Nothing on screen said anything had changed.
 */

import { expect, test, type Page } from "@playwright/test";

interface ScenarioProbe {
  arrivalProfile: string;
  arrivalWindowSeconds: number;
  checkinStaff: number | undefined;
  participantCount: number;
}

interface QuickProbe {
  arrivalProfile: string;
  arrivalWindowSeconds: number;
  checkinStaff: number;
  participants: number;
}

const readScenario = (page: Page): Promise<ScenarioProbe> => page.evaluate(() => {
  const s = (window as unknown as {
    planform: { store: { getState(): {
      scenarios: {
        arrivalProfile: string; arrivalWindowSeconds: number; participantCount: number;
        stations: { type: string; staffCount: number }[];
      }[];
    } } };
  }).planform.store.getState();
  const scn = s.scenarios[0];
  return {
    arrivalProfile: scn.arrivalProfile,
    arrivalWindowSeconds: scn.arrivalWindowSeconds,
    checkinStaff: scn.stations.find((st) => st.type === "checkin")?.staffCount,
    participantCount: scn.participantCount,
  };
});

const readQuick = (page: Page): Promise<QuickProbe> => page.evaluate(() => {
  const q = (window as unknown as {
    planform: { app: { session: { simQuick: QuickProbe; participants: number } } };
  }).planform.app.session;
  return { ...q.simQuick, participants: q.participants } as QuickProbe;
});

async function openGolden(page: Page): Promise<void> {
  // Wipe on the FIRST load only — the reload below has to behave like a real
  // returning user, whose plan is still on disk.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("e2e-resume-fresh")) {
      sessionStorage.setItem("e2e-resume-fresh", "1");
      localStorage.clear();
    }
  });
  await page.goto("/");
  await page.waitForFunction(() => !!(window as unknown as { planform?: unknown }).planform);
  const card = page.locator(".quickstart__card");
  await card.locator(".quickstart__name").fill("E310 續用測試");
  await card.getByRole("button", { name: /下一步：選場地/ }).click();
  await card.getByRole("button", { name: /直接用 E310 演講範例/ }).click();
  await page.waitForSelector(".quickstart", { state: "detached" });
}

test.describe("resuming a plan after a reload", () => {
  test("the session takes the plan's own numbers, and ▶ does not rewrite them", async ({ page }) => {
    await openGolden(page);
    const authored = await readScenario(page);
    // What the shipped example is authored as. If these ever change, the rest
    // of this test is still meaningful — it compares against whatever shipped.
    expect(authored.arrivalProfile).toBe("front-loaded");
    expect(authored.participantCount).toBe(60);

    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as { planform?: unknown }).planform);
    // Resumed straight into the editor, not thrown back to the project list.
    await expect(page.locator(".projhome")).toBeHidden();

    const quick = await readQuick(page);
    expect(quick.arrivalProfile).toBe(authored.arrivalProfile);
    expect(quick.arrivalWindowSeconds).toBe(authored.arrivalWindowSeconds);
    expect(quick.checkinStaff).toBe(authored.checkinStaff);
    expect(quick.participants).toBe(authored.participantCount);

    // And the run must not write the session's idea of the event over the plan.
    await page.evaluate(() => (window as unknown as {
      planform: { app: { startSimulation(): void } };
    }).planform.app.startSimulation());
    await page.waitForTimeout(300);
    expect(await readScenario(page)).toEqual(authored);
  });

  test("resuming leaves the volunteer where they were, not in 場佈", async ({ page }) => {
    await openGolden(page);
    await page.evaluate(() => (window as unknown as {
      planform: { app: { setWorkflow(w: string): void } };
    }).planform.app.setWorkflow("route"));
    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as { planform?: unknown }).planform);
    // Seeding the session must not drag the navigation half with it: the
    // resume path deliberately does not shove people into 場佈.
    const workflow = await page.evaluate(() => (window as unknown as {
      planform: { app: { session: { workflow: string } } };
    }).planform.app.session.workflow);
    expect(workflow).not.toBe("layout");
  });
});
