/**
 * "工作人員場佈圖" — a clean, self-explanatory top-down construction plan drawn
 * on a 2D canvas (independent of the 3D scene). Uses dedicated symbols (door
 * arc, screen facing, switch icon, computer glyph) plus a legend, scale bar,
 * room dimensions and zone labels, and never draws editor chrome.
 */

import { assetDef } from "../core/assets";
import type { ObjectKind, Project } from "../core/model";
import { groupMembers } from "../core/arrays";
import { doorSweep, facingVec, rectCorners } from "../core/placement";

const NEUTRAL_STROKE = "#334155";
const TEXT = "#0f172a";

interface Xform {
  X: (wx: number) => number;
  Y: (wz: number) => number;
  s: number; // pixels per meter
}

export function renderConstructionPlan(project: Project): string {
  const areas = [project.classroom, project.corridor];
  const minX = Math.min(...areas.map((a) => a.x));
  const minZ = Math.min(...areas.map((a) => a.z));
  const maxX = Math.max(...areas.map((a) => a.x + a.length));
  const maxZ = Math.max(...areas.map((a) => a.z + a.width));
  const worldW = maxX - minX;
  const worldH = maxZ - minZ;

  const pad = 70;
  const headerH = 76;
  const legendH = 118;
  const targetW = 1500;
  const s = Math.max(24, Math.min(120, (targetW - pad * 2) / worldW));
  const planW = worldW * s;
  const planH = worldH * s;
  const width = Math.max(targetW, planW + pad * 2);
  const height = headerH + planH + pad + legendH;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  const ctx = canvas.getContext("2d")!;

  const t: Xform = {
    s,
    X: (wx) => pad + (wx - minX) * s,
    Y: (wz) => headerH + (wz - minZ) * s,
  };

  // Background (light — a real floor-plan look).
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawFloors(ctx, project, t);
  drawTiles(ctx, project, t, minX, minZ, maxX, maxZ);
  drawZones(ctx, project, t);
  drawRoutes(ctx, project, t);
  drawObjects(ctx, project, t);
  drawGroups(ctx, project, t);
  drawDimensions(ctx, project, t);
  drawHeader(ctx, project, canvas.width);
  drawLegend(ctx, project, headerH + planH + pad / 2, canvas.width);
  drawScaleBar(ctx, t, headerH + planH + pad / 2, pad);

  return canvas.toDataURL("image/png");
}

function drawFloors(ctx: CanvasRenderingContext2D, p: Project, t: Xform): void {
  for (const a of [p.classroom, p.corridor]) {
    ctx.fillStyle = a.id === "classroom" ? "#ffffff" : "#f1f5f9";
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 3;
    const x = t.X(a.x), y = t.Y(a.z), w = a.length * t.s, h = a.width * t.s;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = "#64748b";
    ctx.font = "600 15px system-ui, 'Noto Sans TC', sans-serif";
    ctx.fillText(a.name, x + 8, y + 20);
  }
}

function drawTiles(ctx: CanvasRenderingContext2D, p: Project, t: Xform, minX: number, minZ: number, maxX: number, maxZ: number): void {
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  const w = Math.max(p.tile.width, 0.05);
  const d = Math.max(p.tile.depth, 0.05);
  ctx.beginPath();
  let sx = p.tile.originX; while (sx > minX) sx -= w;
  for (let x = sx; x <= maxX + 1e-6; x += w) { ctx.moveTo(t.X(x), t.Y(minZ)); ctx.lineTo(t.X(x), t.Y(maxZ)); }
  let sz = p.tile.originZ; while (sz > minZ) sz -= d;
  for (let z = sz; z <= maxZ + 1e-6; z += d) { ctx.moveTo(t.X(minX), t.Y(z)); ctx.lineTo(t.X(maxX), t.Y(z)); }
  ctx.stroke();
}

function drawZones(ctx: CanvasRenderingContext2D, p: Project, t: Xform): void {
  for (const z of p.zones) {
    if (z.hidden) continue;
    const x = t.X(z.x - z.width / 2), y = t.Y(z.z - z.depth / 2), w = z.width * t.s, h = z.depth * t.s;
    ctx.fillStyle = hexA(z.color, 0.18);
    ctx.strokeStyle = z.color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = TEXT;
    ctx.font = "600 14px system-ui, 'Noto Sans TC', sans-serif";
    ctx.fillText(z.name, x + 6, y + 18);
  }
}

