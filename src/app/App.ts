import {
  OBJECT_DEFAULTS,
  ZONE_DEFAULTS,
  uid,
  type ObjectKind,
  type Project,
  type Route,
  type SceneObject,
  type ViewName,
  type Zone,
  type ZoneType,
} from "../core/model";
import { applySnap, type SnapMode } from "../core/units";
import { matPreviewCenters, type MatArraySpec, type MatPreviewState } from "../core/mat";
import { buildSummary, legendEntries, type PlanSummary } from "../core/summary";
import { Store, migrate } from "../state/store";
import { SceneManager } from "../scene/SceneManager";
import { buildLineShareUrl, buildShareUrl } from "../share/share";
import { buildShareImage } from "../export/shareImage";

export type Mode = "select" | "route";
export type Focus = "all" | "zones" | "flow";

export interface Session {
  selection: Set<string>;
  mode: Mode;
  snap: SnapMode;
  matPreview: MatPreviewState | null;
  activeRouteId: string | null;
  showLabels: boolean;
  focus: Focus;
  presentation: boolean;
}

interface DragState {
  kind: "move" | "routeNode" | "box";
  startGround: { x: number; z: number } | null;
  startClient: { x: number; y: number };
  origPositions: Map<string, { x: number; z: number }>;
  routeId?: string;
  routeIndex?: number;
  moved: boolean;
}

const DRAG_THRESHOLD = 4;

export class App {
  readonly store: Store;
  readonly scene: SceneManager;
  readonly session: Session = {
    selection: new Set(),
    mode: "select",
    snap: "intersection",
    matPreview: null,
    activeRouteId: null,
    showLabels: false,
    focus: "all",
    presentation: false,
  };

  private drag: DragState | null = null;
  private dragging = false;
  private uiListeners = new Set<() => void>();

  constructor(canvas: HTMLCanvasElement, store: Store) {
    this.store = store;
    this.scene = new SceneManager(canvas);
    this.store.subscribe(() => {
      this.syncScene();
      if (!this.dragging) this.notifyUi();
    });
    this.bindPointer(canvas);
    this.render();
    this.scene.setView(this.state.view);
  }

  private get state(): Project {
    return this.store.getState();
  }

  onChange(cb: () => void): () => void {
    this.uiListeners.add(cb);
    return () => this.uiListeners.delete(cb);
  }

  private syncScene(): void {
    this.scene.sync(this.state, {
      selection: this.session.selection,
      matPreview: this.session.matPreview,
      showLabels: this.session.showLabels,
      layerOverride: this.focusOverride(),
    });
  }

  private focusOverride(): Partial<Record<keyof Project["layers"], boolean>> | null {
    switch (this.session.focus) {
      case "zones":
        return { objects: false, routes: false };
      case "flow":
        return { objects: false };
      case "all":
      default:
        return null;
    }
  }

  private render(): void {
    this.syncScene();
    for (const cb of this.uiListeners) cb();
  }

  private notifyUi(): void {
    for (const cb of this.uiListeners) cb();
  }

  // --- view / layers / mode ---------------------------------------------

  setView(view: ViewName): void {
    this.store.mutate((p) => (p.view = view), { history: false });
    this.scene.setView(view);
  }

  setSnap(mode: SnapMode): void {
    this.session.snap = mode;
    this.notifyUi();
  }

  setMode(mode: Mode): void {
    this.session.mode = mode;
    if (mode !== "route") this.session.activeRouteId = null;
    this.notifyUi();
  }

  toggleLayer(layer: keyof Project["layers"]): void {
    this.store.mutate((p) => (p.layers[layer] = !p.layers[layer]), { history: false });
  }

  setShowLabels(v: boolean): void {
    this.session.showLabels = v;
    this.render();
  }

  setFocus(focus: Focus): void {
    this.session.focus = focus;
    this.render();
  }

  setPresentation(on: boolean): void {
    this.session.presentation = on;
    if (on) {
      this.session.selection = new Set();
      this.session.showLabels = true;
      this.session.mode = "select";
      this.setView("top");
    }
    this.render();
  }

  // --- summary & sharing -------------------------------------------------

  getSummary(): PlanSummary {
    return buildSummary(this.state);
  }

  getShareUrl(): string {
    return buildShareUrl(this.state);
  }

  /** LINE share URL prefilled with the plan title + link. */
  getLineShareUrl(): string {
    const url = buildShareUrl(this.state);
    const title = this.getSummary().title;
    return buildLineShareUrl(`【場佈平面圖】${title}\n${url}`);
  }

  loadShared(partial: Partial<Project>): void {
    this.store.loadProject(migrate(partial));
  }

  async buildShareImage(): Promise<string> {
    const top = this.scene.exportPng(this.state, "top", "layout");
    return buildShareImage(top, buildSummary(this.state), legendEntries());
  }

