/**
 * Prop definitions: what survives a save, what degrades, what never drifts.
 *
 * The three claims this file exists to pin:
 *   1. a definition round-trips verbatim, and one corrupt definition costs
 *      only itself, never the project (§77);
 *   2. the mirrored catalog entry is DERIVED, one way — its name, dimensions
 *      and version cannot disagree with the definition's;
 *   3. a file mauled by an older build (props block gone, station bindings
 *      stripped) comes back rebindable, not silently frozen.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { migrateProject } from "../src/core/migrate";
import {
  entryFromProp,
  propEntryId,
  propForAssetId,
  propVisualRef,
  syncPropEntries,
} from "../src/core/propCatalog";
import {
  createDefaultProject,
  planHasContent,
  type Project,
  type PropDefinition,
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

const roundTrip = (p: Partial<Project>): Project =>
  migrateProject(JSON.parse(JSON.stringify(p)) as Partial<Project>);

function diceDefinition(): PropDefinition {
  return {
    id: "prop_dice1",
    name: "城市微光骰子",
    category: "互動",
    dimensions: { width: 0.6, depth: 0.6, height: 0.6 },
    parts: [
      {
        id: "cube",
        shape: "box",
        size: { width: 0.6, depth: 0.6, height: 0.6 },
        offset: { x: 0, y: 0, z: 0 },
        color: "#f4f4f5",
        finish: "plastic-matte",
        facesFromOptions: true,
      },
    ],
    anchors: [
      { id: "player", role: "player", x: 0, z: 0.9 },
      { id: "staff", role: "staff", x: 0.9, z: 0 },
      { id: "queue", role: "queue", x: 0, z: 1.5, facingDeg: 180 },
      { id: "exit", role: "exit", x: -1.2, z: 0 },
    ],
    interaction: {
      steps: [
        {
          id: "roll",
          name: "擲骰",
          avgSeconds: 15,
          branch: {
            kind: "chance",
            record: "face",
            options: Array.from({ length: 6 }, (_, i) => ({
              id: `f${i + 1}`,
              label: `第 ${i + 1} 面`,
              weight: 1,
              color: "#38bdf8",
            })),
          },
        },
        { id: "talk", name: "對談", avgSeconds: 90, next: null },
      ],
      station: { meanServiceSeconds: 105, parallelServers: 1, queueCapacity: 6 },
      staffRole: { name: "骰子站", count: 1 },
      skipRate: 0.35,
    },
    clearance: 1.2,
    interactionZone: 1.2,
    icon: "🎲",
    version: 3,
    source: "user",
  };
}

describe("a definition survives being saved and opened", () => {
  it("comes back field for field, including face colours on the options", () => {
    const p = roundTrip({ ...createDefaultProject(), props: [diceDefinition()] });
    expect(p.props).toEqual([diceDefinition()]);
  });

  it("does not appear on a project that never had one", () => {
    const p = roundTrip(createDefaultProject());
    expect("props" in p).toBe(false);
  });

  it("one corrupt definition costs itself, not the project", () => {
    const broken = { name: 42, parts: "nope" };
    const p = roundTrip({
      ...createDefaultProject(),
      props: [broken as never, diceDefinition()],
    });
    expect(p.props).toHaveLength(1);
    expect(p.props![0].name).toBe("城市微光骰子");
  });

  it("a definition-only plan counts as content", () => {
    const p = { ...createDefaultProject(), props: [diceDefinition()] };
    // Without this, 「取代目前專案」 judges an afternoon in Prop Studio as
    // nothing worth an undo checkpoint.
    expect(planHasContent(p)).toBe(true);
  });

  it("station anchor fields survive the save", () => {
    const base = createDefaultProject();
    const p = roundTrip({
      ...base,
      interaction: {
        id: "flow1", name: "流程",
        steps: [{ id: "a", name: "玩", avgSeconds: 30, next: null }],
        startStepId: "a",
        stations: [{
          id: "prop_obj1", name: "骰子站", type: "custom",
          x: 1, z: 2, staffCount: 1, parallelServers: 1,
          meanServiceSeconds: 30, queueCapacity: 6,
          objectId: "obj1",
          anchorOffset: { x: 0, z: 0.9 },
          queueDirectionDeg: 180,
        }],
        staff: [], segments: [{ id: "all", name: "訪客", share: 1, startStepId: "a" }],
        audience: { count: 60, windowSeconds: 3600, profile: "uniform", stopRate: 1, joinRate: 1, patienceSeconds: 0 },
        seed: 1, settings: { speedMetersPerSecond: 1.2 },
      },
    });
    const st = p.interaction!.stations[0];
    expect(st.anchorOffset).toEqual({ x: 0, z: 0.9 });
    expect(st.queueDirectionDeg).toBe(180);
  });
});

describe("the mirrored entry is derived, one way", () => {
  it("carries the definition's name, dimensions, version and refs", () => {
    const def = diceDefinition();
    const entry = entryFromProp(def);
    expect(entry.id).toBe(propEntryId(def));
    expect(entry.name).toBe(def.name);
    expect(entry.dimensions).toEqual(def.dimensions);
    expect(entry.version).toBe(def.version);
    expect(entry.visualRef).toBe(propVisualRef(def));
    expect(entry.planSymbolRef).toBe(`plan:prop:${def.id}`);
    // Inside the original eight kinds, or an older build deletes the entry
    // and every placed instance falls back to a builtin silently.
    expect(["table", "mat"]).toContain(entry.kind);
  });

  it("cannot drift: regenerating after an edit replaces the old entry", () => {
    const def = diceDefinition();
    const before = syncPropEntries([], [def]);
    const edited = { ...def, name: "改名了", version: def.version + 1 };
    const after = syncPropEntries(before, [edited]);
    expect(after).toHaveLength(1);
    expect(after[0].name).toBe("改名了");
    expect(after[0].version).toBe(def.version + 1);
  });

  it("leaves booth and import extras alone, and removes orphaned prop entries", () => {
    const foreign = { id: "custom:booth-tent", tags: ["booth"] } as never;
    const withDef = syncPropEntries([foreign], [diceDefinition()]);
    expect(withDef).toHaveLength(2);
    const without = syncPropEntries(withDef, []);
    // The definition is gone; an entry claiming otherwise is a lie about what
    // the plan contains.
    expect(without).toHaveLength(1);
    expect(without[0].id).toBe("custom:booth-tent");
  });

  it("finds the definition a placed object points at", () => {
    const def = diceDefinition();
    expect(propForAssetId([def], propEntryId(def))?.id).toBe(def.id);
    expect(propForAssetId([def], "custom:booth-tent")).toBeUndefined();
    expect(propForAssetId([def], undefined)).toBeUndefined();
  });
});

describe("a file mauled by an older build comes back rebindable", () => {
  /** What an old build's whitelist does: strips objectId from stations. */
  function mauledByOldBuild(p: Project): Partial<Project> {
    const clone = JSON.parse(JSON.stringify(p)) as Project;
    delete (clone as Partial<Project>).props;
    for (const st of clone.interaction?.stations ?? []) {
      delete st.objectId;
      delete st.anchorOffset;
      delete st.queueDirectionDeg;
    }
    return clone;
  }

  it("prop stations re-bind to their object by their deterministic id", () => {
    const base = createDefaultProject();
    base.objects.push({
      id: "obj9", kind: "table", name: "骰子桌", x: 3, z: 4,
      width: 0.6, depth: 0.6, height: 0.6, rotationDeg: 0,
      locked: false, hidden: false,
    } as never);
    const project: Project = {
      ...base,
      interaction: {
        id: "flow1", name: "流程",
        steps: [{ id: "a", name: "玩", avgSeconds: 30, next: null }],
        startStepId: "a",
        stations: [{
          id: "prop_obj9", name: "骰子站", type: "custom",
          x: 3, z: 4, staffCount: 1, parallelServers: 1,
          meanServiceSeconds: 30, queueCapacity: 6, objectId: "obj9",
        }],
        staff: [], segments: [{ id: "all", name: "訪客", share: 1, startStepId: "a" }],
        audience: { count: 60, windowSeconds: 3600, profile: "uniform", stopRate: 1, joinRate: 1, patienceSeconds: 0 },
        seed: 1, settings: { speedMetersPerSecond: 1.2 },
      },
    };
    const back = roundTrip(mauledByOldBuild(project));
    // The binding was stripped; the deterministic id carries enough to restore
    // it — without this, the station keeps running at stale coordinates, which
    // is worse than disappearing.
    expect(back.interaction!.stations[0].objectId).toBe("obj9");
  });

  it("but never invents a binding for an object that is gone", () => {
    const project = roundTrip({
      ...createDefaultProject(),
      interaction: {
        id: "flow1", name: "流程",
        steps: [{ id: "a", name: "玩", avgSeconds: 30, next: null }],
        startStepId: "a",
        stations: [{
          id: "prop_ghost", name: "站", type: "custom",
          x: 1, z: 1, staffCount: 1, parallelServers: 1,
          meanServiceSeconds: 30, queueCapacity: 6,
        }],
        staff: [], segments: [{ id: "all", name: "訪客", share: 1, startStepId: "a" }],
        audience: { count: 60, windowSeconds: 3600, profile: "uniform", stopRate: 1, joinRate: 1, patienceSeconds: 0 },
        seed: 1, settings: { speedMetersPerSecond: 1.2 },
      },
    } as Partial<Project>);
    expect(project.interaction!.stations[0].objectId).toBeUndefined();
  });
});
