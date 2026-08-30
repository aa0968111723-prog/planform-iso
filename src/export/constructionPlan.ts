/**
 * Construction Plan 2.0 — purpose-driven top-down plans drawn on a 2D canvas
 * (independent of the 3D scene) with dedicated symbols (door arc, screen
 * facing, switch/computer glyphs), zone labels, dimension lines, a legend, a
 * scale bar and an inventory list. Presets tune what is emphasised. Page size
 * (A4/A3) + orientation set the canvas aspect ratio (logical, not print DPI).
 */

import { assetDef } from "../core/assets";
import { catalogFromProject } from "../core/migrate";
import { BRAND } from "../core/brand";
import { drawPlanSymbolOverlay, planSymbolForObject } from "../core/planSymbol";
import { calibrationComplete, venueNeedsCalibration, type PropDefinition, type Project, type SceneObject } from "../core/model";
import { propForAssetId } from "../core/propCatalog";
import { artboardMm, describePrintSpec, type PrintSpec } from "../core/printSpec";
import { audienceJoiners, stationForStep, normalizeTemplate } from "../core/interactionCompile";
import { groupFootprint, groupMembers, memberLabel } from "../core/arrays";

import { doorSweep, facingVec, rectCorners } from "../core/placement";
import { MAT_COLORS } from "../core/theme";

const NEUTRAL_STROKE = "#334155";
const TEXT = "#0f172a";
let activePageSize: PageSize = "a4";

/** Every canvas text call goes through this so CJK never falls back to tofu. */
function font(spec: string): string {
  const adjusted = activePageSize === "phone"
    ? spec.replace(/(\d+(?:\.\d+)?)px/g, (_, value: string) => `${Math.max(28, Number(value))}px`)
    : spec;
  return `${adjusted} system-ui, 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif`;
}

export type PlanPreset = "full" | "mats" | "route" | "zones" | "staff" | "partner" | "inventory" | "flow";
export type PageSize = "a4" | "a3" | "phone";
export type PageOrientation = "landscape" | "portrait";

/** Partner-role filter — same taxonomy as Partner Mode (core/partner.ts). */
export type RoleFilter = "checkin" | "payment" | "guide" | "life" | null;

export function calibrationFooterText(project: Project): string {
  return venueNeedsCalibration(project) && !calibrationComplete(project) ? "尺寸待現場校正" : "";
}

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
  flow: "互動流程",
};

interface Xform { X: (wx: number) => number; Y: (wz: number) => number; s: number }

function pageDims(page: PageSize, orientation: PageOrientation): { w: number; h: number } {
  if (page === "phone") return { w: 1080, h: 1920 };
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
    // Array groups carry a kind, not an assetId. Resolve the catalog entry and
    // refine it by the size actually used, so the packing list reads
    // "🧩 地墊（巧拼 60 × 60 cm） 96" instead of a generic "▫ 地墊 96" — the
    // 場務組 has to know which mats to carry.
    const entry = catalog.resolve(undefined, g.sourceKind);
    const preset = entry.presets?.find(
      (p) => Math.abs(p.width - g.itemWidth) < 1e-6 && Math.abs(p.depth - g.itemDepth) < 1e-6,
    );
    // When the preset names the real material (巧拼), that name alone is what
    // the 場務組 says out loud — and short enough that the count still fits the
    // column. A bare-size preset keeps the kind name in front of it.
    const named = preset && /[\u4e00-\u9fff]/.test(preset.label);
    add(entry.icon, named ? preset.label : preset ? `${entry.name} ${preset.label}` : entry.name, g.rows * g.cols);
  }
  return [...byName.values()].sort((a, b) => b.count - a.count);
}

export interface PrintOrderLine {
  /** The prop's name, as the club calls it. */
  name: string;
  icon: string;
  /** One line a printer can quote from. */
  spec: string;
  /** Artwork canvas including bleed, for whoever makes the file. */
  artboard: string;
  quantity: number;
}

/**
 * What to send to the printer.
 *
 * The plan already knows every poster, banner and backdrop the stall needs and
 * exactly how big each one is. Until this existed that knowledge died on the
 * canvas: the 場佈圖 showed a white rectangle and somebody still had to work
 * out, by hand, that it meant 「A2 雪銅紙 30 份」.
 *
 * Only props that are actually PLACED are counted — designing a banner and not
 * putting it anywhere is not an order.
 */
export function printOrderLines(project: Project): PrintOrderLine[] {
  const placedCount = new Map<string, { def: PropDefinition; placed: number }>();
  for (const o of project.objects) {
    if (o.hidden) continue;
    // `propForAssetId` is the one place that knows how a placed object points
    // back at a definition; re-deriving it here would be a second answer to
    // the same question.
    const def = propForAssetId(project.props, o.assetId);
    if (!def) continue;
    const cur = placedCount.get(def.id);
    if (cur) cur.placed += 1;
    else placedCount.set(def.id, { def, placed: 1 });
  }

  const out: PrintOrderLine[] = [];
  for (const { def, placed } of placedCount.values()) {
    if (!def.print) continue;
    const spec = def.print as PrintSpec;
    // The spec's own quantity is per placed item: two X 展架 on the plan, each
    // specced 1, is an order for two.
    const quantity = spec.quantity * placed;
    const board = artboardMm(spec);
    out.push({
      name: def.name,
      icon: def.icon ?? "🖨",
      spec: describePrintSpec({ ...spec, quantity }),
      artboard: `完稿 ${board.widthMm} × ${board.heightMm} mm`,
      quantity,
    });
  }
  return out.sort((a, b) => b.quantity - a.quantity);
}

interface Bounds { minX: number; minZ: number; maxX: number; maxZ: number }

