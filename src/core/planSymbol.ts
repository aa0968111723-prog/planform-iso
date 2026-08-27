/**
 * Plan-symbol descriptors for top view / construction plan / library thumbs.
 * Prefer clear footprint + icon/text over 3D thumbnails.
 */

import type { AssetCatalogEntry, SemanticAssetType, ServiceRole } from "../core/catalog";
import type { ObjectKind, SceneObject } from "../core/model";
import { MAT_COLORS } from "./theme";

export type PlanSymbolKind =
  | "door"
  | "switch"
  | "screen"
  | "table"
  | "chair"
  | "mat"
  | "computer"
  | "checkin-desk"
  | "payment-desk"
  | "signage"
  | "queue-barrier"
  | "storage"
  | "payment-box"
  | "stage-platform"
  | "lectern"
  | "other";

export interface PlanSymbolSpec {
  kind: PlanSymbolKind;
  label?: string;
  fill: string;
  showFacing: boolean;
  icon?: string;
}

export type PlanSymbolTheme = "paper" | "dark";

export function planSymbolForEntry(entry: AssetCatalogEntry): PlanSymbolSpec {
  if (entry.id === "builtin:stage-platform") {
    return { kind: "stage-platform", label: "講台", fill: entry.color, showFacing: false, icon: "講台" };
  }
  if (entry.id === "builtin:lectern") {
    return { kind: "lectern", label: "講桌", fill: entry.color, showFacing: true, icon: "講桌" };
  }
  return planSymbolForSemantic(entry.semanticType, entry.serviceRole, entry.color, entry.name);
}

export function planSymbolForObject(
  obj: SceneObject,
  entry?: AssetCatalogEntry | null,
): PlanSymbolSpec {
  if (entry) return planSymbolForEntry(entry);
  return planSymbolForKind(obj.kind, obj.serviceRole);
}

export function planSymbolForKind(kind: ObjectKind, serviceRole?: ServiceRole): PlanSymbolSpec {
  if (kind === "regTable") {
    return { kind: "checkin-desk", label: "報到", fill: "#a8b3a0", showFacing: true, icon: "報到" };
  }
  const map: Record<ObjectKind, PlanSymbolSpec> = {
    door: { kind: "door", fill: "#a1a1aa", showFacing: false },
    switch: { kind: "switch", fill: "#e5e7eb", showFacing: false },
    screen: { kind: "screen", fill: "#f8fafc", showFacing: true },
    table: {
      kind: serviceRole === "payment" ? "payment-desk" : "table",
      label: serviceRole === "payment" ? "收費" : undefined,
      fill: serviceRole === "payment" ? "#c4a574" : "#c8b6a6",
      showFacing: serviceRole === "payment",
      icon: serviceRole === "payment" ? "收費" : undefined,
    },
    chair: { kind: "chair", fill: "#b8c0cc", showFacing: true },
    mat: { kind: "mat", fill: MAT_COLORS.base, showFacing: false },
    computer: { kind: "computer", fill: "#94a3b8", showFacing: true },
    regTable: { kind: "checkin-desk", label: "報到", fill: "#a8b3a0", showFacing: true, icon: "報到" },
  };
  return map[kind];
}

export function planSymbolForSemantic(
  semantic: SemanticAssetType,
  serviceRole?: ServiceRole,
  color = "#94a3b8",
  name?: string,
): PlanSymbolSpec {
  switch (semantic) {
    case "door":
      return { kind: "door", fill: color, showFacing: false };
    case "switch":
      return { kind: "switch", fill: color, showFacing: false };
    case "screen":
      return { kind: "screen", fill: color, showFacing: true };
    case "table":
      return { kind: "table", fill: color, showFacing: false };
    case "chair":
      return { kind: "chair", fill: color, showFacing: true };
    case "mat":
      return { kind: "mat", fill: color, showFacing: false };
    case "computer":
      return { kind: "computer", fill: color, showFacing: true };
    case "service-desk":
      if (serviceRole === "payment") {
        return { kind: "payment-desk", label: "收費", fill: color, showFacing: true, icon: "收費" };
      }
      return { kind: "checkin-desk", label: "報到", fill: color, showFacing: true, icon: "報到" };
    case "signage":
      return { kind: "signage", label: name ?? "指示", fill: color, showFacing: true, icon: "→" };
    case "queue-barrier":
      return { kind: "queue-barrier", fill: color, showFacing: false };
    case "storage":
      // Use the item's real name when the catalog has one: a volunteer looking
      // for the 鞋架 on the 場刊圖 should not have to guess which grey "收納"
      // box it is.
      return { kind: "storage", label: name || "收納", fill: color, showFacing: true, icon: name || "收納" };
    case "payment-equipment":
      return { kind: "payment-box", label: "$", fill: color, showFacing: false, icon: "$" };
    default:
      return { kind: "other", label: name, fill: color, showFacing: true };
  }
}

