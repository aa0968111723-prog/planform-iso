/**
 * Step 6 — what a rehearsal SHOWS.
 *
 * Everything here is rendering. The rule the whole step is built on is that
 * none of it may move a number: `results` rides on `playback`, which the
 * parity fixture excludes, and the dice/board/drift code touches transforms
 * and materials only. So these tests pin two separate claims —
 *
 *   1. the visuals are correct and deterministic (§25, §31, §26, §85);
 *   2. the engine's numbers are untouched, and a classroom run does not even
 *      allocate the new field.
 *
 * §96's regression clause gets its own guard: `planSymbolForEntry` now reads
 * `planSymbolRef`, and it must read it for exactly one prefix.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { runDiscreteEvent, runInteraction } from "../src/core/eventFlow";
import { resolveScenarioBindings } from "../src/core/migrate";
import { buildE310GoldenProject } from "../src/core/quickStart";
import { venuePresetById } from "../src/core/venues";
import { instantiatePropInteraction, propTemplateSkeleton } from "../src/core/interactionCompile";
import { propPreset } from "../src/core/propPresets";
import { planSymbolForEntry } from "../src/core/planSymbol";
import { entryFromProp } from "../src/core/propCatalog";
import {
  anchorPhrase,
  anchorSentences,
  formatElapsed,
  propStationObjects,
  stationNow,
} from "../src/core/rehearsal";
import {
  DICE_SPIN_SECONDS,
  buildPropGroup,
  clearPartResult,
  diceRollQuaternion,
  diceSettleQuaternion,
  paintPartResult,
} from "../src/scene/propVisual";
import { Mesh, MeshStandardMaterial, Vector3 } from "three";
import type { AssetCatalogEntry } from "../src/core/catalog";
import type { InteractionTemplate, PropPart, SceneObject } from "../src/core/model";

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

// Painted faces need document.createElement("canvas"); node has none. Same
// minimal stub propVisual.test.ts uses — three only needs an object identity
// and a context that answers the handful of 2D calls the painter makes.
beforeEach(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({
        fillStyle: "", font: "", textAlign: "", textBaseline: "",
        fillRect: () => undefined,
        fillText: () => undefined,
        measureText: () => ({ width: 10 }),
      }),
    }),
    createElementNS: () => ({}),
  };
});

/** A flow with one placed dice, bound to `objectId`. */
function diceFlow(objectId = "obj1"): InteractionTemplate {
  const def = propPreset("prop_dice")!;
  const flow = instantiatePropInteraction(propTemplateSkeleton(), def, objectId);
  // Everyone plays: a skip branch would make the assertion about rolls flaky
  // for a reason that has nothing to do with what is being tested.
  for (const step of flow.steps) {
    if (step.branch?.kind === "chance" && step.branch.options.length === 2
      && step.branch.options.some((o) => o.label.includes("路過"))) {
      for (const opt of step.branch.options) opt.weight = opt.label.includes("路過") ? 0 : 1;
    }
  }
  return flow;
}

