/**
 * The mirror, tested at the scope the original guard missed.
 *
 * `test/propModel.test.ts` exercises `syncPropEntries` in isolation and is
 * green; an architecture review then found two ways a project drifts anyway,
 * both only visible once you go through `migrateProject` — the actual load
 * path. The lesson is the same one this feature keeps teaching: correct in
 * isolation, wrong once composed. So every fixture here does a real round
 * trip.
 */

import { describe, expect, it } from "vitest";
import { migrateProject, migrateProps, resolveStationPosition } from "../src/core/migrate";
import { entryFromProp, propEntryId, propForAssetId } from "../src/core/propCatalog";
import {
  instantiatePropInteraction,
  liveSeedFromInstance,
  propStationId,
  propTemplateSkeleton,
  reseedPropInteraction,
} from "../src/core/interactionCompile";
import { propPreset } from "../src/core/propPresets";
import { createProjectFromVenuePreset, venuePresetById } from "../src/core/venues";
import type { Project, PropDefinition, SceneObject } from "../src/core/model";

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
const blank = (): Project => createProjectFromVenuePreset(venuePresetById("venue:tku-e310")!, "測試");
const roundTrip = (p: Project): Project => migrateProject(JSON.parse(JSON.stringify(p))) as Project;

const placedObject = (assetId: string, id = "obj1"): SceneObject => ({
  id, kind: "table", x: 4, z: 3, rotationDeg: 0,
  width: 0.6, depth: 0.6, height: 0.6,
  locked: false, hidden: false, surface: "floor", elevation: 0,
  assetId,
} as SceneObject);

describe("the mirror is regenerated on load", () => {
  it("a project whose catalogExtras were stripped comes back placeable", () => {
    // An older build, a hand-edited file, or an import can carry the props and
    // no entries. Without regeneration the placed prop resolved to a plain
    // grey table — no faces, no anchors, no plan symbol — permanently.
    const def = dice();
    const project: Project = {
      ...blank(),
      props: [def],
      catalogExtras: [],
      objects: [placedObject(propEntryId(def))],
    };
    const loaded = roundTrip(project);
    const entry = loaded.catalogExtras?.find((e) => e.id === propEntryId(def));
    expect(entry, "the entry is derived data — regenerate it").toBeDefined();
    expect(entry!.visualRef).toBe(`prop:${def.id}`);
    expect(entry!.planSymbolRef).toBe(`plan:prop:${def.id}`);
  });

  it("the loader does not rewrite the entry it was handed", () => {
    const def = dice();
    const project: Project = { ...blank(), props: [def], catalogExtras: [] };
    const loaded = roundTrip(project);
    const entry = loaded.catalogExtras!.find((e) => e.id === propEntryId(def))!;
    const generated = entryFromProp(def);
    // Every field the generator sets must survive the whitelist. `createdBy`
    // was being rewritten from "studio" to "photo".
    for (const key of ["name", "visualRef", "planSymbolRef", "icon", "createdBy", "version"] as const) {
      expect(entry[key as keyof typeof entry], key).toEqual(generated[key as keyof typeof generated]);
    }
  });

  it("a project with no props is untouched — no empty block invented", () => {
    const loaded = roundTrip(blank());
    expect(loaded.props).toBeUndefined();
  });

  it("an entry whose definition is gone does not survive the trip", () => {
    const def = dice();
    const project: Project = {
      ...blank(),
      props: [def],
      catalogExtras: [entryFromProp({ ...def, id: "prop_ghost" }) as never],
    };
    const loaded = roundTrip(project);
    expect(loaded.catalogExtras!.some((e) => e.id === "custom:prop_ghost")).toBe(false);
  });
});