  undo(): void {
    this.store.undo();
  }
  redo(): void {
    this.store.redo();
  }

  // --- objects & zones ---------------------------------------------------

  addObject(kind: ObjectKind): void {
    const d = OBJECT_DEFAULTS[kind];
    const c = this.centerOfClassroom();
    const obj: SceneObject = {
      id: uid("obj"),
      kind,
      x: c.x,
      z: c.z,
      rotationDeg: 0,
      width: d.width,
      depth: d.depth,
      height: d.height,
      locked: false,
      hidden: false,
      openDeg: kind === "door" ? 90 : undefined,
    };
    this.store.mutate((p) => p.objects.push(obj));
    this.setSelection([obj.id]);
  }

  addZone(type: ZoneType): void {
    const d = ZONE_DEFAULTS[type];
    const c = this.centerOfClassroom();
    const zone: Zone = {
      id: uid("zone"),
      type,
      name: d.label,
      x: c.x,
      z: c.z,
      width: d.width,
      depth: d.depth,
      color: d.color,
      locked: false,
      hidden: false,
    };
    this.store.mutate((p) => p.zones.push(zone));
    this.setSelection([zone.id]);
  }

  private centerOfClassroom(): { x: number; z: number } {
    const a = this.state.classroom;
    return { x: a.x + a.length / 2, z: a.z + a.width / 2 };
  }

  deleteSelection(): void {
    if (this.session.selection.size === 0) return;
    const ids = this.session.selection;
    this.store.mutate((p) => {
      p.objects = p.objects.filter((o) => !ids.has(o.id));
      p.zones = p.zones.filter((z) => !ids.has(z.id));
      p.routes = p.routes.filter((r) => !ids.has(r.id));
    });
    this.session.selection = new Set();
    this.notifyUi();
  }

  rotateSelection(delta: number): void {
    const ids = this.session.selection;
    this.store.mutate((p) => {
      for (const o of p.objects) if (ids.has(o.id) && !o.locked) o.rotationDeg = (o.rotationDeg + delta) % 360;
    });
  }

  duplicateSelection(): void {
    const ids = this.session.selection;
    const newIds: string[] = [];
    this.store.mutate((p) => {
      for (const o of [...p.objects]) {
        if (!ids.has(o.id)) continue;
        const copy: SceneObject = { ...o, id: uid("obj"), x: o.x + 0.5, z: o.z + 0.5, locked: false };
        p.objects.push(copy);
        newIds.push(copy.id);
      }
      for (const z of [...p.zones]) {
        if (!ids.has(z.id)) continue;
        const copy: Zone = { ...z, id: uid("zone"), x: z.x + 0.5, z: z.z + 0.5, locked: false };
        p.zones.push(copy);
        newIds.push(copy.id);
      }
    });
    if (newIds.length) this.setSelection(newIds);
  }

  toggleLockSelection(): void {
    const ids = this.session.selection;
    this.store.mutate((p) => {
      for (const o of p.objects) if (ids.has(o.id)) o.locked = !o.locked;
      for (const z of p.zones) if (ids.has(z.id)) z.locked = !z.locked;
    });
  }

  toggleHideSelection(): void {
    const ids = this.session.selection;
    this.store.mutate((p) => {
      for (const o of p.objects) if (ids.has(o.id)) o.hidden = !o.hidden;
      for (const z of p.zones) if (ids.has(z.id)) z.hidden = !z.hidden;
    });
    this.session.selection = new Set();
    this.notifyUi();
  }

  updateSelectedObject(patch: Partial<SceneObject>): void {
    const ids = this.session.selection;
    this.store.mutate((p) => {
      for (const o of p.objects) if (ids.has(o.id)) Object.assign(o, patch);
    });
  }

  updateSelectedZone(patch: Partial<Zone>): void {
    const ids = this.session.selection;
    this.store.mutate((p) => {
      for (const z of p.zones) if (ids.has(z.id)) Object.assign(z, patch);
    });
  }

  setSelection(ids: string[]): void {
    this.session.selection = new Set(ids);
    this.render();
  }

  getSelectedObject(): SceneObject | null {
    if (this.session.selection.size !== 1) return null;
    const id = [...this.session.selection][0];
    return this.state.objects.find((o) => o.id === id) ?? null;
  }

  getSelectedZone(): Zone | null {
    if (this.session.selection.size !== 1) return null;
    const id = [...this.session.selection][0];
    return this.state.zones.find((z) => z.id === id) ?? null;
  }

  // --- room / tile / calibration ----------------------------------------

  updateArea(id: "classroom" | "corridor", patch: Partial<Project["classroom"]>): void {
    this.store.mutate((p) => Object.assign(p[id], patch));
  }

