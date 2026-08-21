/**
 * Procedural real-scale 3D asset geometry (Standard quality).
 * Uses MaterialPreset library. Visual variants keyed by visualRef / kind.
 */

import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { assetDef } from "../core/assets";
import type { ObjectKind } from "../core/model";
import { materialFromPreset, type MaterialPresetId } from "./materials";

export type VisualQuality = "plan" | "standard" | "detail";

export interface DoorParams {
  hinge?: "left" | "right";
  openInward?: boolean;
  openDeg?: number;
}

const D2R = Math.PI / 180;

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
  preset: MaterialPresetId,
  x: number,
  y: number,
  z: number,
  tint?: string,
  shade = 0,
): Mesh {
  const m = new Mesh(boxGeom(w, h, d), materialFromPreset(preset, tint, shade));
  m.position.set(x, y, z);
  return m;
}

function cyl(
  rTop: number,
  rBot: number,
  h: number,
  preset: MaterialPresetId,
  x: number,
  y: number,
  z: number,
  tint?: string,
): Mesh {
  const g = new CylinderGeometry(rTop, rBot, h, 10);
  const m = new Mesh(g, materialFromPreset(preset, tint));
  m.position.set(x, y, z);
  return m;
}

/** Detailed multi-part model for a single asset (also used for the ghost). */
export function buildAssetGroup(
  kind: ObjectKind,
  dims: { width: number; depth: number; height: number },
  door?: DoorParams,
  quality: VisualQuality = "standard",
): Group {
  return buildVisualGroup(`proc:${kind}`, kind, dims, door, quality);
}

/** Build by visualRef (proc:* variants) with ObjectKind fallback. */
export function buildVisualGroup(
  visualRef: string,
  kind: ObjectKind,
  dims: { width: number; depth: number; height: number },
  door?: DoorParams,
  quality: VisualQuality = "standard",
): Group {
  const g = new Group();
  const { width: w, depth: d, height: h } = dims;
  const detail = quality === "detail";
  const tint = assetDef(kind).color;

  switch (visualRef) {
    case "proc:stage-platform":
      buildStagePlatform(g, w, d, h, detail);
      break;
    case "proc:lectern":
      buildLectern(g, w, d, h, detail);
      break;
    case "proc:payment-desk":
      buildDesk(g, w, d, h, tint, "payment", detail);
      break;
    case "proc:signage-stand":
      buildSignage(g, w, d, h, detail);
      break;
    case "proc:queue-barrier":
      buildBarrier(g, w, d, h);
      break;
    case "proc:shoe-rack":
      buildShoeRack(g, w, d, h, detail);
      break;
    case "proc:payment-box":
      buildPaymentBox(g, w, d, h);
      break;
    default:
      buildByKind(g, kind, w, d, h, tint, door, detail);
  }
  return g;
}

function buildByKind(
  g: Group,
  kind: ObjectKind,
  w: number,
  d: number,
  h: number,
  tint: string,
  door: DoorParams | undefined,
  detail: boolean,
): void {
  switch (kind) {
    case "chair":
      buildChair(g, w, d, h, tint, detail);
      break;
    case "table":
      buildDesk(g, w, d, h, tint, "table", detail);
      break;
    case "regTable":
      buildDesk(g, w, d, h, tint, "checkin", detail);
      break;
    case "computer":
      buildComputer(g, w, d, h, tint, detail);
      break;
    case "door":
      buildDoor(g, w, d, h, door, detail);
      break;
    case "screen":
      buildScreen(g, w, d, h, detail);
      break;
    case "switch":
      buildSwitch(g, w, d, h);
      break;
    case "mat":
      buildMat(g, w, d, h, tint);
      break;
  }
}

function buildChair(g: Group, w: number, d: number, h: number, tint: string, detail: boolean): void {
  const seatH = Math.min(0.45, h * 0.48);
  const legR = detail ? 0.022 : 0.028;
  g.add(part(w * 0.92, 0.04, d * 0.88, "fabric", 0, seatH, 0.02, tint));
  g.add(part(w * 0.92, h - seatH - 0.02, 0.04, "fabric", 0, (h + seatH) / 2, -d / 2 + 0.04, tint, -15));
  if (detail) {
    g.add(part(w * 0.88, 0.03, 0.03, "brushed-metal", 0, seatH + 0.02, -d / 2 + 0.05));
  }
  const lx = w / 2 - legR - 0.01;
  const lz = d / 2 - legR - 0.01;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    g.add(cyl(legR, legR * 0.9, seatH, "painted-metal", sx * lx, seatH / 2, sz * lz));
  }
}

