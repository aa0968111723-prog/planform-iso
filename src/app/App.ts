import {
  uid,
  ZONE_DEFAULTS,
  type ArrayGroup,
  type MeasurementAnnotation,
  type MeasurementType,
  type ObjectKind,
  type Project,
  type Route,
  type SceneObject,
  type ValidationSettings,
  type ViewName,
  type Zone,
  type ZoneType,
} from "../core/model";
import { assetDef } from "../core/assets";
import { applySnap, type SnapMode } from "../core/units";
import {
  findParentTable,
  nearestWallSnap,
  wallAnchorToPosition,
} from "../core/placement";
import { groupCenter, groupFootprint, groupMembers, setGroupCenter } from "../core/arrays";
import { validateProject, type Issue } from "../core/validation";
import { objectFieldInfo, measure, snapMeasurePoint, type MeasureResult, type FieldInfo, type SnappedPoint } from "../core/measure";
import { areaBounds } from "../core/placement";
import { routePreset } from "../core/routes";
import { generateLayouts, type LayoutCandidate } from "../core/smartLayout";
import { agentPositions, detectBottlenecks, initSimulation, simulationDone, stepSimulation, type Bottleneck, type SimParams, type SimState } from "../core/simulation";
import { Store } from "../state/store";
import { SceneManager, type GhostState } from "../scene/SceneManager";
import type { RouteType } from "../core/model";

export type Mode = "select" | "place" | "route" | "measure" | "calibrate";
export type Workflow = "site" | "layout" | "route" | "check" | "export";

const TABLE_KINDS: ReadonlySet<string> = new Set(["table", "regTable"]);
const MEASURE_COLOR = "#facc15";

export interface Session {
  selection: Set<string>;
  mode: Mode;
  snap: SnapMode;
  ghost: GhostState | null;
  placingKind: ObjectKind | null;
  placingPreset: string | null;
  ghostRotation: number;
  ghostHinge: "left" | "right";
  activeRouteId: string | null;
  measure: { a: SnappedPoint | null; b: SnappedPoint | null } | null;
  measureType: MeasurementType;
  calibrate: { a: { x: number; z: number } | null; b: { x: number; z: number } | null } | null;
  showLabels: boolean;
  workflow: Workflow;
  issues: Issue[];
  // Visual-communication + simulation state
  teamView: boolean;
  simplify: boolean;
  focusRouteId: string | null;
  participants: number;
  matCandidates: LayoutCandidate[];
  simPositions: { x: number; z: number; routeId: string }[];
  bottlenecks: Bottleneck[];
  simPlaying: boolean;
}

interface DragState {
  kind: "move" | "routeNode" | "box";
  startGround: { x: number; z: number } | null;
  startClient: { x: number; y: number };
  orig: Map<string, { x: number; z: number }>; // objects/zones centers, groups anchors
  routeId?: string;
  routeIndex?: number;
  moved: boolean;
  threshold: number;
}

const DRAG_THRESHOLD = 4;
const TOUCH_DRAG_THRESHOLD = 12;
const TOUCH_GHOST_OFFSET_PX = 46;

export class App {
  readonly store: Store;
  readonly scene: SceneManager;
  readonly session: Session = {
    selection: new Set(),
    mode: "select",
    snap: "intersection",
    ghost: null,
    placingKind: null,
    placingPreset: null,
    ghostRotation: 0,
    ghostHinge: "left",
    activeRouteId: null,
    measure: null,
    measureType: "free-distance",
    calibrate: null,
    showLabels: false,
    workflow: "site",
    issues: [],
    teamView: false,
    simplify: false,
    focusRouteId: null,
    participants: 30,
    matCandidates: [],
    simPositions: [],
    bottlenecks: [],
    simPlaying: false,
  };

  private drag: DragState | null = null;
  private dragging = false;
  private tapClearStart: { x: number; y: number } | null = null;
  private uiListeners = new Set<() => void>();
  private pointers = new Map<number, { x: number; y: number; type: string }>();
  private validationTimer: number | null = null;
  private simState: SimState | null = null;
  private simRaf: number | null = null;
  private simLast = 0;
  onBox: ((rect: { minX: number; minY: number; maxX: number; maxY: number } | null) => void) | null = null;
  onToast: ((msg: string, undo?: boolean) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, store: Store) {
    this.store = store;
    this.scene = new SceneManager(canvas);
    this.store.subscribe(() => {
      this.syncScene();
      if (!this.dragging) {
        this.notifyUi();
        if (this.session.workflow === "check") this.scheduleValidation();
      }
    });
    this.bindPointer(canvas);
    this.render();
    this.scene.setView(this.state.view);
  }

  private get state(): Project { return this.store.getState(); }

  onChange(cb: () => void): () => void { this.uiListeners.add(cb); return () => this.uiListeners.delete(cb); }
  private notifyUi(): void { for (const cb of this.uiListeners) cb(); }
  private syncScene(): void {
    this.scene.sync(this.state, {
      selection: this.session.selection,
      ghost: this.session.ghost,
      measure: this.session.measure,
      calibrate: this.session.calibrate,
      showLabels: this.session.showLabels || this.session.teamView,
      focusRouteId: this.session.focusRouteId,
      simplify: this.session.simplify || this.session.teamView,
      simPositions: this.session.simPositions,
      bottlenecks: this.session.bottlenecks,
    });
  }
  private render(): void { this.syncScene(); this.notifyUi(); }

