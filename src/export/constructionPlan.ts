/**
 * Construction Plan 2.0 — purpose-driven top-down plans drawn on a 2D canvas
 * (independent of the 3D scene) with dedicated symbols (door arc, screen
 * facing, switch/computer glyphs), zone labels, dimension lines, a legend, a
 * scale bar and an inventory list. Presets tune what is emphasised. Page size
 * (A4/A3) + orientation set the canvas aspect ratio (logical, not print DPI).
 */

import { assetDef } from "../core/assets";
import { catalogFromProject } from "../core/migrate";
import { drawPlanSymbolOverlay, planSymbolForObject } from "../core/planSymbol";
import type { ObjectKind, Project, SceneObject } from "../core/model";
import { groupMembers, memberLabel } from "../core/arrays";

import { doorSweep, facingVec, rectCorners } from "../core/placement";

const NEUTRAL_STROKE = "#334155";
const TEXT = "#0f172a";

/** Every canvas text call goes through this so CJK never falls back to tofu. */
function font(spec: string): string {
  return `${spec} system-ui, 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif`;
}

export type PlanPreset = "full" | "mats" | "route" | "zones" | "staff" | "partner" | "inventory";
export type PageSize = "a4" | "a3";
export type PageOrientation = "landscape" | "portrait";

/** Partner-role filter — same taxonomy as Partner Mode (core/partner.ts). */
export type RoleFilter = "checkin" | "payment" | "guide" | "life" | null;

export interface PlanOptions {
  preset: PlanPreset;
  page: PageSize;
  orientation: PageOrientation;
  dims: boolean;
  inventory: boolean;
  roleFilter: RoleFilter;
  simplify: boolean;
  /** Canvas pixel multiplier (2 = high-res export, 1 = fast inline preview). */
  scale: number;
  /** Optional subtitle override (e.g. 模擬摘要). */
  titleSuffix?: string;
  /** Extra notes drawn under the header (simulation summary lines). */
  extraNotes?: string[];
}

const DEFAULT_OPTIONS: PlanOptions = { preset: "full", page: "a4", orientation: "landscape", dims: true, inventory: true, roleFilter: null, simplify: false, scale: 2 };

/** Restrict a plan to what a given partner role needs (partner task map). */
function applyRoleFilter(project: Project, role: RoleFilter, simplify: boolean): Project {
  if (!role && !simplify) return project;
  const zoneOk = (t: string): boolean => {
    if (!role) return true;
    if (role === "checkin") return t === "registration";
    if (role === "payment") return t === "registration" || t === "payment";
    if (role === "life") return t === "life" || t === "meditation";
    return t === "shoe" || t === "backpack" || t === "registration" || t === "group"; // guide
  };
  const routeOk = (t: string): boolean => {
    if (!role) return true;
    if (role === "checkin") return t === "entry" || t === "registration";
    if (role === "payment") return t === "registration" || t === "payment";
    if (role === "life") return t === "staff" || t === "group";
    return t === "entry" || t === "shoe" || t === "backpack" || t === "seating" || t === "group";
  };
  const objOk = (o: SceneObject): boolean => {
    if (simplify && (o.kind === "switch" || o.kind === "computer") && !role) return false;
    if (!role) return true;
    if (role === "checkin") {
      if (o.serviceRole === "payment") return false;
      return o.kind === "door" || o.kind === "regTable" || o.kind === "computer" || o.kind === "screen";
    }
    if (role === "payment") return o.serviceRole === "payment" || o.kind === "door";
    if (role === "life") return o.kind === "table" || o.kind === "chair";
    return o.kind === "door" || o.kind === "screen"; // guide: entrances only
  };
  return {
    ...project,
    zones: project.zones.filter((z) => zoneOk(z.type)),
    routes: project.routes.filter((r) => routeOk(r.type)),
    objects: project.objects.filter((o) => objOk(o)),
    groups: role === "checkin" || role === "payment" ? [] : project.groups,
  };
}

const PRESET_TITLE: Record<PlanPreset, string> = {
  full: "場佈總覽圖",
  mats: "地墊 / 座位圖",
  route: "動線圖",
  zones: "工作分區圖",
  staff: "工作人員配置圖",
  partner: "夥伴觀看圖",
  inventory: "物資清單",
};

interface Xform { X: (wx: number) => number; Y: (wz: number) => number; s: number }

