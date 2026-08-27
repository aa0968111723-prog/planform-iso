/**
 * PR #19 review P1 — 「Preserve venue-only edits before replacing the project」.
 *
 * `planHasContent` is the predicate that decides whether replacing the open
 * plan needs a confirmation. When it says "empty", the plan is replaced with
 * no prompt at all — so every field it forgets is a field somebody loses in
 * silence.
 *
 * It has now forgotten fields twice: first 尺寸線 and 情境, then the whole
 * venue/configuration half (room dimensions, tile calibration, description,
 * layers, custom catalog, validation thresholds, venue identity, event date).
 * Both times the way it was found was that the work was already gone.
 *
 * Table-driven on purpose: the real failure mode is somebody adding a
 * user-editable field to Project and not adding it to the predicate. Each
 * field gets its own row, so the person adding the field sees the list.
 */

import { describe, expect, it } from "vitest";
import { createDefaultScenario } from "../src/core/migrate";
import {
  createDefaultProject,
  planHasContent,
  type Project,
  type Zone,
} from "../src/core/model";

function pristine(): Project {
  return createDefaultProject();
}

function zone(name: string): Zone {
  return {
    id: `zone_${name}`, type: "group", name, x: 0, z: 0, width: 2, depth: 2,
    color: "#38bdf8", locked: false, hidden: false, icon: "◻", capacity: null,
  };
}

describe("planHasContent — a brand-new plan holds nothing worth keeping", () => {
  it("says a pristine project is empty", () => {
    expect(planHasContent(pristine())).toBe(false);
  });

  it("ignores the camera view — that is ambient, not work", () => {
    const p = pristine();
    p.view = "iso";
    expect(planHasContent(p)).toBe(false);
  });

  it("ignores the project id", () => {
    const p = pristine();
    p.id = "proj_something_else";
    expect(planHasContent(p)).toBe(false);
  });
});

describe("planHasContent — things placed on the floor count", () => {
  const PLACED: { label: string; edit: (p: Project) => void }[] = [
    { label: "物件", edit: (p) => void p.objects.push({
      id: "o1", kind: "chair", x: 1, z: 1, rotationDeg: 0, width: 0.45, depth: 0.45,
      height: 0.9, locked: false, hidden: false, surface: "floor", elevation: 0,
    }) },
    { label: "區域", edit: (p) => void p.zones.push(zone("報到區")) },
    { label: "陣列", edit: (p) => void p.groups.push({
      id: "g1", name: "地墊陣列", sourceKind: "mat", rows: 2, cols: 2,
      itemWidth: 0.6, itemDepth: 0.6, itemHeight: 0.04, gapX: 0, gapZ: 0,
      rotationDeg: 0, anchorX: 0, anchorZ: 0, locked: false, hidden: false,
      numberPrefix: "M", numberOrder: "row", numberStart: "nw",
    }) },
    { label: "動線", edit: (p) => void p.routes.push({
      id: "r1", name: "入場動線", color: "#f97316", type: "entry", visible: true,
      points: [{ x: 0, z: 0 }, { x: 1, z: 1 }],
    }) },
    { label: "尺寸線", edit: (p) => void p.measurements.push({
      id: "m1", type: "free-distance", start: { x: 0, z: 0 }, end: { x: 3, z: 0 },
      locked: false, visible: true, color: "#facc15",
    }) },
  ];

  it("只有情境（模擬設定）也算有內容", () => {
    const p = pristine();
    p.scenarios.push(createDefaultScenario(p));
    expect(planHasContent(p)).toBe(true);
  });

  for (const { label, edit } of PLACED) {
    it(`只有${label}也算有內容`, () => {
      const p = pristine();
      edit(p);
      expect(planHasContent(p)).toBe(true);
    });
  }
});

describe("planHasContent — 只改場地設定，一個物件都沒放，也算有內容", () => {
  /**
   * Every row here is ten minutes of somebody's evening. Before this predicate
   * covered them, each one was replaced by the wizard or by 載入平面圖 with no
   * confirmation and no undo.
   */
  const VENUE_ONLY: { label: string; edit: (p: Project) => void }[] = [
    { label: "教室長度", edit: (p) => void (p.classroom.length = 13.5) },
    { label: "教室寬度", edit: (p) => void (p.classroom.width = 9.2) },
    { label: "教室名稱", edit: (p) => void (p.classroom.name = "E310") },
    { label: "走廊寬度", edit: (p) => void (p.corridor.width = 2.8) },
    { label: "地磚尺寸", edit: (p) => void (p.tile.width = 0.4) },
    { label: "地磚原點", edit: (p) => void (p.tile.originX = 0.3) },
    { label: "格線顯示", edit: (p) => void (p.tile.visible = false) },
    {
      label: "現場校正",
      edit: (p) => {
        p.calibration.referenceLength = 0.62;
        p.calibration.confirmed = { tile: true };
      },
    },
    { label: "校正備註", edit: (p) => void (p.calibration.note = "地磚量過 62 cm") },
    { label: "活動說明", edit: (p) => void (p.description = "9/24 社課，教室內報到") },
    { label: "圖層顯示", edit: (p) => void (p.layers.tiles = false) },
    { label: "走道門檻", edit: (p) => void (p.validationSettings.minAisleWidth = 1.2) },
    { label: "投影幕檢查", edit: (p) => void (p.validationSettings.checkScreenView = false) },
    { label: "場地模板", edit: (p) => void (p.venuePresetId = "venue:tku-e310") },
    { label: "活動日期", edit: (p) => void (p.eventDate = "2026-09-24") },
    { label: "專案名稱", edit: (p) => void (p.name = "9/24 禪學社社課") },
    {
      label: "自訂素材",
      edit: (p) => {
        p.catalogExtras = [{
          id: "custom:社旗", name: "社旗", semanticType: "other",
          sourceType: "builtin-procedural", category: "custom", placementType: "floor",
          dimensions: { width: 0.6, depth: 0.1, height: 1.8 },
          defaultFacingDeg: 0, clearanceFront: 0, blocksFlow: false,
          kind: "chair", icon: "🚩", color: "#f1f5f9", visualRef: "proc:other",
          tags: ["custom"], createdBy: "builtin", version: 1,
        }];
      },
    },
  ];

  for (const { label, edit } of VENUE_ONLY) {
    it(`只改${label}`, () => {
      const p = pristine();
      edit(p);
      expect(planHasContent(p), `只改${label}的專案會被無聲取代`).toBe(true);
    });
  }

  it("每一個欄位都真的被檢查到，沒有一列是空跑的", () => {
    // If a row stopped mutating anything (a typo, a renamed field), it would
    // pass against a predicate that ignores it. Prove each row changes the
    // document, so a green row means the predicate noticed a real change.
    for (const { label, edit } of VENUE_ONLY) {
      const before = pristine();
      const after = pristine();
      after.id = before.id;
      edit(after);
      expect(JSON.stringify(after), `「${label}」這一列沒有改到任何東西`)
        .not.toBe(JSON.stringify(before));
    }
  });
});
