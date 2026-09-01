/**
 * The part compiler: what a definition looks like in three dimensions.
 *
 * The claims worth pinning:
 *   1. parts land where their offsets say, floor-referenced — a dice with
 *      offset.y = table height sits ON the table, not inside it;
 *   2. a `facesFromOptions` box takes its faces from the option list — the
 *      one record that also drives the panel — and face edits invalidate the
 *      cache even though the definition version did not move;
 *   3. the mesh budget holds, because the quality gate fails mobile above it.
 *
 * jsdom-free: geometry and grouping are plain data; only textures need a
 * canvas, so face-material tests assert structure rather than pixels.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { Box3, Group, Mesh, Vector3 } from "three";
import {
  buildPropGroup,
  buildPropGroupCached,
  clearPropGroupCache,
  PROP_MESH_BUDGET,
  propMeshCount,
} from "../src/scene/propVisual";
import type { InteractionOption, PropDefinition } from "../src/core/model";

// Textures need document.createElement("canvas"); node has none. A minimal
// stub returning a 2D-context-free canvas would crash CanvasTexture, so give
// it a real-enough fake: three only needs width/height and an object identity.
beforeEach(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({
        fillStyle: "", font: "", textAlign: "", textBaseline: "",
        fillRect: () => undefined,
        fillText: () => undefined,
        translate: () => undefined,
        rotate: () => undefined,
        measureText: () => ({ width: 10 }),
      }),
    }),
    createElementNS: () => ({}),
  };
});

function def(over: Partial<PropDefinition> = {}): PropDefinition {
  return {
    id: "prop_t1",
    name: "測試道具",
    category: "互動",
    dimensions: { width: 1, depth: 1, height: 1 },
    parts: [
      { id: "base", shape: "box", size: { width: 1, depth: 0.6, height: 0.74 }, offset: { x: 0, y: 0, z: 0 }, color: "#c8b6a6", finish: "light-wood" },
      { id: "dice", shape: "box", size: { width: 0.3, depth: 0.3, height: 0.3 }, offset: { x: 0, y: 0.74, z: 0 }, color: "#f4f4f5", facesFromOptions: true },
    ],
    anchors: [],
    version: 1,
    ...over,
  };
}

const options: InteractionOption[] = Array.from({ length: 6 }, (_, i) => ({
  id: `f${i + 1}`, label: `第 ${i + 1} 面`, weight: 1, color: "#38bdf8",
}));

const meshes = (g: Group): Mesh[] => {
  const out: Mesh[] = [];
  g.traverse((m) => { if (m instanceof Mesh) out.push(m); });
  return out;
};

describe("parts land where their offsets say", () => {
  it("a dice at offset.y = table height sits on the table", () => {
    const g = buildPropGroup(def());
    const [table, dice] = meshes(g);
    // Floor-referenced: the table's centre is at half its height; the dice's
    // centre is table height + half the dice.
    expect(table.position.y).toBeCloseTo(0.37, 6);
    expect(dice.position.y).toBeCloseTo(0.74 + 0.15, 6);
  });

  it("the whole group measures what the parts add up to", () => {
    const g = buildPropGroup(def());
    const size = new Box3().setFromObject(g).getSize(new Vector3());
    expect(size.y).toBeCloseTo(0.74 + 0.3, 3);
    expect(size.x).toBeCloseTo(1, 3);
  });

  it("cylinders and spheres stand on the floor too", () => {
    const g = buildPropGroup(def({
      parts: [
        { id: "c", shape: "cylinder", size: { width: 0.4, depth: 0.4, height: 1.2 }, offset: { x: 0, y: 0, z: 0 } },
        { id: "s", shape: "sphere", size: { width: 0.5, depth: 0.5, height: 0.5 }, offset: { x: 1, y: 0, z: 0 } },
      ],
    }));
    const box = new Box3().setFromObject(g);
    expect(box.min.y).toBeGreaterThanOrEqual(-1e-6);
  });

  it("every part casts and receives shadow", () => {
    for (const m of meshes(buildPropGroup(def()))) {
      expect(m.castShadow).toBe(true);
      expect(m.receiveShadow).toBe(true);
    }
  });
});

describe("faces come from the options", () => {
  it("a facesFromOptions box gets six materials, one per option", () => {
    const g = buildPropGroup(def(), { faceOptions: options });
    const dice = meshes(g)[1];
    expect(Array.isArray(dice.material)).toBe(true);
    expect((dice.material as unknown[]).length).toBe(6);
  });

  it("without options it degrades to the part's own colour", () => {
    const g = buildPropGroup(def());
    const dice = meshes(g)[1];
    // No option list: a single material, no invented faces.
    expect(Array.isArray(dice.material)).toBe(false);
  });

  it("a box with a photo gets six materials so the picture can sit on the front", () => {
    const g = buildPropGroup(def({
      parts: [{
        id: "plate", shape: "box",
        size: { width: 0.2, depth: 0.04, height: 0.1 },
        offset: { x: 0, y: 0, z: 0 },
        imageBlobId: "art_test",
      }],
    }));
    const plate = meshes(g)[0];
    expect(Array.isArray(plate.material)).toBe(true);
    expect((plate.material as unknown[]).length).toBe(6);
  });

  it("a cylindrical badge gives artwork its own top-cap material", () => {
    const g = buildPropGroup(def({
      parts: [{
        id: "badge-face", shape: "cylinder",
        size: { width: 0.058, depth: 0.058, height: 0.008 },
        offset: { x: 0, y: 0, z: 0 }, imageBlobId: "art_badge",
      }],
    }));
    const badge = meshes(g)[0];
    expect(Array.isArray(badge.material)).toBe(true);
    expect((badge.material as unknown[]).length).toBe(3);
  });

  it("two options wrap around six faces rather than leaving blanks", () => {
    const two = options.slice(0, 2);
    const g = buildPropGroup(def(), { faceOptions: two });
    const dice = meshes(g)[1];
    expect((dice.material as unknown[]).length).toBe(6);
  });
});

describe("the versioned cache lets go when it must", () => {
  beforeEach(() => clearPropGroupCache());

  it("same version, same faces: cached", () => {
    const d = def();
    const a = buildPropGroupCached(d, { faceOptions: options });
    const b = buildPropGroupCached(d, { faceOptions: options });
    // Clones of one build share geometry identity part for part.
    expect(meshes(a)[0].geometry).toBe(meshes(b)[0].geometry);
  });

  it("a version bump rebuilds", () => {
    const a = buildPropGroupCached(def(), { faceOptions: options });
    const b = buildPropGroupCached(def({ version: 2 }), { faceOptions: options });
    expect(meshes(a)[0].geometry).not.toBe(meshes(b)[0].geometry);
  });

  it("a face edit rebuilds even though the version did not move", () => {
    const a = buildPropGroupCached(def(), { faceOptions: options });
    const edited = options.map((o, i) => (i === 0 ? { ...o, label: "改了" } : o));
    const b = buildPropGroupCached(def(), { faceOptions: edited });
    // The definition is untouched — the face content lives on the options —
    // so without the face fingerprint the scene would keep the stale dice.
    expect(meshes(a)[1].geometry).not.toBe(meshes(b)[1].geometry);
  });
});

describe("the mesh budget", () => {
  it("caps at the quality gate's mobile ceiling", () => {
    const many = def({
      parts: Array.from({ length: 40 }, (_, i) => ({
        id: `p${i}`, shape: "box" as const,
        size: { width: 0.1, depth: 0.1, height: 0.1 },
        offset: { x: i * 0.1, y: 0, z: 0 },
      })),
    });
    expect(propMeshCount(many)).toBe(PROP_MESH_BUDGET);
    expect(meshes(buildPropGroup(many)).length).toBe(PROP_MESH_BUDGET);
  });
});
