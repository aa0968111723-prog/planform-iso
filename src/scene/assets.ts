/**
 * Procedural real-scale 3D asset geometry (Standard quality).
 * Uses MaterialPreset library. Visual variants keyed by visualRef / kind.
 */

import {
  BoxGeometry,
  BufferGeometry,
  ConeGeometry,
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
    case "proc:booth-tent":
      buildTent(g, w, d, h, "#eef1f4");
      break;
    case "proc:neighbor-booth":
      buildTent(g, w, d, h, "#b3452f");
      break;
    case "proc:tent-leg":
      buildTentLeg(g, w, h);
      break;
    case "proc:booth-table":
      buildBoothTable(g, w, d, h);
      break;
    case "proc:red-stool":
      buildStool(g, w, d, h);
      break;
    case "proc:red-chair":
      buildPlasticChair(g, w, d, h);
      break;
    case "proc:display-board":
      buildDisplayBoard(g, w, d, h);
      break;
    case "proc:blank-standee":
      buildStandee(g, w, h);
      break;
    case "proc:banner":
      buildBanner(g, w, d, h);
      break;
    case "proc:flyer-tray":
      buildFlyerTray(g, w, d);
      break;
    case "proc:table-prop":
      buildTableProp(g, w, d, h);
      break;
    case "proc:token-disc":
      buildTokenDisc(g, w, h);
      break;
    default:
      buildByKind(g, kind, w, d, h, tint, door, detail);
  }
  return g;
}

// --- outdoor booth ---------------------------------------------------------
//
// Low-poly primitives only, ≤ 12 meshes each, no textures. Boards, banners
// and standees are BLANK: the mesh named `replaceable-surface` is where a
// club graphic goes later. Nothing here bakes in a name or a logo.
//
// Everything that forms the tent's canopy is tagged `userData.roof`, because
// a top view is a floor plan — leave the roof on and the table and stools
// underneath it are neither visible nor clickable.

function markRoof(m: Mesh, name: string): Mesh {
  m.userData.roof = true;
  m.name = name;
  return m;
}

function buildTent(g: Group, w: number, d: number, h: number, canopy: string): void {
  const roof = new Mesh(new ConeGeometry(Math.hypot(w, d) / 2, 0.45, 4), materialFromPreset("fabric", canopy));
  roof.rotation.y = Math.PI / 4;
  roof.position.y = h - 0.12;
  g.add(markRoof(roof, "canopy"));
  g.add(markRoof(part(w, 0.1, d, "fabric", 0, h - 0.34, 0, canopy, -6), "canopy-slab"));
  // Valance: the fabric skirt hanging off each side. Blank on purpose.
  for (const [sx, sz, vw, vd] of [
    [0, -d / 2, w, 0.02], [0, d / 2, w, 0.02], [-w / 2, 0, 0.02, d], [w / 2, 0, 0.02, d],
  ] as const) {
    g.add(markRoof(part(vw, 0.3, vd, "fabric", sx, h - 0.52, sz, canopy, -3), "valance"));
  }
  const legH = Math.max(0.2, h - 0.4);
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    g.add(cyl(0.03, 0.03, legH, "painted-metal", lx * (w / 2 - 0.05), legH / 2, lz * (d / 2 - 0.05), "#98a1ad"));
  }
}

function buildTentLeg(g: Group, w: number, h: number): void {
  const r = Math.max(0.02, w / 2);
  g.add(cyl(r, r, h, "painted-metal", 0, h / 2, 0, "#98a1ad"));
}

function buildBoothTable(g: Group, w: number, d: number, h: number): void {
  // A folding table under a floor-length cloth: no visible legs, which is what
  // the photographs show and what makes it read as a stall rather than a desk.
  const cloth = "#1e3a5f";
  g.add(part(w, 0.03, d, "fabric", 0, h - 0.015, 0, cloth));
  g.add(part(w, h - 0.02, 0.02, "fabric", 0, (h - 0.02) / 2, d / 2 - 0.005, cloth, 6));
  g.add(part(w * 0.98, h - 0.02, d * 0.9, "fabric", 0, (h - 0.02) / 2, 0, "#24476f"));
}

function buildStool(g: Group, w: number, d: number, h: number): void {
  const red = "#c0392b";
  g.add(part(w, 0.035, d, "plastic-matte", 0, h - 0.018, 0, red));
  const legH = Math.max(0.05, h - 0.035);
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    g.add(part(0.035, legH, 0.035, "plastic-matte", lx * (w / 2 - 0.04), legH / 2, lz * (d / 2 - 0.04), red, -14));
  }
}