function contentBounds(project: Project): Bounds {
  const bounds: Bounds = {
    minX: Math.min(project.classroom.x, project.corridor.x),
    minZ: Math.min(project.classroom.z, project.corridor.z),
    maxX: Math.max(project.classroom.x + project.classroom.length, project.corridor.x + project.corridor.length),
    maxZ: Math.max(project.classroom.z + project.classroom.width, project.corridor.z + project.corridor.width),
  };
  const include = (x: number, z: number) => {
    bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minZ = Math.min(bounds.minZ, z); bounds.maxZ = Math.max(bounds.maxZ, z);
  };
  for (const o of project.objects) {
    if (o.hidden) continue;
    for (const corner of rectCorners(o.x, o.z, o.width, o.depth, o.rotationDeg)) include(corner.x, corner.z);
  }
  for (const g of project.groups) {
    if (g.hidden) continue;
    for (const m of groupMembers(g)) {
      for (const corner of rectCorners(m.x, m.z, g.itemWidth, g.itemDepth, m.rotationDeg)) include(corner.x, corner.z);
    }
  }
  for (const z of project.zones) {
    if (z.hidden) continue;
    include(z.x - z.width / 2, z.z - z.depth / 2);
    include(z.x + z.width / 2, z.z + z.depth / 2);
  }
  for (const r of project.routes) {
    if (!r.visible) continue;
    for (const point of r.points) include(point.x, point.z);
  }
  return bounds;
}

export function renderConstructionPlan(project: Project, options?: Partial<PlanOptions>): string {
  const opt = { ...DEFAULT_OPTIONS, ...options };
  activePageSize = opt.page;
  if (opt.preset === "inventory") return renderInventorySheet(project, opt);
  if (opt.preset === "flow") return renderFlowSheet(project, opt);
  project = applyRoleFilter(project, opt.roleFilter, opt.simplify);
  const bounds = contentBounds(project);
  const minX = bounds.minX;
  const minZ = bounds.minZ;
  const maxX = bounds.maxX;
  const maxZ = bounds.maxZ;
  const worldW = maxX - minX;
  const worldH = maxZ - minZ;

  const { w: cw, h: ch } = pageDims(opt.page, opt.orientation);
  const phone = opt.page === "phone";
  const pad = phone ? 48 : 56;
  const notes = opt.extraNotes?.slice(0, 6) ?? [];
  const headerH = phone ? 132 + (notes.length ? notes.length * 36 + 10 : 0) : 86 + (notes.length ? notes.length * 21 + 8 : 0);

  // Size the footer from real content so the legend never collides with the
  // scale bar or runs off the page.
  const legendEntries = legendEntriesFor(project);
  const legendColW = 260;
  const legendPerRow = Math.max(1, Math.floor((cw / 2 - 48) / legendColW));
  const legendRows = Math.ceil(legendEntries.length / legendPerRow) || 1;
  const invLines = opt.inventory ? inventoryLines(project) : [];
  const invColW = 220;
  const invPerRow = Math.max(1, Math.floor((cw / 2 - 80) / invColW));
  const invRows = Math.ceil(invLines.length / invPerRow) || 1;
  const footerRows = Math.max(legendRows, invRows);
  const footerH = phone ? 74 : 30 + 26 + footerRows * 30 + 48;

  const regionW = cw - pad * 2;
  const regionH = ch - headerH - footerH;
  const s = Math.max(8, Math.min(200, Math.min(regionW / worldW, regionH / worldH)));
  const planW = worldW * s;
  const planH = worldH * s;
  const offX = pad + (regionW - planW) / 2;
  // A roughly square room on a tall portrait page leaves a lot of slack. It
  // used to be split evenly above and below, so a phone 場刊圖 was a small
  // drawing floating in white. Top-align instead and spend the slack on the
  // legend, which phone pages were dropping altogether.
  const slack = regionH - planH;
  const phoneLegendGap = phone && slack > 260 ? slack - 120 : 0;
  const offY = headerH + (phoneLegendGap ? 60 : slack / 2);

  const scale = Math.max(1, opt.scale);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cw * scale);
  canvas.height = Math.round(ch * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  const t: Xform = { s, X: (wx) => offX + (wx - minX) * s, Y: (wz) => offY + (wz - minZ) * s };

  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, cw, ch);
  resetLabelLayout({ minX: 12, minY: headerH - 8, maxX: cw - 12, maxY: ch - footerH - 8 });

  const emphasizeRoutes = opt.preset === "route" || opt.preset === "partner";
  const showRouteBadges = emphasizeRoutes || opt.preset === "staff";
  const emphasizeZones = opt.preset === "zones" || opt.preset === "partner";
  const showTilesFaint = opt.preset !== "full";
  const fadeFurniture = opt.preset === "route" || opt.preset === "staff" || opt.preset === "zones" || opt.preset === "mats";

  drawFloors(ctx, project, t);
  withAlpha(ctx, showTilesFaint ? 0.4 : 1, () => drawTiles(ctx, project, t));
  drawZones(ctx, project, t, emphasizeZones);

  if (opt.preset !== "route") {
    // Furniture + fixtures.
    for (const o of project.objects) {
      if (o.hidden) continue;
      const fade = opt.preset === "mats"
        ? o.kind !== "door" && o.kind !== "screen"
        : fadeFurniture && (o.kind === "table" || o.kind === "chair");
      withAlpha(ctx, fade ? 0.35 : 1, () => drawObject(ctx, o, t, opt.preset, project));
    }
    drawGroups(ctx, project, t, opt.preset === "mats" || opt.preset === "full", opt.preset === "mats");
  } else {
    // Route preset: keep the path readable while retaining the physical
    // landmarks that explain where a route actually ends.
    for (const o of project.objects) {
      if (o.hidden) continue;
      if (o.kind === "door" || o.kind === "screen") drawObject(ctx, o, t, opt.preset, project);
    }
    withAlpha(ctx, 0.28, () => {
      drawGroups(ctx, project, t, false);
      const catalog = catalogFromProject(project);
      for (const o of project.objects) {
        if (o.hidden || o.kind === "door" || o.kind === "screen") continue;
        if (catalog.resolve(o.assetId, o.kind).blocksFlow) drawObject(ctx, o, t, opt.preset, project);
      }
    });
  }

  if (emphasizeRoutes) {
    // Route/partner sheets prioritise numbered stops. Draw zone names first so
    // a long label cannot erase a stop badge (the previous 背包 label hid ④).
    drawZoneLabels(ctx, project, t, emphasizeZones);
    drawRoutes(ctx, project, t, showRouteBadges);
  } else {
    withAlpha(ctx, opt.preset === "mats" ? 0.5 : 0.85, () => drawRoutes(ctx, project, t, showRouteBadges));
    // On non-route sheets labels remain the topmost communication layer.
    drawZoneLabels(ctx, project, t, emphasizeZones);
  }

  if (opt.dims) drawDimensions(ctx, project, t);
  const subtitle = opt.titleSuffix
    ? `${PRESET_TITLE[opt.preset]} · ${opt.titleSuffix}`
    : PRESET_TITLE[opt.preset];
  drawHeader(ctx, project, cw, subtitle);
  if (notes.length) {
    ctx.fillStyle = "#334155";
    ctx.font = font("16px");
    let ny = phone ? 132 : 88;
    for (const line of notes) {
      ctx.fillText(line, 24, ny);
      ny += phone ? 36 : 21;
    }
  }
  const footerY = ch - footerH + 26;
  if (phone) {
    if (phoneLegendGap >= 90) {
      const legendY = offY + planH + 56;
      const phonePerRow = Math.max(1, Math.floor((cw - 48) / 300));
      drawLegend(ctx, legendEntries, legendY, phonePerRow, 300);
    }
    drawPhoneFooter(ctx, project, cw, ch, opt.preset);
  } else {
    drawLegend(ctx, legendEntries, footerY, legendPerRow, legendColW);
    if (opt.inventory) drawInventory(ctx, invLines, footerY, cw, invPerRow, invColW);
  }
  drawCalibrationFooter(ctx, project, cw, ch);
  if (!phone) drawScaleBar(ctx, t, ch - 26, pad, cw);

  return canvas.toDataURL("image/png");
}

