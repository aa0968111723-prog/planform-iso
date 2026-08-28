/**
 * Two ways an afternoon's work went away without a word.
 *
 *   1. 匯入 JSON asks 「載入前已保留一個復原步驟。要繼續嗎？」 and then decided
 *      for itself whether the plan was worth keeping — with a four-array test
 *      that says a resized room, a measured tile, a confirmed calibration and
 *      three 尺寸線 amount to nothing. The undo stack was cleared, so the
 *      promised step did not exist and Ctrl+Z did nothing.
 *   2. 儲存 on 已存的排法 overwrote a version of the same name blind, with no
 *      confirm and `history: false`, while 刪除 ten lines below has always
 *      asked. The name field defaults to the project's own name, so pressing
 *      儲存 twice was enough.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { Store } from "../src/state/store";
import { createDefaultProject, planHasContent, type Project } from "../src/core/model";

function installLocalStorage(): void {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
}
beforeEach(() => installLocalStorage());
installLocalStorage();

/** A plan whose entire content is venue work: every array is empty. */
function venueOnlyPlan(): Project {
  const p = createDefaultProject();
  p.classroom = { ...p.classroom, length: 13.2, width: 9.9 };
  p.tile = { ...p.tile, width: 0.55, depth: 0.55 };
  p.calibration = { ...p.calibration, confirmed: { tile: true }, referenceLength: 0.55 };
  p.name = "E310 實測版";
  return p;
}

describe("匯入 JSON keeps the undo step it promises", () => {
  it("the plan it is about to replace is not 'empty' just because the arrays are", () => {
    const plan = venueOnlyPlan();
    expect(plan.objects).toHaveLength(0);
    expect(plan.zones).toHaveLength(0);
    // This is the disagreement the bug lived in: the dialog asked
    // `planHasContent`, the store asked four arrays.
    expect(planHasContent(plan)).toBe(true);
  });

  it("undo brings the replaced plan back", () => {
    const store = new Store(venueOnlyPlan());
    store.loadProject(createDefaultProject());
    expect(store.canUndo()).toBe(true);
    store.undo();
    expect(store.getState().name).toBe("E310 實測版");
    expect(store.getState().classroom.length).toBeCloseTo(13.2, 6);
  });

  it("an explicit undoBeforeLoad: false still means no checkpoint", () => {
    const store = new Store(venueOnlyPlan());
    store.loadProject(createDefaultProject(), { undoBeforeLoad: false });
    expect(store.canUndo()).toBe(false);
  });

  it("a genuinely untouched plan keeps no pointless checkpoint", () => {
    const store = new Store(createDefaultProject());
    store.loadProject(venueOnlyPlan());
    expect(store.canUndo()).toBe(false);
  });
});

describe("已存的排法 does not overwrite silently", () => {
  it("the store can be asked whether a name is taken", () => {
    const store = new Store(venueOnlyPlan());
    expect(store.hasNamedLayout("方案 A")).toBe(false);
    store.saveNamedLayout("方案 A");
    expect(store.hasNamedLayout("方案 A")).toBe(true);
    // The panel asks this before saving; without it the second 儲存 replaced
    // the first arrangement with no confirm and no undo.
    expect(store.hasNamedLayout("方案 B")).toBe(false);
  });

  it("saving really does replace, which is why the question has to be asked", () => {
    const store = new Store(venueOnlyPlan());
    store.saveNamedLayout("方案 A");
    store.mutate((p) => { p.classroom.length = 8; });
    store.saveNamedLayout("方案 A");
    expect(store.listLayouts()).toEqual(["方案 A"]);
    store.loadNamedLayout("方案 A");
    expect(store.getState().classroom.length).toBe(8);
  });

  it("loading a saved version keeps an undo step, whatever the plan holds", () => {
    const store = new Store(venueOnlyPlan());
    store.saveNamedLayout("方案 A");
    store.mutate((p) => { p.classroom.length = 8; });
    store.loadNamedLayout("方案 A");
    expect(store.canUndo()).toBe(true);
    store.undo();
    expect(store.getState().classroom.length).toBe(8);
  });
});