function drawRoutes(ctx: CanvasRenderingContext2D, p: Project, t: Xform): void {
  for (const r of p.routes) {
    if (!r.visible || r.points.length < 2) continue;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(t.X(r.points[0].x), t.Y(r.points[0].z));
    for (let i = 1; i < r.points.length; i++) ctx.lineTo(t.X(r.points[i].x), t.Y(r.points[i].z));
    ctx.stroke();
    for (let i = 0; i < r.points.length - 1; i++) arrowHead(ctx, t.X(r.points[i].x), t.Y(r.points[i].z), t.X(r.points[i + 1].x), t.Y(r.points[i + 1].z), r.color);
    ctx.fillStyle = TEXT;
    ctx.font = "600 13px system-ui, sans-serif";
    ctx.fillText(r.name, t.X(r.points[0].x) + 6, t.Y(r.points[0].z) - 6);
  }
}

function drawObjects(ctx: CanvasRenderingContext2D, p: Project, t: Xform): void {
  const counts: Partial<Record<ObjectKind, number>> = {};
  for (const o of p.objects) {
    if (o.hidden) continue;
    counts[o.kind] = (counts[o.kind] ?? 0) + 1;
    switch (o.kind) {
      case "door": drawDoor(ctx, o, t); break;
      case "screen": drawScreen(ctx, o, t); break;
      case "switch": drawSwitch(ctx, o, t); break;
      case "computer": drawComputer(ctx, o, t); break;
      default: drawRect(ctx, o, t, o.kind === "regTable" ? "報到桌" : undefined);
    }
  }
}

function drawGroups(ctx: CanvasRenderingContext2D, p: Project, t: Xform): void {
  for (const g of p.groups) {
    if (g.hidden) continue;
    const members = groupMembers(g);
    members.forEach((m, i) => {
      drawRectAt(ctx, m.x, m.z, g.itemWidth, g.itemDepth, m.rotationDeg, t, assetDef(g.sourceKind).color, String(i + 1));
    });
  }
}

function drawRect(ctx: CanvasRenderingContext2D, o: { x: number; z: number; width: number; depth: number; rotationDeg: number; kind: ObjectKind }, t: Xform, label?: string): void {
  drawRectAt(ctx, o.x, o.z, o.width, o.depth, o.rotationDeg, t, assetDef(o.kind).color, label);
  if (o.kind === "chair") {
    // Facing tick.
    const f = facingVec(o.rotationDeg);
    ctx.strokeStyle = NEUTRAL_STROKE;
    ctx.beginPath();
    ctx.moveTo(t.X(o.x), t.Y(o.z));
    ctx.lineTo(t.X(o.x + f.x * o.depth * 0.5), t.Y(o.z + f.z * o.depth * 0.5));
    ctx.stroke();
  }
}

function drawRectAt(ctx: CanvasRenderingContext2D, cx: number, cz: number, w: number, d: number, rot: number, t: Xform, color: string, label?: string): void {
  const corners = rectCorners(cx, cz, w, d, rot).map((c) => ({ x: t.X(c.x), y: t.Y(c.z) }));
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.fillStyle = hexA(color, 0.5);
  ctx.strokeStyle = NEUTRAL_STROKE;
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();
  if (label) {
    ctx.fillStyle = TEXT;
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, t.X(cx), t.Y(cz) + 4);
    ctx.textAlign = "left";
  }
}