  // --- view / workflow ---------------------------------------------------

  setView(view: ViewName): void { this.store.mutate((p) => (p.view = view), { history: false }); this.scene.setView(view); }
  setSnap(mode: SnapMode): void { this.session.snap = mode; this.notifyUi(); }
  setShowLabels(v: boolean): void { this.session.showLabels = v; this.render(); }
  toggleLayer(layer: keyof Project["layers"]): void { this.store.mutate((p) => (p.layers[layer] = !p.layers[layer]), { history: false }); }
  recenterView(): void { this.scene.recenterView(this.state); }
  undo(): void { this.store.undo(); }
  redo(): void { this.store.redo(); }

  setWorkflow(w: Workflow): void {
    this.session.workflow = w;
    if (w !== "route") { this.session.activeRouteId = null; if (this.session.mode === "route") this.session.mode = "select"; }
    if (w === "check") this.runValidation();
    if (w === "route" && this.session.mode !== "route") this.session.mode = "select";
    this.cancelPlacement();
    this.notifyUi();
  }

  // --- placement mode ----------------------------------------------------

  beginPlacement(kind: ObjectKind, presetId?: string): void {
    const def = assetDef(kind);
    const preset = presetId ? def.presets.find((p) => p.id === presetId) : def.presets[0];
    this.session.placingKind = kind;
    this.session.placingPreset = preset?.id ?? null;
    this.session.mode = "place";
    this.session.ghostRotation = def.defaultFacingDeg;
    const c = this.centerOfClassroom();
    this.updateGhostAt(c.x, c.z);
    this.notifyUi();
  }

  cancelPlacement(): void {
    if (this.session.mode === "place") this.session.mode = "select";
    this.session.placingKind = null;
    this.session.ghost = null;
    this.render();
  }

  rotateGhost(): void {
    if (!this.session.placingKind) return;
    if (this.session.placingKind === "door") {
      this.session.ghostHinge = this.session.ghostHinge === "left" ? "right" : "left";
    } else {
      this.session.ghostRotation = (this.session.ghostRotation + 90) % 360;
    }
    if (this.session.ghost) this.updateGhostAt(this.session.ghost.x, this.session.ghost.z);
  }

  private currentDims(kind: ObjectKind, presetId: string | null): { width: number; depth: number; height: number } {
    const def = assetDef(kind);
    const preset = presetId ? def.presets.find((p) => p.id === presetId) : undefined;
    return {
      width: preset?.width ?? def.defaultDimensions.width,
      depth: preset?.depth ?? def.defaultDimensions.depth,
      height: preset?.height ?? def.defaultDimensions.height,
    };
  }

  private updateGhostAt(px: number, pz: number): void {
    const kind = this.session.placingKind;
    if (!kind) return;
    const def = assetDef(kind);
    const dims = this.currentDims(kind, this.session.placingPreset);
    let x = px, z = pz, rotationDeg = this.session.ghostRotation;
    let elevation: number;
    let validity: GhostState["validity"];
    let door: GhostState["door"];

    if (def.placementType === "wall") {
      const snap = nearestWallSnap(px, pz, [this.state.classroom, this.state.corridor], dims.width);
      if (snap) { x = snap.x; z = snap.z; rotationDeg = snap.rotationDeg; }
      elevation = def.defaultElevation;
      validity = snap && snap.distance < 3 ? "ok" : "warn";
      if (kind === "door") door = { hinge: this.session.ghostHinge, openInward: true, openDeg: 90 };
    } else if (def.placementType === "tabletop") {
      const table = findParentTable(px, pz, this.state.objects, TABLE_KINDS);
      if (table) { elevation = table.height; validity = "ok"; }
      else { elevation = def.defaultElevation; validity = "bad"; }
    } else {
      const s = applySnap(px, pz, this.state.tile, this.session.snap);
      x = s.x; z = s.z;
      elevation = 0;
      validity = this.insideAny(x, z) ? "ok" : "bad";
    }
    this.session.ghost = { kind, dims, x, z, rotationDeg, elevation, validity, door };
    this.syncScene();
  }

  private confirmPlacement(): void {
    const g = this.session.ghost;
    const kind = this.session.placingKind;
    if (!g || !kind || g.validity === "bad") return;
    const def = assetDef(kind);
    const id = uid("obj");
    const obj: SceneObject = {
      id, kind, x: g.x, z: g.z, rotationDeg: g.rotationDeg,
      width: g.dims.width, depth: g.dims.depth, height: g.dims.height,
      locked: false, hidden: false,
      surface: def.placementType, elevation: g.elevation,
      presetId: this.session.placingPreset ?? undefined,
    };
    if (def.placementType === "wall") {
      const snap = nearestWallSnap(g.x, g.z, [this.state.classroom, this.state.corridor], g.dims.width);
      if (snap) obj.wallAnchor = { areaId: snap.areaId, edge: snap.edge, offset: snap.offset };
      if (kind === "door") { obj.hinge = this.session.ghostHinge; obj.openInward = true; obj.openDeg = 90; }
    } else if (def.placementType === "tabletop") {
      const table = findParentTable(g.x, g.z, this.state.objects, TABLE_KINDS);
      if (table) obj.parentId = table.id;
    }
    this.store.mutate((p) => p.objects.push(obj));
    this.setSelection([id]);
    // Stay in placement mode for continuous placing.
  }

