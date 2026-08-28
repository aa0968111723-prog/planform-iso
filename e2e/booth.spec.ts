/**
 * 攤位模擬 end-to-end — the outdoor booth flow in a real browser.
 *
 * Covers the acceptance list in BOOTH_SIMULATION_SPEC.md §9: build the pitch
 * from Quick Start, edit it, draw a flow, run the crowd, switch views, export
 * and reload — at phone, tablet and desktop widths.
 */

import { expect, test, type Page } from "@playwright/test";
import { settle } from "./helpers";

interface BoothProbe {
  objects: { assetId?: string; x: number; z: number; rotationDeg: number; width: number }[];
  zones: { boothRole?: string; name: string }[];
  routes: { name: string; points: { x: number; z: number }[] }[];
  stations: { name: string; enabled?: boolean }[];
  scenarioId: string | null;
  view: string;
}

/** Build the booth the way a user does: Quick Start → 戶外攤位. */
async function openBooth(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Wipe on the first load only, so a later reload behaves like a returning
    // user whose project is still on disk.
    if (!sessionStorage.getItem("e2e-booth-fresh")) {
      sessionStorage.setItem("e2e-booth-fresh", "1");
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("planform-iso:")) localStorage.removeItem(key);
      }
    }
    localStorage.setItem("planform-iso:boot", "editor");
  });
  await page.goto("/");
  await page.waitForFunction(() => !!(window as unknown as { planform?: unknown }).planform);
  // The wizard is three steps since the multi-project system landed: name the
  // event, pick where it is, say how many people. This helper had been left on
  // the old single-screen version and stopped reaching the booth at all.
  const card = page.locator(".quickstart__card");
  await expect(card.locator(".quickstart__title")).toHaveText("這場活動叫什麼？");
  await card.locator(".quickstart__name").fill("擺攤測試");
  await card.locator("button", { hasText: "下一步：選場地" }).click();
  await expect(card.locator(".quickstart__title")).toHaveText("在哪裡辦？");
  // A booth needs no 「這次活動需要什麼？」 step — picking the pitch is enough,
  // so the wizard creates the project there and then.
  await card.locator("button", { hasText: "戶外攤位" }).click();
  await settle(page);
}

/** 模擬 lives in the bottom nav on compact layouts and the header on desktop. */
async function gotoSim(page: Page): Promise<void> {
  const nav = page.locator('.navbtn[data-nav="sim"]');
  if (await nav.isVisible()) await nav.click();
  else await page.locator(".group--flows button", { hasText: "模擬" }).click();
  await settle(page);
}

function probe(page: Page): Promise<BoothProbe> {
  return page.evaluate(() => {
    const s = (window as unknown as {
      planform: { store: { getState: () => Record<string, unknown> } };
    }).planform.store.getState() as unknown as {
      objects: { assetId?: string; x: number; z: number; rotationDeg: number; width: number }[];
      zones: { boothRole?: string; name: string }[];
      routes: { name: string; points: { x: number; z: number }[] }[];
      booth?: { stations: { name: string; enabled?: boolean }[]; scenarioId: string };
      view: string;
    };
    return {
      objects: s.objects.map((o) => ({ assetId: o.assetId, x: o.x, z: o.z, rotationDeg: o.rotationDeg, width: o.width })),
      zones: s.zones.map((z) => ({ boothRole: z.boothRole, name: z.name })),
      routes: s.routes.map((r) => ({ name: r.name, points: r.points.map((p) => ({ x: p.x, z: p.z })) })),
      stations: (s.booth?.stations ?? []).map((st) => ({ name: st.name, enabled: st.enabled })),
      scenarioId: s.booth?.scenarioId ?? null,
      view: s.view,
    };
  });
}