function pageDims(page: PageSize, orientation: PageOrientation): { w: number; h: number } {
  const long = page === "a3" ? 1980 : 1400;
  const short = Math.round(long / 1.4142);
  return orientation === "portrait" ? { w: short, h: long } : { w: long, h: short };
}

/** One line of the plan's item list, aggregated by human-readable name. */
export interface InventoryLine {
  icon: string;
  name: string;
  count: number;
}

/**
 * Count items by their catalog display name so a 收費桌 never gets reported
 * as a 桌子 (the legacy kind-based count collapses catalog variants).
 */
export function inventoryLines(project: Project): InventoryLine[] {
  const catalog = catalogFromProject(project);
  const byName = new Map<string, InventoryLine>();
  const add = (icon: string, name: string, count: number) => {
    const cur = byName.get(name);
    if (cur) cur.count += count;
    else byName.set(name, { icon, name, count });
  };
  for (const o of project.objects) {
    if (o.hidden) continue;
    const entry = catalog.resolve(o.assetId, o.kind);
    if (entry) add(entry.icon, entry.name, 1);
    else add("▫", assetDef(o.kind).displayName, 1);
  }
  for (const g of project.groups) {
    if (g.hidden) continue;
    add("▫", assetDef(g.sourceKind).displayName, g.rows * g.cols);
  }
  return [...byName.values()].sort((a, b) => b.count - a.count);
}

export function renderConstructionPlan(project: Project, options?: Partial<PlanOptions>): string {
  const opt = { ...DEFAULT_OPTIONS, ...options };
  if (opt.preset === "inventory") return renderInventorySheet(project, opt);
  project = applyRoleFilter(project, opt.roleFilter, opt.simplify);
  const areas = [project.classroom, project.corridor];
  const minX = Math.min(...areas.map((a) => a.x));
  const minZ = Math.min(...areas.map((a) => a.z));
  const maxX = Math.max(...areas.map((a) => a.x + a.length));
  const maxZ = Math.max(...areas.map((a) => a.z + a.width));
  const worldW = maxX - minX;
  const worldH = maxZ - minZ;

  const { w: cw, h: ch } = pageDims(opt.page, opt.orientation);
  const pad = 56;
  const notes = opt.extraNotes?.slice(0, 6) ?? [];
  const headerH = 78 + (notes.length ? notes.length * 17 + 8 : 0);

  // Size the footer from real content so the legend never collides with the
  // scale bar or runs off the page.
  const legendEntries = legendEntriesFor(project);
  const legendColW = 190;
  const legendPerRow = Math.max(1, Math.floor((cw / 2 - 48) / legendColW));
  const legendRows = Math.ceil(legendEntries.length / legendPerRow) || 1;
  const invLines = opt.inventory ? inventoryLines(project) : [];
  const invColW = 170;
  const invPerRow = Math.max(1, Math.floor((cw / 2 - 80) / invColW));
  const invRows = Math.ceil(invLines.length / invPerRow) || 1;
  const footerRows = Math.max(legendRows, invRows);
  const footerH = 26 + 22 + footerRows * 22 + 40;

  const regionW = cw - pad * 2;
  const regionH = ch - headerH - footerH;
  const s = Math.max(8, Math.min(200, Math.min(regionW / worldW, regionH / worldH)));
  const planW = worldW * s;
  const planH = worldH * s;
  const offX = pad + (regionW - planW) / 2;
  const offY = headerH + (regionH - planH) / 2;

  const scale = Math.max(1, opt.scale);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cw * scale);
  canvas.height = Math.round(ch * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  const t: Xform = { s, X: (wx) => offX + (wx - minX) * s, Y: (wz) => offY + (wz - minZ) * s };

  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, cw, ch);

  const emphasizeRoutes = opt.preset === "route" || opt.preset === "partner";
  const emphasizeZones = opt.preset === "zones" || opt.preset === "partner";
  const showTilesFaint = opt.preset !== "full";
  const fadeFurniture = opt.preset === "route" || opt.preset === "staff" || opt.preset === "zones";

  drawFloors(ctx, project, t);
  withAlpha(ctx, showTilesFaint ? 0.4 : 1, () => drawTiles(ctx, project, t, minX, minZ, maxX, maxZ));
  drawZones(ctx, project, t, emphasizeZones);

  if (opt.preset !== "route") {
    // Furniture + fixtures.
    for (const o of project.objects) {
      if (o.hidden) continue;
      const fade = fadeFurniture && (o.kind === "table" || o.kind === "chair");
      withAlpha(ctx, fade ? 0.35 : 1, () => drawObject(ctx, o, t, opt.preset, project));
    }
    drawGroups(ctx, project, t, opt.preset === "mats" || opt.preset === "full");
  } else {
    // Route preset: only doors/screens for orientation, faint furniture.
    for (const o of project.objects) {
      if (o.hidden) continue;
      if (o.kind === "door" || o.kind === "screen") drawObject(ctx, o, t, opt.preset, project);
    }
  }

  withAlpha(ctx, emphasizeRoutes ? 1 : opt.preset === "mats" ? 0.5 : 0.85, () =>
    drawRoutes(ctx, project, t, emphasizeRoutes));

  if (opt.dims) drawDimensions(ctx, project, t);
  const subtitle = opt.titleSuffix
    ? `${PRESET_TITLE[opt.preset]} · ${opt.titleSuffix}`
    : PRESET_TITLE[opt.preset];
  drawHeader(ctx, project, cw, subtitle);
  if (notes.length) {
    ctx.fillStyle = "#334155";
    ctx.font = font("13px");
    let ny = 82;
    for (const line of notes) {
      ctx.fillText(line, 24, ny);
      ny += 17;
    }
  }
  const footerY = ch - footerH + 26;
  drawLegend(ctx, legendEntries, footerY, legendPerRow, legendColW);
  if (opt.inventory) drawInventory(ctx, invLines, footerY, cw, invPerRow, invColW);
  drawScaleBar(ctx, t, ch - 26, pad, cw);

  return canvas.toDataURL("image/png");
}