/** 物資清單圖 — the item list is the page, with a small locator plan. */
/** One printed line of the 互動流程 sheet. */
export interface FlowSheetLine {
  kind: "head" | "step" | "detail" | "option" | "note";
  text: string;
}

/**
 * The interaction flow, as words on paper.
 *
 * Printed, not drawn. A volunteer standing at the table needs to read what to
 * say and what to hand over; a box-and-arrow diagram of the same thing is
 * slower to read and impossible to check against.
 *
 * What is deliberately NOT here: step ids, `next` targets, option weights,
 * station ids, seeds. Those are how the SIMULATION walks the flow. Nobody
 * running the booth needs them, and printing them would turn a briefing sheet
 * into a data dump. The one place a jump appears is where the flow genuinely
 * branches out of order, and then it is named, not numbered.
 */
export function flowSheetLines(project: Project): FlowSheetLine[] {
  const template = project.interaction;
  if (!template) return [];
  const n = normalizeTemplate(template);
  const lines: FlowSheetLine[] = [];

  const funnel = audienceJoiners(template.audience);
  const minutes = Math.round(template.audience.windowSeconds / 60);
  lines.push({
    kind: "head",
    text: template.audience.stopRate < 1
      ? `${minutes} 分鐘內經過 ${funnel.passed} 人，預計 ${funnel.joined} 人會參加`
      : `${funnel.joined} 人，${minutes} 分鐘內到齊`,
  });
  if (template.staff.length) {
    lines.push({
      kind: "head",
      text: `人手：${template.staff.map((r) => `${r.name} ${r.count} 人`).join("、")}`,
    });
  }

  const supplies = new Set<string>();
  let inherited: string | null = null;
  template.steps.forEach((step, i) => {
    const station = stationForStep(step, inherited, n);
    inherited = station?.id ?? inherited;
    const where = station ? `（${station.name}）` : "";
    const seconds = step.avgSeconds > 0 ? ` · 約 ${Math.round(step.avgSeconds)} 秒` : "";
    lines.push({ kind: "step", text: `${i + 1}. ${step.name}${where}${seconds}` });
    if (step.prompt) lines.push({ kind: "detail", text: step.prompt });

    if (step.branch?.kind === "chance") {
      for (const option of step.branch.options) {
        if (!option.label.trim()) continue;
        lines.push({ kind: "option", text: `· ${option.label}${option.prompt ? `：${option.prompt}` : ""}` });
      }
    } else if (step.branch?.kind === "match") {
      for (const rule of step.branch.rules) {
        lines.push({ kind: "option", text: `· ${rule.label}${rule.prompt ? `：${rule.prompt}` : ""}` });
      }
      if (step.branch.otherwise) {
        lines.push({ kind: "option", text: `· 其他：${step.branch.otherwise.label}` });
      }
    }

    for (const item of step.supplies ?? []) supplies.add(item);
  });

  if (supplies.size) {
    lines.push({ kind: "head", text: "要帶的東西" });
    for (const item of supplies) lines.push({ kind: "option", text: `· ${item}` });
  }
  if (template.note) lines.push({ kind: "note", text: template.note });
  return lines;
}