  // --- zones -------------------------------------------------------------

  addZone(type: ZoneType): void {
    const d = ZONE_DEFAULTS[type];
    const c = this.centerOfClassroom();
    const zone: Zone = { id: uid("zone"), type, name: d.label, x: c.x, z: c.z, width: d.width, depth: d.depth, color: d.color, locked: false, hidden: false, icon: d.icon, capacity: null };
    this.store.mutate((p) => p.zones.push(zone));
    this.setSelection([zone.id]);
  }

  // --- array groups ------------------------------------------------------

  createArray(kind: ObjectKind): void {
    const dims = this.currentDims(kind, null);
    const c = this.centerOfClassroom();
    const cols = 4, rows = kind === "mat" ? 3 : 4;
    const g: ArrayGroup = {
      id: uid("grp"), name: `${assetDef(kind).displayName}陣列`, sourceKind: kind,
      rows, cols, itemWidth: dims.width, itemDepth: dims.depth, itemHeight: dims.height,
      gapX: 0.1, gapZ: 0.1, rotationDeg: 0, anchorX: c.x - 1.5, anchorZ: c.z - 1.5,
      locked: false, hidden: false,
      numberPrefix: kind === "mat" ? "M" : kind === "chair" ? "C" : "A",
      numberOrder: "row", numberStart: "nw",
    };
    this.store.mutate((p) => p.groups.push(g));
    this.setSelection([g.id]);
  }

  updateSelectedGroup(patch: Partial<ArrayGroup>): void {
    const ids = this.session.selection;
    this.store.mutate((p) => { for (const g of p.groups) if (ids.has(g.id)) Object.assign(g, patch); });
  }

  ungroupSelected(): void {
    const ids = this.session.selection;
    const newIds: string[] = [];
    this.store.mutate((p) => {
      const keep: ArrayGroup[] = [];
      for (const g of p.groups) {
        if (!ids.has(g.id)) { keep.push(g); continue; }
        for (const m of groupMembers(g)) {
          const id = uid("obj");
          newIds.push(id);
          p.objects.push({
            id, kind: g.sourceKind, x: m.x, z: m.z, rotationDeg: m.rotationDeg,
            width: g.itemWidth, depth: g.itemDepth, height: g.itemHeight,
            locked: false, hidden: false, surface: "floor", elevation: 0,
          });
        }
      }
      p.groups = keep;
    });
    if (newIds.length) this.setSelection(newIds);
  }

  // --- selection ops -----------------------------------------------------

  setSelection(ids: string[]): void { this.session.selection = new Set(ids); this.render(); }

  getSelectedObject(): SceneObject | null {
    if (this.session.selection.size !== 1) return null;
    return this.state.objects.find((o) => this.session.selection.has(o.id)) ?? null;
  }
  getSelectedZone(): Zone | null {
    if (this.session.selection.size !== 1) return null;
    return this.state.zones.find((z) => this.session.selection.has(z.id)) ?? null;
  }
  getSelectedGroup(): ArrayGroup | null {
    if (this.session.selection.size !== 1) return null;
    return this.state.groups.find((g) => this.session.selection.has(g.id)) ?? null;
  }
  getSelectedRoute(): Route | null {
    if (this.session.selection.size !== 1) return null;
    return this.state.routes.find((r) => this.session.selection.has(r.id)) ?? null;
  }

  deleteSelection(): void {
    const ids = this.session.selection;
    if (ids.size === 0) return;
    this.store.mutate((p) => {
      // Deleting a table also removes its tabletop children.
      const removingTables = p.objects.filter((o) => ids.has(o.id) && TABLE_KINDS.has(o.kind)).map((o) => o.id);
      p.objects = p.objects.filter((o) => !ids.has(o.id) && !(o.parentId && removingTables.includes(o.parentId)));
      p.zones = p.zones.filter((z) => !ids.has(z.id));
      p.groups = p.groups.filter((g) => !ids.has(g.id));
      p.routes = p.routes.filter((r) => !ids.has(r.id));
    });
    this.session.selection = new Set();
    this.notifyUi();
  }

  rotateSelection(delta: number): void {
    const ids = this.session.selection;
    this.store.mutate((p) => {
      for (const o of p.objects) if (ids.has(o.id) && !o.locked && o.surface !== "wall") o.rotationDeg = (o.rotationDeg + delta + 360) % 360;
      for (const g of p.groups) if (ids.has(g.id) && !g.locked) g.rotationDeg = (g.rotationDeg + delta + 360) % 360;
    });
  }