/** 物資清單圖 — the item list is the page, with a small locator plan. */
function renderInventorySheet(project: Project, opt: PlanOptions): string {
  const { w: cw, h: ch } = pageDims(opt.page, opt.orientation);
  const scale = Math.max(1, opt.scale);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cw * scale);
  canvas.height = Math.round(ch * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, cw, ch);
  drawHeader(ctx, project, cw, PRESET_TITLE.inventory);

  const lines = inventoryLines(project);
  const zoneLines = project.zones
    .filter((z) => !z.hidden)
    .map((z) => ({ icon: z.icon, name: z.name, count: z.capacity ?? 0 }));

  ctx.fillStyle = TEXT;
  ctx.font = font("700 18px");
  ctx.fillText("物資數量", 32, 116);
  ctx.font = font("400 16px");
  let y = 148;
  if (!lines.length) {
    ctx.fillStyle = "#64748b";
    ctx.fillText("目前沒有任何物資 — 回到「場佈」放入桌椅、地墊或報到桌。", 32, y);
  }
  for (const line of lines) {
    ctx.fillStyle = TEXT;
    ctx.fillText(`${line.icon} ${line.name}`, 32, y);
    ctx.textAlign = "right";
    ctx.fillText(`× ${line.count}`, cw / 2 - 60, y);
    ctx.textAlign = "left";
    ctx.strokeStyle = "#e2e8f0";
    ctx.beginPath();
    ctx.moveTo(32, y + 8);
    ctx.lineTo(cw / 2 - 60, y + 8);
    ctx.stroke();
    y += 30;
    if (y > ch - 60) break;
  }

  if (zoneLines.length) {
    ctx.font = font("700 18px");
    ctx.fillText("功能區", cw / 2 + 20, 116);
    ctx.font = font("400 16px");
    let zy = 148;
    for (const z of zoneLines) {
      ctx.fillText(`${z.icon} ${z.name}${z.count ? ` · ${z.count} 人` : ""}`, cw / 2 + 20, zy);
      zy += 30;
      if (zy > ch / 2) break;
    }
  }

  // Small locator plan at the lower right so the list still shows the room.
  const miniW = Math.round(cw * 0.42);
  const miniH = Math.round(ch * 0.4);
  const mini = renderMiniPlan(project, miniW, miniH);
  ctx.drawImage(mini, cw - miniW - 32, ch - miniH - 40, miniW, miniH);
  return canvas.toDataURL("image/png");
}

