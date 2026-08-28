/**
 * Step 7 — the AI recipe, and the preview that has to mention it.
 *
 * The rule this whole path exists to keep: an agent may propose a RECIPE, and
 * nothing else. It never writes geometry and never writes project JSON, so an
 * AI-made prop is the same kind of object as a hand-made one and opens in the
 * same Studio. Anything the recipe cannot express, it cannot do.
 *
 * The second claim, and the one the plan singled out: a recipe must be VISIBLE
 * in the preview table. A change the user is asked to accept but is not shown
 * is worse than no preview at all.
 */

import { describe, expect, it } from "vitest";
import { describeRecipe, propFromRecipe } from "../src/core/propRecipe";
import { AgentTransaction } from "../src/agent/transaction";
import { propPreset } from "../src/core/propPresets";
import { migrateProps } from "../src/core/migrate";
import { entryFromProp, propEntryId } from "../src/core/propCatalog";
import { createProjectFromVenuePreset, venuePresetById } from "../src/core/venues";
import type { Project, PropDefinition } from "../src/core/model";

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

const facesOf = (def: PropDefinition) => {
  const branch = def.interaction?.steps.find((s) => s.branch?.kind === "chance")?.branch;
  return branch?.kind === "chance" ? branch.options : undefined;
};

describe("a recipe becomes a real definition", () => {
  it("a six-face dice with written questions is playable and editable", () => {
    const def = propFromRecipe({
      name: "心情骰子",
      kind: "dice",
      faces: [
        { label: "開心", prompt: "說一件今天開心的事", color: "#fbbf24" },
        { label: "疲憊", prompt: "最近什麼讓你累" },
        { label: "期待", prompt: "接下來期待什麼" },
        { label: "感謝", prompt: "想謝謝誰" },
        { label: "煩惱", prompt: "有什麼卡住了" },
        { label: "自由", prompt: "隨便聊" },
      ],
    }, "prop_x");

    expect(def.id).toBe("prop_x");
    expect(def.name).toBe("心情骰子");
    expect(def.source).toBe("agent");
    const faces = facesOf(def)!;
    expect(faces.map((f) => f.label)).toEqual(["開心", "疲憊", "期待", "感謝", "煩惱", "自由"]);
    expect(faces[0].prompt).toBe("說一件今天開心的事");
    expect(faces[0].color).toBe("#fbbf24");
    // Faces with no colour still get one, or the 3D dice renders blank.
    expect(faces[1].color).toMatch(/^#/);
    // It is a normal prop: it has a rolling part and somewhere to stand.
    expect(def.parts.some((p) => p.facesFromOptions)).toBe(true);
    expect(def.anchors.some((a) => a.role === "player")).toBe(true);
  });

  it("survives the same defensive funnel a saved prop goes through", () => {
    const def = propFromRecipe({ name: "AI 轉盤", kind: "spinner" }, "prop_y");
    const round = migrateProps([JSON.parse(JSON.stringify(def))])![0];
    expect(round.name).toBe("AI 轉盤");
    expect(round.parts.length).toBe(def.parts.length);
  });

  it("mirrors to a catalog entry like any other prop — it is placeable", () => {
    const def = propFromRecipe({ name: "AI 箱子", kind: "box" }, "prop_z");
    const entry = entryFromProp(def);
    expect(entry.id).toBe(propEntryId(def));
    expect(entry.name).toBe("AI 箱子");
    // Degrades inside the original eight kinds for old builds.
    expect(["table", "mat"]).toContain(entry.kind);
  });

  it("an unknown kind is a plain box, not a crash and not nothing", () => {
    const def = propFromRecipe({ name: "外星裝置", kind: "teleporter" }, "prop_q");
    expect(def.parts).toHaveLength(1);
    expect(def.parts[0].shape).toBe("box");
    expect(def.interaction).toBeUndefined();
  });

  it("sizes are clamped — a 900 m dice is not placeable in a classroom", () => {
    const huge = propFromRecipe({
      name: "大", kind: "dice", dimensions: { width: 900, depth: 900, height: 900 },
    }, "p1");
    expect(huge.dimensions.width).toBeLessThanOrEqual(6);
    expect(huge.dimensions.height).toBeLessThanOrEqual(4);
    const tiny = propFromRecipe({
      name: "小", kind: "dice", dimensions: { width: 0, depth: -5, height: NaN },
    }, "p2");
    expect(tiny.dimensions.width).toBeGreaterThan(0);
    expect(tiny.dimensions.depth).toBeGreaterThan(0);
    expect(Number.isFinite(tiny.dimensions.height)).toBe(true);
  });

  it("resizing carries the anchors, or people would stand inside the prop", () => {
    const base = propPreset("prop_dice")!;
    const big = propFromRecipe({
      name: "大骰子", kind: "dice", dimensions: { width: 1.2, depth: 1.2, height: 1.2 },
    }, "p3");
    const before = base.anchors.find((a) => a.role === "player")!;
    const after = big.anchors.find((a) => a.role === "player")!;
    expect(after.z).toBeCloseTo(before.z * 2, 6);
  });

  it("「裝飾用的」 turns the game off", () => {
    const def = propFromRecipe({ name: "擺飾骰子", kind: "dice", interactive: false }, "p4");
    expect(def.interaction).toBeUndefined();
    expect(def.parts.length).toBeGreaterThan(0);
  });

  it("describes itself in one sentence a person can check", () => {
    const dice = propFromRecipe({ name: "心情骰子", kind: "dice" }, "p5");
    expect(describeRecipe(dice)).toContain("心情骰子");
    expect(describeRecipe(dice)).toContain("6 個面");
    const table = propFromRecipe({ name: "桌子", kind: "table" }, "p6");
    expect(describeRecipe(table)).toContain("裝飾用");
  });
});

describe("the preview table must mention the prop", () => {
  // A REAL project: summarize() runs validateProject, which needs the venue.
  const base = (): Project => createProjectFromVenuePreset(venuePresetById("venue:tku-e310")!, "測試");

  it("a recipe shows up as a named change, not as silence", () => {
    const tx = new AgentTransaction();
    tx.start(base());
    const def = propFromRecipe({ name: "心情骰子", kind: "dice" }, "prop_new");
    tx.mutate((p) => { p.props = [...(p.props ?? []), def]; });

    const summary = tx.summarize();
    expect(summary.addedPropIds).toEqual(["prop_new"]);
    expect(summary.notes.join(" ")).toContain("心情骰子");
  });

  it("edits and removals are named too", () => {
    const def = propFromRecipe({ name: "心情骰子", kind: "dice" }, "prop_new");
    const project = { ...base(), props: [def] };

    const edit = new AgentTransaction();
    edit.start(project);
    edit.mutate((p) => { p.props![0] = { ...p.props![0], name: "改過的骰子", version: 2 }; });
    expect(edit.summarize().changedPropIds).toEqual(["prop_new"]);
    expect(edit.summarize().notes.join(" ")).toContain("改過的骰子");

    const drop = new AgentTransaction();
    drop.start(project);
    drop.mutate((p) => { delete p.props; });
    expect(drop.summarize().removedPropIds).toEqual(["prop_new"]);
    expect(drop.summarize().notes.join(" ")).toContain("移除道具");
  });

  it("an untouched project reports no prop changes", () => {
    const tx = new AgentTransaction();
    tx.start({ ...base(), props: [propFromRecipe({ name: "骰子", kind: "dice" }, "p")] });
    const s = tx.summarize();
    expect([s.addedPropIds, s.changedPropIds, s.removedPropIds]).toEqual([[], [], []]);
  });

  it("committing a DELETED optional block actually deletes it", () => {
    // `Object.assign` copies the keys a draft HAS; a key it deleted used to
    // stay behind, so removing every prop silently did nothing on commit.
    const project = { ...base(), props: [propFromRecipe({ name: "骰子", kind: "dice" }, "p")] };
    let committed: Project = project;
    const store = {
      getState: () => committed,
      mutate: (fn: (p: Project) => void) => { const next = structuredClone(committed); fn(next); committed = next; },
    };
    const tx = new AgentTransaction();
    tx.start(project);
    tx.mutate((p) => { delete p.props; });
    tx.commit(store as never);
    expect(committed.props).toBeUndefined();
  });
});

describe("§40 the GLB upgrade path", () => {
  it("a definition can borrow an imported model's visual and keep everything else", () => {
    const def = { ...propPreset("prop_dice")!, visualFrom: "glb:blob-123" };
    const entry = entryFromProp(def);
    expect(entry.visualRef, "the scene draws the model").toBe("glb:blob-123");
    // The prop's own identity is untouched: anchors, game, footprint, symbol.
    expect(entry.planSymbolRef).toBe(`plan:prop:${def.id}`);
    expect(entry.dimensions).toEqual(def.dimensions);
    expect(def.anchors).toHaveLength(4);
    expect(facesOf(def)).toHaveLength(6);
  });

  it("without it the prop draws itself, and `parts` remains the fallback", () => {
    const def = propPreset("prop_dice")!;
    expect(entryFromProp(def).visualRef).toBe(`prop:${def.id}`);
    expect(def.parts.length).toBeGreaterThan(0);
  });

  it("the link survives a save and reload", () => {
    const def = { ...propPreset("prop_dice")!, visualFrom: "glb:blob-123" };
    const round = migrateProps([JSON.parse(JSON.stringify(def))])![0];
    expect(round.visualFrom).toBe("glb:blob-123");
  });
});
