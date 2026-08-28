/**
 * Every built-in prop must actually work — as data, as geometry, as a save.
 *
 * These are property tests over the whole preset list, so a sixteenth preset
 * added later is held to the same bar automatically:
 *   - it survives migration verbatim (a preset that dies on save is a trap);
 *   - it compiles inside the mesh budget;
 *   - an interactive one carries the anchors its rehearsal needs, and its
 *     fragment obeys the wiring contract (sealed end, explicit internal
 *     links) — a fragment spliced into a list it does not control must never
 *     rely on row order.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { PROP_PRESETS, propPreset } from "../src/core/propPresets";
import { migrateProps } from "../src/core/migrate";
import { buildPropGroup, PROP_MESH_BUDGET } from "../src/scene/propVisual";
import { entryFromProp } from "../src/core/propCatalog";
import { Mesh } from "three";

beforeEach(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({
        fillStyle: "", font: "", textAlign: "", textBaseline: "",
        fillRect: () => undefined, fillText: () => undefined,
        translate: () => undefined, rotate: () => undefined,
        measureText: () => ({ width: 10 }),
      }),
    }),
    createElementNS: () => ({}),
  };
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
});

const meshCount = (g: ReturnType<typeof buildPropGroup>): number => {
  let n = 0;
  g.traverse((m) => { if (m instanceof Mesh) n += 1; });
  return n;
};

describe("all presets", () => {
  it("ship a dozen props and four golden assemblies, not fifty", () => {
    expect(PROP_PRESETS.length).toBe(16);
    const names = PROP_PRESETS.map((d) => d.name);
    // Names carry what is INSIDE the assembly, because a poetic name told a
    // reviewer nothing: given 「請建立一個大型骰子遊戲站」 they picked the bare
    // 大型骰子 and started building a table out of numbered boxes, never
    // realising a ready-made one existed. Substring, so the parenthetical can
    // be reworded without breaking the test.
    for (const golden of ["骰子遊戲站", "祝福箱", "快問快答台", "轉盤遊戲站"]) {
      expect(names.some((n) => n.includes(golden)), golden).toBe(true);
    }
    // §50: the club's mat exists as a formal definition.
    expect(names).toContain("巧拼地墊");
  });

  it("every preset survives migration verbatim", () => {
    const back = migrateProps(JSON.parse(JSON.stringify(PROP_PRESETS)));
    expect(back).toEqual(PROP_PRESETS);
  });

  it("every preset compiles inside the mesh budget", () => {
    for (const def of PROP_PRESETS) {
      const count = meshCount(buildPropGroup(def));
      expect(count, `${def.name} has ${count} meshes`).toBeLessThanOrEqual(PROP_MESH_BUDGET);
      expect(count).toBeGreaterThan(0);
    }
  });

  it("every preset yields a valid mirrored entry with kind inside the eight", () => {
    for (const def of PROP_PRESETS) {
      const entry = entryFromProp(def);
      expect(["table", "mat"], def.name).toContain(entry.kind);
      expect(entry.version).toBe(def.version);
    }
  });

  it("propPreset returns an independent copy, not the shared object", () => {
    const a = propPreset("prop_dice")!;
    a.name = "改壞了";
    expect(propPreset("prop_dice")!.name).toBe("大型骰子");
  });
});

describe("interactive presets", () => {
  const interactive = () => PROP_PRESETS.filter((d) => d.interaction);

  it("there are interactive ones at all, so these tests cannot pass vacuously", () => {
    expect(interactive().length).toBeGreaterThanOrEqual(7);
  });

  it("each carries a player anchor — a game nobody can stand at is scenery", () => {
    for (const def of interactive()) {
      const roles = new Set(def.anchors.map((a) => a.role));
      expect(roles.has("player"), `${def.name} 沒有參加者站位`).toBe(true);
      expect(roles.has("exit"), `${def.name} 沒有完成出口`).toBe(true);
    }
  });

  it("staffed ones carry a staff anchor; self-service ones need none", () => {
    for (const def of interactive()) {
      const hasRole = !!def.interaction!.staffRole;
      const hasStaffAnchor = def.anchors.some((a) => a.role === "staff");
      if (hasRole) expect(hasStaffAnchor, `${def.name} 有角色卻沒有工作人員站位`).toBe(true);
    }
  });

  it("every fragment is sealed: the last step ends the visit explicitly", () => {
    for (const def of interactive()) {
      const steps = def.interaction!.steps;
      expect(steps[steps.length - 1].next, `${def.name} 的片段沒有封口`).toBeNull();
    }
  });

  it("no internal link relies on row order beyond the plain next-row default", () => {
    for (const def of interactive()) {
      const ids = new Set(def.interaction!.steps.map((s) => s.id));
      for (const step of def.interaction!.steps) {
        if (typeof step.next === "string") {
          expect(ids.has(step.next), `${def.name}/${step.name} 指向片段外`).toBe(true);
        }
        if (step.branch?.kind === "chance") {
          for (const option of step.branch.options) {
            if (typeof option.next === "string") {
              expect(ids.has(option.next), `${def.name}/${step.name}/${option.label}`).toBe(true);
            }
          }
        }
      }
    }
  });

  it("the dice really has six faces and the card box twenty cards", () => {
    const diceRoll = propPreset("prop_dice")!.interaction!.steps.find((s) => s.branch)!;
    expect(diceRoll.branch!.kind).toBe("chance");
    if (diceRoll.branch!.kind === "chance") {
      expect(diceRoll.branch!.options).toHaveLength(6);
      // Faces carry colours — the one record the 3D face renders from.
      expect(diceRoll.branch!.options.every((o) => o.color)).toBe(true);
    }
    const draw = propPreset("prop_cardbox")!.interaction!.steps.find((s) => s.branch)!;
    if (draw.branch!.kind === "chance") expect(draw.branch!.options).toHaveLength(20);
  });

  it("skip rates are honest probabilities", () => {
    for (const def of interactive()) {
      const rate = def.interaction!.skipRate;
      if (rate !== undefined) {
        expect(rate).toBeGreaterThanOrEqual(0);
        expect(rate).toBeLessThanOrEqual(1);
      }
    }
  });
});
