/**
 * Procedural, low-poly, real-scale 3D asset geometry. Each builder returns a
 * Group whose local origin is on the floor (y=0) so the SceneManager can place
 * it at (x, elevation, z). Materials/geometry are shared/cached for phones, and
 * a merged single-geometry variant powers InstancedMesh array groups.
 */

import {
  BoxGeometry,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { assetDef } from "../core/assets";
import type { ObjectKind } from "../core/model";

const D2R = Math.PI / 180;

const materialCache = new Map<string, MeshStandardMaterial>();
function mat(color: string, roughness = 0.85): MeshStandardMaterial {
  const key = `${color}|${roughness}`;
  let m = materialCache.get(key);
  if (!m) {
    m = new MeshStandardMaterial({ color, roughness, metalness: 0.02 });
    materialCache.set(key, m);
  }
  return m;
}

const geomCache = new Map<string, BoxGeometry>();
function boxGeom(w: number, h: number, d: number): BoxGeometry {
  const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}`;
  let g = geomCache.get(key);
  if (!g) {
    g = new BoxGeometry(w, h, d);
    geomCache.set(key, g);
  }
  return g;
}

function part(
  w: number,
  h: number,
  d: number,
  color: string,
  x: number,
  y: number,
  z: number,
): Mesh {
  const m = new Mesh(boxGeom(w, h, d), mat(color));
  m.position.set(x, y, z);
  return m;
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp((n >> 16) + amt);
  const g = clamp(((n >> 8) & 0xff) + amt);
  const b = clamp((n & 0xff) + amt);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

export interface DoorParams {
  hinge?: "left" | "right";
  openInward?: boolean;
  openDeg?: number;
}

/** Detailed multi-part model for a single asset (also used for the ghost). */
export function buildAssetGroup(
  kind: ObjectKind,
  dims: { width: number; depth: number; height: number },
  door?: DoorParams,
): Group {
  const g = new Group();
  const c = assetDef(kind).color;
  const { width: w, depth: d, height: h } = dims;

  switch (kind) {
    case "chair": {
      const seatH = Math.min(0.45, h * 0.5);
      const legR = 0.03;
      g.add(part(w, 0.05, d, c, 0, seatH, 0)); // seat
      g.add(part(w, h - seatH, 0.05, shade(c, -20), 0, (h + seatH) / 2, -d / 2 + 0.03)); // back
      const lx = w / 2 - legR;
      const lz = d / 2 - legR;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        g.add(part(legR * 2, seatH, legR * 2, shade(c, -30), sx * lx, seatH / 2, sz * lz));
      }
      break;
    }
    case "table":
    case "regTable": {
      const topT = 0.04;
      g.add(part(w, topT, d, c, 0, h - topT / 2, 0)); // top
      const legR = 0.04;
      const lx = w / 2 - legR - 0.02;
      const lz = d / 2 - legR - 0.02;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        g.add(part(legR * 2, h - topT, legR * 2, shade(c, -25), sx * lx, (h - topT) / 2, sz * lz));
      }
      if (kind === "regTable") {
        // Modesty front panel + a small "報到" sign board so it reads as a desk.
        g.add(part(w, h - topT - 0.1, 0.03, shade(c, -12), 0, (h - topT) / 2 + 0.02, d / 2 - 0.02));
        g.add(part(w * 0.5, 0.18, 0.03, "#f8fafc", 0, h + 0.12, d / 2 - 0.02));
        g.add(part(w * 0.5, 0.02, 0.03, shade(c, -30), 0, h + 0.02, d / 2 - 0.02));
      }
      break;
    }
    case "computer": {
      const baseH = 0.02;
      g.add(part(w * 0.5, baseH, d * 0.8, shade(c, -30), 0, baseH / 2, d * 0.15)); // base
      g.add(part(0.05, h * 0.45, 0.05, shade(c, -20), 0, h * 0.25, d * 0.15)); // stand
      const screen = part(w, h * 0.55, 0.03, shade(c, 30), 0, h * 0.72, 0); // screen
      screen.rotation.x = -8 * D2R;
      g.add(screen);
      break;
    }
    case "door": {
      const jamb = 0.06;
      const wallDepth = Math.max(d, 0.1);
      // Frame: two jambs + head, lying in the wall plane (thin along Z).
      g.add(part(jamb, h, wallDepth, "#9ca3af", -w / 2 + jamb / 2, h / 2, 0));
      g.add(part(jamb, h, wallDepth, "#9ca3af", w / 2 - jamb / 2, h / 2, 0));
      g.add(part(w, jamb, wallDepth, "#9ca3af", 0, h - jamb / 2, 0));
      // Leaf, hinged at one jamb and opened inward by openDeg.
      const hingeSign = door?.hinge === "right" ? 1 : -1;
      const openDeg = door?.openDeg ?? 90;
      const openSide = door?.openInward === false ? -1 : 1;
      const leaf = new Group();
      const leafMesh = part(w, h - 0.06, 0.04, shade(c, 12), (-hingeSign * w) / 2, (h - 0.06) / 2, 0);
      leaf.add(leafMesh);
      leaf.position.set((hingeSign * w) / 2, 0, 0);
      leaf.rotation.y = hingeSign * openSide * openDeg * D2R;
      g.add(leaf);
      break;
    }
    case "screen": {
      const barH = 0.08;
      g.add(part(w + 0.06, barH, 0.08, "#475569", 0, h, 0)); // top roller bar
      g.add(part(w, h, 0.015, c, 0, h / 2, 0)); // white surface
      g.add(part(w, 0.03, 0.02, "#38bdf8", 0, 0.02, 0.03)); // facing marker (front, +Z)
      break;
    }
    case "switch": {
      g.add(part(w, h, d, c, 0, h / 2, 0)); // wall plate
      g.add(part(w * 0.4, h * 0.5, 0.01, "#94a3b8", 0, h / 2, d / 2)); // toggle
      break;
    }
    case "mat": {
      const m = new Mesh(boxGeom(w, Math.max(h, 0.02), d), mat(c, 0.95));
      m.position.y = Math.max(h, 0.02) / 2;
      g.add(m);
      g.add(part(w * 0.94, 0.006, d * 0.94, shade(c, 25), 0, Math.max(h, 0.02) + 0.002, 0)); // top inlay
      break;
    }
  }
  return g;
}

const mergedCache = new Map<string, BufferGeometry>();

/** A single merged geometry (asset base color) for InstancedMesh array groups. */
export function buildMergedGeometry(
  kind: ObjectKind,
  dims: { width: number; depth: number; height: number },
): BufferGeometry {
  const key = `${kind}|${dims.width.toFixed(3)}|${dims.depth.toFixed(3)}|${dims.height.toFixed(3)}`;
  const cached = mergedCache.get(key);
  if (cached) return cached;
  const group = buildAssetGroup(kind, dims);
  const geos: BufferGeometry[] = [];
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (o instanceof Mesh) {
      const cloned = o.geometry.clone();
      cloned.applyMatrix4(o.matrixWorld);
      geos.push(cloned);
    }
  });
  const merged = geos.length ? mergeGeometries(geos, false) : new BoxGeometry(dims.width, dims.height, dims.depth);
  const result = merged ?? new BoxGeometry(dims.width, dims.height, dims.depth);
  mergedCache.set(key, result);
  return result;
}

export function assetInstanceMaterial(kind: ObjectKind): MeshStandardMaterial {
  return mat(assetDef(kind).color);
}
