import { expect, test, type Page } from "@playwright/test";
import { openWorkspace, settle } from "./helpers";

/**
 * §94 says 「加入攤位」 — the dice station joins a BOOTH, and that matters to
 * the test rather than being scene-setting. A flow with one station has no
 * journey in it: everybody arrives, queues, is served, leaves, and moving the
 * station changes literally nothing, correctly. The claim
 * 「Simulation 結果跟著改變」 is only meaningful once there is somewhere else
 * to walk from. So this builds the pitch the way a person does.
 */
async function openBooth(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("planform-iso:")) localStorage.removeItem(key);
    }
    localStorage.setItem("planform-iso:boot", "editor");
  });
  await page.goto("/");
  await page.waitForFunction(() => !!(window as unknown as { planform?: unknown }).planform);
  const card = page.locator(".quickstart__card");
  await expect(card.locator(".quickstart__title")).toHaveText("這場活動叫什麼？");
  await card.locator(".quickstart__name").fill("城市微光攤位");
  await card.locator("button", { hasText: "下一步：選場地" }).click();
  await expect(card.locator(".quickstart__title")).toHaveText("在哪裡辦？");
  await card.locator("button", { hasText: "戶外攤位" }).click();
  await settle(page);
}

/**
 * §94 and §95 — the two flows the brief uses as its acceptance test, driven
 * end to end in a real browser.
 *
 * These go through the app's own API rather than clicking every chip: the unit
 * suite already pins the arithmetic, and what is worth proving here is that
 * the WHOLE CHAIN holds in a real engine with a real scene — a definition
 * becomes a catalog entry becomes a placed object becomes a station becomes
 * people queuing, and moving the thing changes the numbers. Clicking would
 * test the DOM; this tests the plumbing between subsystems, which is where
 * every defect in this feature has actually lived. The 場刊 at the end IS
 * clicked, because that is the one step whose output a person looks at.
 *
 * Both props are authored inline. §95 requires it (「完全不用內建 Interactive
 * Template」), and §94 says 「自訂大型骰子」 — so neither test is allowed to
 * lean on a preset, and neither does.
 */

/** The dice a person would build in the Studio: six faces, six questions. */
const GOLDEN_DICE = {
  id: "prop_golden_dice",
  name: "城市微光骰子",
  category: "互動",
  dimensions: { width: 0.6, depth: 0.6, height: 0.6 },
  parts: [{
    id: "cube", shape: "box",
    size: { width: 0.6, depth: 0.6, height: 0.6 },
    offset: { x: 0, y: 0, z: 0 },
    color: "#f4f4f5", finish: "plastic-matte", facesFromOptions: true,
  }],
  anchors: [
    { id: "player", role: "player", x: 0, z: 0.9 },
    { id: "staff", role: "staff", x: 0.9, z: 0.3 },
    { id: "queue", role: "queue", x: 0, z: 1.6, facingDeg: 0 },
    { id: "exit", role: "exit", x: -1.2, z: 0.6 },
  ],
  interaction: {
    steps: [
      {
        id: "roll", name: "擲骰子", avgSeconds: 15, prompt: "擲出你的題目",
        branch: {
          kind: "chance", record: "face",
          options: ["認識自己", "家人", "朋友", "夢想", "城市", "自由"].map((q, i) => ({
            id: `f${i + 1}`, label: `${i + 1} ${q}`, weight: 1,
            color: ["#38bdf8", "#34d399", "#fbbf24", "#f472b6", "#a78bfa", "#fb923c"][i],
            prompt: `聊聊「${q}」`,
          })),
        },
      },
      { id: "talk", name: "依骰面對談", avgSeconds: 90, next: null },
    ],
    station: { meanServiceSeconds: 105, parallelServers: 1, queueCapacity: 6 },
    staffRole: { name: "骰子站", count: 1 },
    skipRate: 0.35,
  },
  clearance: 1.2, interactionZone: 1.2, icon: "🎲", version: 1, source: "user",
};