function renderFlowSheet(project: Project, opt: PlanOptions): string {
  const { w: cw, h: ch } = pageDims(opt.page, opt.orientation);
  const phone = opt.page === "phone";
  const scale = Math.max(1, opt.scale);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(cw * scale);
  canvas.height = Math.round(ch * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, cw, ch);
  drawHeader(ctx, project, cw, PRESET_TITLE.flow);

  const lines = flowSheetLines(project);
  let y = phone ? 132 : 112;
  const bottom = ch - 56;
  const columnWidth = phone ? cw - 64 : cw / 2 - 56;
  let x = 32;
  let omitted = 0;

  if (!lines.length) {
    ctx.fillStyle = "#64748b";
    ctx.font = font("400 16px");
    ctx.fillText("這份計畫還沒有互動流程 — 到「模擬」分頁排一份。", 32, y);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (y > bottom) {
      // One column on a phone, two on paper: move over rather than truncate.
      if (!phone && x < cw / 2) {
        x = cw / 2 + 24;
        y = 112;
      } else {
        omitted = lines.length - i;
        break;
      }
    }
    if (line.kind === "head") {
      ctx.fillStyle = TEXT;
      ctx.font = font("700 18px");
      y += 8;
    } else if (line.kind === "step") {
      ctx.fillStyle = TEXT;
      ctx.font = font("700 16px");
      y += 6;
    } else if (line.kind === "option") {
      ctx.fillStyle = "#334155";
      ctx.font = font("400 15px");
    } else if (line.kind === "note") {
      ctx.fillStyle = "#b45309";
      ctx.font = font("400 14px");
      y += 8;
    } else {
      ctx.fillStyle = "#475569";
      ctx.font = font("400 15px");
    }
    const indent = line.kind === "option" ? 18 : line.kind === "detail" ? 14 : 0;
    // Wrapped, not clipped: the quote on the card IS the content of this sheet.
    const wrapped = wrapText(ctx, line.text, columnWidth - indent);
    for (let w = 0; w < wrapped.length; w++) {
      // Continuation lines hang under the first character, not under the dot.
      ctx.fillText(wrapped[w], x + indent + (w > 0 ? 12 : 0), y);
      if (w < wrapped.length - 1) y += 22;
    }
    y += line.kind === "head" ? 30 : 26;
  }

  if (omitted) {
    ctx.fillStyle = "#b45309";
    ctx.font = font("700 15px");
    ctx.fillText(`還有 ${omitted} 行沒印出來 — 用 A3 或手機版分兩張`, 32, ch - 34);
  }

  if (phone) drawPhoneFooter(ctx, project, cw, ch, "flow");
  drawCalibrationFooter(ctx, project, cw, ch);
  return canvas.toDataURL("image/png");
}

function renderInventorySheet(project: Project, opt: PlanOptions): string {
  const { w: cw, h: ch } = pageDims(opt.page, opt.orientation);
  const phone = opt.page === "phone";
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
  ctx.fillText("物資數量", 32, phone ? 132 : 116);
  ctx.font = font("400 16px");
  let y = phone ? 176 : 148;
  if (!lines.length) {
    ctx.fillStyle = "#64748b";
    ctx.fillText("目前沒有任何物資 — 回到「場佈」放入桌椅、地墊或報到桌。", 32, y);
  }
  let omitted = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (y > ch - 60) { omitted = lines.length - i; break; }
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
  }
  if (omitted) {
    ctx.fillStyle = "#b45309";
    ctx.font = font("700 16px");
    ctx.fillText(`還有 ${omitted} 項未列出`, 32, Math.min(y, ch - 34));
  }

  if (zoneLines.length) {
    ctx.font = font("700 18px");
    ctx.fillText("功能區", phone ? 32 : cw / 2 + 20, phone ? Math.min(ch - 340, y + 48) : 116);
    ctx.font = font("400 16px");
    let zy = phone ? Math.min(ch - 300, y + 84) : 148;
    for (const z of zoneLines) {
      ctx.fillText(`${z.icon} ${z.name}${z.count ? ` · ${z.count} 人` : ""}`, phone ? 32 : cw / 2 + 20, zy);
      zy += 30;
      if (zy > (phone ? ch - 240 : ch / 2)) break;
    }
  }

  // Small locator plan at the lower right so the list still shows the room.
  const miniW = Math.round(cw * 0.42);
  const miniH = Math.round(ch * 0.4);
  const mini = renderMiniPlan(project, miniW, miniH);
  ctx.drawImage(mini, phone ? cw - miniW - 32 : cw - miniW - 32, ch - miniH - 40, miniW, miniH);
  if (phone) drawPhoneFooter(ctx, project, cw, ch, "inventory");
  drawCalibrationFooter(ctx, project, cw, ch);
  return canvas.toDataURL("image/png");
}

function drawCalibrationFooter(ctx: CanvasRenderingContext2D, project: Project, width: number, height: number): void {
  if (activePageSize === "phone") return;
  const text = calibrationFooterText(project);
  if (!text) return;
  ctx.fillStyle = "#b45309";
  ctx.font = font("700 16px");
  ctx.textAlign = "right";
  ctx.fillText(text, width - 24, height - 10);
  ctx.textAlign = "left";
}

function drawPhoneFooter(ctx: CanvasRenderingContext2D, project: Project, width: number, height: number, preset: PlanPreset): void {
  ctx.fillStyle = "#e2e8f0";
  ctx.fillRect(0, height - 74, width, 74);
  ctx.fillStyle = TEXT;
  ctx.font = font("700 20px");
  const calibration = calibrationFooterText(project);
  const text = `${BRAND.name} · ${PRESET_TITLE[preset]} · 圖例精簡 · 地磚 ${Math.round(project.tile.width * 100)}×${Math.round(project.tile.depth * 100)} cm · 1 m 比例尺${calibration ? ` · ${calibration}` : ""}`;
  ctx.fillText(fitText(ctx, text, width - 48), 24, height - 28);
}

/** Bare-bones top view used as a locator thumbnail (no header/footer). */
function renderMiniPlan(project: Project, w: number, h: number): HTMLCanvasElement {
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#cbd5e1";
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  const bounds = contentBounds(project);
  const minX = bounds.minX;
  const minZ = bounds.minZ;
  const maxX = bounds.maxX;
  const maxZ = bounds.maxZ;
  const s = Math.min((w - 24) / (maxX - minX), (h - 24) / (maxZ - minZ));
  const t: Xform = { s, X: (wx) => 12 + (wx - minX) * s, Y: (wz) => 12 + (wz - minZ) * s };
  // The thumbnail is its own drawing: give it a fresh label layout framed to
  // the tile, or its titles inherit the host page's boxes and run off the edge.
  const hostBoxes = labelBoxes;
  const hostFrame = labelFrame;
  resetLabelLayout({ minX: 4, minY: 4, maxX: w - 4, maxY: h - 4 });
  drawFloors(ctx, project, t);
  drawZones(ctx, project, t, false);
  for (const o of project.objects) {
    if (!o.hidden) drawObject(ctx, o, t, "full", project);
  }
  drawGroups(ctx, project, t, false);
  // The inventory page already lists every zone and object at full size above.
  // Repeating all labels inside this small locator map turns it into an
  // unreadable knot; retain the geometry and the field label only.
  labelBoxes = hostBoxes;
  labelFrame = hostFrame;
  return canvas;
}