  duplicateSelection(): void {
    const ids = this.session.selection;
    const newIds: string[] = [];
    this.store.mutate((p) => {
      for (const o of [...p.objects]) if (ids.has(o.id)) { const c = { ...o, id: uid("obj"), x: o.x + 0.4, z: o.z + 0.4, locked: false, parentId: undefined }; p.objects.push(c); newIds.push(c.id); }
      for (const g of [...p.groups]) if (ids.has(g.id)) { const c = { ...g, id: uid("grp"), anchorX: g.anchorX + 0.4, anchorZ: g.anchorZ + 0.4, locked: false }; p.groups.push(c); newIds.push(c.id); }
      for (const z of [...p.zones]) if (ids.has(z.id)) { const c = { ...z, id: uid("zone"), x: z.x + 0.4, z: z.z + 0.4, locked: false }; p.zones.push(c); newIds.push(c.id); }
    });
    if (newIds.length) this.setSelection(newIds);
  }

  toggleLockSelection(): void {
    const ids = this.session.selection;
    this.store.mutate((p) => {
      for (const o of p.objects) if (ids.has(o.id)) o.locked = !o.locked;
      for (const z of p.zones) if (ids.has(z.id)) z.locked = !z.locked;
      for (const g of p.groups) if (ids.has(g.id)) g.locked = !g.locked;
    });
  }

  toggleHideSelection(): void {
    const ids = this.session.selection;
    this.store.mutate((p) => {
      for (const o of p.objects) if (ids.has(o.id)) o.hidden = !o.hidden;
      for (const z of p.zones) if (ids.has(z.id)) z.hidden = !z.hidden;
      for (const g of p.groups) if (ids.has(g.id)) g.hidden = !g.hidden;
    });
    this.session.selection = new Set();
    this.notifyUi();
  }

  updateSelectedObject(patch: Partial<SceneObject>): void {
    const ids = this.session.selection;
    this.store.mutate((p) => { for (const o of p.objects) if (ids.has(o.id)) Object.assign(o, patch); });
  }

  applyPresetToSelection(presetId: string): void {
    const obj = this.getSelectedObject();
    if (!obj) return;
    const def = assetDef(obj.kind);
    const preset = def.presets.find((x) => x.id === presetId);
    if (!preset) return;
    this.updateSelectedObject({ width: preset.width, depth: preset.depth, height: preset.height ?? obj.height, presetId });
  }

  setDoorParams(patch: { hinge?: "left" | "right"; openInward?: boolean; openDeg?: number }): void {
    this.updateSelectedObject(patch);
  }

  detachComputer(): void {
    const obj = this.getSelectedObject();
    if (!obj || obj.kind !== "computer") return;
    this.updateSelectedObject({ surface: "floor", parentId: undefined, elevation: 0 });
  }

  updateSelectedZone(patch: Partial<Zone>): void {
    const ids = this.session.selection;
    this.store.mutate((p) => { for (const z of p.zones) if (ids.has(z.id)) Object.assign(z, patch); });
  }

  // --- routes ------------------------------------------------------------

  newRoute(): void {
    const colors = ["#f97316", "#22d3ee", "#a78bfa", "#34d399", "#f43f5e"];
    const route: Route = { id: uid("route"), name: `動線 ${this.state.routes.length + 1}`, color: colors[this.state.routes.length % colors.length], points: [], visible: true, type: "custom" };
    this.store.mutate((p) => p.routes.push(route));
    this.session.mode = "route";
    this.session.activeRouteId = route.id;
    this.setSelection([route.id]);
    this.notifyUi();
  }
  finishRoute(): void { this.session.activeRouteId = null; this.session.mode = "select"; this.notifyUi(); }
  editRoute(id: string): void { this.session.mode = "route"; this.session.activeRouteId = id; this.setSelection([id]); this.notifyUi(); }
  updateRoute(id: string, patch: Partial<Route>): void { this.store.mutate((p) => { const r = p.routes.find((x) => x.id === id); if (r) Object.assign(r, patch); }); }

  // --- measure -----------------------------------------------------------

  setMeasureType(t: MeasurementType): void { this.session.measureType = t; this.notifyUi(); }
  startMeasure(type: MeasurementType = "free-distance"): void {
    this.session.measureType = type;
    this.session.mode = "measure";
    this.session.measure = { a: null, b: null };
    this.notifyUi();
  }
  clearMeasure(): void { this.session.measure = { a: null, b: null }; this.render(); }
  stopMeasure(): void { this.session.mode = "select"; this.session.measure = null; this.render(); }
  getMeasureResult(): MeasureResult | null {
    const m = this.session.measure;
    if (!m || !m.a || !m.b) return null;
    return measure(m.a, m.b, this.state.tile);
  }
  keepMeasurement(): void {
    const m = this.session.measure;
    if (!m || !m.a || !m.b) return;
    const ann: MeasurementAnnotation = {
      id: uid("msr"), type: this.session.measureType,
      start: { x: m.a.x, z: m.a.z }, end: { x: m.b.x, z: m.b.z },
      locked: false, visible: true, color: MEASURE_COLOR,
    };
    this.store.mutate((p) => p.measurements.push(ann));
    this.session.measure = { a: null, b: null };
    this.toast("已保留尺寸線");
  }
  deleteMeasurement(id: string): void { this.store.mutate((p) => { p.measurements = p.measurements.filter((m) => m.id !== id); }); }
  toggleMeasurementVisible(id: string): void { this.store.mutate((p) => { const m = p.measurements.find((x) => x.id === id); if (m) m.visible = !m.visible; }); }

