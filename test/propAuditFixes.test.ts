/**
 * The scene and UI half of the adversarial audit.
 *
 * Each block corresponds to one confirmed finding against a tree where every
 * test passed. The recurring shape is a rule written for one case and applied
 * to all of them: the dice's settle rotation used on a flat disc, `box`-only
 * face rendering asked of a cylinder, a cache keyed as if ids were global, a
 * rule rebuilt from two fields when it had five.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { Group, Mesh, Vector3 } from "three";
import {
  buildPropGroup,
  buildPropGroupCached,
  clearPropGroupCache,
  diceSettleQuaternion,
  disposePropGroup,
  settleQuaternionFor,
  spinnerSettleQuaternion,
} from "../src/scene/propVisual";
import { absorbSelection } from "../src/core/propEdit";
import { setMatchCell } from "../src/ui/flowPanel";
import { propPreset } from "../src/core/propPresets";
import type { InteractionOption, InteractionTemplate, PropDefinition, SceneObject } from "../src/core/model";

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

beforeEach(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({
        fillStyle: "", font: "", textAlign: "", textBaseline: "",
        fillRect: () => undefined, fillText: () => undefined,
        measureText: () => ({ width: 10 }),
      }),
    }),
    createElementNS: () => ({}),
  };
  clearPropGroupCache();
});

const options = (n: number): InteractionOption[] =>
  Array.from({ length: n }, (_, i) => ({ id: `w${i}`, label: `扇 ${i}`, weight: 1, color: "#ff0000" }));

describe("a spinner is not a dice", () => {
  it("the wheel stays FLAT — it turns about its own axis", () => {
    // The dice quaternions are slot-normal→+y rotations; five of six stand a
    // horizontal disc on its edge. A wheel must keep its face up.
    for (let i = 0; i < 6; i++) {
      const up = new Vector3(0, 1, 0).applyQuaternion(spinnerSettleQuaternion(i, 6)!);
      expect(up.y, `wedge ${i} must stay flat`).toBeCloseTo(1, 6);
    }
  });

  it("each wedge stops at a different angle, and lands under the pointer", () => {
    // Compare the resulting DIRECTION, not the quaternion's y: rotation by θ
    // and by 2π−θ share a y and differ only in w.
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      // Where wedge i's centre started, once the disc has settled.
      const centre = ((i + 0.5) / 6) * Math.PI * 2;
      const start = new Vector3(Math.sin(centre), 0, Math.cos(centre));
      const landed = start.clone().applyQuaternion(spinnerSettleQuaternion(i, 6)!);
      // String(Number(...)) normalises -0 to 0; the wedges land on both sides.
      seen.add([landed.x, landed.z].map((v) => String(Number(v.toFixed(5)))).join(","));
      // The pointer is at +z, so every wedge must arrive there.
      expect(landed.z, `wedge ${i} must land under the pointer`).toBeCloseTo(1, 5);
      expect(landed.x).toBeCloseTo(0, 5);
    }
    // Six wedges, six DIFFERENT rotations getting them there.
    const rotations = new Set(
      Array.from({ length: 6 }, (_, i) => {
        const q = spinnerSettleQuaternion(i, 6)!;
        return [q.x, q.y, q.z, q.w].map((v) => v.toFixed(5)).join(",");
      }),
    );
    expect(rotations.size).toBe(6);
    expect(seen.size, "all six arrive at the same place — the pointer").toBe(1);
  });

  it("settleQuaternionFor dispatches on SHAPE, not on the flag", () => {
    const box = { shape: "box" as const };
    const disc = { shape: "cylinder" as const };
    // A box tips a face up…
    expect(new Vector3(0, 1, 0).applyQuaternion(settleQuaternionFor(box, 0, 6)!).y).toBeLessThan(0.9);
    // …a cylinder never does.
    expect(new Vector3(0, 1, 0).applyQuaternion(settleQuaternionFor(disc, 0, 6)!).y).toBeCloseTo(1, 6);
    expect(settleQuaternionFor(box, 0, 6)).toEqual(diceSettleQuaternion(0));
  });

  it("an out-of-range wedge returns null rather than a wrong angle", () => {
    expect(spinnerSettleQuaternion(6, 6)).toBeNull();
    expect(spinnerSettleQuaternion(-1, 6)).toBeNull();
    expect(spinnerSettleQuaternion(0, 0)).toBeNull();
  });

  it("the disc renders one wedge per option — 「一份活資料」 reaches the 3D", () => {
    const spinner = propPreset("prop_spinner")!;
    const disc = spinner.parts.find((p) => p.facesFromOptions)!;
    expect(disc.shape, "the fixture must be the cylinder case").toBe("cylinder");

    const plain = buildPropGroup(spinner);
    const plainDisc = plain.getObjectByName(`part:${disc.id}`) as Mesh;
    expect(plainDisc.children).toHaveLength(0);

    const painted = buildPropGroup(spinner, { faceOptions: options(6) });
    const paintedDisc = painted.getObjectByName(`part:${disc.id}`) as Mesh;
    expect(paintedDisc.children, "one wedge per option").toHaveLength(6);

    const four = buildPropGroup(spinner, { faceOptions: options(4) });
    expect((four.getObjectByName(`part:${disc.id}`) as Mesh).children).toHaveLength(4);
  });
});

describe("the group cache is not shared across projects", () => {
  const defAt = (color: string, parts = 1): PropDefinition => ({
    id: "prop_shared", name: "共用", category: "互動",
    dimensions: { width: 1, depth: 1, height: 1 },
    parts: Array.from({ length: parts }, (_, i) => ({
      id: `p${i}`, shape: "box" as const,
      size: { width: 0.5, depth: 0.5, height: 0.5 },
      offset: { x: i * 0.6, y: 0, z: 0 }, color,
    })),
    anchors: [], version: 2, source: "library",
  });

  it("clearing releases the builds — the same id at the same version rebuilds", () => {
    // §39 makes each project's copy an independently edited snapshot, so the
    // same id at the same version really can mean two different props.
    const a = buildPropGroupCached(defAt("#ff0000", 3));
    expect(a.children).toHaveLength(3);
    clearPropGroupCache();
    const b = buildPropGroupCached(defAt("#0000ff", 5));
    expect(b.children, "must not serve the other project's build").toHaveLength(5);
  });

  it("without clearing it DOES collide — which is why opening a project clears it", () => {
    buildPropGroupCached(defAt("#ff0000", 3));
    const stale = buildPropGroupCached(defAt("#0000ff", 5));
    expect(stale.children).toHaveLength(3);
  });

  it("disposePropGroup releases every geometry it built", () => {
    const group = buildPropGroup(propPreset("prop_dicestation")!);
    const geoms: { disposed: boolean }[] = [];
    group.traverse((n) => {
      if (n instanceof Mesh) {
        const g = n.geometry as unknown as { disposed: boolean; dispose: () => void };
        g.disposed = false;
        const real = g.dispose.bind(g);
        g.dispose = () => { g.disposed = true; real(); };
        geoms.push(g);
      }
    });
    expect(geoms.length).toBeGreaterThan(3);
    disposePropGroup(group);
    expect(geoms.every((g) => g.disposed)).toBe(true);
  });

  it("disposing an empty group is safe", () => {
    expect(() => disposePropGroup(new Group())).not.toThrow();
  });
});

describe("§93 grouping keeps a rotated prop's arrangement", () => {
  const obj = (id: string, over: Partial<SceneObject> = {}): SceneObject => ({
    id, kind: "table", x: 0, z: 0, rotationDeg: 0,
    width: 0.8, depth: 0.8, height: 1.1,
    locked: false, hidden: false, surface: "floor", elevation: 0,
    ...over,
  } as SceneObject);

  it("a 180°-turned spinner's pointer and anchors flip with it", () => {
    const spinner = propPreset("prop_spinner")!;
    const pointerBefore = spinner.parts.find((p) => p.id === "pointer")!;
    const playerBefore = spinner.anchors.find((a) => a.role === "player")!;
    expect(pointerBefore.offset.z, "fixture: pointer sits at +z").toBeGreaterThan(0);
    expect(playerBefore.z, "fixture: player stands at +z").toBeGreaterThan(0);

    const result = absorbSelection({
      objects: [
        obj("spin1", { x: 2, z: 2, rotationDeg: 180, assetId: "custom:prop_spinner" } as never),
        obj("table1", { x: 4, z: 2 }),
      ],
      props: [spinner],
      entryFor: () => ({ color: "#c8b6a6", name: "桌" }),
    }, "轉盤遊戲站")!;

    // The spinner sits 1 m left of centre; its pointer must now face -z.
    const pointer = result.def.parts.find((p) => p.id === "spin1_pointer")!;
    expect(pointer.offset.z).toBeLessThan(0);
    expect(pointer.offset.x).toBeCloseTo(-1, 6);

    // …and the participant must stand behind it, not in front of the old front.
    const player = result.def.anchors.find((a) => a.role === "player")!;
    expect(player.z, "the §85 sentence must point at the real front").toBeLessThan(0);
  });

  it("an unrotated prop is unchanged — the common case stays exact", () => {
    const spinner = propPreset("prop_spinner")!;
    const result = absorbSelection({
      objects: [
        obj("spin1", { x: 2, z: 2, rotationDeg: 0, assetId: "custom:prop_spinner" } as never),
        obj("table1", { x: 4, z: 2 }),
      ],
      props: [spinner],
      entryFor: () => ({ color: "#c8b6a6", name: "桌" }),
    })!;
    const pointer = result.def.parts.find((p) => p.id === "spin1_pointer")!;
    const src = spinner.parts.find((p) => p.id === "pointer")!;
    expect(pointer.offset.z).toBeCloseTo(src.offset.z, 6);
    expect(pointer.offset.x).toBeCloseTo(src.offset.x - 1, 6);
    expect(pointer.rotationDeg).toBeUndefined();
  });

  it("a 90° turn moves x into z with the repo's shared convention", () => {
    const spinner = propPreset("prop_spinner")!;
    const result = absorbSelection({
      objects: [
        obj("spin1", { x: 0, z: 0, rotationDeg: 90, assetId: "custom:prop_spinner" } as never),
        obj("table1", { x: 0, z: 0 }),
      ],
      props: [spinner],
      entryFor: () => undefined,
    })!;
    // player anchor (0, 0.8) with rot 90: x = 0*cos+0.8*sin = 0.8, z = -0+0.8*cos = 0
    const player = result.def.anchors.find((a) => a.role === "player")!;
    expect(player.x).toBeCloseTo(0.8, 6);
    expect(player.z).toBeCloseTo(0, 6);
  });
});

describe("renaming a 4×4 outcome cell keeps what is printed on the 場刊", () => {
  const table = (): InteractionTemplate => ({
    id: "t", name: "心情 OK 蹦", startStepId: "res",
    steps: [{
      id: "res", name: "結果", avgSeconds: 5,
      branch: {
        kind: "match", on: ["q1", "q2"],
        rules: [
          {
            when: ["burnout", "future"], label: "拖延獸",
            prompt: "不要害怕走慢，只怕站著不動。", extraSeconds: 7, next: "card",
          },
          { when: ["calm", "now"], label: "穩定獸", prompt: "你已經做得很好了。" },
        ],
        otherwise: { label: "其他" },
      },
    }, { id: "card", name: "領卡", avgSeconds: 10, next: null }],
    stations: [], staff: [], segments: [],
    audience: { count: 10, windowSeconds: 600, profile: "uniform", stopRate: 1, joinRate: 1, patienceSeconds: 0 },
    seed: 1, settings: { speedMetersPerSecond: 1.1 },
  });

  const rulesOf = (t: InteractionTemplate) => {
    const branch = t.steps[0].branch;
    if (branch?.kind !== "match") throw new Error("not a match");
    return branch.rules;
  };

  it("keeps the quote, the seconds and the target", () => {
    const next = setMatchCell(table(), "res", ["burnout", "future"], "拖延獸 2");
    const rule = rulesOf(next).find((r) => r.when[0] === "burnout")!;
    expect(rule.label).toBe("拖延獸 2");
    expect(rule.prompt, "the quote the 場刊 prints").toBe("不要害怕走慢，只怕站著不動。");
    expect(rule.extraSeconds).toBe(7);
    expect(rule.next).toBe("card");
  });

  it("keeps the rules in order — resolveBranch walks them top to bottom", () => {
    const before = rulesOf(table()).map((r) => r.when.join("+"));
    const after = rulesOf(setMatchCell(table(), "res", ["burnout", "future"], "改名"));
    expect(after.map((r) => r.when.join("+"))).toEqual(before);
  });

  it("an empty name still deletes the cell, and a new cell is still appended", () => {
    expect(rulesOf(setMatchCell(table(), "res", ["burnout", "future"], "  "))).toHaveLength(1);
    const added = rulesOf(setMatchCell(table(), "res", ["tired", "past"], "新格"));
    expect(added).toHaveLength(3);
    expect(added[2].label).toBe("新格");
  });
});

describe("the cache must not dispose what it handed out", () => {
  it("a cached build SHARES geometry with every clone — so clearing must not dispose", () => {
    const def: PropDefinition = {
      id: "prop_shared_geom", name: "共用", category: "互動",
      dimensions: { width: 1, depth: 1, height: 1 },
      parts: [{
        id: "p0", shape: "box",
        size: { width: 0.5, depth: 0.5, height: 0.5 },
        offset: { x: 0, y: 0, z: 0 }, color: "#fff",
      }],
      anchors: [], version: 1, source: "library",
    };
    const placed = buildPropGroupCached(def);
    const mesh = placed.getObjectByName("part:p0") as Mesh;
    let disposed = false;
    const geom = mesh.geometry as unknown as { dispose: () => void };
    const real = geom.dispose.bind(geom);
    geom.dispose = () => { disposed = true; real(); };

    clearPropGroupCache();

    // The clone in the scene is still being rendered; its buffers must live.
    expect(disposed, "clearing must not delete a live copy's geometry").toBe(false);
  });
});
