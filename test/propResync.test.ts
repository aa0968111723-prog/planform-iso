/**
 * Making an edit reach the props that are already on the floor.
 *
 * Every defect pinned here was found by an adversarial review of code that
 * was green: 654 tests passed while the Studio's entire 互動 section was a
 * silent no-op for any placed prop. They share one shape — correct when the
 * piece is examined alone, wrong once it is composed with placement — so the
 * fixtures here always go through a real splice rather than testing a
 * definition in isolation.
 */

import { describe, expect, it } from "vitest";
import {
  instantiatePropInteraction,
  liveSeedFromInstance,
  propStationId,
  propTemplateSkeleton,
  reseedPropInteraction,
} from "../src/core/interactionCompile";
import { propPreset } from "../src/core/propPresets";
import { propFaceOptions } from "../src/core/propCatalog";
import { migrateProject, resolveStationPosition, resolveTemplateBindings } from "../src/core/migrate";
import { templateFromScenario } from "../src/core/interactionCompile";
import { buildE310GoldenProject } from "../src/core/quickStart";
import { venuePresetById } from "../src/core/venues";
import { runInteraction } from "../src/core/eventFlow";
import type { InteractionTemplate, Project, PropDefinition, SceneObject } from "../src/core/model";

function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}
installLocalStorage();

const dice = (): PropDefinition => JSON.parse(JSON.stringify(propPreset("prop_dice")!));

function chanceOf(def: PropDefinition) {
  const step = def.interaction!.steps.find((s) => s.branch?.kind === "chance")!;
  if (step.branch?.kind !== "chance") throw new Error("no chance");
  return step.branch;
}

function placed(def: PropDefinition, objectId = "obj1", at = { x: 4, z: 3 }) {
  const flow = instantiatePropInteraction(propTemplateSkeleton(), def, objectId, at);
  return flow;
}

describe("§0 the station type the whitelist used to erase", () => {
  it("a converted classroom keeps its zone-derived server expansion across a save", () => {
    const project = buildE310GoldenProject(venuePresetById("venue:tku-e310")!);
    project.interaction = templateFromScenario(project.scenarios[0]);

    const before = resolveTemplateBindings(project, project.interaction!);
    const zoneStations = before.stations.filter((s) => ["shoe", "backpack", "seating"].includes(s.type));
    expect(zoneStations.length, "the fixture must actually contain zone stations").toBeGreaterThan(0);
    const beforeServers = Object.fromEntries(zoneStations.map((s) => [s.name, s.parallelServers]));
    expect(Math.max(...Object.values(beforeServers)), "zone expansion is on").toBeGreaterThan(1);

    // One save and reload.
    const reloaded = migrateProject(JSON.parse(JSON.stringify(project))) as Project;
    const after = resolveTemplateBindings(reloaded, reloaded.interaction!);
    for (const [name, servers] of Object.entries(beforeServers)) {
      const now = after.stations.find((s) => s.name === name)!;
      expect(now.parallelServers, `${name} must keep its servers`).toBe(servers);
    }
  });
});

describe("§0 a hidden prop must not drag its station to the world origin", () => {
  it("resolves against the object even when it is hidden", () => {
    const def = dice();
    const obj: SceneObject = {
      id: "obj1", kind: "table", x: 4, z: 3, rotationDeg: 0,
      width: 0.6, depth: 0.6, height: 0.6,
      locked: false, hidden: false, surface: "floor", elevation: 0,
      assetId: "custom:prop_dice",
    } as SceneObject;
    const project = { objects: [obj], zones: [] } as unknown as Project;
    const station = placed(def).stations.find((s) => s.id === propStationId("obj1"))!;

    const shown = resolveStationPosition(project, station);
    expect(shown.x).toBeCloseTo(4, 6);
    expect(shown.z).toBeCloseTo(3.9, 6);

    obj.hidden = true;
    const hidden = resolveStationPosition(project, station);
    expect(hidden, "pressing 隱藏 must not move the queue to the corner").toEqual(shown);
  });

  it("the persisted fallback is the object's position, never 0,0", () => {
    const station = placed(dice(), "obj1", { x: 4, z: 3 }).stations
      .find((s) => s.id === propStationId("obj1"))!;
    expect({ x: station.x, z: station.z }).toEqual({ x: 4, z: 3 });
  });

  it("a pre-prop object-bound station still ignores hidden objects — parity", () => {
    // No anchorOffset => the old behaviour, byte for byte.
    const obj = { id: "o", x: 9, z: 9, hidden: true } as SceneObject;
    const project = { objects: [obj], zones: [] } as unknown as Project;
    const station = { id: "s", objectId: "o", x: 1, z: 2 } as never;
    expect(resolveStationPosition(project, station)).toEqual({ x: 1, z: 2 });
  });
});