  // --- calibration wizard ------------------------------------------------

  startCalibration(): void { this.session.mode = "calibrate"; this.session.calibrate = { a: null, b: null }; this.notifyUi(); }
  cancelCalibration(): void { this.session.mode = "select"; this.session.calibrate = null; this.render(); }
  getCalibrationDistance(): number | null {
    const c = this.session.calibrate;
    if (!c || !c.a || !c.b) return null;
    return Math.hypot(c.b.x - c.a.x, c.b.z - c.a.z);
  }
  applyCalibration(action: "record" | "tile" | "classroom-length", actualMeters: number, note = ""): void {
    if (!actualMeters || actualMeters <= 0) return;
    if (action === "tile") this.applyCalibrationToTile(actualMeters);
    else if (action === "classroom-length") this.updateArea("classroom", { length: actualMeters });
    else this.updateCalibration({ referenceLength: actualMeters, note });
    this.toast(action === "record" ? "已記錄校正結果" : "已套用校正（可復原）", true);
    this.cancelCalibration();
  }

  // --- precision: nudge / rotate / align --------------------------------

  nudgeSelection(dx: number, dz: number): void {
    const ids = this.session.selection;
    this.store.mutate((p) => {
      const moved = new Set<string>();
      for (const o of p.objects) if (ids.has(o.id) && !o.locked) { o.x += dx; o.z += dz; moved.add(o.id); }
      for (const o of p.objects) if (o.parentId && moved.has(o.parentId) && !ids.has(o.id)) { o.x += dx; o.z += dz; }
      for (const z of p.zones) if (ids.has(z.id) && !z.locked) { z.x += dx; z.z += dz; }
      for (const g of p.groups) if (ids.has(g.id) && !g.locked) { g.anchorX += dx; g.anchorZ += dz; }
    });
  }
  setSelectionRotation(deg: number): void {
    const ids = this.session.selection;
    const r = ((deg % 360) + 360) % 360;
    this.store.mutate((p) => {
      for (const o of p.objects) if (ids.has(o.id) && !o.locked && o.surface !== "wall") o.rotationDeg = r;
      for (const g of p.groups) if (ids.has(g.id) && !g.locked) g.rotationDeg = r;
    });
  }
  alignSelection(edge: "left" | "right" | "top" | "bottom"): void {
    const ids = this.session.selection;
    const objs = this.state.objects.filter((o) => ids.has(o.id) && !o.locked);
    if (objs.length < 2) return;
    const val = edge === "left" ? Math.min(...objs.map((o) => o.x))
      : edge === "right" ? Math.max(...objs.map((o) => o.x))
      : edge === "top" ? Math.min(...objs.map((o) => o.z))
      : Math.max(...objs.map((o) => o.z));
    this.store.mutate((p) => {
      for (const o of p.objects) if (ids.has(o.id) && !o.locked) { if (edge === "left" || edge === "right") o.x = val; else o.z = val; }
    });
  }
  distributeSelection(axis: "x" | "z"): void {
    const ids = this.session.selection;
    const objs = this.state.objects.filter((o) => ids.has(o.id) && !o.locked).sort((a, b) => (axis === "x" ? a.x - b.x : a.z - b.z));
    if (objs.length < 3) return;
    const lo = axis === "x" ? objs[0].x : objs[0].z;
    const hi = axis === "x" ? objs[objs.length - 1].x : objs[objs.length - 1].z;
    const step = (hi - lo) / (objs.length - 1);
    this.store.mutate((p) => {
      objs.forEach((o, i) => {
        const t = p.objects.find((x) => x.id === o.id);
        if (t) { if (axis === "x") t.x = lo + i * step; else t.z = lo + i * step; }
      });
    });
  }

  updateValidationSettings(patch: Partial<ValidationSettings>): void {
    this.store.mutate((p) => Object.assign(p.validationSettings, patch), { history: false });
    if (this.session.workflow === "check") this.scheduleValidation();
  }
  private scheduleValidation(): void {
    if (typeof window === "undefined") { this.runValidation(); return; }
    if (this.validationTimer !== null) window.clearTimeout(this.validationTimer);
    this.validationTimer = window.setTimeout(() => this.runValidation(), 250);
  }
  private toast(msg: string, undo = false): void { this.onToast?.(msg, undo); }

  // --- visual communication ---------------------------------------------

  setTeamView(on: boolean): void {
    this.session.teamView = on;
    if (on) { this.session.selection = new Set(); this.setView("top"); }
    this.render();
  }
  setSimplify(on: boolean): void { this.session.simplify = on; this.render(); }
  setRouteFocus(id: string | null): void { this.session.focusRouteId = id; this.render(); }
  updateDescription(text: string): void { this.store.mutate((p) => (p.description = text), { history: false }); }
  updateZoneCapacity(capacity: number | null): void { this.updateSelectedZone({ capacity }); }

  // --- route presets + zone links ---------------------------------------

  newRoutePreset(type: RouteType): void {
    const pre = routePreset(type);
    const route: Route = { id: uid("route"), name: pre.label, color: pre.color, points: [], visible: true, type };
    this.store.mutate((p) => p.routes.push(route));
    this.session.mode = "route";
    this.session.activeRouteId = route.id;
    this.setSelection([route.id]);
    this.notifyUi();
  }