function drawDoor(ctx: CanvasRenderingContext2D, o: { x: number; z: number; width: number; rotationDeg: number; hinge?: string; openInward?: boolean; openDeg?: number }, t: Xform): void {
  const sweep = doorSweep(o as never);
  // Opening (gap) in the wall — a white rect over the wall line.
  const tangent = { x: facingVec(o.rotationDeg).z, z: -facingVec(o.rotationDeg).x };
  const a = { x: o.x - tangent.x * o.width / 2, z: o.z - tangent.z * o.width / 2 };
  const b = { x: o.x + tangent.x * o.width / 2, z: o.z + tangent.z * o.width / 2 };
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(t.X(a.x), t.Y(a.z)); ctx.lineTo(t.X(b.x), t.Y(b.z)); ctx.stroke();
  // Leaf + arc.
  ctx.strokeStyle = "#0f172a";
  ctx.lineWidth = 2;
  const endAng = sweep.startAngle + sweep.sweepAngle;
  const leafX = sweep.hingeX + Math.cos(endAng) * sweep.radius;
  const leafZ = sweep.hingeZ + Math.sin(endAng) * sweep.radius;
  ctx.beginPath(); ctx.moveTo(t.X(sweep.hingeX), t.Y(sweep.hingeZ)); ctx.lineTo(t.X(leafX), t.Y(leafZ)); ctx.stroke();
  ctx.strokeStyle = "#94a3b8";
  ctx.beginPath();
  ctx.arc(t.X(sweep.hingeX), t.Y(sweep.hingeZ), sweep.radius * t.s, Math.min(sweep.startAngle, endAng), Math.max(sweep.startAngle, endAng));
  ctx.stroke();
}

function drawScreen(ctx: CanvasRenderingContext2D, o: { x: number; z: number; width: number; rotationDeg: number }, t: Xform): void {
  const tangent = { x: facingVec(o.rotationDeg).z, z: -facingVec(o.rotationDeg).x };
  const f = facingVec(o.rotationDeg);
  const a = { x: o.x - tangent.x * o.width / 2, z: o.z - tangent.z * o.width / 2 };
  const b = { x: o.x + tangent.x * o.width / 2, z: o.z + tangent.z * o.width / 2 };
  ctx.strokeStyle = "#1d4ed8";
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(t.X(a.x), t.Y(a.z)); ctx.lineTo(t.X(b.x), t.Y(b.z)); ctx.stroke();
  // Facing triangle.
  ctx.fillStyle = "#1d4ed8";
  const tip = { x: o.x + f.x * 0.4, z: o.z + f.z * 0.4 };
  ctx.beginPath();
  ctx.moveTo(t.X(o.x - tangent.x * 0.15), t.Y(o.z - tangent.z * 0.15));
  ctx.lineTo(t.X(o.x + tangent.x * 0.15), t.Y(o.z + tangent.z * 0.15));
  ctx.lineTo(t.X(tip.x), t.Y(tip.z));
  ctx.closePath();
  ctx.fill();
}

function drawSwitch(ctx: CanvasRenderingContext2D, o: { x: number; z: number }, t: Xform): void {
  ctx.fillStyle = "#facc15";
  ctx.strokeStyle = "#0f172a";
  ctx.lineWidth = 1.5;
  const r = 8;
  ctx.beginPath(); ctx.arc(t.X(o.x), t.Y(o.z), r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = TEXT; ctx.font = "700 10px system-ui, sans-serif"; ctx.textAlign = "center";
  ctx.fillText("S", t.X(o.x), t.Y(o.z) + 3.5); ctx.textAlign = "left";
}

function drawComputer(ctx: CanvasRenderingContext2D, o: { x: number; z: number; width: number; depth: number; rotationDeg: number }, t: Xform): void {
  drawRectAt(ctx, o.x, o.z, o.width, o.depth, o.rotationDeg, t, "#38bdf8");
  ctx.fillStyle = "#0369a1"; ctx.font = "700 10px system-ui, sans-serif"; ctx.textAlign = "center";
  ctx.fillText("PC", t.X(o.x), t.Y(o.z) + 3.5); ctx.textAlign = "left";
}

function drawDimensions(ctx: CanvasRenderingContext2D, p: Project, t: Xform): void {
  const a = p.classroom;
  ctx.strokeStyle = "#0f172a"; ctx.fillStyle = "#0f172a"; ctx.lineWidth = 1;
  ctx.font = "600 13px system-ui, sans-serif";
  // Top (length).
  const y = t.Y(a.z) - 14;
  dimLine(ctx, t.X(a.x), y, t.X(a.x + a.length), y, `${a.length} m`);
  // Left (width).
  const x = t.X(a.x) - 14;
  dimLine(ctx, x, t.Y(a.z), x, t.Y(a.z + a.width), `${a.width} m`, true);
}

function dimLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, label: string, vertical = false): void {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  tick(ctx, x1, y1, vertical); tick(ctx, x2, y2, vertical);
  ctx.save();
  ctx.fillStyle = "#0f172a";
  if (vertical) { ctx.translate((x1 + x2) / 2 - 4, (y1 + y2) / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = "center"; ctx.fillText(label, 0, 0); }
  else { ctx.textAlign = "center"; ctx.fillText(label, (x1 + x2) / 2, y1 - 5); }
  ctx.restore();
  ctx.textAlign = "left";
}

function tick(ctx: CanvasRenderingContext2D, x: number, y: number, vertical: boolean): void {
  ctx.beginPath();
  if (vertical) { ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); } else { ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); }
  ctx.stroke();
}