describe("an edit reaches the props already on the floor", () => {
  it("face labels, colours and prompts land on the live splice", () => {
    const def = dice();
    let flow = placed(def);
    expect(propFaceOptions({ interaction: flow }, "obj1", def)!.map((o) => o.label))
      .toEqual(["第 1 面", "第 2 面", "第 3 面", "第 4 面", "第 5 面", "第 6 面"]);

    const edited = dice();
    chanceOf(edited).options.forEach((o, i) => {
      o.label = `真心話 ${i + 1}`;
      o.color = "#ff0000";
      o.prompt = `題目 ${i + 1}`;
    });
    flow = reseedPropInteraction(flow, edited, "obj1");

    const live = propFaceOptions({ interaction: flow }, "obj1", edited)!;
    expect(live.map((o) => o.label)).toEqual([1, 2, 3, 4, 5, 6].map((n) => `真心話 ${n}`));
    expect(live.every((o) => o.color === "#ff0000")).toBe(true);
    expect(live[0].prompt).toBe("題目 1");
  });

  it("station numbers, staff size and skip rate land too", () => {
    const def = dice();
    let flow = placed(def);
    const edited = dice();
    edited.interaction!.station.meanServiceSeconds = 999;
    edited.interaction!.station.queueCapacity = 12;
    edited.interaction!.staffRole = { name: "骰子站", count: 4 };
    edited.interaction!.skipRate = 0.9;

    flow = reseedPropInteraction(flow, edited, "obj1");
    const station = flow.stations.find((s) => s.id === propStationId("obj1"))!;
    expect(station.meanServiceSeconds).toBe(999);
    expect(station.queueCapacity).toBe(12);
    expect(station.staffCount).toBe(4);
    expect(flow.staff.find((r) => r.name === "骰子站")!.count).toBe(4);
    const ask = flow.steps.find((s) => s.id === `ask_prop_obj1`)!;
    if (ask.branch?.kind !== "chance") throw new Error("no ask");
    expect(ask.branch.options.find((o) => o.id === "skip")!.weight).toBeCloseTo(0.9, 6);
  });

  it("growing the face count adds faces without breaking the wiring", () => {
    const def = dice();
    let flow = placed(def);
    const wiringBefore = flow.steps.map((s) => `${s.id}->${s.next === null ? "NULL" : s.next ?? "fall"}`);

    const edited = dice();
    const branch = chanceOf(edited);
    branch.options.push(
      { id: "f7", label: "第 7 面", weight: 1 },
      { id: "f8", label: "第 8 面", weight: 1 },
    );
    flow = reseedPropInteraction(flow, edited, "obj1");

    expect(propFaceOptions({ interaction: flow }, "obj1", edited)).toHaveLength(8);
    expect(flow.steps.map((s) => `${s.id}->${s.next === null ? "NULL" : s.next ?? "fall"}`))
      .toEqual(wiringBefore);
    // Still runnable, and the new faces really come up.
    const result = runInteraction(flow, { sampleDt: 5 });
    const rolled = new Set(result.playback.flatMap((f) => Object.values(f.results ?? {})).map((r) => r.optionId));
    expect(rolled.size).toBeGreaterThan(1);
  });

  it("PER-OPTION wiring survives — a rolled face still leads on to the talk", () => {
    // Judged by the engine, not by comparing arrays: if reseed rewrote each
    // face's `next`, a visitor would leave the moment they rolled instead of
    // going on to 依骰面對談, and the talk step would serve nobody.
    const def = dice();
    let flow = placed(def);
    const talkServed = (t: InteractionTemplate) => {
      const r = runInteraction(t, { sampleDt: 5 });
      const rolls = r.playback.flatMap((f) => Object.values(f.results ?? {})).length;
      return { rolls, served: r.stations.find((s) => s.stationId === propStationId("obj1"))!.served };
    };
    const before = talkServed(flow);
    expect(before.served, "the fixture must actually serve people").toBeGreaterThan(0);

    const edited = dice();
    chanceOf(edited).options.forEach((o, i) => { o.label = `面 ${i + 1}`; });
    flow = reseedPropInteraction(flow, edited, "obj1");

    const after = talkServed(flow);
    // roll + talk are two services per visitor; dropping the talk halves this.
    expect(after.served, "reseeding must not strand visitors at the roll").toBe(before.served);
    expect(after.rolls).toBe(before.rolls);
    // And the per-option pointers are literally unchanged.
    const step = flow.steps.find((s) => s.id === "p_obj1_roll")!;
    if (step.branch?.kind !== "chance") throw new Error("no chance");
    expect(step.branch.options.map((o) => o.next)).toEqual(new Array(6).fill(undefined));
  });

  it("reseeding never touches another prop's splice", () => {
    const def = dice();
    let flow = instantiatePropInteraction(propTemplateSkeleton(), def, "objA", { x: 1, z: 1 });
    flow = instantiatePropInteraction(flow, def, "objB", { x: 5, z: 1 });
    const edited = dice();
    chanceOf(edited).options[0].label = "只有 A 改了";
    flow = reseedPropInteraction(flow, edited, "objA");

    expect(propFaceOptions({ interaction: flow }, "objA", edited)![0].label).toBe("只有 A 改了");
    expect(propFaceOptions({ interaction: flow }, "objB", edited)![0].label).toBe("第 1 面");
  });

  it("reseeding a prop that is not placed is a no-op, not a crash", () => {
    const flow = propTemplateSkeleton();
    expect(reseedPropInteraction(flow, dice(), "nobody")).toBe(flow);
  });
});