describe("the Studio opens what is RUNNING", () => {
  it("liveSeedFromInstance is what a single-instance edit must start from", () => {
    const def = dice();
    const flow = instantiatePropInteraction(propTemplateSkeleton(), def, "obj1", { x: 4, z: 3 });
    const roll = flow.steps.find((s) => s.id === "p_obj1_roll")!;
    if (roll.branch?.kind !== "chance") throw new Error("no chance");
    roll.branch.options.forEach((o, i) => { o.label = `真心話 ${i + 1}`; });

    const seed = liveSeedFromInstance(flow, def, "obj1")!;
    const faces = seed.steps.find((s) => s.branch?.kind === "chance")!;
    if (faces.branch?.kind !== "chance") throw new Error("no chance");
    expect(faces.branch.options.map((o) => o.label))
      .toEqual([1, 2, 3, 4, 5, 6].map((n) => `真心話 ${n}`));
  });

  it("open-edit-save is a ROUND TRIP, not a revert", () => {
    // The sequence that used to destroy work: rename the faces in the flow
    // panel, reopen the Studio to change one colour, save.
    const def = dice();
    let flow = instantiatePropInteraction(propTemplateSkeleton(), def, "obj1", { x: 4, z: 3 });
    const roll = flow.steps.find((s) => s.id === "p_obj1_roll")!;
    if (roll.branch?.kind !== "chance") throw new Error("no chance");
    roll.branch.options.forEach((o, i) => { o.label = `真心話 ${i + 1}`; });

    // Studio opens from the live state…
    const opened = { ...def, interaction: liveSeedFromInstance(flow, def, "obj1") };
    // …the person changes one colour…
    const step = opened.interaction!.steps.find((s) => s.branch?.kind === "chance")!;
    if (step.branch?.kind !== "chance") throw new Error("no chance");
    step.branch.options[0].color = "#ff0000";
    // …and saves.
    flow = reseedPropInteraction(flow, opened, "obj1");

    const after = flow.steps.find((s) => s.id === "p_obj1_roll")!;
    if (after.branch?.kind !== "chance") throw new Error("no chance");
    expect(after.branch.options.map((o) => o.label), "the six names must survive")
      .toEqual([1, 2, 3, 4, 5, 6].map((n) => `真心話 ${n}`));
    expect(after.branch.options[0].color).toBe("#ff0000");
  });
});

describe("an anchor removed from a definition is removed from the station", () => {
  it("dropping the player anchor clears the station's offset", () => {
    const def = dice();
    let flow = instantiatePropInteraction(propTemplateSkeleton(), def, "obj1", { x: 4, z: 3 });
    expect(flow.stations[0].anchorOffset).toEqual({ x: 0, z: 0.9 });

    const noPlayer = { ...def, anchors: def.anchors.filter((a) => a.role !== "player") };
    flow = reseedPropInteraction(flow, noPlayer, "obj1");
    const station = flow.stations.find((s) => s.id === propStationId("obj1"))!;
    expect(station.anchorOffset, "a spread cannot delete — this had to be explicit")
      .toBeUndefined();

    // And the simulation now stands people at the object, not at a spot the
    // definition no longer describes.
    const project = { objects: [placedObject("custom:prop_dice")], zones: [] } as unknown as Project;
    expect(resolveStationPosition(project, station)).toEqual({ x: 4, z: 3 });
  });

  it("a fresh station carries no empty anchor keys", () => {
    const bare = { ...dice(), anchors: [] };
    const flow = instantiatePropInteraction(propTemplateSkeleton(), bare, "obj1", { x: 1, z: 1 });
    const station = flow.stations[0];
    expect(Object.prototype.hasOwnProperty.call(station, "anchorOffset")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(station, "queueDirectionDeg")).toBe(false);
  });
});

describe("the prop id invariant the lookup depends on", () => {
  it("propForAssetId answers for a normal definition", () => {
    const def = dice();
    expect(propForAssetId([def], propEntryId(def))).toBe(def);
  });

  it("an id arriving without the prefix is GIVEN one, not left invisible", () => {
    // Every prop path goes through propForAssetId, which answers only for
    // `prop_` ids. A definition imported with a bare id used to get a valid,
    // placeable catalog entry and then be invisible to every lookup: a grey
    // box with no faces, no anchors and no validation, and nothing to explain
    // it. The invariant is now established on the way in.
    const odd = { ...dice(), id: "mydice" };
    const fixed = migrateProps([JSON.parse(JSON.stringify(odd))])![0];
    expect(fixed.id).toBe("prop_mydice");
    expect(propForAssetId([fixed], propEntryId(fixed))).toBe(fixed);
  });

  it("a conforming id is left exactly as it was", () => {
    const def = dice();
    expect(migrateProps([JSON.parse(JSON.stringify(def))])![0].id).toBe(def.id);
  });
});