describe("per-frame station results", () => {
  it("a served chance fork is recorded on the frame, with the option's own colour", () => {
    const result = runInteraction(diceFlow(), { sampleDt: 5 });
    const withResults = result.playback.filter((f) => f.results);
    expect(withResults.length, "the dice rolled at some point").toBeGreaterThan(0);

    const record = Object.values(withResults[withResults.length - 1].results!)[0];
    expect(record.label).toBeTruthy();
    // Every dice face carries a colour in the preset; it must survive to the frame.
    expect(record.color).toMatch(/^#/);
    expect(record.serial).toBeGreaterThan(0);
    expect(record.t).toBeLessThanOrEqual(withResults[withResults.length - 1].t);
  });

  it("the serial increments per roll, so the same face twice still reads as two rolls", () => {
    const result = runInteraction(diceFlow(), { sampleDt: 5 });
    const serials = result.playback
      .filter((f) => f.results)
      .map((f) => Object.values(f.results!)[0].serial);
    expect(serials[serials.length - 1]).toBeGreaterThan(serials[0]);
    // Monotonic: a result never goes backwards in a replay.
    for (let i = 1; i < serials.length; i++) expect(serials[i]).toBeGreaterThanOrEqual(serials[i - 1]);
  });

  it("the classroom never allocates the field — no forks, no results", () => {
    // The real regression target, not a hand-built stub: E310 compiled through
    // the same path the parity fixture uses. Its steps have no chance branch,
    // so every frame must come out exactly as it did before Step 6.
    const project = buildE310GoldenProject(venuePresetById("venue:tku-e310")!);
    const scenario = resolveScenarioBindings(project, project.scenarios[0]);
    const result = runDiscreteEvent(scenario, { sampleDt: 5 });
    expect(result.playback.length).toBeGreaterThan(0);
    expect(result.playback.every((f) => f.results === undefined)).toBe(true);
    // And the field is genuinely absent, not present-and-empty: `{}` would
    // still serialise into every frame of a saved run.
    expect(Object.prototype.hasOwnProperty.call(result.playback[0], "results")).toBe(false);
  });

  it("the 0-second ask step is a decision, not a result — 路過 never shows as a roll", () => {
    const def = propPreset("prop_dice")!;
    const flow = instantiatePropInteraction(propTemplateSkeleton(), def, "obj1");
    // Force EVERYONE past the prop: if the ask-step leaked into results, this
    // run would still record one.
    for (const step of flow.steps) {
      if (step.avgSeconds === 0 && step.branch?.kind === "chance") {
        for (const opt of step.branch.options) opt.weight = opt.label.includes("路過") ? 1 : 0;
      }
    }
    const result = runInteraction(flow, { sampleDt: 5 });
    expect(result.playback.every((f) => f.results === undefined)).toBe(true);
  });

  it("§55: a second dice on one staff member serves nobody, and is named for it", () => {
    // Not a Step 6 behaviour — the documented static-allocation reality, pinned
    // here because it is what a person who places two dice actually gets. The
    // second station stalls; `staffLoad` has to say so out loud, or the plan
    // would quietly promise a game that never runs.
    const def = propPreset("prop_dice")!;
    let flow = instantiatePropInteraction(propTemplateSkeleton(), def, "objA");
    flow = instantiatePropInteraction(flow, def, "objB");
    expect(flow.staff, "copies share one role by name").toHaveLength(1);
    const result = runInteraction(flow, { sampleDt: 5 });
    expect(result.stations.find((s) => s.stationId === "prop_objB")!.served).toBe(0);
    const shortage = result.staffLoad?.find((l) => l.shortage);
    expect(shortage?.roleName).toBe("骰子站");
    expect(shortage?.stationNames).toHaveLength(2);
    // Nothing rolled at B, so nothing is displayed at B either.
    const keys = new Set(result.playback.flatMap((f) => Object.keys(f.results ?? {})));
    expect([...keys]).toEqual(["prop_objA"]);
  });

  it("results are per station: two staffed dice never share a face", () => {
    const def = propPreset("prop_dice")!;
    let flow = instantiatePropInteraction(propTemplateSkeleton(), def, "objA");
    flow = instantiatePropInteraction(flow, def, "objB");
    for (const role of flow.staff) role.count = 2; // one person per dice
    const result = runInteraction(flow, { sampleDt: 5 });
    const frames = result.playback.filter((f) => f.results && Object.keys(f.results).length === 2);
    expect(frames.length, "both stations rolled").toBeGreaterThan(0);
    for (const frame of frames) {
      for (const [stationId, record] of Object.entries(frame.results!)) {
        expect(stationId).toMatch(/^prop_obj[AB]$/);
        expect(record.stepId).toContain(stationId.replace("prop_", ""));
      }
    }
  });
});

describe("§25 dice settle", () => {
  it("each of the six faces settles to a DIFFERENT orientation", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const q = diceSettleQuaternion(i)!;
      seen.add([q.x, q.y, q.z, q.w].map((v) => v.toFixed(4)).join(","));
    }
    expect(seen.size).toBe(6);
  });

  it("the settled face points up — that is what 'settle' means", () => {
    // Slot order is +x,-x,+y,-y,+z,-z; the fill order puts option i on
    // FACE_ORDER[i]. The normal of that slot must end up at +y.
    const slotNormal = [
      new Vector3(1, 0, 0), new Vector3(-1, 0, 0),
      new Vector3(0, 1, 0), new Vector3(0, -1, 0),
      new Vector3(0, 0, 1), new Vector3(0, 0, -1),
    ];
    const faceOrder = [4, 5, 0, 1, 2, 3];
    for (let i = 0; i < 6; i++) {
      const up = slotNormal[faceOrder[i]].clone().applyQuaternion(diceSettleQuaternion(i)!);
      expect(up.y, `option ${i} face must be up`).toBeCloseTo(1, 5);
    }
  });

  it("a face the box cannot show returns null — a d12 does not lie", () => {
    expect(diceSettleQuaternion(6)).toBeNull();
    expect(diceSettleQuaternion(11)).toBeNull();
    expect(diceSettleQuaternion(-1)).toBeNull();
  });

  it("the roll is deterministic and lands exactly on the settled face", () => {
    const settle = diceSettleQuaternion(2)!;
    const a = diceRollQuaternion(0.4, 3, settle);
    const b = diceRollQuaternion(0.4, 3, settle);
    expect([a.x, a.y, a.z, a.w]).toEqual([b.x, b.y, b.z, b.w]);
    // Mid-spin it is NOT the settled orientation…
    expect(a.angleTo(settle)).toBeGreaterThan(0.01);
    // …and once the spin is over it is exactly the settled orientation.
    const done = diceRollQuaternion(DICE_SPIN_SECONDS, 3, settle);
    expect(done.angleTo(settle)).toBeCloseTo(0, 6);
    expect(diceRollQuaternion(999, 3, settle).angleTo(settle)).toBeCloseTo(0, 6);
  });

  it("two rolls of the same face tumble differently — the serial seeds the phase", () => {
    const settle = diceSettleQuaternion(0)!;
    // Sampled across the spin: a serial that only perturbs one axis would slip
    // through a single-point check.
    for (const t of [0.1, 0.3, 0.6, 0.9]) {
      expect(diceRollQuaternion(t, 1, settle).angleTo(diceRollQuaternion(t, 2, settle)), `t=${t}`)
        .toBeGreaterThan(0.01);
    }
  });

  it("it DECELERATES — 擲→轉→停, not tumble-then-teleport", () => {
    // A dice that spins at full speed and snaps to the result on the last
    // frame reads as a glitch. `angleTo` cannot express this (a multi-turn
    // spin passes through every angle repeatedly), so measure the thing that
    // actually defines settling: angular speed, which must fall to zero.
    const settle = diceSettleQuaternion(3)!;
    const step = DICE_SPIN_SECONDS / 40;
    const speeds: number[] = [];
    for (let i = 0; i < 40; i++) {
      const a = diceRollQuaternion(step * i, 5, settle);
      const b = diceRollQuaternion(step * (i + 1), 5, settle);
      speeds.push(a.angleTo(b));
    }
    for (let i = 1; i < speeds.length; i++) {
      expect(speeds[i], `speed must never pick back up (step ${i})`)
        .toBeLessThanOrEqual(speeds[i - 1] + 1e-9);
    }
    expect(speeds[0], "spinning fast at the start").toBeGreaterThan(0.3);
    expect(speeds[speeds.length - 1], "at rest by the end").toBeLessThan(0.02);
    expect(diceRollQuaternion(DICE_SPIN_SECONDS, 5, settle).angleTo(settle)).toBeCloseTo(0, 6);
  });
});