  updateTile(patch: Partial<Project["tile"]>): void {
    this.store.mutate((p) => Object.assign(p.tile, patch));
  }

  updateCalibration(patch: Partial<Project["calibration"]>): void {
    this.store.mutate((p) => Object.assign(p.calibration, patch));
  }

  // --- mat simulation ----------------------------------------------------

  startMatPreview(): void {
    const zone = this.getSelectedZone();
    const spec: MatArraySpec = { matWidth: 0.6, matDepth: 1.8, rows: 3, cols: 4, gapX: 0.1, gapZ: 0.1 };
    const anchor = zone
      ? { x: zone.x - zone.width / 2 + 0.05, z: zone.z - zone.depth / 2 + 0.05 }
      : this.centerOfClassroom();
    this.session.matPreview = {
      spec,
      rotationDeg: 0,
      anchorX: anchor.x,
      anchorZ: anchor.z,
      zoneId: zone ? zone.id : null,
    };
    this.render();
  }

  updateMatPreview(patch: Omit<Partial<MatPreviewState>, "spec"> & { spec?: Partial<MatArraySpec> }): void {
    if (!this.session.matPreview) return;
    const cur = this.session.matPreview;
    this.session.matPreview = {
      ...cur,
      ...patch,
      spec: { ...cur.spec, ...(patch.spec ?? {}) },
    };
    this.render();
  }

  cancelMatPreview(): void {
    this.session.matPreview = null;
    this.render();
  }

  confirmMatPreview(): void {
    const pre = this.session.matPreview;
    if (!pre) return;
    const centers = matPreviewCenters(pre);
    const newIds: string[] = [];
    this.store.mutate((p) => {
      for (const c of centers) {
        const id = uid("obj");
        newIds.push(id);
        p.objects.push({
          id,
          kind: "mat",
          x: c.x,
          z: c.z,
          rotationDeg: pre.rotationDeg,
          width: pre.spec.matWidth,
          depth: pre.spec.matDepth,
          height: OBJECT_DEFAULTS.mat.height,
          locked: false,
          hidden: false,
        });
      }
    });
    this.session.matPreview = null;
    this.setSelection(newIds);
  }

  // --- routes ------------------------------------------------------------

  newRoute(): void {
    const colors = ["#f97316", "#22d3ee", "#a78bfa", "#34d399", "#f43f5e"];
    const route: Route = {
      id: uid("route"),
      name: `動線 ${this.state.routes.length + 1}`,
      color: colors[this.state.routes.length % colors.length],
      points: [],
      visible: true,
    };
    this.store.mutate((p) => p.routes.push(route));
    this.session.mode = "route";
    this.session.activeRouteId = route.id;
    this.setSelection([route.id]);
    this.notifyUi();
  }

  finishRoute(): void {
    this.session.activeRouteId = null;
    this.session.mode = "select";
    this.notifyUi();
  }

  updateRoute(id: string, patch: Partial<Route>): void {
    this.store.mutate((p) => {
      const r = p.routes.find((x) => x.id === id);
      if (r) Object.assign(r, patch);
    });
  }

  deleteRouteNode(routeId: string, index: number): void {
    this.store.mutate((p) => {
      const r = p.routes.find((x) => x.id === routeId);
      if (r) r.points.splice(index, 1);
    });
  }

  // --- pointer interaction ----------------------------------------------

  private bindPointer(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    canvas.addEventListener("pointermove", (e) => this.onPointerMove(e));
    window.addEventListener("pointerup", () => this.onPointerUp());
  }

  private onPointerDown(e: PointerEvent): void {
    const ground = this.scene.groundPoint(e.clientX, e.clientY);
    const pick = this.scene.pick(e.clientX, e.clientY);

    if (this.session.mode === "route" && this.session.activeRouteId) {
      if (pick?.type === "routeNode" && pick.id === this.session.activeRouteId) {
        this.beginDrag(e, { kind: "routeNode", routeId: pick.id, routeIndex: pick.index });
        this.scene.setControlsEnabled(false);
        return;
      }
      // Add a new point (snapped) to the active route.
      if (ground) {
        const snapped = applySnap(ground.x, ground.z, this.state.tile, this.session.snap);
        this.store.mutate((p) => {
          const r = p.routes.find((x) => x.id === this.session.activeRouteId);
          if (r) r.points.push(snapped);
        });
      }
      return;
    }

    if (pick) {
      const additive = e.shiftKey;
      if (!additive && !this.session.selection.has(pick.id)) this.session.selection = new Set();
      this.session.selection.add(pick.id);
      this.render();
      // Begin move drag unless the (single) target is locked.
      const locked = this.isLocked(pick.id);
      if (!locked) {
        this.beginDrag(e, { kind: "move" });
        this.scene.setControlsEnabled(false);
      }
      return;
    }

    // Empty space: shift-drag = box select; otherwise let OrbitControls handle camera.
    if (e.shiftKey) {
      this.beginDrag(e, { kind: "box" });
      this.scene.setControlsEnabled(false);
      this.session.selection = new Set();
      this.render();
    }
  }