  // --- smart layout (participant-driven mats) ---------------------------

  computeMatCandidates(participants: number, opts?: { centralAisleWidth?: number; matWidth?: number; matDepth?: number; gap?: number }): LayoutCandidate[] {
    this.session.participants = participants;
    const vs = this.state.validationSettings;
    const zone = this.getSelectedZone();
    let bounds;
    if (zone) {
      bounds = { minX: zone.x - zone.width / 2, maxX: zone.x + zone.width / 2, minZ: zone.z - zone.depth / 2, maxZ: zone.z + zone.depth / 2 };
    } else {
      const b = areaBounds(this.state.classroom);
      const inset = vs.matWallClearance;
      bounds = { minX: b.minX + inset, maxX: b.maxX - inset, minZ: b.minZ + inset, maxZ: b.maxZ - inset };
    }
    this.session.matCandidates = generateLayouts({
      participants,
      matWidth: opts?.matWidth ?? 0.6,
      matDepth: opts?.matDepth ?? 1.8,
      gap: opts?.gap ?? 0.1,
      aisleWidth: opts?.centralAisleWidth ?? Math.max(vs.minAisleWidth, 0.9),
      bounds,
    });
    this.notifyUi();
    return this.session.matCandidates;
  }

  applyMatCandidate(id: string): void {
    const cand = this.session.matCandidates.find((c) => c.id === id);
    if (!cand) return;
    const newIds: string[] = [];
    this.store.mutate((p) => {
      cand.groups.forEach((g, i) => {
        const gid = uid("grp");
        newIds.push(gid);
        p.groups.push({
          id: gid, name: `地墊區 ${cand.groups.length > 1 ? String.fromCharCode(65 + i) : ""}`.trim() || "地墊區",
          sourceKind: "mat", rows: g.rows, cols: g.cols, itemWidth: g.itemWidth, itemDepth: g.itemDepth,
          itemHeight: 0.04, gapX: g.gapX, gapZ: g.gapZ, rotationDeg: g.rotationDeg, anchorX: g.anchorX, anchorZ: g.anchorZ,
          locked: false, hidden: false, numberPrefix: cand.groups.length > 1 ? String.fromCharCode(65 + i) : "M", numberOrder: "row", numberStart: "nw",
        });
      });
    });
    this.session.matCandidates = [];
    this.toast(`已套用 ${cand.count} 張地墊`, true);
    if (newIds.length) this.setSelection(newIds);
  }

  // --- traffic simulation -----------------------------------------------