test.describe("outdoor booth", () => {
  test.use({ viewport: { width: 1366, height: 1024 } });

  test("the template builds a tent, a table, zones, flows and stations", async ({ page }) => {
    await openBooth(page);
    const p = await probe(page);
    expect(p.objects.filter((o) => o.assetId === "custom:booth-tent")).toHaveLength(1);
    expect(p.objects.filter((o) => o.assetId === "custom:tent-leg")).toHaveLength(4);
    expect(p.objects.filter((o) => o.assetId === "custom:booth-table")).toHaveLength(1);
    expect(p.zones.map((z) => z.boothRole)).toContain("queue");
    expect(p.routes).toHaveLength(4);
    expect(p.stations).toHaveLength(8);
    expect(p.scenarioId).toBe("normal");
  });

  test("the bottom nav grows a 模擬 slot only for a booth plan", async ({ page }) => {
    await openBooth(page);
    await expect(page.locator('.navbtn[data-nav="sim"]')).toHaveCount(1);
    await expect(page.locator(".navbtn")).toHaveCount(5);

    // Strip the booth data and the slot goes away again.
    await page.evaluate(() => {
      const pf = (window as unknown as {
        planform: { store: { mutate(fn: (p: Record<string, unknown>) => void): void } };
      }).planform;
      pf.store.mutate((p) => { delete p.booth; });
    });
    await expect(page.locator(".navbtn")).toHaveCount(4);
    await expect(page.locator('.navbtn[data-nav="sim"]')).toHaveCount(0);
  });

  test("moving and rotating the booth table updates the plan", async ({ page }) => {
    await openBooth(page);
    const before = (await probe(page)).objects.find((o) => o.assetId === "custom:booth-table")!;
    await page.evaluate(() => {
      const pf = (window as unknown as {
        planform: {
          app: {
            store: { getState(): { objects: { id: string; assetId?: string }[] } };
            setSelection(ids: string[]): void;
            nudgeSelection(dx: number, dz: number): void;
            rotateSelection(deg: number): void;
          };
        };
      }).planform;
      const table = pf.app.store.getState().objects.find((o) => o.assetId === "custom:booth-table")!;
      pf.app.setSelection([table.id]);
      pf.app.nudgeSelection(0.5, 0);
      pf.app.rotateSelection(90);
    });
    const after = (await probe(page)).objects.find((o) => o.assetId === "custom:booth-table")!;
    expect(after.x).toBeCloseTo(before.x + 0.5, 5);
    expect(after.rotationDeg).toBe(90);
  });

  test("running the simulation puts people on the canvas and moves the numbers", async ({ page }) => {
    await openBooth(page);
    await gotoSim(page);
    // One panel for every plan: the booth's own steps, not a check-in desk.
    await expect(page.locator(".left")).toContainText("互動流程");

    await page.locator(".left button", { hasText: "▶ 演練一次" }).click();
    // The numbers land first.
    await expect(page.locator(".left")).toContainText("全部完成");
    await expect
      .poll(() => page.evaluate(() => (window as unknown as {
        planform: { app: { session: { simResult: { completed: number } | null } } };
      }).planform.app.session.simResult?.completed ?? 0), { timeout: 15_000 })
      .toBeGreaterThan(0);

    // Then the walk-through puts people on the canvas.
    await page.locator(".left button", { hasText: "▶ 播放走位" }).click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as {
        planform: { app: { session: { simPositions: unknown[] } } };
      }).planform.app.session.simPositions.length), { timeout: 15_000 })
      .toBeGreaterThan(0);
    await page.locator(".left button", { hasText: "⏸ 暫停" }).click();
    await expect(page.locator(".left button", { hasText: "繼續" })).toBeVisible();
  });

  test("more people passing means a longer queue on the same layout", async ({ page }) => {
    await openBooth(page);
    // The old 正常／尖峰 chips were a booth-only concept. The same question is
    // now asked of any plan by changing the crowd: it is one editable number.
    const compared = await page.evaluate(() => {
      const pf = (window as unknown as {
        planform: {
          app: {
            updateFlowAudience(patch: { count: number }): void;
            runFlowSimulation(): { maxQueue: number; leftEarly: number } | null;
            flowTemplate(): { audience: { count: number } } | null;
          };
        };
      }).planform;
      const before = pf.app.flowTemplate()!.audience.count;
      const quiet = pf.app.runFlowSimulation();
      pf.app.updateFlowAudience({ count: before * 3 });
      const busy = pf.app.runFlowSimulation();
      return { quiet, busy };
    });
    expect(compared.quiet).not.toBeNull();
    expect(compared.busy!.maxQueue).toBeGreaterThan(compared.quiet!.maxQueue);
    expect(compared.busy!.leftEarly).toBeGreaterThanOrEqual(compared.quiet!.leftEarly);
  });

  test("editing a step changes the simulation, not just the panel", async ({ page }) => {
    await openBooth(page);
    await gotoSim(page);
    const moved = await page.evaluate(() => {
      const pf = (window as unknown as {
        planform: {
          app: {
            flowTemplate(): { steps: { id: string; name: string; avgSeconds: number }[] } | null;
            updateFlowStep(id: string, patch: { avgSeconds: number }): void;
            runFlowSimulation(): { avgWaitSeconds: number; maxQueue: number } | null;
          };
        };
      }).planform;
      const before = pf.app.runFlowSimulation()!;
      // Whatever the plan's slowest step is, tripling it has to show up.
      const slowest = [...pf.app.flowTemplate()!.steps]
        .sort((a, b) => b.avgSeconds - a.avgSeconds)[0];
      pf.app.updateFlowStep(slowest.id, { avgSeconds: slowest.avgSeconds * 3 });
      const after = pf.app.runFlowSimulation()!;
      return { before, after, step: slowest.name };
    });
    // Tripling how long a step takes has to show up in the queue.
    expect(moved.step, "the booth plan arrives with its own steps").toBeTruthy();
    expect(moved.after.avgWaitSeconds).toBeGreaterThan(moved.before.avgWaitSeconds);
  });

  test("夥伴模式 rehearses the booth's own steps and writes nothing into the plan", async ({ page }) => {
    await openBooth(page);
    const before = await page.evaluate(() => {
      const s = (window as unknown as {
        planform: { store: { getState(): { scenarios: unknown[]; interaction?: { stations: { name: string }[] } } } };
      }).planform.store.getState();
      return { scenarios: s.scenarios.length, stations: s.interaction?.stations.map((st) => st.name) ?? [] };
    });
    expect(before.stations.length).toBeGreaterThan(0);

    const rehearsal = await page.evaluate(() => {
      const pf = (window as unknown as {
        planform: {
          app: {
            enterPartnerMode?(): void;
            runRehearsal(): { text: string }[];
            partnerBriefing(): { flowSummary?: string };
          };
          store: { getState(): { scenarios: unknown[] } };
        };
      }).planform;
      const timeline = pf.app.runRehearsal();
      return {
        brief: pf.app.partnerBriefing().flowSummary ?? "",
        timeline: timeline.map((e) => e.text).join(" | "),
        scenariosAfter: pf.store.getState().scenarios.length,
      };
    });

    // The brief names the plan's own stations, not an invented check-in desk.
    for (const station of before.stations) {
      expect(rehearsal.brief, `the brief must name ${station}`).toContain(station);
    }
    expect(rehearsal.brief).not.toContain("報到");
    expect(rehearsal.timeline).not.toContain("報到");
    // And the rehearsal must not leave a fabricated 進場流程 behind in the plan.
    expect(rehearsal.scenariosAfter).toBe(before.scenarios);
  });

  test("俯視 ↔ 立體 changes the camera, not the plan", async ({ page }) => {
    await openBooth(page);
    const snapshot = () => page.evaluate(() => {
      const s = (window as unknown as {
        planform: { store: { getState: () => Record<string, unknown> } };
      }).planform.store.getState();
      const copy = { ...s } as Record<string, unknown>;
      delete copy.view;
      return JSON.stringify(copy);
    });
    const before = await snapshot();
    await page.evaluate(() => (window as unknown as {
      planform: { app: { setView(v: string): void } };
    }).planform.app.setView("top"));
    await page.waitForTimeout(150);
    expect(await snapshot()).toEqual(before);
    expect((await probe(page)).view).toBe("top");

    await page.evaluate(() => (window as unknown as {
      planform: { app: { setView(v: string): void } };
    }).planform.app.setView("iso"));
    await page.waitForTimeout(150);
    expect(await snapshot()).toEqual(before);
  });

  test("the tent canopy comes off in the top view so the table can be picked", async ({ page }) => {
    await openBooth(page);
    const roofVisible = () => page.evaluate(() => {
      let total = 0;
      let visible = 0;
      const scene = (window as unknown as {
        planform: { app: { scene: { scene: { traverse(cb: (o: unknown) => void): void } } } };
      }).planform.app.scene.scene;
      scene.traverse((o) => {
        const node = o as { userData?: { roof?: boolean }; visible?: boolean };
        if (!node.userData?.roof) return;
        total += 1;
        if (node.visible) visible += 1;
      });
      return { total, visible };
    });
    await page.evaluate(() => (window as unknown as {
      planform: { app: { setView(v: string): void } };
    }).planform.app.setView("iso"));
    await page.waitForTimeout(150);
    const iso = await roofVisible();
    expect(iso.total).toBeGreaterThan(0);
    expect(iso.visible).toBe(iso.total);

    await page.evaluate(() => (window as unknown as {
      planform: { app: { setView(v: string): void } };
    }).planform.app.setView("top"));
    await page.waitForTimeout(150);
    const top = await roofVisible();
    expect(top.total).toBe(iso.total);
    expect(top.visible).toBe(0);
  });

  test("the plan survives a reload", async ({ page }) => {
    await openBooth(page);
    const before = await probe(page);
    await page.waitForTimeout(600); // let autosave land
    await page.reload();
    await page.waitForFunction(() => !!(window as unknown as { planform?: unknown }).planform);
    await settle(page);
    const after = await probe(page);
    expect(after.objects).toHaveLength(before.objects.length);
    expect(after.zones.map((z) => z.boothRole)).toEqual(before.zones.map((z) => z.boothRole));
    expect(after.routes).toHaveLength(before.routes.length);
    expect(after.stations).toHaveLength(8);
  });
});

test.describe("outdoor booth on small screens", () => {
  for (const [label, viewport] of [
    ["phone", { width: 390, height: 844 }],
    ["tablet", { width: 820, height: 1180 }],
  ] as const) {
    test(`${label}: header does not overflow and the 模擬 tab opens`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await openBooth(page);
      const overflow = await page.evaluate(() => {
        const header = document.querySelector(".topbar")!;
        return header.scrollWidth - header.clientWidth;
      });
      expect(overflow).toBeLessThanOrEqual(1);

      await gotoSim(page);
      await expect(page.locator(".left")).toContainText("互動流程");
      const navBox = await page.locator(".bottomnav").boundingBox();
      expect(navBox!.height).toBeGreaterThanOrEqual(44);
    });
  }
});