  private beginDrag(e: PointerEvent, opts: Partial<DragState> & { kind: DragState["kind"] }): void {
    const ground = this.scene.groundPoint(e.clientX, e.clientY);
    const orig = new Map<string, { x: number; z: number }>();
    for (const o of this.state.objects) if (this.session.selection.has(o.id)) orig.set(o.id, { x: o.x, z: o.z });
    for (const z of this.state.zones) if (this.session.selection.has(z.id)) orig.set(z.id, { x: z.x, z: z.z });
    this.drag = {
      kind: opts.kind,
      startGround: ground,
      startClient: { x: e.clientX, y: e.clientY },
      origPositions: orig,
      routeId: opts.routeId,
      routeIndex: opts.routeIndex,
      moved: false,
    };
    if (opts.kind === "move" || opts.kind === "routeNode") {
      this.store.beginTransient();
      this.dragging = true;
    }
    this.onBox?.(null);
  }

  private onPointerMove(e: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    const dx = e.clientX - drag.startClient.x;
    const dy = e.clientY - drag.startClient.y;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    drag.moved = true;
    const ground = this.scene.groundPoint(e.clientX, e.clientY);

    if (drag.kind === "box") {
      this.updateBoxSelection(drag.startClient, { x: e.clientX, y: e.clientY });
      return;
    }
    if (!ground || !drag.startGround) return;

    if (drag.kind === "routeNode" && drag.routeId !== undefined && drag.routeIndex !== undefined) {
      const snapped = applySnap(ground.x, ground.z, this.state.tile, this.session.snap);
      this.store.transient((p) => {
        const r = p.routes.find((x) => x.id === drag.routeId);
        if (r && r.points[drag.routeIndex!]) r.points[drag.routeIndex!] = snapped;
      });
      return;
    }

    if (drag.kind === "move") {
      const rawDx = ground.x - drag.startGround.x;
      const rawDz = ground.z - drag.startGround.z;
      // Snap based on the primary (first) selected item.
      const primaryId = [...this.session.selection][0];
      const primOrig = drag.origPositions.get(primaryId);
      let sdx = rawDx;
      let sdz = rawDz;
      if (primOrig) {
        const snapped = applySnap(primOrig.x + rawDx, primOrig.z + rawDz, this.state.tile, this.session.snap);
        sdx = snapped.x - primOrig.x;
        sdz = snapped.z - primOrig.z;
      }
      this.store.transient((p) => {
        for (const o of p.objects) {
          const orig = drag.origPositions.get(o.id);
          if (orig && !o.locked) {
            o.x = orig.x + sdx;
            o.z = orig.z + sdz;
          }
        }
        for (const z of p.zones) {
          const orig = drag.origPositions.get(z.id);
          if (orig && !z.locked) {
            z.x = orig.x + sdx;
            z.z = orig.z + sdz;
          }
        }
      });
    }
  }

  private onPointerUp(): void {
    const drag = this.drag;
    this.drag = null;
    this.dragging = false;
    this.scene.setControlsEnabled(true);
    this.onBox?.(null);
    if (!drag) return;
    if (drag.kind === "move" || drag.kind === "routeNode") {
      this.store.commitTransient();
    }
    // Final full refresh so panels reflect the committed positions.
    this.render();
  }

  private updateBoxSelection(a: { x: number; y: number }, b: { x: number; y: number }): void {
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    const sel = new Set<string>();
    for (const o of this.state.objects) {
      if (o.hidden) continue;
      const s = this.scene.project(o.x, o.z);
      if (s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY) sel.add(o.id);
    }
    for (const z of this.state.zones) {
      if (z.hidden) continue;
      const s = this.scene.project(z.x, z.z);
      if (s.x >= minX && s.x <= maxX && s.y >= minY && s.y <= maxY) sel.add(z.id);
    }
    this.session.selection = sel;
    this.render();
    this.onBox?.({ minX, minY, maxX, maxY });
  }

  private isLocked(id: string): boolean {
    const o = this.state.objects.find((x) => x.id === id);
    if (o) return o.locked;
    const z = this.state.zones.find((x) => x.id === id);
    if (z) return z.locked;
    return false;
  }

  /** Optional hook the UI sets to render the box-select rectangle overlay. */
  onBox: ((rect: { minX: number; minY: number; maxX: number; maxY: number } | null) => void) | null = null;
}