function withAlpha(ctx: CanvasRenderingContext2D, a: number, fn: () => void): void {
  const prev = ctx.globalAlpha;
  ctx.globalAlpha = a;
  fn();
  ctx.globalAlpha = prev;
}

function drawFloors(ctx: CanvasRenderingContext2D, p: Project, t: Xform): void {
  const e310 = p.venuePresetId === "venue:tku-e310";
  for (const a of [p.classroom, p.corridor]) {
    ctx.fillStyle = e310
      ? (a.id === "classroom" ? "#e2ded5" : "#d2a0a2")
      : (a.id === "classroom" ? "#ffffff" : "#f1f5f9");
    ctx.strokeStyle = e310 ? "#465552" : "#0f172a";
    ctx.lineWidth = 3;
    const x = t.X(a.x), y = t.Y(a.z), w = a.length * t.s, h = a.width * t.s;
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = e310 ? "#455853" : "#64748b";
    ctx.font = font("600 20px");
    planText(ctx, fitText(ctx, a.name, Math.max(120, w - 16)), x + 8, y + 24);
  }
  if (e310) {
    const k = p.corridor;
    ctx.fillStyle = "#d7ad38";
    ctx.fillRect(t.X(k.x + k.length * 0.06), t.Y(k.z + k.width * 0.67), k.length * 0.72 * t.s, 0.26 * t.s);
  }
}

function drawTiles(ctx: CanvasRenderingContext2D, p: Project, t: Xform): void {
  const w = Math.max(p.tile.width, 0.05);
  const d = Math.max(p.tile.depth, 0.05);
  const e310 = p.venuePresetId === "venue:tku-e310";
  for (const area of [p.classroom, p.corridor]) {
    const minX = area.x, minZ = area.z, maxX = area.x + area.length, maxZ = area.z + area.width;
    ctx.strokeStyle = e310 ? (area.id === "classroom" ? "rgba(96,91,84,.25)" : "rgba(112,63,68,.28)") : "#e2e8f0";
    ctx.lineWidth = 1;
    ctx.beginPath();
    let sx = p.tile.originX; while (sx > minX) sx -= w;
    for (let x = sx; x <= maxX + 1e-6; x += w) { ctx.moveTo(t.X(x), t.Y(minZ)); ctx.lineTo(t.X(x), t.Y(maxZ)); }
    let sz = p.tile.originZ; while (sz > minZ) sz -= d;
    for (let z = sz; z <= maxZ + 1e-6; z += d) { ctx.moveTo(t.X(minX), t.Y(z)); ctx.lineTo(t.X(maxX), t.Y(z)); }
    ctx.stroke();
  }
}

interface LabelBox { x: number; y: number; w: number; h: number }

/**
 * Every text label drawn onto the plan registers its box here for the duration
 * of one render. Zone names used to dodge only each other, so a 報到區 title
 * landed straight on top of the 電腦 sitting on its desk and neither could be
 * read — on the one page a volunteer actually needs (where do I check in?).
 */
let labelBoxes: LabelBox[] = [];
/** Drawing frame, so a label near the edge is nudged in rather than clipped. */
let labelFrame = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

/**
 * Draw plan text with a soft white halo. A 場刊圖 label sits on top of routes,
 * mats and furniture, and without a halo the 報到區 title reads as mush where
 * the green 入場動線 crosses it — exactly the label a volunteer needs most.
 */
function planText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, halo = 4): void {
  const prevStroke = ctx.strokeStyle;
  const prevWidth = ctx.lineWidth;
  const prevJoin = ctx.lineJoin;
  ctx.strokeStyle = "rgba(248, 250, 252, 0.92)";
  ctx.lineWidth = halo;
  ctx.lineJoin = "round";
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
  ctx.strokeStyle = prevStroke;
  ctx.lineWidth = prevWidth;
  ctx.lineJoin = prevJoin;
}

function resetLabelLayout(frame: { minX: number; minY: number; maxX: number; maxY: number }): void {
  labelBoxes = [];
  labelFrame = frame;
}

function overlapsPlaced(box: LabelBox): boolean {
  return labelBoxes.some(
    (r) => box.x < r.x + r.w && box.x + box.w > r.x && box.y < r.y + r.h && box.y + box.h > r.y,
  );
}

/**
 * Find a clear spot for a label near (x, y): try the anchor, then step above
 * and below in alternating rings, then give up and take the anchor. Always
 * clamped inside the drawing frame.
 */
function placeLabel(x: number, y: number, w: number, h: number, step: number): { x: number; y: number } {
  const clampX = (v: number) => Math.min(Math.max(v, labelFrame.minX), Math.max(labelFrame.minX, labelFrame.maxX - w));
  const clampY = (v: number) => Math.min(Math.max(v, labelFrame.minY), Math.max(labelFrame.minY, labelFrame.maxY - h));
  const cx = clampX(x);
  for (let ring = 0; ring <= 6; ring++) {
    for (const dy of ring === 0 ? [0] : [-ring * step, ring * step]) {
      const cy = clampY(y + dy);
      if (!overlapsPlaced({ x: cx, y: cy, w, h })) {
        labelBoxes.push({ x: cx, y: cy, w, h });
        return { x: cx, y: cy };
      }
    }
  }
  const cy = clampY(y);
  labelBoxes.push({ x: cx, y: cy, w, h });
  return { x: cx, y: cy };
}

/** Zone tints and dashed outlines. Titles are drawn later — see drawZoneLabels. */
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
  }
}

/**
 * Zone titles, drawn after the furniture and routes. They used to be painted
 * with the zone tint, so the 報到桌 was then drawn straight over 報到區 and
 * sliced the title in half — on the page a volunteer reads first.
 */