describe("§31 display link", () => {
  const displayPart: PropPart = {
    id: "board", shape: "plane",
    size: { width: 0.7, depth: 0.02, height: 0.5 },
    offset: { x: 0, y: 0.8, z: 0 },
    color: "#f8fafc", text: "題目板", showsResultOf: "self",
  };

  it("painting a result swaps the material, and clearing puts the original back", () => {
    const original = new MeshStandardMaterial();
    const mesh = new Mesh(undefined, original);
    paintPartResult(mesh, displayPart, "④ 認識自己", "#38bdf8");
    expect(mesh.material).not.toBe(original);
    clearPartResult(mesh);
    expect(mesh.material).toBe(original);
  });

  it("repainting the same result is a no-op — playback ticks 60 times a second", () => {
    const mesh = new Mesh(undefined, new MeshStandardMaterial());
    paintPartResult(mesh, displayPart, "④", "#38bdf8");
    const first = mesh.material;
    paintPartResult(mesh, displayPart, "④", "#38bdf8");
    expect(mesh.material).toBe(first);
    paintPartResult(mesh, displayPart, "⑤", "#38bdf8");
    expect(mesh.material).not.toBe(first);
  });

  it("clearing a mesh that never showed a result does nothing", () => {
    const original = new MeshStandardMaterial();
    const mesh = new Mesh(undefined, original);
    clearPartResult(mesh);
    expect(mesh.material).toBe(original);
  });

  it("a box display paints only its front face and keeps the other five", () => {
    const boxPart: PropPart = { ...displayPart, shape: "box" };
    const base = new MeshStandardMaterial();
    const mesh = new Mesh(undefined, base);
    paintPartResult(mesh, boxPart, "答對", "#22c55e");
    const mats = mesh.material as unknown as MeshStandardMaterial[];
    expect(Array.isArray(mats)).toBe(true);
    expect(mats).toHaveLength(6);
    expect(mats[4]).not.toBe(base);
    expect(mats.filter((m) => m === base)).toHaveLength(5);
  });

  it("the golden 骰子站 ships with its board already wired to its own station", () => {
    const station = propPreset("prop_dicestation")!;
    expect(station.parts.find((p) => p.id === "board")?.showsResultOf).toBe("self");
    // …and the dice inside it is still the part that spins.
    expect(station.parts.filter((p) => p.facesFromOptions)).toHaveLength(1);
  });

  it("every part of every preset compiles to a findable, uniquely named mesh", () => {
    const def = propPreset("prop_dicestation")!;
    const group = buildPropGroup(def);
    const names = group.children.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const part of def.parts) {
      expect(group.getObjectByName(`part:${part.id}`), part.id).toBeDefined();
    }
  });
});