function buildDesk(
  g: Group,
  w: number,
  d: number,
  h: number,
  tint: string,
  variant: "table" | "checkin" | "payment",
  detail: boolean,
): void {
  const topT = detail ? 0.035 : 0.04;
  const wood: MaterialPresetId = variant === "payment" ? "dark-wood" : "light-wood";
  g.add(part(w, topT, d, wood, 0, h - topT / 2, 0, tint));
  if (detail) {
    g.add(part(w * 0.98, 0.01, d * 0.98, wood, 0, h - topT - 0.005, 0, tint, -20));
  }
  const legR = 0.035;
  const lx = w / 2 - legR - 0.03;
  const lz = d / 2 - legR - 0.03;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    g.add(cyl(legR, legR, h - topT, "painted-metal", sx * lx, (h - topT) / 2, sz * lz));
  }
  if (variant === "checkin" || variant === "payment") {
    g.add(part(w * 0.96, h - topT - 0.12, 0.025, wood, 0, (h - topT) / 2 + 0.02, d / 2 - 0.02, tint, -12));
    const boardColor = variant === "payment" ? "#fef3c7" : "#f8fafc";
    g.add(part(w * 0.45, 0.16, 0.025, "paper", 0, h + 0.12, d / 2 - 0.02, boardColor));
    g.add(part(w * 0.45, 0.02, 0.03, "painted-metal", 0, h + 0.03, d / 2 - 0.02));
  }
}

function buildStagePlatform(g: Group, w: number, d: number, h: number, detail: boolean): void {
  const top = Math.min(0.06, h * 0.35);
  g.add(part(w, h - top, d, "dark-wood", 0, (h - top) / 2, 0, "#315b45"));
  g.add(part(w, top, d, "dark-wood", 0, h - top / 2, 0, "#3f7658"));
  if (detail) {
    // A low front fascia makes the raised platform legible in the isometric view.
    g.add(part(w * 0.98, 0.025, 0.025, "painted-metal", 0, h + 0.012, d / 2 + 0.012, "#9cc6a8"));
  }
}

function buildLectern(g: Group, w: number, d: number, h: number, detail: boolean): void {
  const topH = Math.min(0.08, h * 0.1);
  g.add(part(w, topH, d, "dark-wood", 0, h - topH / 2, 0, "#8b6b4a", -8));
  g.add(part(Math.max(0.08, w * 0.12), h - topH, Math.max(0.08, d * 0.12), "painted-metal", 0, (h - topH) / 2, 0, "#5b4633"));
  g.add(part(w * 0.82, Math.max(0.08, h * 0.48), 0.035, "dark-wood", 0, h * 0.42, d / 2 - 0.025, "#8b6b4a", 8));
  if (detail) g.add(part(w * 0.55, 0.025, 0.02, "plastic-gloss", 0, h * 0.7, d / 2 + 0.002, "#e2e8f0"));
}

function buildComputer(g: Group, w: number, d: number, h: number, tint: string, detail: boolean): void {
  const baseH = 0.015;
  g.add(part(w * 0.45, baseH, d * 0.7, "brushed-metal", 0, baseH / 2, d * 0.12, tint, -20));
  g.add(cyl(0.02, 0.025, h * 0.4, "brushed-metal", 0, h * 0.22, d * 0.12));
  const screen = part(w, h * 0.52, detail ? 0.02 : 0.03, "plastic-matte", 0, h * 0.7, 0, tint, 20);
  screen.rotation.x = -8 * D2R;
  g.add(screen);
  const glass = part(w * 0.92, h * 0.46, 0.008, "screen-glass", 0, h * 0.7, 0.012, "#64748b");
  glass.rotation.x = -8 * D2R;
  g.add(glass);
}

function buildDoor(g: Group, w: number, d: number, h: number, door: DoorParams | undefined, detail: boolean): void {
  const jamb = 0.055;
  const wallDepth = Math.max(d, 0.1);
  g.add(part(jamb, h, wallDepth, "painted-metal", -w / 2 + jamb / 2, h / 2, 0, "#9ca3af"));
  g.add(part(jamb, h, wallDepth, "painted-metal", w / 2 - jamb / 2, h / 2, 0, "#9ca3af"));
  g.add(part(w, jamb, wallDepth, "painted-metal", 0, h - jamb / 2, 0, "#9ca3af"));
  const hingeSign = door?.hinge === "right" ? 1 : -1;
  const openDeg = door?.openDeg ?? 90;
  const openSide = door?.openInward === false ? -1 : 1;
  const leaf = new Group();
  leaf.add(part(w - 0.02, h - 0.08, 0.038, "light-wood", (-hingeSign * w) / 2, (h - 0.08) / 2, 0, "#c4b5a5"));
  if (detail) {
    leaf.add(part(w * 0.35, h * 0.35, 0.01, "screen-glass", (-hingeSign * w) / 2, h * 0.55, 0.02, "#cbd5e1"));
  }
  // handle
  leaf.add(part(0.02, 0.12, 0.04, "brushed-metal", (-hingeSign * w) / 2 + hingeSign * (w * 0.35), h * 0.45, 0.03));
  leaf.position.set((hingeSign * w) / 2, 0, 0);
  leaf.rotation.y = hingeSign * openSide * openDeg * D2R;
  g.add(leaf);
}