function drawZoneLabels(ctx: CanvasRenderingContext2D, p: Project, t: Xform, emphasize = false): void {
  for (const z of p.zones) {
    if (z.hidden) continue;
    const x = t.X(z.x - z.width / 2), y = t.Y(z.z - z.depth / 2), w = z.width * t.s, h = z.depth * t.s;
    ctx.fillStyle = TEXT;
    // 34px is the PHONE floor — on A4/A3 it blew labels up to 講師… ellipses.
    ctx.font = font(activePageSize === "phone" ? "700 34px" : "700 22px");
    const displayName = z.type === "backpack" ? "背包" : z.name;
    const label = `${z.icon ? `${z.icon} ` : ""}${displayName}`;
    const labelW = Math.min(
      Math.max(w - 12, activePageSize === "phone" ? 260 : 150),
      activePageSize === "phone" ? 420 : 300,
    );
    const lineH = activePageSize === "phone" ? 42 : 26;
    // A zone shorter than its own title cannot hold it without covering the
    // furniture inside — put the title just above the zone instead.
    const insideTop = y + (emphasize ? lineH : lineH - 4) - lineH;
    const anchorY = h >= lineH * 2 ? insideTop : y - lineH - 4;
    const spot = placeLabel(x + 6, anchorY, labelW, lineH, lineH);
    planText(ctx, fitText(ctx, label, labelW), spot.x, spot.y + lineH - 6, activePageSize === "phone" ? 6 : 4);
  }
}

function drawRoutes(ctx: CanvasRenderingContext2D, p: Project, t: Xform, bold: boolean): void {
  for (const r of p.routes) {
    // Photo-grounded Golden Scenes may hide editing overlays by default; a
    // dedicated route/partner sheet must still be able to reveal the route.
    if ((!r.visible && !bold) || r.points.length < 2) continue;
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
        ctx.arc(px, py, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.font = font("700 18px");
        ctx.textAlign = "center";
        ctx.fillText(isStart ? "起" : isEnd ? "終" : String(i + 1), px, py + 4);
        ctx.textAlign = "left";
      }
    }
    ctx.fillStyle = TEXT;
    const routeFont = activePageSize === "phone" ? 26 : 18;
    ctx.font = font(`600 ${routeFont}px`);
    const routeText = fitText(ctx, r.name, Math.max(180, t.s * 5));
    const routeW = ctx.measureText(routeText).width;
    const routeSpot = placeLabel(
      t.X(r.points[0].x) + 20,
      t.Y(r.points[0].z) - 18 - routeFont,
      routeW,
      routeFont,
      routeFont + 6,
    );
    planText(ctx, routeText, routeSpot.x, routeSpot.y + routeFont - 4, activePageSize === "phone" ? 6 : 4);
  }
}

function drawObject(ctx: CanvasRenderingContext2D, o: SceneObject, t: Xform, preset: PlanPreset, project: Project): void {
  if (o.kind === "door") { drawDoor(ctx, o, t, project); return; }
  if (o.kind === "screen") { drawScreen(ctx, o, t); return; }
  if (o.kind === "switch") { drawSwitch(ctx, o, t); return; }
  if (o.kind === "computer") { drawComputer(ctx, o, t); return; }

  const catalog = catalogFromProject(project);
  const entry = catalog.resolve(o.assetId, o.kind);
  const spec = planSymbolForObject(o, entry);
  const wPx = o.width * t.s;
  const dPx = o.depth * t.s;
  drawPlanSymbolOverlay(ctx, t.X(o.x), t.Y(o.z), wPx, dPx, o.rotationDeg, spec, "paper");

  // Keep chair facing tick in mats/full when symbol didn't already (belt-and-suspenders).
  if (o.kind === "chair" && preset !== "route" && !spec.showFacing) {
    const f = facingVec(o.rotationDeg);
    ctx.strokeStyle = NEUTRAL_STROKE;
    ctx.beginPath(); ctx.moveTo(t.X(o.x), t.Y(o.z)); ctx.lineTo(t.X(o.x + f.x * o.depth * 0.5), t.Y(o.z + f.z * o.depth * 0.5)); ctx.stroke();
  }
}

function drawGroups(ctx: CanvasRenderingContext2D, p: Project, t: Xform, numbered: boolean, seatMap = false): void {
  for (const g of p.groups) {
    if (g.hidden) continue;
    if (isFieldMatGroup(g)) {
      drawFieldGroup(ctx, g, t, seatMap);
      continue;
    }
    const dense = g.rows * g.cols > 60; // hide labels when too dense to read
    withAlpha(ctx, seatMap ? 0.28 : 1, () => {
      for (const m of groupMembers(g)) {
        drawRectAt(ctx, m.x, m.z, g.itemWidth, g.itemDepth, m.rotationDeg, t, assetDef(g.sourceKind).color,
          numbered && !dense ? memberLabel(g, m.row, m.col) : undefined);
      }
    });
  }
}

function isFieldMatGroup(g: Project["groups"][number]): boolean {
  return g.sourceKind === "mat" && Math.abs(g.itemWidth - 0.6) < 1e-6 && Math.abs(g.itemDepth - 0.6) < 1e-6;
}