function drawHeader(ctx: CanvasRenderingContext2D, p: Project, width: number): void {
  ctx.fillStyle = "#0f172a";
  ctx.font = "700 26px system-ui, 'Noto Sans TC', sans-serif";
  ctx.fillText(p.name || "場佈平面圖", 24, 40);
  ctx.fillStyle = "#64748b";
  ctx.font = "400 14px system-ui, sans-serif";
  ctx.fillText("工作人員場佈圖 · 平面場 ISO", 24, 62);
  ctx.textAlign = "right";
  ctx.fillText(`地磚 ${Math.round(p.tile.width * 100)}×${Math.round(p.tile.depth * 100)} cm`, width - 24, 62);
  ctx.textAlign = "left";
}

function drawLegend(ctx: CanvasRenderingContext2D, p: Project, y: number, width: number): void {
  const entries: { color: string; label: string }[] = [];
  const kinds = new Set(p.objects.map((o) => o.kind));
  for (const g of p.groups) kinds.add(g.sourceKind);
  for (const k of kinds) entries.push({ color: assetDef(k).color, label: assetDef(k).displayName });
  for (const z of p.zones) entries.push({ color: z.color, label: z.name });
  for (const r of p.routes) entries.push({ color: r.color, label: `動線：${r.name}` });

  ctx.fillStyle = "#0f172a";
  ctx.font = "700 15px system-ui, sans-serif";
  ctx.fillText("圖例", 24, y);
  ctx.font = "400 13px system-ui, sans-serif";
  let x = 24, row = y + 22;
  const colW = 220;
  entries.forEach((e, i) => {
    if (i > 0 && i % Math.max(1, Math.floor((width - 48) / colW)) === 0) { row += 24; x = 24; }
    ctx.fillStyle = e.color; ctx.fillRect(x, row - 12, 16, 16);
    ctx.strokeStyle = "#94a3b8"; ctx.strokeRect(x, row - 12, 16, 16);
    ctx.fillStyle = "#0f172a"; ctx.fillText(e.label, x + 22, row);
    x += colW;
  });
}

function drawScaleBar(ctx: CanvasRenderingContext2D, t: Xform, y: number, pad: number): void {
  const meters = 1;
  const len = meters * t.s;
  const x = ctx.canvas.width - pad - len;
  ctx.strokeStyle = "#0f172a"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y); ctx.stroke();
  tick(ctx, x, y, false); tick(ctx, x + len, y, false);
  ctx.fillStyle = "#0f172a"; ctx.font = "600 13px system-ui, sans-serif"; ctx.textAlign = "center";
  ctx.fillText("1 m", x + len / 2, y - 8); ctx.textAlign = "left";
}

function arrowHead(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string): void {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const ang = Math.atan2(y2 - y1, x2 - x1);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(mx + Math.cos(ang) * 8, my + Math.sin(ang) * 8);
  ctx.lineTo(mx + Math.cos(ang + 2.5) * 8, my + Math.sin(ang + 2.5) * 8);
  ctx.lineTo(mx + Math.cos(ang - 2.5) * 8, my + Math.sin(ang - 2.5) * 8);
  ctx.closePath();
  ctx.fill();
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