/** Draw a plan symbol into a 2D canvas context (object local footprint already transformed). */
export function drawPlanSymbolOverlay(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  wPx: number,
  dPx: number,
  rotationDeg: number,
  spec: PlanSymbolSpec,
  theme: PlanSymbolTheme = "dark",
): void {
  const paper = theme === "paper";
  const outline = paper ? "#334155" : "#cbd5e1";
  const labelColor = paper ? "#0f172a" : "#f8fafc";
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((-rotationDeg * Math.PI) / 180);

  if (spec.kind === "chair") {
    // Seat rectangle + back bar on -Z (top of local after rotate convention: -depth/2)
    ctx.fillStyle = hexA(spec.fill, paper ? 0.8 : 0.55);
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1.4;
    roundRect(ctx, -wPx / 2, -dPx / 2, wPx, dPx, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = hexA(spec.fill, 0.9);
    ctx.fillRect(-wPx / 2, -dPx / 2, wPx, Math.max(3, dPx * 0.18));
    // facing tick toward +Z (bottom in canvas Y-down after our rotate? we use -rot so +Z is +y in plan Y-down maps to +z world)
    ctx.strokeStyle = paper ? "#334155" : "#e2e8f0";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, dPx * 0.45);
    ctx.stroke();
  } else if (spec.kind === "signage") {
    ctx.fillStyle = hexA(spec.fill, paper ? 0.8 : 0.7);
    ctx.strokeStyle = paper ? "#334155" : "#94a3b8";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -dPx / 2);
    ctx.lineTo(wPx / 2, dPx / 2);
    ctx.lineTo(-wPx / 2, dPx / 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (spec.kind === "queue-barrier") {
    ctx.strokeStyle = paper ? "#334155" : spec.fill;
    ctx.lineWidth = Math.max(3, dPx);
    ctx.beginPath();
    ctx.moveTo(-wPx / 2, 0);
    ctx.lineTo(wPx / 2, 0);
    ctx.stroke();
  } else if (spec.kind === "stage-platform") {
    ctx.fillStyle = hexA(spec.fill, paper ? 0.8 : 0.72);
    ctx.strokeStyle = paper ? "#334155" : "#1f2937";
    ctx.lineWidth = 2;
    ctx.fillRect(-wPx / 2, -dPx / 2, wPx, dPx);
    ctx.strokeRect(-wPx / 2, -dPx / 2, wPx, dPx);
    ctx.strokeStyle = "rgba(226,232,240,0.7)";
    ctx.lineWidth = 1;
    for (let x = -wPx / 2 - dPx; x < wPx / 2 + dPx; x += Math.max(8, dPx * 0.7)) {
      ctx.beginPath(); ctx.moveTo(x, dPx / 2); ctx.lineTo(x + dPx, -dPx / 2); ctx.stroke();
    }
  } else if (spec.kind === "lectern") {
    ctx.fillStyle = hexA(spec.fill, paper ? 0.8 : 0.68);
    ctx.strokeStyle = "#713f12";
    ctx.lineWidth = 1.5;
    roundRect(ctx, -wPx / 2, -dPx / 2, wPx, dPx, 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#f8fafc";
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, dPx * 0.4); ctx.stroke();
  } else if (spec.kind === "storage") {
    ctx.fillStyle = hexA(spec.fill, paper ? 0.8 : 0.5);
    ctx.strokeStyle = outline;
    roundRect(ctx, -wPx / 2, -dPx / 2, wPx, dPx, 2);
    ctx.fill();
    ctx.stroke();
    // grid hint
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-wPx / 6, -dPx / 2);
    ctx.lineTo(-wPx / 6, dPx / 2);
    ctx.moveTo(wPx / 6, -dPx / 2);
    ctx.lineTo(wPx / 6, dPx / 2);
    ctx.moveTo(-wPx / 2, 0);
    ctx.lineTo(wPx / 2, 0);
    ctx.stroke();
  } else {
    ctx.fillStyle = hexA(spec.fill, paper ? 0.8 : 0.5);
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1.5;
    roundRect(ctx, -wPx / 2, -dPx / 2, wPx, dPx, 2);
    ctx.fill();
    ctx.stroke();
    if (spec.showFacing) {
      ctx.strokeStyle = paper ? "#334155" : "#e2e8f0";
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, dPx * 0.45);
      ctx.stroke();
    }
  }

  if (spec.icon || spec.label) {
    const text = spec.icon ?? spec.label ?? "";
    ctx.save();
    // Counter-rotate so the label stays upright no matter how the object faces
    // (a 180° desk otherwise prints its name upside down on the export).
    ctx.rotate((rotationDeg * Math.PI) / 180);
    ctx.fillStyle = labelColor;
    const minLabelPx = paper ? 14 : 9;
    const maxLabelPx = paper ? 18 : 14;
    ctx.font = `600 ${Math.max(minLabelPx, Math.min(maxLabelPx, wPx * 0.28))}px system-ui, 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (paper) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 4;
      ctx.lineJoin = "round";
      ctx.strokeText(text, 0, 0);
    }
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }

  ctx.restore();
}

/** Tiny library thumbnail (offscreen canvas → data URL). */
export function renderPlanThumbDataUrl(spec: PlanSymbolSpec, size = 64): string {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, size, size);
  drawPlanSymbolOverlay(ctx, size / 2, size / 2, size * 0.7, size * 0.5, 0, spec);
  return canvas.toDataURL("image/png");
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}