function drawFieldGroup(ctx: CanvasRenderingContext2D, g: Project["groups"][number], t: Xform, seatMap = false): void {
  const members = groupMembers(g);
  const points = members.flatMap((m) => rectCorners(m.x, m.z, g.itemWidth, g.itemDepth, m.rotationDeg));
  if (!points.length) return;
  const minX = Math.min(...points.map((p) => p.x));
  const maxX = Math.max(...points.map((p) => p.x));
  const minZ = Math.min(...points.map((p) => p.z));
  const maxZ = Math.max(...points.map((p) => p.z));
  const x = t.X(minX), y = t.Y(minZ), w = (maxX - minX) * t.s, h = (maxZ - minZ) * t.s;
  const color = MAT_COLORS.base;
  ctx.fillStyle = hexA(color, seatMap ? 0.72 : 0.88);
  ctx.strokeStyle = MAT_COLORS.outline;
  ctx.lineWidth = 3.5;
  ctx.fillRect(x, y, w, h);
  ctx.strokeRect(x, y, w, h);

  // Draw every 60 cm EVA seam and a small joint mark. The overall field stays
  // visually continuous while still reading as interlocking pieces.
  ctx.strokeStyle = hexA(MAT_COLORS.seam, 0.62);
  ctx.lineWidth = 1.5;
  for (const member of members) {
    const corners = rectCorners(member.x, member.z, g.itemWidth, g.itemDepth, member.rotationDeg);
    ctx.beginPath();
    ctx.moveTo(t.X(corners[0].x), t.Y(corners[0].z));
    for (let i = 1; i < corners.length; i++) ctx.lineTo(t.X(corners[i].x), t.Y(corners[i].z));
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(t.X(corners[0].x), t.Y(corners[0].z), Math.max(2, t.s * 0.025), 0, Math.PI * 2);
    ctx.stroke();
  }

  if (seatMap) {
    const rows = new Map<number, ReturnType<typeof groupMembers>[number]>();
    for (const member of members) {
      drawRectAt(ctx, member.x, member.z, g.itemWidth, g.itemDepth, member.rotationDeg, t, color, undefined, 0.13, 2.5);
      if (!rows.has(member.row)) rows.set(member.row, member);
    }
    ctx.fillStyle = TEXT;
    ctx.font = font("700 18px");
    ctx.textAlign = "right";
    for (const [row, member] of rows) {
      ctx.fillText(`${g.numberPrefix || "A"}${row + 1}`, t.X(member.x - g.itemWidth * 0.7), t.Y(member.z) + 6);
    }
    ctx.textAlign = "left";
    ctx.font = font("600 16px");
    const pitchText = "一人約 1 格寬 × 1.5 格深";
    const pitchW = ctx.measureText(pitchText).width;
    const pitchSpot = placeLabel(x, y + h + 12, pitchW, 20, 24);
    planText(ctx, pitchText, pitchSpot.x, pitchSpot.y + 16);
  }

  // Two lines (name / spec) so a narrow block never ellipsizes the piece count.
  const nameLine = g.name || "巧拼區塊";
  const specLine = `${g.cols}×${g.rows} · ${g.rows * g.cols} 片`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const labelX = x + w / 2, labelY = y + h / 2;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 7;
  ctx.lineJoin = "round";
  const maxW = Math.max(160, w - 16);
  ctx.font = font("700 22px");
  ctx.strokeText(fitText(ctx, nameLine, maxW), labelX, labelY - 14);
  ctx.fillStyle = TEXT;
  ctx.fillText(fitText(ctx, nameLine, maxW), labelX, labelY - 14);
  ctx.font = font("600 18px");
  ctx.strokeText(fitText(ctx, specLine, maxW), labelX, labelY + 13);
  ctx.fillText(fitText(ctx, specLine, maxW), labelX, labelY + 13);
  if (seatMap) {
    ctx.font = font("600 16px");
    ctx.fillText(`${groupFootprint(g).totalWidth.toFixed(1)} × ${groupFootprint(g).totalDepth.toFixed(1)} m`, labelX, labelY + 38);
  }
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
}

function drawRectAt(ctx: CanvasRenderingContext2D, cx: number, cz: number, w: number, d: number, rot: number, t: Xform, color: string, label?: string, fillAlpha = 0.5, lineWidth = 1.5): void {
  const corners = rectCorners(cx, cz, w, d, rot).map((c) => ({ x: t.X(c.x), y: t.Y(c.z) }));
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.fillStyle = hexA(color, fillAlpha);
  ctx.strokeStyle = NEUTRAL_STROKE;
  ctx.lineWidth = lineWidth;
  ctx.fill();
  ctx.stroke();
  if (label) {
    ctx.fillStyle = TEXT;
    ctx.font = font("600 14px");
    ctx.textAlign = "center";
    ctx.fillText(label, t.X(cx), t.Y(cz) + 3.5);
    ctx.textAlign = "left";
  }
}

function drawDoor(ctx: CanvasRenderingContext2D, o: SceneObject, t: Xform, project: Project): void {
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
  const entry = project.routes.find((r) => r.visible && r.type === "entry" && r.points.length > 0);
  if (entry) {
    const start = entry.points[0];
    const nearest = project.objects
      .filter((candidate) => !candidate.hidden && candidate.kind === "door")
      .reduce<{ object: SceneObject; distance: number } | null>((best, candidate) => {
        const distance = Math.hypot(candidate.x - start.x, candidate.z - start.z);
        return !best || distance < best.distance ? { object: candidate, distance } : best;
      }, null);
    if (nearest?.object.id === o.id) drawEntryPill(ctx, t.X(o.x) + 14, t.Y(o.z) - 18);
  }
}

function drawEntryPill(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.save();
  ctx.font = font("700 16px");
  const label = "入口";
  const width = ctx.measureText(label).width + 18;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 2;
  roundedRectPath(ctx, x, y - 16, width, 28, 14);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = TEXT;
  ctx.textAlign = "center";
  ctx.fillText(label, x + width / 2, y + 5);
  ctx.textAlign = "left";
  ctx.restore();
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
  ctx.font = font(activePageSize === "phone" ? "700 30px" : "700 16px");
  const label = "投影幕";
  const labelW = ctx.measureText(label).width;
  const labelX = t.X(o.x) - labelW / 2;
  const labelY = t.Y(o.z + f.z * 0.52) - (activePageSize === "phone" ? 34 : 18);
  const spot = placeLabel(labelX, labelY, labelW, activePageSize === "phone" ? 34 : 18, 20);
  ctx.fillStyle = "#1e40af";
  planText(ctx, label, spot.x, spot.y + (activePageSize === "phone" ? 28 : 15));
}