describe("§85 anchor sentences", () => {
  it("names all four posts, the volunteer's own first", () => {
    const lines = anchorSentences(propPreset("prop_dice")!);
    expect(lines.map((l) => l.role)).toEqual(["staff", "player", "queue", "exit"]);
    expect(lines[0].text).toContain("你站這裡");
    expect(lines[1].text).toContain("參加者站這裡");
    expect(lines[2].text).toContain("排隊從這裡開始");
    expect(lines[3].text).toContain("完成後往這裡走");
  });

  it("speaks directions and centimetres, never coordinates", () => {
    expect(anchorPhrase({ x: 0, z: 0.9 })).toBe("道具正前方 90 公分");
    expect(anchorPhrase({ x: 0.9, z: 0.3 })).toContain("右");
    expect(anchorPhrase({ x: -1.2, z: 0 })).toBe("道具正左方 120 公分");
    expect(anchorPhrase({ x: 0.5, z: 0.5 })).toBe("道具右前方 71 公分");
    expect(anchorPhrase({ x: 0, z: -0.7 })).toBe("道具正後方 70 公分");
    expect(anchorPhrase({ x: 0.02, z: 0.02 })).toBe("就在道具旁邊");
    for (const phrase of [anchorPhrase({ x: 1, z: 2 }), anchorPhrase({ x: -1, z: -2 })]) {
      expect(phrase).not.toMatch(/[xz]|-?\d+\.\d/);
    }
  });

  it("a prop with no anchors gets no sentences — never an invented spot", () => {
    expect(anchorSentences({ anchors: [] })).toEqual([]);
    expect(anchorSentences(propPreset("prop_screen")!)).toEqual([]);
  });

  it("only props with anchors are tappable stations", () => {
    const obj = (id: string, assetId: string): SceneObject => ({
      id, kind: "table", x: 0, z: 0, rotationDeg: 0,
      width: 1, depth: 1, height: 1, locked: false, hidden: false,
      surface: "floor", elevation: 0, assetId,
    } as SceneObject);
    const found = propStationObjects(
      [obj("a", "custom:prop_dice"), obj("b", "custom:prop_screen"), obj("c", "builtin:table")],
      (o) => (o.assetId?.startsWith("custom:") ? propPreset(o.assetId.slice(7)) ?? undefined : undefined),
    );
    expect(found.map((f) => f.object.id)).toEqual(["a"]);
  });
});

