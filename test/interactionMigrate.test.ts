/**
 * Opening a file that was saved by a different build.
 *
 * Two things have to be true, and they pull in opposite directions:
 *   1. a flow saved today comes back exactly as it was saved;
 *   2. a flow saved by a build that knows something this one does not must
 *      still open — with everything this build DOES understand intact.
 *
 * (2) is the one with teeth. A closed vocabulary would let a single unknown
 * value delete an afternoon of an organiser's work at load time, silently.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { migrateProject, resolveTemplateBindings } from "../src/core/migrate";
import { templateFromBooth } from "../src/core/interactionCompile";
import { interactionPreset } from "../src/core/interactionPresets";
import { runInteraction } from "../src/core/eventFlow";
import { boothVenuePreset, createProjectFromVenuePreset } from "../src/core/venues";
import { createDefaultProject, PROJECT_VERSION, type InteractionTemplate, type Project } from "../src/core/model";

function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

beforeEach(() => installLocalStorage());
installLocalStorage();

const roundTrip = (p: Partial<Project>): Project =>
  migrateProject(JSON.parse(JSON.stringify(p)) as Partial<Project>);

function handwritten(): InteractionTemplate {
  return {
    id: "flow1",
    name: "手寫流程",
    note: "備註",
    steps: [
      { id: "a", name: "招呼", stationId: "st1", avgSeconds: 15, prompt: "你好" },
      {
        id: "b", name: "抽一張祝福卡", stationId: "st1", avgSeconds: 30,
        supplies: ["卡片"],
        branch: {
          kind: "chance", record: "card",
          options: [
            { id: "x", label: "平安", weight: 2, value: "peace" },
            { id: "y", label: "順利", weight: 1, value: "smooth", extraSeconds: 5 },
          ],
        },
      },
      {
        id: "c", name: "對出結果", stationId: "st2", avgSeconds: 10, next: null,
        branch: {
          kind: "match", on: ["card"],
          rules: [{ when: ["peace"], label: "平安卡", prompt: "祝你平安" }],
          otherwise: { label: "通用卡" },
        },
      },
    ],
    startStepId: "a",
    stations: [
      { id: "st1", name: "桌前", type: "custom", x: 1, z: 2, staffCount: 1, parallelServers: 2, meanServiceSeconds: 30, queueCapacity: 6, staffRoleId: "host" },
      { id: "st2", name: "發卡處", type: "custom", x: 3, z: 2, staffCount: 0, parallelServers: 1, meanServiceSeconds: 20, queueCapacity: 4, selfService: true, balkQueueLength: 4 },
    ],
    staff: [{ id: "host", name: "主持", count: 2 }],
    audience: { count: 200, windowSeconds: 3600, profile: "front-loaded", stopRate: 0.5, joinRate: 0.8, patienceSeconds: 90 },
    segments: [{ id: "all", name: "訪客", share: 1, startStepId: "a" }],
    seed: 7,
    settings: { speedMetersPerSecond: 1.1 },
  };
}

describe("a flow survives being saved and opened", () => {
  it("comes back field for field", () => {
    const p = roundTrip({ ...createDefaultProject(), interaction: handwritten() });
    expect(p.interaction).toEqual(handwritten());
    expect(p.version).toBe(PROJECT_VERSION);
  });

  it("does not appear on a project that never had one", () => {
    const p = roundTrip(createDefaultProject());
    expect("interaction" in p).toBe(false);
  });

  it("and PROJECT_VERSION does not move for it", () => {
    // The flow is an optional block, exactly like the booth block. Bumping the
    // version would make every older build refuse a file it can still read.
    expect(PROJECT_VERSION).toBe(8);
  });
});

describe("a flow written by a build that knows more still opens", () => {
  it("keeps a step whose fork this build has never heard of", () => {
    const t = handwritten();
    (t.steps[1] as { branch?: unknown }).branch = { kind: "quantum", options: [] };
    const p = roundTrip({ ...createDefaultProject(), interaction: t });
    const step = p.interaction!.steps.find((s) => s.id === "b")!;
    // The step keeps its name, its seconds, its supplies and its place.
    expect(step.name).toBe("抽一張祝福卡");
    expect(step.avgSeconds).toBe(30);
    expect(step.supplies).toEqual(["卡片"]);
    expect(step.branch).toBeUndefined();
    expect(p.interaction!.steps.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("turns a jump to a deleted step into an ending, not a deletion", () => {
    const t = handwritten();
    t.steps[0].next = "gone";
    const p = roundTrip({ ...createDefaultProject(), interaction: t });
    expect(p.interaction!.steps).toHaveLength(3);
    expect(p.interaction!.steps[0].next).toBeNull();
  });

  it("does the same for an option's jump", () => {
    const t = handwritten();
    const branch = t.steps[1].branch!;
    if (branch.kind === "chance") branch.options[0].next = "gone";
    const p = roundTrip({ ...createDefaultProject(), interaction: t });
    const fixed = p.interaction!.steps[1].branch!;
    expect(fixed.kind).toBe("chance");
    if (fixed.kind === "chance") expect(fixed.options[0].next).toBeNull();
  });

  it("sends a step at a deleted station to the first one", () => {
    const t = handwritten();
    t.steps[2].stationId = "gone";
    const p = roundTrip({ ...createDefaultProject(), interaction: t });
    expect(p.interaction!.steps[2].stationId).toBe("st1");
  });

  it("moves the start when it points nowhere", () => {
    const t = handwritten();
    t.startStepId = "gone";
    const p = roundTrip({ ...createDefaultProject(), interaction: t });
    expect(p.interaction!.startStepId).toBe("a");
  });

  it("treats an all-zero fork as no fork", () => {
    const t = handwritten();
    const branch = t.steps[1].branch!;
    if (branch.kind === "chance") branch.options.forEach((o) => { o.weight = 0; });
    const p = roundTrip({ ...createDefaultProject(), interaction: t });
    expect(p.interaction!.steps[1].branch).toBeUndefined();
  });

  it("clamps nonsense rates instead of producing NaN people", () => {
    const t = handwritten();
    t.audience.stopRate = 5;
    (t.audience as { joinRate: unknown }).joinRate = "半數";
    const p = roundTrip({ ...createDefaultProject(), interaction: t });
    expect(p.interaction!.audience.stopRate).toBe(1);
    expect(p.interaction!.audience.joinRate).toBe(1);
  });
});

describe("a booth plan saved before the step list existed", () => {
  const savedBoothPlan = (): Project => {
    const p = createProjectFromVenuePreset(boothVenuePreset());
    // This is what such a file looks like: a booth block, no interaction.
    delete (p as { interaction?: unknown }).interaction;
    return p;
  };

  it("opens with its own activity already written out", () => {
    const p = roundTrip(savedBoothPlan());
    expect(p.interaction).toBeDefined();
    expect(p.interaction!.steps.length).toBeGreaterThan(8);
    expect(p.interaction!.stations.map((s) => s.name)).toContain("與工作人員對談");
  });

  it("keeps the booth block in the file, so an older build still works", () => {
    const p = roundTrip(savedBoothPlan());
    expect(p.booth).toBeDefined();
    expect(p.booth!.stations).toHaveLength(8);
  });

  it("never overwrites a flow the organiser already edited", () => {
    const saved = { ...savedBoothPlan(), interaction: handwritten() };
    const p = roundTrip(saved);
    expect(p.interaction!.name).toBe("手寫流程");
    expect(p.interaction!.steps).toHaveLength(3);
  });

  it("carries every booth setting into the flow, where it can be edited", () => {
    const saved = savedBoothPlan();
    saved.booth!.params = { ...saved.booth!.params, talkSeconds: 123, deskStaff: 4, queueCapacity: 5, balk: true };
    const p = roundTrip(saved);
    const talk = p.interaction!.stations.find((s) => s.name === "與工作人員對談")!;
    const step = p.interaction!.steps.find((s) => s.name === "與工作人員對談")!;
    expect(step.avgSeconds).toBe(123);
    expect(talk.parallelServers).toBe(4);
    expect(p.interaction!.staff.find((r) => r.id === "talker")!.count).toBe(4);
    expect(talk.queueCapacity).toBe(5);
    expect(talk.balkQueueLength).toBe(5);
    // The old params layer could override a station edit; there is no layer now.
    expect(p.interaction!.audience.patienceSeconds).toBeGreaterThan(0);
  });

  it("switching balk off removes the walk-away rule entirely", () => {
    const saved = savedBoothPlan();
    saved.booth!.params = { ...saved.booth!.params, balk: false };
    const p = roundTrip(saved);
    expect(p.interaction!.audience.patienceSeconds).toBe(0);
    expect(p.interaction!.stations.every((s) => s.balkQueueLength === undefined)).toBe(true);
  });
});

describe("the booth journey becomes data, and the data is right", () => {
  const booth = () => createProjectFromVenuePreset(boothVenuePreset()).booth!;

  it("asks about every skippable station, including after a skip", () => {
    const t = templateFromBooth(booth());
    const asks = t.steps.filter((s) => s.name.startsWith("要不要"));
    // Seven of the eight: 排隊等待 has a skip rate of zero, so it is not a choice.
    expect(asks).toHaveLength(7);
    for (const ask of asks) {
      const branch = ask.branch!;
      expect(branch.kind).toBe("chance");
      if (branch.kind !== "chance") continue;
      const skip = branch.options.find((o) => o.label === "路過")!;
      if (skip.next === null) continue;
      // Skipping must land on the FIRST row of the next station's block — its
      // own question where it has one. Landing past that row would make every
      // station after a skipped one compulsory.
      const askAt = t.steps.findIndex((s) => s.id === ask.id);
      expect(t.steps.findIndex((s) => s.id === skip.next)).toBe(askAt + 2);
    }
  });

  it("a second station of the same type gets into the flow", () => {
    const b = booth();
    const board = b.stations.find((s) => s.boothType === "board")!;
    b.stations.push({ ...board, id: "board2", name: "第二塊展示板", x: board.x + 1 });
    const t = templateFromBooth(b);
    // The old engine looked the station up by type and could only ever see the
    // first one. A second board was invisible to the simulation.
    expect(t.steps.some((s) => s.name === "第二塊展示板")).toBe(true);
  });

  it("a disabled station keeps its place but leaves the flow", () => {
    const b = booth();
    const cushion = b.stations.find((s) => s.boothType === "cushion")!;
    cushion.enabled = false;
    const t = templateFromBooth(b);
    expect(t.steps.some((s) => s.name === "體驗坐墊靜心")).toBe(false);
    expect(t.stations.some((s) => s.name === "體驗坐墊靜心")).toBe(true);
  });

  it("the skip rates actually come out of the simulation", () => {
    const t = templateFromBooth(booth());
    const r = runInteraction({ ...t, audience: { ...t.audience, count: 400, windowSeconds: 40000 } }, { sampleDt: 60 });
    const ask = r.steps!.find((s) => s.name === "要不要體驗坐墊靜心")!;
    const skipped = ask.optionCounts!.find((o) => o.label === "路過")!.count;
    // 0.75 in the old engine's table. Loose bounds: this asserts the rate was
    // carried across, not that a particular seed produced a particular count.
    expect(skipped / ask.entered).toBeGreaterThan(0.65);
    expect(skipped / ask.entered).toBeLessThan(0.85);
  });

  it("a display board still holds the three people it always held", () => {
    const t = templateFromBooth(booth());
    const r = runInteraction(t, { sampleDt: 30 });
    // The old engine opened `parallelServers` positions and never looked at
    // `staffCount`. Reading these stations as staffed instead would quietly
    // cut a three-slot board down to one and invent a queue that never existed.
    expect(r.stations.find((s) => s.name === "看展示板")!.servers).toBe(3);
    expect(r.stations.find((s) => s.name === "拿傳單／DM")!.servers).toBe(4);
    // The table is the one place with people behind it.
    expect(r.stations.find((s) => s.name === "與工作人員對談")!.servers).toBe(3);
  });

  it("deciding costs no server: nobody queues to walk past", () => {
    const t = templateFromBooth(booth());
    const r = runInteraction(t, { sampleDt: 30 });
    const cushion = r.stations.find((s) => s.name === "體驗坐墊靜心")!;
    const ask = r.steps!.find((s) => s.name === "要不要體驗坐墊靜心")!;
    // Everyone is asked; only the joiners are served.
    expect(ask.entered).toBeGreaterThan(cushion.served);
    expect(cushion.served).toBeLessThan(ask.entered * 0.5);
  });
});

describe("a station bound to something in the plan uses the real thing", () => {
  it("takes the bound object's position", () => {
    const project = createProjectFromVenuePreset(boothVenuePreset());
    const table = project.objects.find((o) => o.kind === "table");
    expect(table, "the booth template has a table").toBeDefined();
    const t = interactionPreset("preset:ok-bandage")!;
    const bound: InteractionTemplate = {
      ...t,
      stations: t.stations.map((s) => (s.id === "st_table" ? { ...s, objectId: table!.id } : s)),
    };
    const resolved = resolveTemplateBindings(project, bound);
    const station = resolved.stations.find((s) => s.id === "st_table")!;
    expect(station.x).toBeCloseTo(table!.x, 6);
    expect(station.z).toBeCloseTo(table!.z, 6);
    // And the run gets the plan's own geometry.
    expect(resolved.spatial).toBeDefined();
  });
});