/** Bare-bones top view used as a locator thumbnail (no header/footer). */
function renderMiniPlan(project: Project, w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#cbd5e1";
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  const areas = [project.classroom, project.corridor];
  const minX = Math.min(...areas.map((a) => a.x));
  const minZ = Math.min(...areas.map((a) => a.z));
  const maxX = Math.max(...areas.map((a) => a.x + a.length));
  const maxZ = Math.max(...areas.map((a) => a.z + a.width));
  const s = Math.min((w - 24) / (maxX - minX), (h - 24) / (maxZ - minZ));
  const t: Xform = { s, X: (wx) => 12 + (wx - minX) * s, Y: (wz) => 12 + (wz - minZ) * s };
  drawFloors(ctx, project, t);
  drawZones(ctx, project, t, false);
  for (const o of project.objects) {
    if (!o.hidden) drawObject(ctx, o, t, "full", project);
  }
  drawGroups(ctx, project, t, false);
  return canvas;
}

function withAlpha(ctx: CanvasRenderingContext2D, a: number, fn: () => void): void {
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = a;
  fn();
  ctx.globalAlpha = prev;
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
    ctx.font = font("600 15px");
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

function drawZones(ctx: CanvasRenderingContext2D, p: Project, t: Xform, emphasize = false): void {
  for (const z of p.zones) {
    if (z.hidden) continue;
    const x = t.X(z.x - z.width / 2), y = t.Y(z.z - z.depth / 2), w = z.width * t.s, h = z.depth * t.s;
    ctx.fillStyle = hexA(z.color, emphasize ? 0.3 : 0.18);
    ctx.strokeStyle = z.color;
    ctx.lineWidth = emphasize ? 3 : 2;
    ctx.setLineDash([6, 4]);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = TEXT;
    ctx.font = font(emphasize ? "700 16px" : "600 14px");
    const label = `${z.icon ? `${z.icon} ` : ""}${z.name}`;
    ctx.fillText(label, x + 6, y + (emphasize ? 22 : 18));
  }
}

function drawRoutes(ctx: CanvasRenderingContext2D, p: Project, t: Xform, bold: boolean): void {
  for (const r of p.routes) {
    if (!r.visible || r.points.length < 2) continue;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = bold ? 5 : 3;
    ctx.beginPath();
    ctx.moveTo(t.X(r.points[0].x), t.Y(r.points[0].z));
    for (let i = 1; i < r.points.length; i++) ctx.lineTo(t.X(r.points[i].x), t.Y(r.points[i].z));
    ctx.stroke();
    for (let i = 0; i < r.points.length - 1; i++) arrowHead(ctx, t.X(r.points[i].x), t.Y(r.points[i].z), t.X(r.points[i + 1].x), t.Y(r.points[i + 1].z), r.color);
    if (bold) {
      // Numbered stop badges ①②③ plus 起/終 so the walking order reads at a glance.
      for (let i = 0; i < r.points.length; i++) {
        const px = t.X(r.points[i].x);
        const py = t.Y(r.points[i].z);
        const isStart = i === 0;
        const isEnd = i === r.points.length - 1;
        ctx.fillStyle = isStart ? "#16a34a" : isEnd ? "#dc2626" : r.color;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.font = font("700 11px");
        ctx.textAlign = "center";
        ctx.fillText(isStart ? "起" : isEnd ? "終" : String(i + 1), px, py + 4);
        ctx.textAlign = "left";
      }
    }
    ctx.fillStyle = TEXT;
    ctx.font = font("600 13px");
    ctx.fillText(r.name, t.X(r.points[0].x) + 12, t.Y(r.points[0].z) - 10);
  }
}

function drawObject(ctx: CanvasRenderingContext2D, o: SceneObject, t: Xform, preset: PlanPreset, project: Project): void {
  if (o.kind === "door") { drawDoor(ctx, o, t); return; }
  if (o.kind === "screen") { drawScreen(ctx, o, t); return; }
  if (o.kind === "switch") { drawSwitch(ctx, o, t); return; }
  if (o.kind === "computer") { drawComputer(ctx, o, t); return; }

  const catalog = catalogFromProject(project);
  const entry = catalog.resolve(o.assetId, o.kind);
  const spec = planSymbolForObject(o, entry);
  const wPx = o.width * t.s;
  const dPx = o.depth * t.s;
  drawPlanSymbolOverlay(ctx, t.X(o.x), t.Y(o.z), wPx, dPx, o.rotationDeg, spec);

  // Keep chair facing tick in mats/full when symbol didn't already (belt-and-suspenders).
  if (o.kind === "chair" && preset !== "route" && !spec.showFacing) {
    const f = facingVec(o.rotationDeg);
    ctx.strokeStyle = NEUTRAL_STROKE;
    ctx.beginPath(); ctx.moveTo(t.X(o.x), t.Y(o.z)); ctx.lineTo(t.X(o.x + f.x * o.depth * 0.5), t.Y(o.z + f.z * o.depth * 0.5)); ctx.stroke();
  }
}

function drawGroups(ctx: CanvasRenderingContext2D, p: Project, t: Xform, numbered: boolean): void {
  for (const g of p.groups) {
    if (g.hidden) continue;
    const dense = g.rows * g.cols > 60; // hide labels when too dense to read
    for (const m of groupMembers(g)) {
      drawRectAt(ctx, m.x, m.z, g.itemWidth, g.itemDepth, m.rotationDeg, t, assetDef(g.sourceKind).color,
        numbered && !dense ? memberLabel(g, m.row, m.col) : undefined);
    }
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
    ctx.font = font("600 10px");
    ctx.textAlign = "center";
    ctx.fillText(label, t.X(cx), t.Y(cz) + 3.5);
    ctx.textAlign = "left";
  }
}

function drawDoor(ctx: CanvasRenderingContext2D, o: SceneObject, t: Xform): void {
  const sweep = doorSweep(o);
  const tangent = { x: facingVec(o.rotationDeg).z, z: -facingVec(o.rotationDeg).x };
  const a = { x: o.x - tangent.x * o.width / 2, z: o.z - tangent.z * o.width / 2 };
  const b = { x: o.x + tangent.x * o.width / 2, z: o.z + tangent.z * o.width / 2 };
  ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(t.X(a.x), t.Y(a.z)); ctx.lineTo(t.X(b.x), t.Y(b.z)); ctx.stroke();
  ctx.strokeStyle = "#0f172a"; ctx.lineWidth = 2;
  const endAng = sweep.startAngle + sweep.sweepAngle;
  ctx.beginPath(); ctx.moveTo(t.X(sweep.hingeX), t.Y(sweep.hingeZ)); ctx.lineTo(t.X(sweep.hingeX + Math.cos(endAng) * sweep.radius), t.Y(sweep.hingeZ + Math.sin(endAng) * sweep.radius)); ctx.stroke();
  ctx.strokeStyle = "#94a3b8";
  ctx.beginPath(); ctx.arc(t.X(sweep.hingeX), t.Y(sweep.hingeZ), sweep.radius * t.s, Math.min(sweep.startAngle, endAng), Math.max(sweep.startAngle, endAng)); ctx.stroke();
}

function drawScreen(ctx: CanvasRenderingContext2D, o: SceneObject, t: Xform): void {
  const tangent = { x: facingVec(o.rotationDeg).z, z: -facingVec(o.rotationDeg).x };
  const f = facingVec(o.rotationDeg);
  const a = { x: o.x - tangent.x * o.width / 2, z: o.z - tangent.z * o.width / 2 };
  const b = { x: o.x + tangent.x * o.width / 2, z: o.z + tangent.z * o.width / 2 };
  ctx.strokeStyle = "#1d4ed8"; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(t.X(a.x), t.Y(a.z)); ctx.lineTo(t.X(b.x), t.Y(b.z)); ctx.stroke();
  ctx.fillStyle = "#1d4ed8";
  const tip = { x: o.x + f.x * 0.4, z: o.z + f.z * 0.4 };
  ctx.beginPath();
  ctx.moveTo(t.X(o.x - tangent.x * 0.15), t.Y(o.z - tangent.z * 0.15));
  ctx.lineTo(t.X(o.x + tangent.x * 0.15), t.Y(o.z + tangent.z * 0.15));
  ctx.lineTo(t.X(tip.x), t.Y(tip.z));
  ctx.closePath(); ctx.fill();
}

function drawSwitch(ctx: CanvasRenderingContext2D, o: SceneObject, t: Xform): void {
  ctx.fillStyle = "#facc15"; ctx.strokeStyle = "#0f172a"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(t.X(o.x), t.Y(o.z), 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = TEXT; ctx.font = font("700 9px"); ctx.textAlign = "center";
  ctx.fillText("開", t.X(o.x), t.Y(o.z) + 3.5); ctx.textAlign = "left";
}

function drawComputer(ctx: CanvasRenderingContext2D, o: SceneObject, t: Xform): void {
  drawRectAt(ctx, o.x, o.z, o.width, o.depth, o.rotationDeg, t, "#38bdf8");
  ctx.fillStyle = "#0369a1"; ctx.font = font("700 9px"); ctx.textAlign = "center";
  ctx.fillText("電腦", t.X(o.x), t.Y(o.z) + 3.5); ctx.textAlign = "left";
}

function drawDimensions(ctx: CanvasRenderingContext2D, p: Project, t: Xform): void {
  const a = p.classroom;
  ctx.strokeStyle = "#0f172a"; ctx.fillStyle = "#0f172a"; ctx.lineWidth = 1;
  ctx.font = font("600 13px");
  dimLine(ctx, t.X(a.x), t.Y(a.z) - 16, t.X(a.x + a.length), t.Y(a.z) - 16, `${a.length} m`);
  dimLine(ctx, t.X(a.x) - 16, t.Y(a.z), t.X(a.x) - 16, t.Y(a.z + a.width), `${a.width} m`, true);
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

function drawHeader(ctx: CanvasRenderingContext2D, p: Project, width: number, subtitle: string): void {
  ctx.fillStyle = "#0f172a";
  ctx.font = font("700 26px");
  ctx.fillText(p.name || "場佈平面圖", 24, 40);
  ctx.fillStyle = "#64748b";
  ctx.font = font("400 14px");
  const today = new Date();
  const dateStr = `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}`;
  ctx.fillText(`${subtitle} · ${dateStr}`, 24, 62);
  ctx.textAlign = "right";
  ctx.fillText(`地磚 ${Math.round(p.tile.width * 100)}×${Math.round(p.tile.depth * 100)} cm`, width - 24, 62);
  ctx.textAlign = "left";
}

interface LegendEntry { color: string; label: string }

function legendEntriesFor(p: Project): LegendEntry[] {
  const entries: LegendEntry[] = [];
  const kinds = new Set<ObjectKind>(p.objects.filter((o) => !o.hidden).map((o) => o.kind));
  for (const g of p.groups) if (!g.hidden) kinds.add(g.sourceKind);
  for (const k of kinds) entries.push({ color: assetDef(k).color, label: assetDef(k).displayName });
  for (const z of p.zones) if (!z.hidden) entries.push({ color: z.color, label: z.name });
  for (const r of p.routes) if (r.visible) entries.push({ color: r.color, label: `動線：${r.name}` });
  return entries;
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  entries: LegendEntry[],
  y: number,
  perRow: number,
  colW: number,
): void {
  ctx.fillStyle = "#0f172a"; ctx.font = font("700 15px");
  ctx.fillText("圖例", 24, y);
  ctx.font = font("400 13px");
  let x = 24, row = y + 22;
  entries.forEach((e, i) => {
    if (i > 0 && i % perRow === 0) { row += 22; x = 24; }
    ctx.fillStyle = e.color; ctx.fillRect(x, row - 12, 15, 15);
    ctx.strokeStyle = "#94a3b8"; ctx.strokeRect(x, row - 12, 15, 15);
    ctx.fillStyle = "#0f172a"; ctx.fillText(e.label, x + 20, row);
    x += colW;
  });
}

function drawInventory(
  ctx: CanvasRenderingContext2D,
  lines: InventoryLine[],
  y: number,
  width: number,
  perRow: number,
  colW: number,
): void {
  const x = width / 2 + 20;
  ctx.fillStyle = "#0f172a"; ctx.font = font("700 15px");
  ctx.fillText("物資數量", x, y);
  ctx.font = font("400 13px");
  let row = y + 22, col = 0;
  for (const e of lines) {
    const cx = x + col * colW;
    ctx.fillStyle = "#0f172a";
    ctx.fillText(`${e.name}：${e.count}`, cx, row);
    col += 1;
    if (col >= perRow) { col = 0; row += 22; }
  }
}

function drawScaleBar(ctx: CanvasRenderingContext2D, t: Xform, y: number, pad: number, logicalW: number): void {
  const len = t.s;
  const x = logicalW - pad - len;
  ctx.strokeStyle = "#0f172a"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y); ctx.stroke();
  tick(ctx, x, y, false); tick(ctx, x + len, y, false);
  ctx.fillStyle = "#0f172a"; ctx.font = font("600 13px"); ctx.textAlign = "center";
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
  ctx.closePath(); ctx.fill();
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
