/**
 * The Studio's edit operations — fork, group, relate, and the device library.
 *
 * §93's script is the reason absorb exists: place a table, a standee, a dice
 * and a board, group them into 「骰子遊戲站」, move the group, and everything —
 * anchors included — must ride along. Anchors riding along is free only
 * because absorb re-expresses them relative to the new single object; that
 * arithmetic is what these tests pin.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { absorbSelection, forkDefinition, overlappingParts, relatePartOffset } from "../src/core/propEdit";
import { propPreset } from "../src/core/propPresets";
import {
  deleteLibraryProp,
  libraryIsNewer,
  listLibraryProps,
  loadLibraryProp,
  saveLibraryProp,
} from "../src/state/propLibrary";
import type { PropPart, SceneObject } from "../src/core/model";

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

const obj = (id: string, x: number, z: number, over: Partial<SceneObject> = {}): SceneObject => ({
  id, kind: "table", x, z, rotationDeg: 0,
  width: 0.6, depth: 0.6, height: 0.6,
  locked: false, hidden: false, surface: "floor", elevation: 0,
  ...over,
} as SceneObject);

describe("§71 fork", () => {
  it("a fork is its own definition — new id, reset version, marked name", () => {
    const original = propPreset("prop_dice")!;
    const fork = forkDefinition(original);
    expect(fork.id).not.toBe(original.id);
    expect(fork.version).toBe(1);
    expect(fork.name).toContain(original.name);
    // Deep copy: editing the fork's faces must not reach the original.
    const forkStep = fork.interaction!.steps[0];
    if (forkStep.branch?.kind === "chance") forkStep.branch.options[0].label = "改了";
    const origStep = original.interaction!.steps[0];
    if (origStep.branch?.kind === "chance") {
      expect(origStep.branch.options[0].label).not.toBe("改了");
    }
  });
});

describe("§93 group into one prop", () => {
  const diceEntry = "custom:prop_dice";

  it("parts land at their relative positions around the selection centre", () => {
    const result = absorbSelection({
      objects: [obj("a", 2, 2), obj("b", 4, 2)],
      props: [propPreset("prop_dice")!],
      entryFor: () => ({ color: "#c8b6a6", name: "桌" }),
    }, "組合")!;
    // Centre is (3,2): the plain boxes sit at ±1 on x.
    const xs = result.def.parts.map((p) => p.offset.x).sort((p, q) => p - q);
    expect(xs[0]).toBeCloseTo(-1, 6);
    expect(xs[1]).toBeCloseTo(1, 6);
  });

  it("the dice's interaction AND anchors ride into the assembly, shifted", () => {
    const dice = obj("dice1", 5, 3, { assetId: diceEntry } as never);
    const table = obj("table1", 3, 3);
    const result = absorbSelection({
      objects: [table, dice],
      props: [propPreset("prop_dice")!],
      entryFor: () => ({ color: "#c8b6a6", name: "桌" }),
    }, "骰子遊戲站")!;
    expect(result.def.interaction, "the game came along").toBeDefined();
    expect(result.droppedInteractions).toEqual([]);
    // The dice sits +1 from centre; its player anchor (0, 0.9) must now be
    // (1, 0.9) — still in front of the DICE, not in front of the table.
    const player = result.def.anchors.find((a) => a.role === "player")!;
    expect(player.x).toBeCloseTo(1, 6);
    expect(player.z).toBeCloseTo(0.9, 6);
  });

  it("a second game is dropped AND named — never silently merged", () => {
    const dice = obj("d1", 2, 2, { assetId: "custom:prop_dice" } as never);
    const cards = obj("c1", 4, 2, { assetId: "custom:prop_cardbox" } as never);
    const result = absorbSelection({
      objects: [dice, cards],
      props: [propPreset("prop_dice")!, propPreset("prop_cardbox")!],
      entryFor: () => undefined,
    })!;
    expect(result.def.interaction).toBeDefined();
    expect(result.droppedInteractions).toEqual(["抽卡箱"]);
  });

  it("the assembly's footprint covers the whole selection", () => {
    const result = absorbSelection({
      objects: [obj("a", 0, 0), obj("b", 3, 0)],
      props: undefined,
      entryFor: () => undefined,
    })!;
    expect(result.def.dimensions.width).toBeCloseTo(3.6, 6);
  });
});

describe("§46-48 relations", () => {
  const base: PropPart = {
    id: "table", shape: "box",
    size: { width: 1.8, depth: 0.6, height: 0.74 },
    offset: { x: 0, y: 0, z: 0 },
  };

  it("「放在上面」 computes the height — nobody types a Z", () => {
    const offset = relatePartOffset(base, { width: 0.3, depth: 0.3, height: 0.3 }, "on-top");
    expect(offset.y).toBeCloseTo(0.74, 6);
    expect(offset.x).toBe(0);
  });

  it("「放前面」 and 「放旁邊」 clear the base's footprint", () => {
    const front = relatePartOffset(base, { width: 0.3, depth: 0.3, height: 0.3 }, "in-front");
    expect(front.z).toBeGreaterThan(0.3);
    const beside = relatePartOffset(base, { width: 0.3, depth: 0.3, height: 0.3 }, "beside");
    expect(beside.x).toBeGreaterThan(0.9);
  });

  it("interpenetrating parts are named, stacked parts are not", () => {
    const stacked: PropPart = { ...base, id: "dice", size: { width: 0.3, depth: 0.3, height: 0.3 }, offset: { x: 0, y: 0.74, z: 0 } };
    expect(overlappingParts([base, stacked])).toEqual([]);
    const sunk: PropPart = { ...stacked, id: "sunk", offset: { x: 0, y: 0.3, z: 0 } };
    expect(overlappingParts([base, sunk])).toEqual([["table", "sunk"]]);
  });
});

describe("我的道具 (device library)", () => {
  it("saves, lists, loads, deletes", () => {
    const def = propPreset("prop_dice")!;
    saveLibraryProp(def);
    expect(listLibraryProps().map((m) => m.name)).toEqual(["大型骰子"]);
    expect(loadLibraryProp(def.id)!.parts).toHaveLength(1);
    deleteLibraryProp(def.id);
    expect(listLibraryProps()).toEqual([]);
    expect(loadLibraryProp(def.id)).toBeNull();
  });

  it("loads through the defensive funnel — a corrupt body returns null, not a crash", () => {
    localStorage.setItem("planform-iso:prop-library:prop_bad", "{{{nope");
    expect(loadLibraryProp("prop_bad")).toBeNull();
  });

  it("§39: knows when the library copy is newer than the project's snapshot", () => {
    const def = propPreset("prop_dice")!;
    saveLibraryProp({ ...def, version: 3 });
    expect(libraryIsNewer({ ...def, version: 1 })).toBe(true);
    expect(libraryIsNewer({ ...def, version: 3 })).toBe(false);
    expect(libraryIsNewer({ ...def, id: "prop_unknown", version: 1 })).toBe(false);
  });
});