function buildPlasticChair(g: Group, w: number, d: number, h: number): void {
  const red = "#c0392b";
  const seatH = Math.min(0.44, h * 0.55);
  g.add(part(w, 0.04, d, "plastic-matte", 0, seatH, 0, red));
  g.add(part(w, Math.max(0.1, h - seatH), 0.04, "plastic-matte", 0, seatH + (h - seatH) / 2, -d / 2 + 0.03, red, -8));
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    g.add(part(0.032, seatH, 0.032, "plastic-matte", lx * (w / 2 - 0.04), seatH / 2, lz * (d / 2 - 0.04), red, -14));
  }
}

function buildDisplayBoard(g: Group, w: number, d: number, h: number): void {
  const standH = Math.min(0.35, h * 0.3);
  const panelH = Math.max(0.1, h - standH);
  g.add(part(w, panelH, 0.035, "paper", 0, standH + panelH / 2, 0, "#f4f6f8"));
  const face = part(w * 0.9, panelH * 0.94, 0.01, "paper", 0, standH + panelH / 2, 0.024, "#fdfdfe");
  face.name = "replaceable-surface";
  g.add(face);
  for (const sx of [-1, 1] as const) {
    g.add(part(0.05, standH, Math.max(d, 0.08), "painted-metal", sx * (w / 2 - 0.08), standH / 2, 0, "#cbd3dc"));
  }
}

function buildStandee(g: Group, w: number, h: number): void {
  // Two blank faces leaning together — an A-frame with nothing printed on it.
  for (const [sz, name] of [[-0.06, "replaceable-surface"], [0.06, "replaceable-surface-back"]] as const) {
    const face = part(w, h, 0.03, "paper", 0, h / 2, sz, "#f8fafc");
    face.name = name;
    g.add(face);
  }
}

function buildBanner(g: Group, w: number, d: number, h: number): void {
  const face = part(w, h, Math.max(d, 0.02), "fabric", 0, h / 2, 0, "#fbfcfd");
  face.name = "replaceable-surface";
  g.add(face);
}

function buildFlyerTray(g: Group, w: number, d: number): void {
  g.add(part(w, 0.012, d, "plastic-matte", 0, 0.006, 0, "#e9edf2"));
  g.add(part(w * 0.8, 0.02, d * 0.72, "paper", 0, 0.022, 0.01, "#fbfcfd"));
  g.add(part(w * 0.7, 0.02, d * 0.6, "paper", 0.03, 0.042, -0.02, "#f5f7fa"));
}

function buildTableProp(g: Group, w: number, d: number, h: number): void {
  g.add(part(w, h * 0.8, d, "light-wood", 0, (h * 0.8) / 2, 0, "#d9b45b"));
  g.add(part(w * 1.04, h * 0.2, d * 1.04, "light-wood", 0, h * 0.9, 0, "#c9a24d"));
}

