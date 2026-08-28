/**
 * The splice: a prop becomes a station people actually reach.
 *
 * The wiring contract's claims, each pinned by running the ENGINE, not by
 * inspecting arrays — reachability is a property of execution:
 *   1. spliced into an existing flow, the prop station serves people
 *      (the fragment is not an unreachable island past a next:null);
 *   2. nobody is forced through it — the skip rate is real;
 *   3. insert-then-remove is a no-op on the SIMULATION: same seed, same
 *      numbers as never having inserted at all;
 *   4. a copy is a second station; a shared role splits statically, the
 *      second station stalls, and the staff-load line says so;
 *   5. the station stands at the player anchor and turns with the object.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  instantiatePropInteraction,
  propStationId,
  propTemplateSkeleton,
  removePropInteraction,
} from "../src/core/interactionCompile";
import { runInteraction } from "../src/core/eventFlow";
import { resolveStationPosition } from "../src/core/migrate";
import { queuePlacement } from "../src/core/simSpatial";
import { interactionPreset } from "../src/core/interactionPresets";
import { propPreset } from "../src/core/propPresets";
import { validateProject } from "../src/core/validation";
import { entryFromProp } from "../src/core/propCatalog";
import {
  createDefaultProject,
  type InteractionTemplate,
  type Project,
  type PropDefinition,
  type SceneObject,
} from "../src/core/model";

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

const dice = (): PropDefinition => propPreset("prop_dice")!;
const run = (t: InteractionTemplate) => runInteraction(t, { sampleDt: 30 });
const served = (t: InteractionTemplate, objectId: string) =>
  run(t).stations.find((s) => s.stationId === propStationId(objectId))!;

describe("splicing into an existing flow", () => {
  it("the prop station actually serves people — the fragment is reachable", () => {
    const base = interactionPreset("preset:ok-bandage")!;
    const spliced = instantiatePropInteraction(base, dice(), "obj1");
    const station = served(spliced, "obj1");
    expect(station, "the station exists").toBeDefined();
    // Every existing preset ends in next:null; without terminal rewiring the
    // fragment would sit past the end of the flow, silently serving nobody.
    expect(station.served).toBeGreaterThan(0);
  });

  it("nobody is forced through — the skip rate is a real fork", () => {
    const def = dice();
    const spliced = instantiatePropInteraction(interactionPreset("preset:ok-bandage")!, def, "obj1");
    const result = run(spliced);
    const ask = result.steps!.find((s) => s.stepId === `ask_prop_obj1`)!;
    expect(ask, "the ask step ran").toBeDefined();
    const skipped = ask.optionCounts!.find((o) => o.label === "路過")!.count;
    const joined = ask.optionCounts!.find((o) => o.label === def.name)!.count;
    expect(skipped).toBeGreaterThan(0);
    expect(joined).toBeGreaterThan(0);
    // And the base flow itself still completes people.
    expect(result.completed).toBeGreaterThan(0);
  });

  it("a skipRate of zero splices without an ask step", () => {
    const def = { ...dice(), interaction: { ...dice().interaction!, skipRate: 0 } };
    const spliced = instantiatePropInteraction(propTemplateSkeleton(), def, "obj1");
    expect(spliced.steps.some((s) => s.id.startsWith("ask_"))).toBe(false);
    expect(served(spliced, "obj1").served).toBeGreaterThan(0);
  });

  it("two props chain: both stations serve, both skippable independently", () => {
    const one = instantiatePropInteraction(propTemplateSkeleton(), dice(), "obj1");
    const two = instantiatePropInteraction(one, propPreset("prop_cardbox")!, "obj2");
    expect(served(two, "obj1").served).toBeGreaterThan(0);
    expect(served(two, "obj2").served).toBeGreaterThan(0);
  });

  it("splicing twice for the same object is a no-op", () => {
    const once = instantiatePropInteraction(propTemplateSkeleton(), dice(), "obj1");
    const twice = instantiatePropInteraction(once, dice(), "obj1");
    expect(twice).toBe(once);
  });
});

describe("removal restores the pre-insertion meaning", () => {
  it("insert-then-remove leaves the SIMULATION exactly as it was", () => {
    const base = interactionPreset("preset:ok-bandage")!;
    const before = run(base);
    const restored = removePropInteraction(
      instantiatePropInteraction(base, dice(), "obj1"),
      "obj1",
    )!;
    const after = run(restored);
    // Not array equality — the rewiring leaves an explicit null where a
    // fall-through was, which MEANS the same thing. The engine is the judge:
    // same seed, same numbers, or the removal broke something.
    expect(after.completed).toBe(before.completed);
    expect(after.avgWaitSeconds).toBeCloseTo(before.avgWaitSeconds, 9);
    expect(after.finishTimeSeconds).toBeCloseTo(before.finishTimeSeconds, 9);
    expect(after.stations.map((s) => s.served)).toEqual(before.stations.map((s) => s.served));
  });

  it("removing the only prop of a skeleton returns null — the flow is over", () => {
    const only = instantiatePropInteraction(propTemplateSkeleton(), dice(), "obj1");
    expect(removePropInteraction(only, "obj1")).toBeNull();
  });

  it("removing the middle of three keeps the other two serving", () => {
    let t = instantiatePropInteraction(propTemplateSkeleton(), dice(), "obj1");
    t = instantiatePropInteraction(t, propPreset("prop_cardbox")!, "obj2");
    t = instantiatePropInteraction(t, propPreset("prop_pickup")!, "obj3");
    const cut = removePropInteraction(t, "obj2")!;
    expect(served(cut, "obj1").served).toBeGreaterThan(0);
    expect(served(cut, "obj3").served).toBeGreaterThan(0);
    expect(cut.stations.some((s) => s.id === propStationId("obj2"))).toBe(false);
  });

  it("the role goes when its last station goes — no zombie staff", () => {
    // Two DIFFERENT props with two different crews; removing one prop must
    // remove exactly its own crew. A dangling staffRoleId opens zero servers
    // and stalls silently — the failure this cleanup exists to prevent.
    let t = instantiatePropInteraction(propTemplateSkeleton(), dice(), "obj1");
    t = instantiatePropInteraction(t, propPreset("prop_cardbox")!, "obj2");
    expect(t.staff).toHaveLength(2);
    const after = removePropInteraction(t, "obj2")!;
    expect(after.staff).toHaveLength(1);
    expect(after.staff[0].name).toBe("骰子站");
  });

  it("but a shared role survives while a sibling still uses it", () => {
    const t = instantiatePropInteraction(propTemplateSkeleton(), dice(), "obj1");
    const kept = instantiatePropInteraction(t, dice(), "obj2");
    const afterOne = removePropInteraction(kept, "obj1")!;
    expect(afterOne.staff).toHaveLength(1);
  });

  it("the seal holds even for a fragment that arrives unsealed", () => {
    // A user-authored definition might end on a fall-through. The splice must
    // seal it anyway: after the organiser appends an unrelated step to the
    // flow, joiners who finish the fragment LEAVE — they do not fall through
    // into whatever row happens to sit below.
    const unsealed = dice();
    const steps = unsealed.interaction!.steps;
    delete steps[steps.length - 1].next;
    let t = instantiatePropInteraction(propTemplateSkeleton(), unsealed, "obj1");
    t = {
      ...t,
      steps: [...t.steps, { id: "stray", name: "不相干的一步", avgSeconds: 30, next: null }],
    };
    const result = run(t);
    // Joiners do exactly two servings (roll + talk); the ask is a decision
    // and serves nobody. A leak into the stray row would add a third serving
    // per joiner — `served` is the instrument, because StepStats.entered only
    // counts fork steps and is blind to a plain step.
    const ask = result.steps!.find((s) => s.stepId === "ask_prop_obj1")!;
    const joined = ask.optionCounts!.find((o) => o.label === unsealed.name)!.count;
    const station = result.stations.find((s) => s.stationId === propStationId("obj1"))!;
    expect(joined).toBeGreaterThan(0);
    expect(station.served).toBe(joined * 2);
  });
});

describe("copies share a crew, honestly", () => {
  it("two dice = two stations, one staff role", () => {
    const one = instantiatePropInteraction(propTemplateSkeleton(), dice(), "obj1");
    const two = instantiatePropInteraction(one, dice(), "obj2");
    expect(two.stations).toHaveLength(2);
    expect(two.staff).toHaveLength(1);
    expect(two.stations[0].staffRoleId).toBe(two.stations[1].staffRoleId);
  });

  it("one person over two stations: the second stalls and the readout says so", () => {
    const one = instantiatePropInteraction(propTemplateSkeleton(), dice(), "obj1");
    const two = instantiatePropInteraction(one, dice(), "obj2");
    const result = run(two);
    const servers = result.stations
      .filter((s) => s.stationId.startsWith("prop_"))
      .map((s) => s.servers)
      .sort();
    // Static split: [1, 0] — this satisfies §55's letter (one person cannot
    // serve two at once) and is REPORTED, not hidden behind a rounding.
    expect(servers).toEqual([0, 1]);
    const line = result.staffLoad!.find((l) => l.shortage);
    expect(line, "the staff-load line names the shortage").toBeDefined();
  });
});

describe("the station stands where the player stands", () => {
  function placedProject(rotationDeg: number): { project: Project; template: InteractionTemplate } {
    const project = createDefaultProject();
    const def = dice();
    project.props = [def];
    project.catalogExtras = [entryFromProp(def) as never];
    const obj: SceneObject = {
      id: "obj1", kind: "table", name: def.name, x: 4, z: 3, rotationDeg,
      width: 0.6, depth: 0.6, height: 0.6, locked: false, hidden: false,
      assetId: entryFromProp(def).id,
    } as unknown as SceneObject;
    project.objects.push(obj);
    const template = instantiatePropInteraction(propTemplateSkeleton(), def, "obj1");
    return { project, template };
  }

  it("unrotated: object centre + player anchor", () => {
    const { project, template } = placedProject(0);
    const pos = resolveStationPosition(project, template.stations[0]);
    // The dice's player anchor is (0, 0.9): in front of the prop.
    expect(pos.x).toBeCloseTo(4, 6);
    expect(pos.z).toBeCloseTo(3.9, 6);
  });

  it("rotated 90°: the anchor turns with the object", () => {
    const { project, template } = placedProject(90);
    const pos = resolveStationPosition(project, template.stations[0]);
    expect(pos.x).toBeCloseTo(4.9, 6);
    expect(pos.z).toBeCloseTo(3, 6);
  });

  it("a station without the field resolves to the byte-identical centre", () => {
    const { project, template } = placedProject(90);
    const bare = { ...template.stations[0] };
    delete bare.anchorOffset;
    const pos = resolveStationPosition(project, bare);
    expect(pos).toEqual({ x: 4, z: 3 });
  });

  it("the queue extends the way the queue anchor points", () => {
    const { template } = placedProject(0);
    const station = { ...template.stations[0], x: 5, z: 4.5 };
    const spatial = {
      classroom: { id: "classroom", name: "教室", x: 0, z: 0, length: 10, width: 8 },
      corridor: { id: "corridor", name: "走廊", x: 0, z: 8, length: 10, width: 2 },
      walls: [], doorways: [],
    };
    // The dice's queue anchor faces 0° = +Z.
    const p0 = queuePlacement(station as never, 0, spatial as never);
    const p1 = queuePlacement(station as never, 1, spatial as never);
    expect(p1.point.z).toBeGreaterThan(p0.point.z);
    expect(Math.abs(p1.point.x - p0.point.x)).toBeLessThan(0.01);
  });
});

describe("§63 validation", () => {
  it("warns when a player anchor lands outside the venue", () => {
    const project = createDefaultProject();
    const def = dice();
    project.props = [def];
    project.objects.push({
      id: "obj1", kind: "table", name: def.name,
      // Near the south edge, facing so the player anchor (0, 0.9) leaves the room.
      x: 5, z: project.classroom.z + 0.1, rotationDeg: 180,
      width: 0.6, depth: 0.6, height: 0.6, locked: false, hidden: false,
      assetId: entryFromProp(def).id,
    } as never);
    const issues = validateProject(project);
    expect(issues.some((i) => i.code === "prop-anchor-outside")).toBe(true);
  });

  it("warns when two interactive stations sit inside each other's zone", () => {
    const project = createDefaultProject();
    const def = dice();
    project.props = [def];
    for (const [id, x] of [["obj1", 4], ["obj2", 5]] as const) {
      project.objects.push({
        id, kind: "table", name: def.name, x, z: 4, rotationDeg: 0,
        width: 0.6, depth: 0.6, height: 0.6, locked: false, hidden: false,
        assetId: entryFromProp(def).id,
      } as never);
    }
    const issues = validateProject(project);
    expect(issues.some((i) => i.code === "prop-zone-overlap")).toBe(true);
  });

  it("stays quiet for well-spaced props", () => {
    const project = createDefaultProject();
    const def = dice();
    project.props = [def];
    project.objects.push({
      id: "obj1", kind: "table", name: def.name, x: 5, z: 4, rotationDeg: 0,
      width: 0.6, depth: 0.6, height: 0.6, locked: false, hidden: false,
      assetId: entryFromProp(def).id,
    } as never);
    const issues = validateProject(project);
    expect(issues.filter((i) => i.code.startsWith("prop-"))).toEqual([]);
  });
});