describe("§71 fork keeps what the organiser actually typed", () => {
  it("a fork starts from the LIVE faces, not the frozen preset", () => {
    const def = dice();
    const flow: InteractionTemplate = placed(def);
    // What the flow panel edits: the live options.
    const liveStep = flow.steps.find((s) => s.id === "p_obj1_roll")!;
    if (liveStep.branch?.kind !== "chance") throw new Error("no chance");
    liveStep.branch.options.forEach((o, i) => { o.label = `真心話 ${i + 1}`; });
    const station = flow.stations.find((s) => s.id === propStationId("obj1"))!;
    station.meanServiceSeconds = 222;

    const seed = liveSeedFromInstance(flow, def, "obj1")!;
    const forkFaces = seed.steps.find((s) => s.branch?.kind === "chance")!;
    if (forkFaces.branch?.kind !== "chance") throw new Error("no chance");
    expect(forkFaces.branch.options.map((o) => o.label))
      .toEqual([1, 2, 3, 4, 5, 6].map((n) => `真心話 ${n}`));
    expect(seed.station.meanServiceSeconds).toBe(222);
    // Ids stay the DEFINITION's, because the fork gets re-spliced.
    expect(forkFaces.id).toBe("roll");
  });

  it("falls back to the definition when the prop was never placed", () => {
    const def = dice();
    expect(liveSeedFromInstance(undefined, def, "obj1")).toBe(def.interaction);
    expect(liveSeedFromInstance(propTemplateSkeleton(), def, "obj1")).toBe(def.interaction);
  });
});