function buildTokenDisc(g: Group, w: number, h: number): void {
  const r = Math.max(0.01, w / 2);
  g.add(cyl(r, r, h, "light-wood", 0, h / 2, 0, "#e7d7b8"));
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

function buildChair(g: Group, w: number, d: number, h: number, _tint: string, detail: boolean): void {
  const seatH = Math.min(0.45, h * 0.48);
  const legR = detail ? 0.022 : 0.028;
  // E310's fixed furniture is a grey plastic writing-tablet chair with a
  // black steel frame and an under-seat basket, not a freestanding soft chair.
  g.add(part(w * 0.9, 0.055, d * 0.82, "plastic-matte", 0, seatH, 0.02, "#7f8b91"));
  g.add(part(w * 0.88, h - seatH - 0.04, 0.045, "plastic-matte", 0, (h + seatH) / 2, -d / 2 + 0.04, "#87949a", -8));
  if (detail) {
    g.add(part(w * 0.88, 0.03, 0.03, "brushed-metal", 0, seatH + 0.02, -d / 2 + 0.05));
  }
  const lx = w / 2 - legR - 0.01;
  const lz = d / 2 - legR - 0.01;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    g.add(cyl(legR, legR * 0.9, seatH, "painted-metal", sx * lx, seatH / 2, sz * lz, "#1f2937"));
  }
  const armX = w * 0.56;
  g.add(cyl(0.018, 0.018, 0.24, "painted-metal", armX, seatH + 0.12, -d * 0.08, "#1f2937"));
  const tablet = part(w * 0.7, 0.035, d * 0.58, "plastic-matte", armX - w * 0.18, seatH + 0.25, d * 0.12, "#e4e1d8");
  tablet.rotation.y = -4 * D2R;
  g.add(tablet);
  // Basket silhouette: three slim rails are enough to read at overview zoom.
  for (const z of [-0.11, 0, 0.11]) g.add(part(w * 0.66, 0.012, 0.012, "painted-metal", 0, seatH * 0.48, z, "#374151"));
  for (const x of [-0.22, 0, 0.22]) g.add(part(0.012, 0.012, d * 0.55, "painted-metal", x, seatH * 0.48, 0, "#374151"));
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
  const serviceDesk = variant === "checkin" || variant === "payment";
  const wood: MaterialPresetId = serviceDesk ? "plastic-matte" : "light-wood";
  const topColor = serviceDesk ? "#eeeae0" : tint;
  g.add(part(w, topT, d, wood, 0, h - topT / 2, 0, topColor));
  if (detail) {
    g.add(part(w * 0.98, 0.01, d * 0.98, wood, 0, h - topT - 0.005, 0, topColor, -10));
  }
  const legR = 0.035;
  const lx = w / 2 - legR - 0.03;
  const lz = d / 2 - legR - 0.03;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    g.add(cyl(legR, legR, h - topT, "painted-metal", sx * lx, (h - topT) / 2, sz * lz, "#252b2d"));
  }
  if (serviceDesk) {
    // Loose forms / name tags on the photographed folding table. Avoid a tall
    // fascia or readable sign that would invent a booth absent from the room.
    g.add(part(w * 0.28, 0.008, d * 0.3, "paper", -w * 0.18, h + 0.006, 0, "#fafafa"));
    g.add(part(w * 0.2, 0.012, d * 0.2, "paper", w * 0.18, h + 0.009, -d * 0.12, variant === "payment" ? "#c9a97a" : "#e8edf0"));
  }
}

function buildStagePlatform(g: Group, w: number, d: number, h: number, detail: boolean): void {
  const top = Math.min(0.06, h * 0.35);
  g.add(part(w, h - top, d, "dark-wood", 0, (h - top) / 2, 0, "#182d26"));
  g.add(part(w, top, d, "dark-wood", 0, h - top / 2, 0, "#2f6348"));
  g.add(part(w * 0.99, Math.min(0.13, h * 0.55), 0.035, "rubber", 0, h * 0.36, d / 2 + 0.012, "#111827"));
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
  // Laptop clamshell used on the check-in table in the activity photos.
  const baseH = detail ? 0.018 : 0.024;
  g.add(part(w, baseH, d * 0.78, "brushed-metal", 0, baseH / 2, d * 0.08, "#747b80"));
  g.add(part(w * 0.72, 0.006, d * 0.48, "plastic-matte", 0, baseH + 0.004, d * 0.08, "#2f3639"));
  const screen = part(w, h * 0.72, detail ? 0.018 : 0.024, "brushed-metal", 0, h * 0.42, -d * 0.3, tint, 8);
  screen.rotation.x = -14 * D2R;
  g.add(screen);
  const glass = part(w * 0.9, h * 0.62, 0.006, "screen-glass", 0, h * 0.42, -d * 0.286, "#334155");
  glass.rotation.x = -14 * D2R;
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

/**
 * One EVA 巧拼 piece, as photographed: a soft 2 cm slab whose top face is
 * inset, so two pieces laid edge to edge show the shaded groove between them
 * instead of merging into one painted rectangle.
 *
 * The interlocking teeth are NOT modelled per piece. A 30-person field is
 * around 100 pieces; teeth would multiply the mesh count for detail that is
 * invisible at the zoom anyone plans at. The groove plus the seam overlay in
 * SceneManager is what makes the field read as interlocking pieces.
 */
function buildMat(g: Group, w: number, d: number, h: number, tint: string): void {
  const th = Math.max(h, 0.02);
  // Body: full footprint, so the field stays continuous with no gaps of floor.
  g.add(part(w, th * 0.72, d, "mat-soft", 0, (th * 0.72) / 2, 0, tint, -14));
  // Top face, inset by ~8 mm a side: the inset edge IS the seam.
  const inset = Math.min(0.008, w * 0.02);
  g.add(part(w - inset * 2, th * 0.34, d - inset * 2, "mat-soft", 0, th * 0.72, 0, tint));
  // Thin dark underside keeps the slab from floating on a pale floor.
  g.add(part(w, 0.006, d, "rubber", 0, 0.003, 0, "#3f4a52"));
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