/** §95: no preset is consulted anywhere in this definition. */
const WISH_WALL = {
  id: "prop_wishwall",
  name: "祝福留言牆",
  category: "互動",
  dimensions: { width: 1.6, depth: 0.4, height: 1.8 },
  parts: [
    { id: "board", shape: "box", size: { width: 1.6, depth: 0.08, height: 1.4 },
      offset: { x: 0, y: 0.4, z: 0 }, color: "#fef3c7", finish: "paper" },
    { id: "title", shape: "plane", size: { width: 1.2, depth: 0.02, height: 0.25 },
      offset: { x: 0, y: 1.5, z: 0.06 }, color: "#fde68a", text: "祝福留言牆" },
    { id: "desk", shape: "box", size: { width: 0.8, depth: 0.4, height: 0.74 },
      offset: { x: 0, y: 0, z: 0.6 }, color: "#c8b6a6", finish: "light-wood" },
  ],
  anchors: [
    { id: "player", role: "player", x: 0, z: 1.0 },
    { id: "staff", role: "staff", x: 1.0, z: 0.3 },
    { id: "queue", role: "queue", x: 0, z: 1.8, facingDeg: 0 },
    { id: "exit", role: "exit", x: -1.2, z: 0.6 },
  ],
  interaction: {
    steps: [
      { id: "approach", name: "靠近", avgSeconds: 5 },
      { id: "write", name: "寫卡片", avgSeconds: 60, prompt: "寫下你想說的話" },
      { id: "stick", name: "貼到牆上", avgSeconds: 15 },
      { id: "done", name: "完成", avgSeconds: 5, next: null },
    ],
    station: { meanServiceSeconds: 85, parallelServers: 2, queueCapacity: 8 },
    staffRole: { name: "留言牆", count: 1 },
    skipRate: 0.4,
  },
  clearance: 1.0, icon: "💌", version: 1, source: "user",
};

/** A plain table and a board, so §94 has something to group the dice with. */
const PLAIN = (id: string, name: string, w: number, d: number, h: number, color: string) => ({
  id, name, category: "傢俱",
  dimensions: { width: w, depth: d, height: h },
  parts: [{
    id: "body", shape: "box", size: { width: w, depth: d, height: h },
    offset: { x: 0, y: 0, z: 0 }, color,
  }],
  anchors: [], icon: "▦", version: 1, source: "user",
});

interface PageApp {
  addPropToProject: (def: unknown, opts?: { place?: boolean }) => void;
  groupSelectionIntoProp: (name?: string) => unknown;
  setSelection: (ids: string[]) => void;
  bindPropOnPlace: (obj: unknown) => void;
  runFlowSimulation: () => null | {
    finishTimeSeconds: number;
    participantCount: number;
    stations: { stationId: string; served: number }[];
    playback: { t: number; results?: Record<string, { label: string; serial: number }> }[];
  };
  propAnchorGuide: (id: string) => null | { name: string; lines: { role: string; text: string }[] };
  store: {
    getState: () => Record<string, unknown>;
    mutate: (fn: (p: Record<string, unknown>) => void) => void;
  };
}

