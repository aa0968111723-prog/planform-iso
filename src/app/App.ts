import {
  uid,
  ZONE_DEFAULTS,
  type ArrayGroup,
  type ArrivalProfile,
  type EventScenario,
  type MeasurementAnnotation,
  type MeasurementType,
  type ObjectKind,
  type Project,
  type Route,
  type RouteType,
  type SceneObject,
  type ValidationSettings,
  type ViewName,
  type Zone,
  type ZoneType,
} from "../core/model";
import { assetDef } from "../core/assets";
import { AssetCatalog, type AssetCatalogEntry } from "../core/catalog";
import { catalogFromProject, createDefaultScenario, resolveScenarioBindings } from "../core/migrate";
import { applySnap, type SnapMode } from "../core/units";
import {
  findParentTable,
  nearestWallSnap,
  wallAnchorToPosition,
  areaBounds,
} from "../core/placement";
import { groupCenter, groupFootprint, groupMembers, setGroupCenter } from "../core/arrays";
import { validateProject, type Issue } from "../core/validation";
import {
  buildRoleBriefing,
  partnerEmphasis,
  partnerMarks,
  partnerStatus,
  type PartnerEmphasis,
  type PartnerMark,
  type PartnerRole,
  type RoleBriefing,
} from "../core/partner";
import {
  buildRehearsalTimeline,
  comparePlainMetrics,
  plainMetrics,
  type PlainComparison,
  type PlainMetrics,
  type RehearsalEvent,
} from "../core/rehearsal";
import {
  objectFieldInfo,
  measure,
  snapMeasurePoint,
  type MeasureResult,
  type FieldInfo,
  type SnappedPoint,
} from "../core/measure";
import { applyCalibrationPath, type CalibrationPath } from "../core/calibration";
import { routePreset } from "../core/routes";
import { generateLayouts, type LayoutCandidate } from "../core/smartLayout";
import { applyVenuePreset, saveUserVenuePreset, venuePresetById, venuePresetFromProject } from "../core/venues";
import {
  agentPositions,
  detectBottlenecks,
  initSimulation,
  simulationDone,
  stepSimulation,
  type Bottleneck,
  type SimParams,
  type SimState,
} from "../core/simulation";
import {
  buildCheckinPaymentVariants,
  compareScenarioVariants,
  frameAt,
  runDiscreteEvent,
  runScenarioMedian,
  type PlaybackAgent,
  type ScenarioVariantCompareResult,
  type SimulationResult,
} from "../core/eventFlow";
import {
  detectionsToObjects,
  type VenueCaptureSession,
} from "../assets/venueCapture";
import { Store } from "../state/store";
import type { ProjectSession } from "../state/projectSession";
import { SceneManager, type GhostState } from "../scene/SceneManager";
import { applyThemeToDocument, loadTheme, otherTheme, saveTheme, type ThemeName } from "../core/theme";
import { QuickAgent } from "../agent/quickAgent";
import { MockProvider } from "../agent/provider";

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
  placingAssetId: string | null;
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
  /** When set, scene shows agent draft instead of committed project. */
  agentPreview: Project | null;
  // Visual-communication + simulation state
  /** Partner Mode session, or null while the professional editor is active. */
  partner: PartnerSession | null;
  simplify: boolean;
  focusRouteId: string | null;
  participants: number;
  matCandidates: LayoutCandidate[];
  /** Zone type waiting for a canvas tap ("點畫面放區域"). */
  zonePlace: ZoneType | null;
  simPositions: { id?: number; x: number; z: number; routeId?: string; state?: PlaybackAgent["state"] }[];
  bottlenecks: Bottleneck[];
  simPlaying: boolean;
  /** DES playback (preferred over route-walk when a scenario exists). */
  simMode: "off" | "route-walk" | "event-flow";
  simPaused: boolean;
  simSpeed: number;
  simTime: number;
  simResult: SimulationResult | null;
  simQueues: Record<string, number>;
  simCompare: ScenarioVariantCompareResult | null;
  simQuick: {
    participants: number;
    arrivalWindowSeconds: number;
    prepaidRatio: number;
    hasOnsitePayment: boolean;
    arrivalProfile: ArrivalProfile;
    checkinStaff: number;
    paymentStaff: number;
  };
}

/** Live state of Partner Mode — the visual-first, read-only view of a plan. */
export interface PartnerSession {
  role: PartnerRole;
  /** Rehearsal beats from the last run; empty until 演練 is pressed. */
  timeline: RehearsalEvent[];
  /** Pending AI suggestion, shown as a visual before/after. */
  suggestion: PartnerSuggestion | null;
  /** True while a rehearsal or suggestion is being computed. */
  busy: boolean;
}

export interface PartnerSuggestion {
  message: string;
  before: PlainMetrics;
  after: PlainMetrics;
  comparison: PlainComparison;
  /** Draft plan the agent proposes; applied only if the user accepts. */
  afterProject: Project;
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

/** Did the agent actually change the plan, or hand back the same layout? */
function planDiffers(a: Project, b: Project): boolean {
  const key = (p: Project) => JSON.stringify({ o: p.objects, z: p.zones, g: p.groups, r: p.routes });
  return key(a) !== key(b);
}

function boundsOfPoints(points: { x: number; z: number }[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }
  return { minX, maxX, minZ, maxZ };
}

const DRAG_THRESHOLD = 4;
const TOUCH_DRAG_THRESHOLD = 12;
const TOUCH_GHOST_OFFSET_PX = 46;

export class App {
  readonly store: Store;
  /** The project library. Owns which project is open; see state/projectSession. */
  readonly projects: ProjectSession;
  readonly scene: SceneManager;
  readonly session: Session = {
    selection: new Set(),
    mode: "select",
    snap: "intersection",
    ghost: null,
    placingKind: null,
    placingAssetId: null,
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
    agentPreview: null,
    partner: null,
    simplify: false,
    focusRouteId: null,
    participants: 30,
    matCandidates: [],
    zonePlace: null,
    simPositions: [],
    bottlenecks: [],
    simPlaying: false,
    simMode: "off",
    simPaused: false,
    simSpeed: 1,
    simTime: 0,
    simResult: null,
    simQueues: {},
    simCompare: null,
    simQuick: {
      participants: 60,
      arrivalWindowSeconds: 1200,
      prepaidRatio: 2 / 3,
      hasOnsitePayment: true,
      arrivalProfile: "uniform",
      checkinStaff: 1,
      paymentStaff: 1,
    },
  };