  startSimulation(params?: Partial<SimParams>): void {
    const p: SimParams = { countPerRoute: params?.countPerRoute ?? 8, speed: params?.speed ?? 1.2, spacing: params?.spacing ?? 1.0 };
    const routes = this.state.routes.filter((r) => r.visible && r.points.length >= 2);
    if (routes.length === 0) { this.toast("尚無可模擬的動線"); return; }
    this.simState = initSimulation(routes, p);
    this.session.simPlaying = true;
    this.simLast = performance.now();
    this.notifyUi();
    this.simLoop();
  }
  stopSimulation(): void {
    this.session.simPlaying = false;
    if (this.simRaf !== null) { cancelAnimationFrame(this.simRaf); this.simRaf = null; }
    this.session.simPositions = [];
    this.session.bottlenecks = [];
    this.simState = null;
    this.render();
  }
  private simLoop(): void {
    if (!this.session.simPlaying || !this.simState) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.simLast) / 1000);
    this.simLast = now;
    const routes = this.state.routes.filter((r) => r.visible && r.points.length >= 2);
    this.simState = stepSimulation(this.simState, routes, dt);
    this.session.simPositions = agentPositions(this.simState, routes);
    this.session.bottlenecks = detectBottlenecks(this.session.simPositions, 1.2, 4);
    this.syncScene();
    if (simulationDone(this.simState, routes)) {
      // Loop the run so it stays visible until the user stops it.
      this.simState = initSimulation(routes, this.simState.params);
    }
    this.simRaf = requestAnimationFrame(() => this.simLoop());
  }

  // --- room / tile / calibration ----------------------------------------

  updateArea(id: "classroom" | "corridor", patch: Partial<Project["classroom"]>): void {
    this.store.mutate((p) => {
      Object.assign(p[id], patch);
      // Keep wall-anchored assets glued to their walls after a resize.
      for (const o of p.objects) {
        if (o.wallAnchor && o.wallAnchor.areaId === id) {
          const pos = wallAnchorToPosition(o.wallAnchor, [p.classroom, p.corridor]);
          if (pos) { o.x = pos.x; o.z = pos.z; o.rotationDeg = pos.rotationDeg; }
        }
      }
    });
  }
  updateTile(patch: Partial<Project["tile"]>): void { this.store.mutate((p) => Object.assign(p.tile, patch)); }
  updateCalibration(patch: Partial<Project["calibration"]>): void { this.store.mutate((p) => Object.assign(p.calibration, patch)); }

  applyCalibrationToTile(actualMeters: number): void {
    this.store.mutate((p) => { p.tile.width = actualMeters; p.tile.depth = actualMeters; p.calibration.referenceLength = actualMeters; });
  }

  // --- validation --------------------------------------------------------

  runValidation(): Issue[] { this.session.issues = validateProject(this.state); this.notifyUi(); return this.session.issues; }
  focusIssue(issue: Issue): void {
    if (issue.targetId) this.session.selection = new Set([issue.targetId]);
    this.scene.focusOn(issue.focus.x, issue.focus.z);
    this.render();
  }

  // --- field info --------------------------------------------------------

  fieldInfo(obj: SceneObject): FieldInfo { return objectFieldInfo(obj, this.state); }
  groupInfo(g: ArrayGroup): { count: number; totalWidth: number; totalDepth: number } { return groupFootprint(g); }

  // --- helpers -----------------------------------------------------------

  private centerOfClassroom(): { x: number; z: number } { const a = this.state.classroom; return { x: a.x + a.length / 2, z: a.z + a.width / 2 }; }
  private insideAny(x: number, z: number): boolean {
    for (const a of [this.state.classroom, this.state.corridor]) {
      if (x >= a.x && x <= a.x + a.length && z >= a.z && z <= a.z + a.width) return true;
    }
    return false;
  }
  private isLocked(id: string): boolean {
    return !!(this.state.objects.find((o) => o.id === id)?.locked
      || this.state.zones.find((z) => z.id === id)?.locked
      || this.state.groups.find((g) => g.id === id)?.locked);
  }

  // --- pointer interaction ----------------------------------------------

  private bindPointer(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    canvas.addEventListener("pointermove", (e) => this.onPointerMove(e));
    window.addEventListener("pointerup", (e) => this.onPointerUp(e));
    window.addEventListener("pointercancel", (e) => this.onPointerUp(e));
    canvas.addEventListener("contextmenu", (e) => { if (this.session.mode === "place") { e.preventDefault(); this.cancelPlacement(); } });
  }

  /** Cancel any in-progress single-finger object drag (e.g. when a 2nd finger lands). */
  private abortDrag(): void {
    if (this.drag && (this.drag.kind === "move" || this.drag.kind === "routeNode")) this.store.cancelTransient();
    this.drag = null;
    this.dragging = false;
    this.tapClearStart = null;
    this.onBox?.(null);
  }

  private onPointerDown(e: PointerEvent): void {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    // Two or more fingers → this is a camera gesture (pinch/pan). Never drag objects.
    if (this.pointers.size >= 2) { this.abortDrag(); this.scene.setControlsEnabled(true); return; }

    const ground = this.scene.groundPoint(e.clientX, e.clientY);

    if (this.session.mode === "place") { this.confirmPlacement(); return; }

    if (this.session.mode === "measure" && ground) {
      const snapped = snapMeasurePoint(ground.x, ground.z, this.state, 0.35);
      const m = this.session.measure ?? { a: null, b: null };
      if (!m.a || (m.a && m.b)) { m.a = snapped; m.b = null; } else { m.b = snapped; }
      this.session.measure = m;
      this.render();
      return;
    }

    if (this.session.mode === "calibrate" && ground) {
      const snapped = snapMeasurePoint(ground.x, ground.z, this.state, 0.35);
      const c = this.session.calibrate ?? { a: null, b: null };
      if (!c.a || (c.a && c.b)) { c.a = { x: snapped.x, z: snapped.z }; c.b = null; } else { c.b = { x: snapped.x, z: snapped.z }; }
      this.session.calibrate = c;
      this.render();
      return;
    }

    const pick = this.scene.pick(e.clientX, e.clientY);

    if (this.session.mode === "route" && this.session.activeRouteId) {
      if (pick?.type === "routeNode" && pick.id === this.session.activeRouteId) {
        this.beginDrag(e, { kind: "routeNode", routeId: pick.id, routeIndex: pick.index });
        this.scene.setControlsEnabled(false);
        return;
      }
      if (ground) {
        const snapped = applySnap(ground.x, ground.z, this.state.tile, this.session.snap);
        this.store.mutate((p) => { const r = p.routes.find((x) => x.id === this.session.activeRouteId); if (r) r.points.push(snapped); });
      }
      return;
    }

    if (pick) {
      if (!e.shiftKey && !this.session.selection.has(pick.id)) this.session.selection = new Set();
      this.session.selection.add(pick.id);
      this.render();
      if (!this.isLocked(pick.id)) { this.beginDrag(e, { kind: "move" }); this.scene.setControlsEnabled(false); }
      return;
    }

    if (e.shiftKey) {
      this.beginDrag(e, { kind: "box" });
      this.scene.setControlsEnabled(false);
      this.session.selection = new Set();
      this.render();
    } else if (this.session.mode === "select" && this.session.selection.size > 0) {
      this.tapClearStart = { x: e.clientX, y: e.clientY };
    }
  }

  private beginDrag(e: PointerEvent, opts: { kind: DragState["kind"]; routeId?: string; routeIndex?: number }): void {
    const ground = this.scene.groundPoint(e.clientX, e.clientY);
    const orig = new Map<string, { x: number; z: number }>();
    for (const o of this.state.objects) if (this.session.selection.has(o.id)) orig.set(o.id, { x: o.x, z: o.z });
    for (const z of this.state.zones) if (this.session.selection.has(z.id)) orig.set(z.id, { x: z.x, z: z.z });
    for (const g of this.state.groups) if (this.session.selection.has(g.id)) { const c = groupCenter(g); orig.set(g.id, { x: c.x, z: c.z }); }
    const threshold = e.pointerType === "touch" ? TOUCH_DRAG_THRESHOLD : DRAG_THRESHOLD;
    this.drag = { kind: opts.kind, startGround: ground, startClient: { x: e.clientX, y: e.clientY }, orig, routeId: opts.routeId, routeIndex: opts.routeIndex, moved: false, threshold };
    if (opts.kind === "move" || opts.kind === "routeNode") { this.store.beginTransient(); this.dragging = true; }
    this.onBox?.(null);
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    if (this.pointers.size >= 2) return; // camera gesture; never move objects

    if (this.session.mode === "place") {
      // On touch, lift the ghost above the finger so it (and its snap/legality) stays visible.
      const gy = e.pointerType === "touch" ? e.clientY - TOUCH_GHOST_OFFSET_PX : e.clientY;
      const ground = this.scene.groundPoint(e.clientX, gy);
      if (ground) this.updateGhostAt(ground.x, ground.z);
      return;
    }
    const drag = this.drag;
    if (!drag) return;
    const dx = e.clientX - drag.startClient.x;
    const dy = e.clientY - drag.startClient.y;
    if (!drag.moved && Math.hypot(dx, dy) < drag.threshold) return;
    drag.moved = true;
    const ground = this.scene.groundPoint(e.clientX, e.clientY);

    if (drag.kind === "box") { this.updateBoxSelection(drag.startClient, { x: e.clientX, y: e.clientY }); return; }
    if (!ground || !drag.startGround) return;

    if (drag.kind === "routeNode" && drag.routeId && drag.routeIndex !== undefined) {
      const snapped = applySnap(ground.x, ground.z, this.state.tile, this.session.snap);
      this.store.transient((p) => { const r = p.routes.find((x) => x.id === drag.routeId); if (r && r.points[drag.routeIndex!]) r.points[drag.routeIndex!] = snapped; });
      return;
    }

    if (drag.kind === "move") {
      const rawDx = ground.x - drag.startGround.x;
      const rawDz = ground.z - drag.startGround.z;
      const primaryId = [...this.session.selection][0];
      const primOrig = drag.orig.get(primaryId);
      let sdx = rawDx, sdz = rawDz;
      if (primOrig) { const s = applySnap(primOrig.x + rawDx, primOrig.z + rawDz, this.state.tile, this.session.snap); sdx = s.x - primOrig.x; sdz = s.z - primOrig.z; }
      const movedObjectIds = new Set<string>();
      this.store.transient((p) => {
        for (const o of p.objects) {
          const orig = drag.orig.get(o.id);
          if (orig && !o.locked) { o.x = orig.x + sdx; o.z = orig.z + sdz; movedObjectIds.add(o.id); }
        }
        // Tabletop children follow their parent.
        for (const o of p.objects) {
          if (o.parentId && movedObjectIds.has(o.parentId) && !drag.orig.has(o.id)) { o.x += sdx; o.z += sdz; }
        }
        for (const z of p.zones) { const orig = drag.orig.get(z.id); if (orig && !z.locked) { z.x = orig.x + sdx; z.z = orig.z + sdz; } }
        for (const g of p.groups) { const orig = drag.orig.get(g.id); if (orig && !g.locked) { const patch = setGroupCenter(g, orig.x + sdx, orig.z + sdz); g.anchorX = patch.anchorX; g.anchorZ = patch.anchorZ; } }
      });
    }
  }

  private onPointerUp(e?: PointerEvent): void {
    if (e) this.pointers.delete(e.pointerId);
    if (this.pointers.size >= 1 && this.drag) return; // still mid multi-touch gesture
    const drag = this.drag;
    this.drag = null;
    this.dragging = false;
    this.scene.setControlsEnabled(true);
    this.onBox?.(null);
    // Tap on empty space (no drag/orbit) clears the selection.
    if (!drag && this.tapClearStart && e) {
      const moved = Math.hypot(e.clientX - this.tapClearStart.x, e.clientY - this.tapClearStart.y);
      if (moved < DRAG_THRESHOLD && this.session.selection.size > 0) { this.session.selection = new Set(); this.render(); }
    }
    this.tapClearStart = null;
    if (!drag) return;
    if (drag.kind === "move" || drag.kind === "routeNode") this.store.commitTransient();
    this.render();
  }

  private updateBoxSelection(a: { x: number; y: number }, b: { x: number; y: number }): void {
    const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x), minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
    const sel = new Set<string>();
    const test = (id: string, x: number, z: number) => { const s = this.scene.project(x, z); if (s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY) sel.add(id); };
    for (const o of this.state.objects) if (!o.hidden) test(o.id, o.x, o.z);
    for (const z of this.state.zones) if (!z.hidden) test(z.id, z.x, z.z);
    for (const g of this.state.groups) if (!g.hidden) { const c = groupCenter(g); test(g.id, c.x, c.z); }
    this.session.selection = sel;
    this.render();
    this.onBox?.({ minX, minY, maxX, maxY });
  }
}