test.describe("§94 golden: build a dice station, rehearse it, move it", () => {
  test("the whole chain, and the numbers follow the prop", async ({ page }) => {
    await openBooth(page);

    // --- 加入自訂大型骰子（六面設定內容）＋桌子＋題目板 -------------------
    const built = await page.evaluate((defs) => {
      const app = (window as unknown as { planform: { app: PageApp } }).planform.app;
      for (const d of defs) app.addPropToProject(d, { place: false });
      const place = (id: string, assetId: string, x: number, z: number, s: number[]) => {
        app.store.mutate((p) => {
          (p.objects as unknown[]).push({
            id, kind: "table", x, z, rotationDeg: 0,
            width: s[0], depth: s[1], height: s[2],
            locked: false, hidden: false, surface: "floor", elevation: 0,
            assetId, serviceRole: "none",
          });
        });
        app.bindPropOnPlace((app.store.getState().objects as { id: string }[]).find((o) => o.id === id));
      };
      place("g_dice", "custom:prop_golden_dice", 4, 4, [0.6, 0.6, 0.6]);
      place("g_table", "custom:prop_g_table", 4.8, 4, [1.2, 0.6, 0.74]);
      place("g_board", "custom:prop_g_board", 3.2, 4, [0.9, 0.1, 1.2]);
      const s = app.store.getState();
      return {
        props: (s.props as { id: string }[]).map((d) => d.id),
        objects: (s.objects as { id: string }[]).filter((o) => o.id.startsWith("g_")).map((o) => o.id),
        stations: (s.interaction as { stations: { id: string }[] } | undefined)?.stations.map((x) => x.id) ?? [],
      };
    }, [
      GOLDEN_DICE,
      PLAIN("prop_g_table", "活動桌", 1.2, 0.6, 0.74, "#c8b6a6"),
      PLAIN("prop_g_board", "題目板", 0.9, 0.1, 1.2, "#f8fafc"),
    ] as unknown[]);

    expect(built.props).toContain("prop_golden_dice");
    expect(built.objects).toEqual(["g_dice", "g_table", "g_board"]);
    expect(built.stations, "the dice became a station on placement").toContain("prop_g_dice");

    // --- 群組成骰子站，Player / Staff / Queue / Exit -----------------------
    const grouped = await page.evaluate(() => {
      const app = (window as unknown as { planform: { app: PageApp } }).planform.app;
      app.setSelection(["g_dice", "g_table", "g_board"]);
      app.groupSelectionIntoProp("城市微光骰子站");
      const s = app.store.getState();
      const objs = s.objects as { id: string; assetId?: string }[];
      const station = objs.find((o) => (o.assetId ?? "").includes("prop_asm"));
      return {
        remaining: objs.filter((o) => o.id.startsWith("g_")).length,
        id: station?.id ?? null,
        guide: station ? app.propAnchorGuide(station.id) : null,
        zombies: ((s.interaction as { stations: { objectId?: string }[] } | undefined)?.stations ?? [])
          .filter((st) => st.objectId && !objs.some((o) => o.id === st.objectId)).length,
      };
    });

    expect(grouped.remaining, "the three originals are absorbed").toBe(0);
    expect(grouped.id).toBeTruthy();
    expect(grouped.zombies, "no station left pointing at a deleted object").toBe(0);
    expect(grouped.guide?.name).toBe("城市微光骰子站");
    expect(grouped.guide?.lines.map((l) => l.role)).toEqual(["staff", "player", "queue", "exit"]);
    for (const line of grouped.guide!.lines) {
      expect(line.text, "plain words, never coordinates").not.toMatch(/[xz]\s*[:=]|-?\d+\.\d{2}/);
    }

    // --- 開始彩排：排隊 → 擲骰 → 顯示結果 → 對談 → 離開 ------------------
    const first = await page.evaluate((objectId: string) => {
      const app = (window as unknown as { planform: { app: PageApp } }).planform.app;
      const r = app.runFlowSimulation()!;
      // ONLY this station's rolls: a booth has chance steps of its own, and
      // picking those up would prove nothing about the dice.
      const mine = r.playback
        .map((f) => f.results?.[`prop_${objectId}`])
        .filter((x): x is { label: string; serial: number } => !!x);
      return {
        finish: r.finishTimeSeconds,
        participants: r.participantCount,
        served: r.stations.find((s) => s.stationId === `prop_${objectId}`)?.served ?? 0,
        labels: [...new Set(mine.map((x) => x.label))],
        maxSerial: Math.max(0, ...mine.map((x) => x.serial)),
      };
    }, grouped.id!);

    expect(first.participants, "people turned up").toBeGreaterThan(0);
    expect(first.served, "they queued and were served").toBeGreaterThan(0);
    expect(first.labels.length, "the dice produced varied faces").toBeGreaterThan(1);
    for (const l of first.labels) expect(l).toMatch(/認識自己|家人|朋友|夢想|城市|自由/);
    expect(first.maxSerial, "many rolls, not one frozen result").toBeGreaterThan(1);

    // --- 移動骰子站 → 再彩排 → Simulation 結果跟著改變 -------------------
    const second = await page.evaluate((objectId: string) => {
      const app = (window as unknown as { planform: { app: PageApp } }).planform.app;
      app.store.mutate((p) => {
        const o = (p.objects as { id: string; x: number; z: number }[]).find((x) => x.id === objectId)!;
        o.x = 1.2;
        o.z = 1.2;
      });
      const r = app.runFlowSimulation()!;
      return { finish: r.finishTimeSeconds, participants: r.participantCount };
    }, grouped.id!);

    expect(second.participants).toBe(first.participants);
    expect(
      second.finish,
      `moving the station must change the run (was ${first.finish}, now ${second.finish})`,
    ).not.toBeCloseTo(first.finish, 2);

    // --- 場刊圖輸出 (clicked, because a person looks at this one) ----------
    // 分享 is a topbar chip on desktop and a bottom-nav slot on a phone; this
    // suite runs desktop, so take the chip.
    await page.locator(".topbar .chip", { hasText: "分享" }).first().click();
    await settle(page);
    const dl = page.waitForEvent("download");
    await page.locator(".left button", { hasText: "場佈總覽圖" }).click();
    expect((await dl).suggestedFilename()).toContain("場佈總覽");
  });
});