function buildScreen(g: Group, w: number, _d: number, h: number, detail: boolean): void {
  g.add(part(w + 0.08, 0.07, 0.07, "painted-metal", 0, h, 0, "#475569"));
  g.add(part(w, h, 0.012, "paper", 0, h / 2, 0, "#f8fafc"));
  if (detail) {
    g.add(part(w * 0.98, h * 0.98, 0.004, "screen-glass", 0, h / 2, 0.006, "#e2e8f0"));
  }
  g.add(part(w * 0.2, 0.025, 0.02, "plastic-gloss", 0, 0.03, 0.03, "#38bdf8"));
}

function buildSwitch(g: Group, w: number, d: number, h: number): void {
  g.add(part(w, h, d, "plastic-matte", 0, h / 2, 0, "#e5e7eb"));
  g.add(part(w * 0.35, h * 0.45, 0.012, "plastic-gloss", 0, h / 2, d / 2 + 0.002, "#94a3b8"));
}

function buildMat(g: Group, w: number, d: number, h: number, tint: string): void {
  const th = Math.max(h, 0.025);
  g.add(part(w, th, d, "mat-soft", 0, th / 2, 0, tint));
  g.add(part(w * 0.94, 0.006, d * 0.94, "fabric", 0, th + 0.002, 0, tint, 25));
  g.add(part(w, 0.008, d, "rubber", 0, 0.004, 0, "#4b5563"));
}

function buildSignage(g: Group, w: number, d: number, h: number, detail: boolean): void {
  g.add(cyl(0.03, 0.04, h * 0.75, "painted-metal", 0, h * 0.375, 0));
  g.add(part(w, h * 0.35, 0.03, "paper", 0, h * 0.78, 0, "#f8fafc"));
  if (detail) {
    g.add(part(w * 0.7, 0.04, 0.01, "plastic-gloss", 0, h * 0.78, 0.02, "#38bdf8"));
  }
  g.add(part(w * 0.5, 0.02, d, "brushed-metal", 0, 0.01, 0));
}

function buildBarrier(g: Group, w: number, d: number, h: number): void {
  const postH = h;
  g.add(cyl(0.04, 0.05, postH, "painted-metal", -w / 2 + 0.05, postH / 2, 0, "#64748b"));
  g.add(cyl(0.04, 0.05, postH, "painted-metal", w / 2 - 0.05, postH / 2, 0, "#64748b"));
  g.add(part(w - 0.1, 0.04, 0.04, "brushed-metal", 0, postH * 0.85, 0, "#94a3b8"));
  g.add(part(Math.max(d, 0.12), 0.02, Math.max(d, 0.12), "painted-metal", -w / 2 + 0.05, 0.01, 0));
  g.add(part(Math.max(d, 0.12), 0.02, Math.max(d, 0.12), "painted-metal", w / 2 - 0.05, 0.01, 0));
}

function buildShoeRack(g: Group, w: number, d: number, h: number, detail: boolean): void {
  g.add(part(w, 0.03, d, "light-wood", 0, 0.02, 0));
  g.add(part(w, 0.03, d, "light-wood", 0, h / 2, 0));
  g.add(part(w, 0.03, d, "light-wood", 0, h - 0.02, 0));
  g.add(part(0.03, h, d, "light-wood", -w / 2 + 0.02, h / 2, 0, undefined, -15));
  g.add(part(0.03, h, d, "light-wood", w / 2 - 0.02, h / 2, 0, undefined, -15));
  if (detail) {
    g.add(part(0.02, h - 0.06, d * 0.9, "painted-metal", 0, h / 2, 0));
  }
}

function buildPaymentBox(g: Group, w: number, d: number, h: number): void {
  g.add(part(w, h, d, "plastic-matte", 0, h / 2, 0, "#475569"));
  g.add(part(w * 0.7, 0.02, d * 0.15, "brushed-metal", 0, h * 0.7, d / 2 - 0.01));
  g.add(part(w * 0.4, 0.03, 0.01, "plastic-gloss", 0, h * 0.4, d / 2, "#fbbf24"));
}

const mergedCache = new Map<string, BufferGeometry>();

/** A single merged geometry for InstancedMesh array groups. */
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
  const map: Record<ObjectKind, MaterialPresetId> = {
    chair: "fabric",
    table: "light-wood",
    regTable: "light-wood",
    computer: "plastic-matte",
    door: "light-wood",
    screen: "paper",
    switch: "plastic-matte",
    mat: "mat-soft",
  };
  return materialFromPreset(map[kind], assetDef(kind).color);
}