  readonly quickAgent: QuickAgent;
  notifyToast: ((msg: string, undo?: boolean) => void) | null = null;
  /** UI hook: open the AI sheet with the 幫我改善 request (set by UI). */
  onImprove: (() => void) | null = null;

  /** Live catalog (builtins + project custom extras). */
  getCatalog(): AssetCatalog {
    const catalog = catalogFromProject(this.state);
    for (const id of this.recentAssetIds) catalog.markRecent(id);
    return catalog;
  }

  private recentAssetIds: string[] = [];

  private rememberAsset(id: string): void {
    this.recentAssetIds = [id, ...this.recentAssetIds.filter((x) => x !== id)].slice(0, 12);
  }

  private drag: DragState | null = null;
  private dragging = false;
  private tapClearStart: { x: number; y: number } | null = null;
  private uiListeners = new Set<() => void>();
  private pointers = new Map<number, { x: number; y: number; type: string }>();
  private validationTimer: number | null = null;
  private simState: SimState | null = null;
  private simRaf: number | null = null;
  private simLast = 0;
  private lastPanelSync = 0;
  private partnerReturnView: ViewName | null = null;
  onBox: ((rect: { minX: number; minY: number; maxX: number; maxY: number } | null) => void) | null = null;
  onToast: ((msg: string, undo?: boolean) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, store: Store, projects: ProjectSession) {
    this.store = store;
    this.projects = projects;
    this.scene = new SceneManager(canvas);
    // Light by default; a stored preference wins. Applied before the first
    // paint so the canvas and the panels never disagree for a frame.
    this.applyTheme(loadTheme(), false);
    this.quickAgent = new QuickAgent(store, new MockProvider());
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

  private get state(): Project {
    return this.store.getState();
  }

  /** Project currently shown in the scene (draft during agent preview). */
  private get viewState(): Project {
    return this.session.agentPreview ?? this.store.getState();
  }

  applyAgentPreview(project: Project | null): void {
    this.session.agentPreview = project;
    this.syncScene();
    this.notifyUi();
  }

  upsertCatalogEntry(entry: import("../core/catalog").AssetCatalogEntry): void {
    this.store.mutate((p) => {
      const list = [...(p.catalogExtras ?? [])];
      const i = list.findIndex((e) => e.id === entry.id);
      if (i >= 0) list[i] = entry as never;
      else list.push(entry as never);
      p.catalogExtras = list;
    });
  }

  /** Commit confirmed venue-capture detections (undoable). */
  commitVenueCapture(session: VenueCaptureSession): number {
    const { objects, skipped } = detectionsToObjects(session, this.state);
    if (!objects.length) {
      this.toast(skipped[0] ?? "沒有可寫入的物件");
      return 0;
    }
    this.store.mutate((p) => {
      p.objects.push(...objects);
    });
    const notes = skipped.length ? `（略過：${skipped.join("、")}）` : "";
    this.toast(`已寫入 ${objects.length} 個掃描物件${notes}`, true);
    return objects.length;
  }

  onChange(cb: () => void): () => void { this.uiListeners.add(cb); return () => this.uiListeners.delete(cb); }
  private notifyUi(): void { for (const cb of this.uiListeners) cb(); }
  private syncScene(): void {
    this.scene.sync(this.viewState, {
      selection: this.session.selection,
      ghost: this.session.ghost,
      measure: this.session.measure,
      calibrate: this.session.calibrate,
      // Partner Mode names places (zones) and flows (routes); per-object name
      // tags on top of that is what turns the plan into label soup.
      showLabels: this.session.showLabels,
      focusRouteId: this.session.focusRouteId,
      simplify: this.session.simplify || !!this.session.partner,
      partner: this.partnerView(),
      simPositions: this.session.simPositions,
      bottlenecks: this.session.bottlenecks,
      simQueues: this.session.simQueues,
      simStations: this.activeScenario()?.stations.map((s) => ({
        id: s.id,
        name: s.name,
        x: s.x,
        z: s.z,
        queue: this.session.simQueues[s.id] ?? 0,
      })),
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
    if (w !== "site" && this.session.mode === "calibrate") this.cancelCalibration();
    this.session.workflow = w;
    if (w !== "route") { this.session.activeRouteId = null; if (this.session.mode === "route") this.session.mode = "select"; }
    if (w === "check") this.runValidation();
    if (w === "route" && this.session.mode !== "route") this.session.mode = "select";
    this.cancelPlacement();
    this.notifyUi();
  }

  // --- placement mode ----------------------------------------------------

  beginPlacement(kind: ObjectKind, presetId?: string): void {
    this.beginPlacementByAssetId(AssetCatalog.builtinId(kind), presetId);
  }

  beginPlacementByAssetId(assetId: string, presetId?: string): void {
    const entry = this.getCatalog().get(assetId);
    if (!entry) return;
    const preset = presetId
      ? entry.presets?.find((p) => p.id === presetId)
      : entry.presets?.[0];
    this.session.placingKind = entry.kind;
    this.session.placingAssetId = entry.id;
    this.session.placingPreset = preset?.id ?? null;
    this.session.mode = "place";
    this.session.ghostRotation = entry.defaultFacingDeg;
    this.rememberAsset(entry.id);
    const c = this.centerOfClassroom();
    this.updateGhostAt(c.x, c.z);
    this.notifyUi();
  }

  /**
   * Enter a drawing / measuring mode, disarming any pending zone tap first.
   * The armed zone is checked before route points in the canvas-click chain,
   * so arming 「點畫面放區域」 and then starting a route made the next tap drop
   * a zone instead of adding a route point.
   */
  private enterMode(mode: Mode): void {
    this.session.zonePlace = null;
    this.session.mode = mode;
  }

  cancelPlacement(): void {
    if (this.session.mode === "place") this.session.mode = "select";
    this.session.zonePlace = null;
    this.session.placingKind = null;
    this.session.placingAssetId = null;
    this.session.ghost = null;
    this.render();
  }

  private placingEntry(): AssetCatalogEntry | null {
    const id = this.session.placingAssetId;
    const kind = this.session.placingKind;
    if (!kind) return null;
    return this.getCatalog().resolve(id ?? undefined, kind);
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
    const entry = this.placingEntry() ?? this.getCatalog().resolve(undefined, kind);
    const preset = presetId ? entry.presets?.find((p) => p.id === presetId) : undefined;
    return {
      width: preset?.width ?? entry.dimensions.width,
      depth: preset?.depth ?? entry.dimensions.depth,
      height: preset?.height ?? entry.dimensions.height,
    };
  }

  private updateGhostAt(px: number, pz: number): void {
    const kind = this.session.placingKind;
    const entry = this.placingEntry();
    if (!kind || !entry) return;
    const dims = this.currentDims(kind, this.session.placingPreset);
    let x = px, z = pz, rotationDeg = this.session.ghostRotation;
    let elevation: number;
    let validity: GhostState["validity"];
    let door: GhostState["door"];

    if (entry.placementType === "wall") {
      const snap = nearestWallSnap(px, pz, [this.state.classroom, this.state.corridor], dims.width);
      if (snap) { x = snap.x; z = snap.z; rotationDeg = snap.rotationDeg; }
      elevation = entry.defaultElevation ?? 0;
      validity = snap && snap.distance < 3 ? "ok" : "warn";
      if (kind === "door") door = { hinge: this.session.ghostHinge, openInward: true, openDeg: 90 };
    } else if (entry.placementType === "tabletop") {
      const table = findParentTable(px, pz, this.state.objects, TABLE_KINDS);
      if (table) { elevation = table.height; validity = "ok"; }
      else { elevation = entry.defaultElevation ?? 0; validity = "bad"; }
    } else {
      const s = applySnap(px, pz, this.state.tile, this.session.snap);
      x = s.x; z = s.z;
      elevation = 0;
      validity = this.insideAny(x, z) ? "ok" : "bad";
    }
    this.session.ghost = {
      kind,
      assetId: entry.id,
      dims,
      x,
      z,
      rotationDeg,
      elevation,
      validity,
      door,
    };
    this.syncScene();
  }

  private confirmPlacement(): void {
    const g = this.session.ghost;
    const kind = this.session.placingKind;
    const entry = this.placingEntry();
    if (!g || !kind || !entry || g.validity === "bad") return;
    const id = uid("obj");
    const obj: SceneObject = {
      id, kind, x: g.x, z: g.z, rotationDeg: g.rotationDeg,
      width: g.dims.width, depth: g.dims.depth, height: g.dims.height,
      locked: false, hidden: false,
      surface: entry.placementType, elevation: g.elevation,
      presetId: this.session.placingPreset ?? undefined,
      assetId: entry.id,
      serviceRole: entry.serviceRole,
    };
    if (entry.placementType === "floor") {
      // A tap near the edge must not leave furniture sticking through a wall
      // (Grok placed a desk at 距牆 −15 cm) — clamp the footprint into the
      // room the tap landed in (classroom by default).
      const rooms = [this.state.classroom, this.state.corridor];
      const room = rooms.find((r) => g.x >= r.x && g.x <= r.x + r.length && g.z >= r.z && g.z <= r.z + r.width)
        ?? this.state.classroom;
      const rad = (g.rotationDeg * Math.PI) / 180;
      const hx = (Math.abs(Math.cos(rad)) * g.dims.width + Math.abs(Math.sin(rad)) * g.dims.depth) / 2;
      const hz = (Math.abs(Math.sin(rad)) * g.dims.width + Math.abs(Math.cos(rad)) * g.dims.depth) / 2;
      obj.x = Math.min(Math.max(g.x, room.x + hx), room.x + Math.max(hx, room.length - hx));
      obj.z = Math.min(Math.max(g.z, room.z + hz), room.z + Math.max(hz, room.width - hz));
    }
    if (entry.placementType === "wall") {
      const snap = nearestWallSnap(g.x, g.z, [this.state.classroom, this.state.corridor], g.dims.width);
      if (snap) obj.wallAnchor = { areaId: snap.areaId, edge: snap.edge, offset: snap.offset };
      if (kind === "door") { obj.hinge = this.session.ghostHinge; obj.openInward = true; obj.openDeg = 90; }
    } else if (entry.placementType === "tabletop") {
      const table = findParentTable(g.x, g.z, this.state.objects, TABLE_KINDS);
      if (table) obj.parentId = table.id;
    }
    this.store.mutate((p) => p.objects.push(obj));
    this.setSelection([id]);
    // Stay in placement mode for continuous placing.
  }

  // --- zones -------------------------------------------------------------

  addZone(type: ZoneType): void {
    const c = this.centerOfClassroom();
    this.addZoneAt(type, c.x, c.z);
  }

  addZoneAt(type: ZoneType, x: number, z: number): void {
    const d = ZONE_DEFAULTS[type];
    const zone: Zone = { id: uid("zone"), type, name: d.label, x, z, width: d.width, depth: d.depth, color: d.color, locked: false, hidden: false, icon: d.icon, capacity: null };
    this.store.mutate((p) => p.zones.push(zone));
    this.setSelection([zone.id]);
    this.toast(`已建立「${d.label}」，拖曳可移動位置`, true);
  }

  /** Arm one canvas tap to drop a zone of the given type where the user taps. */
  beginZonePlacement(type: ZoneType): void {
    this.session.zonePlace = type;
    this.notifyUi();
    this.toast(`點畫面放「${ZONE_DEFAULTS[type].label}」`);
  }

  // --- venue presets & quick start ---------------------------------------

  applyVenuePresetById(id: string): boolean {
    const preset = venuePresetById(id);
    if (!preset) return false;
    this.store.mutate((p) => applyVenuePreset(p, preset, { withFixtures: true }));
    this.recenterView();
    this.toast(`已套用「${preset.name}」（可復原）`, true);
    return true;
  }

  saveCurrentVenuePreset(name: string): boolean {
    const trimmed = name.trim();
    if (!trimmed) {
      this.toast("請先輸入場地名稱");
      return false;
    }
    const preset = venuePresetFromProject(this.state, trimmed);
    const ok = saveUserVenuePreset(preset);
    this.toast(ok ? `已把目前場地存成「${trimmed}」` : "儲存場地失敗（儲存空間可能已滿）");
    return ok;
  }

  /**
   * Take on a project that has just been loaded into the Store.
   *
   * Split in two halves because boot adopts BEFORE `new UI` exists. The frame
   * half depends on `scene.setViewportRects(...)`, which only ever runs from
   * inside `UI`'s viewport subscription — recentering before that frames
   * against unmeasured defaults, with nothing to correct it afterwards.
   */
  adoptProject(project: Project, opts: { frame: boolean; toast?: string }): void {
    // --- state half: always ------------------------------------------------
    // Everything here is derived from the OLD project and would otherwise
    // survive the switch: a selection of ids that no longer exist, a
    // half-placed object, a simulation of somebody else's floor plan.
    this.session.selection = new Set();
    this.cancelPlacement();
    if (this.session.measure) this.stopMeasure();
    if (this.session.calibrate) this.cancelCalibration();
    this.session.agentPreview = null;
    this.session.simResult = null;
    this.session.simPositions = [];
    this.session.simMode = "off";
    this.session.simCompare = null;
    this.session.matCandidates = [];
    this.session.issues = [];
    this.session.focusRouteId = null;

    const scenario = project.activeScenarioId
      ? project.scenarios.find((s) => s.id === project.activeScenarioId)
      : project.scenarios[0];
    if (scenario) {
      const prepaid = scenario.profiles.find((p) => p.id === "prepaid")?.ratio ?? 1;
      const staffOf = (type: string) =>
        scenario.stations.find((st) => st.type === type)?.staffCount;
      this.session.simQuick = {
        ...this.session.simQuick,
        participants: scenario.participantCount,
        arrivalWindowSeconds: scenario.arrivalWindowSeconds,
        prepaidRatio: prepaid,
        hasOnsitePayment: scenario.profiles.some((p) => p.id === "pay-on-site" && p.ratio > 0),
        // The example ships a 2-person check-in desk — the quick panel must
        // not quietly simulate a 1-person understaffed version of it.
        checkinStaff: staffOf("checkin") ?? this.session.simQuick.checkinStaff,
        paymentStaff: staffOf("payment") ?? this.session.simQuick.paymentStaff,
      };
      // One head count everywhere: the mat arranger and the AI read the same
      // number the event was created with.
      this.session.participants = scenario.participantCount;
    }
    this.scene.setView(project.view);

    // --- frame half: interactive opens only --------------------------------
    if (!opts.frame) {
      // Boot restores exactly what the previous session left, including its
      // workflow step. Forcing 場佈 here would change first-launch behaviour
      // for every existing user.
      this.notifyUi();
      return;
    }
    this.setWorkflow("layout");
    // Two flat purple slabs in a shallow isometric view read as nothing on a
    // phone — compact devices open the plan top-down.
    if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 600px)").matches) {
      this.setView("top");
    }
    // Best effort now (correct when the editor is already on screen), and
    // again after the next measurement (correct when it is not).
    this.framePending = true;
    this.recenterView();
    if (opts.toast) this.toast(opts.toast);
    this.notifyUi();
  }

  private framePending = false;

  /**
   * Whether the plan still needs framing against real viewport rects.
   *
   * Opening a project from 我的專案 adopts it while `#scene` and every rail are
   * `display:none`, so `recenterView()` picks its zoom from the Home layout —
   * the plan lands over-zoomed with an edge under the docked rail. `UI` calls
   * this once per measurement and re-frames when it returns true.
   */
  consumePendingFrame(): boolean {
    if (!this.framePending) return false;
    this.framePending = false;
    return true;
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
    this.enterMode("route");
    this.session.activeRouteId = route.id;
    this.setSelection([route.id]);
    this.notifyUi();
  }
  finishRoute(): void { this.session.activeRouteId = null; this.session.mode = "select"; this.notifyUi(); }
  editRoute(id: string): void { this.enterMode("route"); this.session.activeRouteId = id; this.setSelection([id]); this.notifyUi(); }
  updateRoute(id: string, patch: Partial<Route>): void { this.store.mutate((p) => { const r = p.routes.find((x) => x.id === id); if (r) Object.assign(r, patch); }); }

  // --- measure -----------------------------------------------------------

  setMeasureType(t: MeasurementType): void { this.session.measureType = t; this.notifyUi(); }
  startMeasure(type: MeasurementType = "free-distance"): void {
    this.session.measureType = type;
    this.enterMode("measure");
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

  startCalibration(): void { this.enterMode("calibrate"); this.session.calibrate = { a: null, b: null }; this.notifyUi(); }
  cancelCalibration(): void { this.session.mode = "select"; this.session.calibrate = null; this.render(); }
  getCalibrationDistance(): number | null {
    const c = this.session.calibrate;
    if (!c || !c.a || !c.b) return null;
    return Math.hypot(c.b.x - c.a.x, c.b.z - c.a.z);
  }
  applyCalibration(action: CalibrationPath, actualMeters: number, note = ""): void {
    if (!actualMeters || actualMeters <= 0) return;
    const measured = action === "classroom-length" ? this.getCalibrationDistance() ?? undefined : undefined;
    if (action === "classroom-length" && (!measured || measured <= 0)) {
      this.toast("請先在畫布點兩個已知距離的端點，再套用到教室長");
      return;
    }
    this.store.mutate((p) => applyCalibrationPath(p, action, actualMeters, measured, note));
    // Concrete numbers in the toast — a 60→58 cm tile change is invisible on
    // screen, so say exactly what the model now believes.
    const cm = Math.round(actualMeters * 100);
    const after = this.state;
    const msg =
      action === "tile" ? `地磚已設為 ${cm}×${cm} cm（可復原）`
      : action === "door" ? `門寬已設為 ${cm} cm（可復原）`
      : action === "classroom-length"
        ? `教室已修正為 ${after.classroom.length.toFixed(1)}×${after.classroom.width.toFixed(1)} m（可復原）`
        : "已記錄量測（尚未套用到圖上）";
    this.toast(msg, action !== "record");
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

  // --- partner mode ------------------------------------------------------

  /**
   * Enter the visual-first partner view. Nothing about the plan changes — the
   * editor state is left exactly as it was so leaving returns you to your work.
   */
  enterPartnerMode(role: PartnerRole = "all"): void {
    this.partnerReturnView = this.state.view;
    this.session.partner = { role, timeline: [], suggestion: null, busy: false };
    this.session.selection = new Set();
    this.cancelPlacement();
    if (this.session.mode === "measure") this.stopMeasure();
    if (this.session.mode === "calibrate") this.cancelCalibration();
    this.runValidation();
    this.setView("top");
    this.render();
    // Framing is left to the UI: the partner chrome has not been laid out yet,
    // so fitting here would frame the plan against the editor's rect.
  }

  exitPartnerMode(): void {
    if (this.session.partner?.suggestion) this.dismissPartnerSuggestion();
    const restoreView = this.partnerReturnView;
    this.partnerReturnView = null;
    this.session.partner = null;
    if (restoreView) this.setView(restoreView);
    this.render();
  }

  setPartnerRole(role: PartnerRole): void {
    if (!this.session.partner) return;
    this.session.partner.role = role;
    this.render();
  }

  /** Emphasis + marks the scene needs to render the partner view. */
  private partnerView(): { role: PartnerRole; emphasis: PartnerEmphasis; marks: PartnerMark[] } | null {
    const p = this.session.partner;
    if (!p) return null;
    return {
      role: p.role,
      emphasis: partnerEmphasis(this.viewState, p.role),
      marks: partnerMarks(this.session.issues),
    };
  }

  partnerBriefing(): RoleBriefing {
    const role = this.session.partner?.role ?? "all";
    return buildRoleBriefing(this.state, role, this.activeScenario());
  }

  partnerMarks(): PartnerMark[] {
    return partnerMarks(this.session.issues);
  }

  partnerStatus(): { tone: "bad" | "warn" | "ok"; text: string } {
    return partnerStatus(this.partnerMarks());
  }

  /** Run the rehearsal and turn it into wall-clock sentences. */
  runRehearsal(): RehearsalEvent[] {
    const result = this.runEventSimulation();
    const timeline = buildRehearsalTimeline(result);
    if (this.session.partner) this.session.partner.timeline = timeline;
    this.notifyUi();
    return timeline;
  }

  /** Simulate a plan without touching the store — used for the "after" side. */
  private simulatePlan(project: Project): SimulationResult {
    const existing =
      (project.activeScenarioId && project.scenarios?.find((s) => s.id === project.activeScenarioId)) ||
      project.scenarios?.[0] ||
      null;
    const q = this.session.simQuick;
    const baseScenario: EventScenario = existing
      ? { ...existing, participantCount: q.participants, arrivalWindowSeconds: q.arrivalWindowSeconds, arrivalProfile: q.arrivalProfile }
      : createDefaultScenario(project, { participantCount: q.participants });
    const scenario = resolveScenarioBindings(project, baseScenario);
    return runDiscreteEvent(scenario, { sampleDt: 2 });
  }

  /**
   * Ask the agent to improve the layout and express the answer as a visual
   * before/after with numbers a partner already understands. The plan is not
   * modified until the suggestion is accepted.
   */
  async requestPartnerSuggestion(): Promise<PartnerSuggestion | null> {
    const p = this.session.partner;
    if (!p) return null;
    p.busy = true;
    this.notifyUi();
    try {
      // Ask for the two improvements the agent already knows how to make:
      // keep the doorway clear, and split check-in from payment.
      const result = await this.quickAgent.run({
        text: "幫我改善，把報到和收費分開，入口旁邊留 1 公尺不要擋門",
      });
      const draft = this.quickAgent.getDraftProject();
      if (!draft || !planDiffers(this.state, draft)) {
        this.dismissPartnerSuggestion();
        p.suggestion = null;
        this.toast("目前的排法已經夠順，沒有需要改的地方");
        return null;
      }
      const before = plainMetrics(this.simulatePlan(this.state));
      const after = plainMetrics(this.simulatePlan(draft));
      const suggestion: PartnerSuggestion = {
        message: result.response.message,
        before,
        after,
        comparison: comparePlainMetrics(before, after),
        afterProject: draft,
      };
      p.suggestion = suggestion;
      return suggestion;
    } catch {
      this.toast("AI 暫時無法給建議，稍後再試");
      return null;
    } finally {
      p.busy = false;
      this.notifyUi();
    }
  }

  applyPartnerSuggestion(): void {
    if (!this.session.partner?.suggestion) return;
    if (this.quickAgent.isPreviewActive()) this.quickAgent.commit();
    this.session.partner.suggestion = null;
    this.session.agentPreview = null;
    this.runValidation();
    this.toast("已套用建議方案（可復原）", true);
    this.render();
  }

  dismissPartnerSuggestion(): void {
    if (this.quickAgent.isPreviewActive()) this.quickAgent.rollback();
    this.session.agentPreview = null;
    if (this.session.partner) this.session.partner.suggestion = null;
    this.render();
  }
  setSimplify(on: boolean): void { this.session.simplify = on; this.render(); }

  /** Current look: "light" (default) or "dark". */
  get theme(): ThemeName { return this.scene.getTheme(); }

  toggleTheme(): void { this.applyTheme(otherTheme(this.theme), true); }

  private applyTheme(theme: ThemeName, persist: boolean): void {
    applyThemeToDocument(theme);
    this.scene.setTheme(theme);
    if (persist) saveTheme(theme);
    this.render();
  }

  setRouteFocus(id: string | null): void {
    this.session.focusRouteId = id;
    if (id) {
      const r = this.state.routes.find((x) => x.id === id);
      if (r && r.points.length >= 2) {
        const b = boundsOfPoints(r.points);
        this.scene.fitBounds({
          minX: b.minX - 1, maxX: b.maxX + 1,
          minZ: b.minZ - 1, maxZ: b.maxZ + 1,
        }, { padding: 0.86 });
      }
    }
    this.render();
  }
  updateDescription(text: string): void { this.store.mutate((p) => (p.description = text), { history: false }); }
  updateZoneCapacity(capacity: number | null): void { this.updateSelectedZone({ capacity }); }

  // --- route presets + zone links ---------------------------------------

  newRoutePreset(type: RouteType): void {
    const pre = routePreset(type);
    const route: Route = { id: uid("route"), name: pre.label, color: pre.color, points: [], visible: true, type };
    this.store.mutate((p) => p.routes.push(route));
    this.enterMode("route");
    this.session.activeRouteId = route.id;
    this.setSelection([route.id]);
    this.notifyUi();
  }

  // --- smart layout (participant-driven mats) ---------------------------

  computeMatCandidates(participants: number, opts?: { centralAisleWidth?: number; matWidth?: number; matDepth?: number; gap?: number; mode?: "individual" | "field" }): LayoutCandidate[] {
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
      mode: opts?.mode ?? (this.state.venuePresetId === "venue:tku-classroom" || this.state.venuePresetId === "venue:tku-e310" ? "field" : "individual"),
    });
    this.notifyUi();
    return this.session.matCandidates;
  }

  applyMatCandidate(id: string): void {
    const cand = this.session.matCandidates.find((c) => c.id === id);
    if (!cand) return;
    const newIds: string[] = [];
    let replaced = 0;
    this.store.mutate((p) => {
      replaced = p.groups.filter((g) => g.sourceKind === "mat").length;
      p.groups = p.groups.filter((g) => g.sourceKind !== "mat");
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
    this.toast(
      replaced
        ? `已取代原有 ${replaced} 組地墊，可按「復原」回到上一版`
        : (cand.mode === "field" ? `已套用巧拼座區（可坐 ${cand.count} 人）` : `已套用 ${cand.count} 張地墊`),
      true,
    );
    if (newIds.length) this.setSelection(newIds);
  }

  // --- traffic / event-flow simulation ----------------------------------

  activeScenario(): EventScenario | null {
    const p = this.state;
    if (!p.scenarios?.length) return null;
    return (
      (p.activeScenarioId && p.scenarios.find((s) => s.id === p.activeScenarioId)) ||
      p.scenarios[0] ||
      null
    );
  }

  updateSimQuick(patch: Partial<Session["simQuick"]>): void {
    Object.assign(this.session.simQuick, patch);
    this.notifyUi();
  }

  /** Build or refresh the active scenario from Quick Setup + current layout. */
  ensureEventScenario(forceRebuild = false): EventScenario {
    const q = this.session.simQuick;
    const existing = this.activeScenario();
    if (existing && !forceRebuild) {
      this.store.mutate((p) => {
        p.scenarios = p.scenarios.map((s) => {
          if (s.id !== existing.id) return s;
          const stations = s.stations.map((st) => {
            if (st.type === "checkin") {
              return { ...st, staffCount: q.checkinStaff, parallelServers: q.checkinStaff };
            }
            if (st.type === "payment") {
              return {
                ...st,
                staffCount: q.hasOnsitePayment ? q.paymentStaff : 0,
                parallelServers: q.hasOnsitePayment ? q.paymentStaff : 0,
              };
            }
            return st;
          });
          const prepaid = Math.max(0, Math.min(1, q.prepaidRatio));
          const onsite = q.hasOnsitePayment ? 1 - prepaid : 0;
          const prepaidBranch = s.profiles.find((pr) => pr.id === "prepaid")?.branch
            ?? s.stations.filter((st) => st.type !== "payment").map((st) => st.id);
          const fullBranch = s.profiles.find((pr) => pr.id === "pay-on-site")?.branch
            ?? s.stations.map((st) => st.id);
          const profiles = q.hasOnsitePayment
            ? [
                { id: "prepaid" as const, ratio: prepaid, branch: prepaidBranch },
                { id: "pay-on-site" as const, ratio: onsite, branch: fullBranch },
              ]
            : [{ id: "prepaid" as const, ratio: 1, branch: prepaidBranch }];
          return resolveScenarioBindings(p, {
            ...s,
            participantCount: q.participants,
            arrivalWindowSeconds: q.arrivalWindowSeconds,
            arrivalProfile: q.arrivalProfile,
            stations,
            profiles,
          });
        });
      });
      return this.activeScenario()!;
    }

    let scn = createDefaultScenario(this.state, {
      participantCount: q.participants,
      name: "進場流程",
    });
    scn = resolveScenarioBindings(this.state, {
      ...scn,
      arrivalWindowSeconds: q.arrivalWindowSeconds,
      arrivalProfile: q.arrivalProfile,
      stations: scn.stations.map((st) => {
        if (st.type === "checkin") {
          return { ...st, staffCount: q.checkinStaff, parallelServers: q.checkinStaff };
        }
        if (st.type === "payment") {
          return {
            ...st,
            staffCount: q.hasOnsitePayment ? q.paymentStaff : 0,
            parallelServers: q.hasOnsitePayment ? q.paymentStaff : 0,
          };
        }
        return st;
      }),
    });
    const prepaid = Math.max(0, Math.min(1, q.prepaidRatio));
    const paymentId = scn.stations.find((s) => s.type === "payment")?.id;
    const prepaidBranch = scn.stations.filter((s) => s.type !== "payment").map((s) => s.id);
    const fullBranch = scn.stations.map((s) => s.id);
    scn.profiles = q.hasOnsitePayment
      ? [
          { id: "prepaid", ratio: prepaid, branch: prepaidBranch },
          { id: "pay-on-site", ratio: 1 - prepaid, branch: fullBranch },
        ]
      : [{ id: "prepaid", ratio: 1, branch: prepaidBranch }];
    if (!q.hasOnsitePayment && paymentId) {
      scn.stations = scn.stations.map((s) =>
        s.id === paymentId ? { ...s, staffCount: 0, parallelServers: 0 } : s,
      );
    }

    this.store.mutate((p) => {
      p.scenarios = [scn, ...p.scenarios.filter((s) => s.id !== scn.id)];
      p.activeScenarioId = scn.id;
    });
    return scn;
  }

  runEventSimulation(): SimulationResult {
    const scn = this.ensureEventScenario(false);
    const result = runDiscreteEvent(scn, { sampleDt: 1 });
    this.session.simResult = result;
    this.session.simCompare = null;
    this.notifyUi();
    return result;
  }

  compareCheckinPayment(): ScenarioVariantCompareResult {
    const scn = this.ensureEventScenario(false);
    const { combined, separated, corridor } = buildCheckinPaymentVariants(scn);
    const a = runScenarioMedian(combined, { sampleDt: 2 });
    const b = runScenarioMedian(separated, { sampleDt: 2 });
    const c = runScenarioMedian(corridor ?? separated, { sampleDt: 2 });
    const cmp = compareScenarioVariants(a, b, c);
    this.session.simCompare = cmp;
    this.notifyUi();
    return cmp;
  }

  startSimulation(params?: Partial<SimParams>): void {
    // Prefer DES when we can build a scenario; else fall back to route-walk.
    const scn = this.ensureEventScenario(false);
    if (scn.stations.length >= 2) {
      this.startEventPlayback();
      return;
    }
    this.startRouteWalk(params);
  }

  startEventPlayback(): void {
    // ▶ 模擬 shows the numbers immediately; the animated walk-through is the
    // separate opt-in ▶ 播放走位 (replaySimulation).
    const result = this.runEventSimulation();
    this.stopSimLoopOnly();
    this.session.simMode = "event-flow";
    this.session.simPlaying = false;
    this.session.simPaused = false;
    this.session.simTime = result.finishTimeSeconds;
    this.session.simPositions = [];
    this.session.bottlenecks = [];
    this.notifyUi();
  }

  /** Replay the already computed frames without running the engine again. */
  replaySimulation(): void {
    const result = this.session.simResult;
    if (!result) return;
    // Whole-event replay in about 45 s of wall time regardless of length.
    this.session.simSpeed = Math.max(1, result.finishTimeSeconds / 45);
    this.playEventResult(result);
  }

  private playEventResult(result: SimulationResult): void {
    this.stopSimLoopOnly();
    this.session.simMode = "event-flow";
    this.focusSimulation();
    this.session.simPlaying = true;
    this.session.simPaused = false;
    this.session.simTime = 0;
    this.applyDesFrame(0, result);
    this.simLast = performance.now();
    this.notifyUi();
    this.simLoop();
  }

  startRouteWalk(params?: Partial<SimParams>): void {
    const p: SimParams = {
      countPerRoute: params?.countPerRoute ?? 8,
      speed: params?.speed ?? 1.2,
      spacing: params?.spacing ?? 1.0,
    };
    const routes = this.state.routes.filter((r) => r.visible && r.points.length >= 2);
    if (routes.length === 0) {
      this.toast("尚無可模擬的動線，請先建立活動流程或動線");
      return;
    }
    this.stopSimLoopOnly();
    this.simState = initSimulation(routes, p);
    this.session.simMode = "route-walk";
    this.focusSimulation();
    this.session.simPlaying = true;
    this.session.simPaused = false;
    this.session.simResult = null;
    this.simLast = performance.now();
    this.notifyUi();
    this.simLoop();
  }

  pauseSimulation(paused = !this.session.simPaused): void {
    this.session.simPaused = paused;
    this.simLast = performance.now();
    this.notifyUi();
    if (!paused && this.session.simPlaying) this.simLoop();
  }

  setSimSpeed(speed: number): void {
    // Replays compress an hour-long event into tens of seconds, so the cap is
    // generous; the floor still guards against a frozen-looking playback.
    this.session.simSpeed = Math.max(0.5, Math.min(600, speed));
    this.notifyUi();
  }

  restartSimulation(): void {
    if (this.session.simMode === "event-flow") this.startEventPlayback();
    else if (this.session.simMode === "route-walk") this.startRouteWalk();
    else this.startSimulation();
  }

  stopSimulation(): void {
    this.stopSimLoopOnly();
    this.session.simPlaying = false;
    this.session.simPaused = false;
    this.session.simMode = "off";
    this.session.simPositions = [];
    this.session.bottlenecks = [];
    this.session.simQueues = {};
    this.session.simTime = 0;
    this.simState = null;
    this.render();
  }

  private stopSimLoopOnly(): void {
    if (this.simRaf !== null) {
      cancelAnimationFrame(this.simRaf);
      this.simRaf = null;
    }
  }

  private applyDesFrame(t: number, result: SimulationResult): void {
    const frame = frameAt(result, t);
    if (!frame) return;
    // Track the CONTINUOUS clock, not the sampled frame time — assigning
    // frame.t floored progress back to the sample grid, which pinned the
    // playback at 0 s forever (dt per tick < sampleDt).
    this.session.simTime = t;
    this.session.simQueues = frame.queues;
    this.session.simPositions = frame.agents
      .filter((a) => a.state !== "pending" && a.state !== "done")
      // id travels with the position so the crowd can keep each figure facing
      // the way it is walking between frames.
      .map((a) => ({ id: a.id, x: a.x, z: a.z, state: a.state }));
    this.session.bottlenecks = result.stations
      .filter((s) => (frame.queues[s.stationId] ?? 0) >= 3)
      .map((s) => {
        const st = this.activeScenario()?.stations.find((x) => x.id === s.stationId);
        return {
          x: st?.x ?? 0,
          z: st?.z ?? 0,
          count: frame.queues[s.stationId] ?? s.maxQueue,
        };
      })
      .concat(result.spatialBottlenecks.map((bottleneck) => ({
        x: bottleneck.x,
        z: bottleneck.z,
        count: bottleneck.count,
        name: bottleneck.name,
        kind: bottleneck.kind,
      })));
    this.syncScene();
  }

  private simLoop(): void {
    if (!this.session.simPlaying || this.session.simPaused) return;
    const now = performance.now();
    // Cap a single tick at ~a quarter second of wall time so hitches don't
    // teleport agents, while still letting high replay speeds progress.
    const dt = Math.min(Math.max(0.1, 0.25 * this.session.simSpeed), ((now - this.simLast) / 1000) * this.session.simSpeed);
    this.simLast = now;

    if (this.session.simMode === "event-flow" && this.session.simResult) {
      const result = this.session.simResult;
      const nextT = this.session.simTime + dt;
      if (nextT >= result.finishTimeSeconds) {
        // Replay finished — hand the screen back to the results readout.
        this.stopSimLoopOnly();
        this.session.simPlaying = false;
        this.session.simPaused = false;
        this.session.simTime = result.finishTimeSeconds;
        this.session.simPositions = [];
        this.session.bottlenecks = [];
        this.notifyUi();
        return;
      }
      this.applyDesFrame(nextT, result);
      // The scene animates every frame; the side panel only needs a few
      // updates a second (it was frozen at 0 s / 0 人 before this).
      if (now - this.lastPanelSync > 200) {
        this.lastPanelSync = now;
        this.notifyUi();
      }
      this.simRaf = requestAnimationFrame(() => this.simLoop());
      return;
    }

    if (!this.simState) return;
    const routes = this.state.routes.filter((r) => r.visible && r.points.length >= 2);
    this.simState = stepSimulation(this.simState, routes, dt);
    this.session.simPositions = agentPositions(this.simState, routes);
    this.session.bottlenecks = detectBottlenecks(this.session.simPositions, 1.2, 4);
    this.syncScene();
    if (simulationDone(this.simState, routes)) {
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
    this.store.mutate((p) => applyCalibrationPath(p, "tile", actualMeters));
  }

  applyCalibrationToDoor(actualMeters: number): void {
    this.store.mutate((p) => applyCalibrationPath(p, "door", actualMeters));
  }

  // --- validation --------------------------------------------------------

  runValidation(): Issue[] { this.session.issues = validateProject(this.state); this.notifyUi(); return this.session.issues; }
  focusIssue(issue: Issue): void {
    if (issue.targetId) this.session.selection = new Set([issue.targetId]);
    this.scene.focusOn(issue.focus.x, issue.focus.z);
    this.render();
  }

  // --- camera focus ------------------------------------------------------

  /** World centre of any selectable entity, or null when it no longer exists. */
  entityCenter(id: string): { x: number; z: number } | null {
    const o = this.state.objects.find((x) => x.id === id);
    if (o) return { x: o.x, z: o.z };
    const z = this.state.zones.find((x) => x.id === id);
    if (z) return { x: z.x, z: z.z };
    const g = this.state.groups.find((x) => x.id === id);
    if (g) return groupCenter(g);
    const r = this.state.routes.find((x) => x.id === id);
    if (r && r.points.length) {
      const b = boundsOfPoints(r.points);
      return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
    }
    return null;
  }

  /** Bring an entity to the centre of the visible canvas without changing zoom. */
  focusObject(id: string): void {
    const c = this.entityCenter(id);
    if (c) this.scene.focusOn(c.x, c.z);
  }

  /**
   * Frame whatever the simulation is about to animate inside the visible
   * canvas: the scenario stations for event-flow playback, otherwise the
   * simulated routes.
   */
  focusSimulation(): void {
    const points: { x: number; z: number }[] = [];
    const scn = this.activeScenario();
    if (this.session.simMode !== "route-walk" && scn) {
      for (const st of scn.stations) points.push({ x: st.x, z: st.z });
    }
    if (points.length < 2) {
      for (const r of this.state.routes) if (r.visible) points.push(...r.points);
    }
    if (points.length < 2) { this.scene.recenterView(this.state); return; }
    const b = boundsOfPoints(points);
    this.scene.fitBounds({
      minX: b.minX - 1.5, maxX: b.maxX + 1.5,
      minZ: b.minZ - 1.5, maxZ: b.maxZ + 1.5,
    }, { padding: 0.86 });
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
    // A cancelled pointer (system gesture, palm rejection, tab switch) must
    // roll the drag back, not commit a half-finished move.
    window.addEventListener("pointercancel", (e) => {
      this.pointers.delete(e.pointerId);
      this.abortDrag();
      this.scene.setControlsEnabled(true);
      this.render();
    });
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

    // Partner Mode is read-only: a volunteer looking at the plan must not be
    // able to select or drag the furniture. Camera gestures still work.
    if (this.session.partner) { this.scene.setControlsEnabled(true); return; }

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

    if (this.session.zonePlace && ground) {
      const type = this.session.zonePlace;
      this.session.zonePlace = null;
      const snapped = applySnap(ground.x, ground.z, this.state.tile, this.session.snap);
      this.addZoneAt(type, snapped.x, snapped.z);
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
      // On touch, lift the ghost above the finger so it (and its snap/legality)
      // stays visible — then clamp it into the visible canvas rect so the lift
      // can never park the preview under the header or a bottom sheet.
      const gy = e.pointerType === "touch" ? e.clientY - TOUCH_GHOST_OFFSET_PX : e.clientY;
      const pt = e.pointerType === "touch"
        ? this.scene.clampClientToVisible(e.clientX, gy)
        : { x: e.clientX, y: gy };
      const ground = this.scene.groundPoint(pt.x, pt.y);
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