describe("§26 station readout", () => {
  it("says what was rolled, what is happening, and for how long", () => {
    const now = stationNow({
      stationId: "prop_obj1",
      result: { stepId: "roll", optionId: "f4", label: "④ 認識自己", color: "#38bdf8", t: 120, serial: 3 },
      nextStepName: "對談中",
      now: 192,
      serving: 1,
      queued: 4,
    });
    expect(now.result).toBe("④ 認識自己");
    expect(now.resultColor).toBe("#38bdf8");
    expect(now.doing).toBe("對談中");
    expect(now.since).toBe("01:12");
    expect(now.queued).toBe(4);
  });

  it("before the first roll it says nothing rather than guessing", () => {
    const now = stationNow({ stationId: "s", nextStepName: "對談中", now: 30, serving: 0, queued: 0 });
    expect(now.result).toBeNull();
    expect(now.doing).toBeNull();
    expect(now.since).toBeNull();
  });

  it("formats as mm:ss and never goes negative", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(72)).toBe("01:12");
    expect(formatElapsed(3599)).toBe("59:59");
    expect(formatElapsed(-5)).toBe("00:00");
  });
});

describe("§96 plan symbol regression", () => {
  const entry = (over: Partial<AssetCatalogEntry>): AssetCatalogEntry => ({
    id: "builtin:table", name: "長桌", semanticType: "table", sourceType: "generated-procedural",
    category: "furniture", placementType: "floor",
    dimensions: { width: 1.8, depth: 0.6, height: 0.74 },
    defaultFacingDeg: 0, clearanceFront: 0, blocksFlow: true, serviceRole: "none",
    kind: "table", icon: "▭", color: "#c8b6a6", visualRef: "table", version: 1,
    ...over,
  } as AssetCatalogEntry);

  it("a prop entry draws as a prop, labelled with its own name", () => {
    const spec = planSymbolForEntry(entryFromProp(propPreset("prop_dice")!));
    expect(spec.kind).toBe("prop");
    expect(spec.label).toBe("大型骰子");
    expect(spec.icon).toBe("大型骰子");
  });

  it("EVERY other planSymbolRef is still ignored — that is the whole clause", () => {
    // A GLB import and a booth asset both carry `plan:<semantic>` refs that
    // this function has never read. Reading them now would silently redraw a
    // 場刊 that volunteers already know.
    for (const ref of ["plan:table", "plan:signage", "plan:storage", "plan:other", "plan:propaganda"]) {
      const spec = planSymbolForEntry(entry({ planSymbolRef: ref }));
      expect(spec.kind, ref).toBe("table");
    }
    // Including a ref that merely LOOKS like a prop one.
    expect(planSymbolForEntry(entry({ planSymbolRef: "plan:props:x" })).kind).toBe("table");
    // And with no ref at all.
    expect(planSymbolForEntry(entry({ planSymbolRef: undefined })).kind).toBe("table");
  });

  it("the two named built-ins still win over everything", () => {
    expect(planSymbolForEntry(entry({ id: "builtin:stage-platform", planSymbolRef: "plan:stage-platform" })).kind)
      .toBe("stage-platform");
    expect(planSymbolForEntry(entry({ id: "builtin:lectern", planSymbolRef: "plan:lectern" })).kind)
      .toBe("lectern");
  });
});