test.describe("§95 golden: a prop built from scratch, no built-in template", () => {
  test("祝福留言牆 — three parts, four steps, people rehearse it normally", async ({ page }) => {
    await openWorkspace(page);

    const result = await page.evaluate((wall) => {
      const app = (window as unknown as { planform: { app: PageApp } }).planform.app;
      app.addPropToProject(wall, { place: false });
      app.store.mutate((p) => {
        (p.objects as unknown[]).push({
          id: "wish1", kind: "table", x: 5, z: 5, rotationDeg: 0,
          width: 1.6, depth: 0.4, height: 1.8,
          locked: false, hidden: false, surface: "floor", elevation: 0,
          assetId: "custom:prop_wishwall", serviceRole: "none",
        });
      });
      app.bindPropOnPlace((app.store.getState().objects as { id: string }[]).find((o) => o.id === "wish1"));

      const sim = app.runFlowSimulation()!;
      const flow = app.store.getState().interaction as { steps: { id: string; name: string }[] };
      return {
        stepNames: flow.steps.filter((s) => s.id.startsWith("p_wish1_")).map((s) => s.name),
        served: sim.stations.find((s) => s.stationId === "prop_wish1")?.served ?? 0,
        participants: sim.participantCount,
        guide: app.propAnchorGuide("wish1"),
        anyResults: sim.playback.some((f) => f.results),
      };
    }, WISH_WALL as unknown);

    expect(result.stepNames).toEqual(["靠近", "寫卡片", "貼到牆上", "完成"]);
    expect(result.participants).toBeGreaterThan(0);
    expect(result.served, "people rehearsed the wall normally").toBeGreaterThan(0);
    expect(result.guide?.name).toBe("祝福留言牆");
    expect(result.guide?.lines).toHaveLength(4);
    // No chance fork anywhere in this prop, so no result record is allocated —
    // the field is optional precisely so a non-forking prop costs nothing.
    expect(result.anyResults).toBe(false);
  });
});

test.describe("§80 performance contract", () => {
  test("10 interactive props and 100 participants stay interactive", async ({ page }) => {
    await openWorkspace(page);

    const perf = await page.evaluate((dice) => {
      const app = (window as unknown as { planform: { app: PageApp; }; }).planform.app;
      app.addPropToProject(dice, { place: false });
      for (let i = 0; i < 10; i++) {
        const id = `perf_${i}`;
        app.store.mutate((p) => {
          (p.objects as unknown[]).push({
            id, kind: "table", x: 1.5 + (i % 5) * 1.4, z: 2 + Math.floor(i / 5) * 1.6,
            rotationDeg: 0, width: 0.6, depth: 0.6, height: 0.6,
            locked: false, hidden: false, surface: "floor", elevation: 0,
            assetId: "custom:prop_golden_dice", serviceRole: "none",
          });
        });
        app.bindPropOnPlace((app.store.getState().objects as { id: string }[]).find((o) => o.id === id));
      }
      // Enough staff that every station runs, and ~100 real participants.
      app.store.mutate((p) => {
        const flow = p.interaction as {
          staff: { count: number }[];
          audience: { count: number; stopRate?: number; joinRate?: number };
        };
        for (const r of flow.staff) r.count = 10;
        const a = flow.audience;
        a.count = Math.round(100 / ((a.stopRate ?? 1) * (a.joinRate ?? 1)));
      });

      const t0 = performance.now();
      const sim = app.runFlowSimulation()!;
      const simMs = performance.now() - t0;

      const frames = sim.playback.filter((f) => f.results);
      const times: number[] = [];
      const anyApp = app as unknown as {
        session: Record<string, unknown>;
        render: () => void;
      };
      for (let i = 0; i < 30; i++) {
        const f = frames[Math.floor((i * frames.length) / 30)];
        if (!f) continue;
        anyApp.session.simTime = f.t;
        anyApp.session.simStationResults = f.results;
        const t = performance.now();
        anyApp.render();
        times.push(performance.now() - t);
      }
      times.sort((a, b) => a - b);
      return {
        stations: (app.store.getState().interaction as { stations: unknown[] }).stations.length,
        participants: sim.participantCount,
        simMs,
        renderMedian: times[Math.floor(times.length / 2)],
        renderMax: times[times.length - 1],
      };
    }, GOLDEN_DICE as unknown);

    expect(perf.stations).toBeGreaterThanOrEqual(10);
    expect(perf.participants).toBeGreaterThanOrEqual(90);
    // Generous ceilings on purpose: this runs on CI hardware under
    // instrumentation, and the job is to catch an ORDER-of-magnitude
    // regression, not to police milliseconds. Measured on a desktop: sim
    // ~100 ms, per-frame scene sync 0.1 ms median.
    expect(perf.simMs, `sim took ${Math.round(perf.simMs)} ms`).toBeLessThan(5000);
    expect(perf.renderMedian, `median render ${perf.renderMedian.toFixed(1)} ms`).toBeLessThan(250);
    expect(perf.renderMax, `worst render ${perf.renderMax.toFixed(1)} ms`).toBeLessThan(1000);
  });
});