function drawSwitch(ctx: CanvasRenderingContext2D, o: SceneObject, t: Xform): void {
  ctx.fillStyle = "#facc15"; ctx.strokeStyle = "#0f172a"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(t.X(o.x), t.Y(o.z), 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = TEXT; ctx.font = font("700 9px"); ctx.textAlign = "center";
  ctx.fillText("開", t.X(o.x), t.Y(o.z) + 3.5); ctx.textAlign = "left";
}

function drawComputer(ctx: CanvasRenderingContext2D, o: SceneObject, t: Xform): void {
  drawRectAt(ctx, o.x, o.z, o.width, o.depth, o.rotationDeg, t, "#38bdf8");
  // 9px was unreadable at any page size and still large enough to collide with
  // the zone title above it. Size it with the page and let the shared placer
  // move it clear.
  const size = activePageSize === "phone" ? 22 : 14;
  ctx.font = font(`700 ${size}px`);
  const w = ctx.measureText("電腦").width;
  const spot = placeLabel(t.X(o.x) - w / 2, t.Y(o.z) - size / 2, w, size, size + 4);
  ctx.fillStyle = "#0369a1";
  ctx.textAlign = "left";
  planText(ctx, "電腦", spot.x, spot.y + size - 4);
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
  ctx.font = font("400 18px");
  const today = new Date();
  const dateStr = `${today.getFullYear()}/${today.getMonth() + 1}/${today.getDate()}`;
  ctx.fillText(fitText(ctx, `${subtitle} · ${dateStr}`, Math.max(260, width - 330)), 24, 66);
  ctx.textAlign = "right";
  ctx.fillText(
    fitText(ctx, `${BRAND.title} · 地磚 ${Math.round(p.tile.width * 100)}×${Math.round(p.tile.depth * 100)} cm`, 420),
    width - 24,
    62,
  );
  ctx.textAlign = "left";
}

interface LegendEntry { color: string; label: string }

function legendEntriesFor(p: Project): LegendEntry[] {
  const entries: LegendEntry[] = [];
  const catalog = catalogFromProject(p);
  const seen = new Set<string>();
  const add = (key: string, color: string, label: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ color, label });
  };
  for (const o of p.objects) {
    if (o.hidden) continue;
    const entry = catalog.resolve(o.assetId, o.kind);
    add(`asset:${entry.id}`, entry.color, entry.name);
  }
  for (const g of p.groups) {
    if (g.hidden) continue;
    const entry = catalog.resolve(undefined, g.sourceKind);
    add(`asset:${entry.id}`, entry.color, entry.name);
  }
  for (const z of p.zones) if (!z.hidden) add(`zone:${z.color}:${z.name}`, z.color, z.name);
  for (const r of p.routes) if (r.visible) add(`route:${r.name}`, r.color, `動線：${r.name}`);
  return entries;
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  entries: LegendEntry[],
  y: number,
  perRow: number,
  colW: number,
): void {
  ctx.fillStyle = "#0f172a"; ctx.font = font("700 18px");
  ctx.fillText("圖例", 24, y);
  ctx.font = font("400 16px");
  let x = 24, row = y + 26;
  entries.forEach((e, i) => {
    if (i > 0 && i % perRow === 0) { row += 30; x = 24; }
    ctx.fillStyle = e.color; ctx.fillRect(x, row - 12, 15, 15);
    ctx.strokeStyle = "#94a3b8"; ctx.strokeRect(x, row - 12, 15, 15);
    ctx.fillStyle = "#0f172a"; ctx.fillText(fitText(ctx, e.label, colW - 20), x + 20, row);
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
  ctx.fillStyle = "#0f172a"; ctx.font = font("700 18px");
  ctx.fillText("物資數量", x, y);
  ctx.font = font("400 16px");
  let row = y + 26, col = 0;
  for (const e of lines) {
    const cx = x + col * colW;
    ctx.fillStyle = "#0f172a";
    ctx.fillText(fitText(ctx, `${e.name}：${e.count}`, colW - 8), cx, row);
    col += 1;
    if (col >= perRow) { col = 0; row += 30; }
  }
}

function drawScaleBar(ctx: CanvasRenderingContext2D, t: Xform, y: number, pad: number, logicalW: number): void {
  const len = t.s;
  const x = logicalW - pad - len;
  ctx.strokeStyle = "#0f172a"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y); ctx.stroke();
  tick(ctx, x, y, false); tick(ctx, x + len, y, false);
  ctx.fillStyle = "#0f172a"; ctx.font = font("600 16px"); ctx.textAlign = "center";
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

/**
 * Break a line to fit a column instead of cutting it off.
 *
 * A truncated 「不用每個人都喜歡你，那樣太…」 is worse than useless on a
 * briefing sheet: the volunteer has to guess the rest of the sentence they are
 * supposed to hand somebody. Chinese has no spaces, so this measures character
 * by character and breaks where it must, preferring a space when Latin text
 * offers one.
 */
function wrapText(ctx: CanvasRenderingContext2D, value: string, maxWidth: number, maxLines = 4): string[] {
  if (ctx.measureText(value).width <= maxWidth) return [value];
  const lines: string[] = [];
  let line = "";
  for (const ch of value) {
    const next = line + ch;
    if (ctx.measureText(next).width > maxWidth && line) {
      // Prefer breaking at the last space so a Latin word survives intact.
      const space = line.lastIndexOf(" ");
      if (space > 0 && line.length - space < 12) {
        lines.push(line.slice(0, space));
        line = `${line.slice(space + 1)}${ch}`;
      } else {
        lines.push(line);
        line = ch;
      }
      if (lines.length === maxLines - 1 && ctx.measureText(value).width > maxWidth * maxLines) {
        // Runaway text still gets an ellipsis rather than eating the page.
        lines.push(fitText(ctx, value.slice(lines.join("").length), maxWidth));
        return lines;
      }
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function fitText(ctx: CanvasRenderingContext2D, value: string, maxWidth: number): string {
  if (ctx.measureText(value).width <= maxWidth) return value;
  const suffix = "…";
  let text = value;
  while (text.length > 1 && ctx.measureText(`${text}${suffix}`).width > maxWidth) text = text.slice(0, -1);
  return `${text}${suffix}`;
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
