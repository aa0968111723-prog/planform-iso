import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Color,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MOUSE,
  Object3D,
  OrthographicCamera,
  Plane,
  PlaneGeometry,
  Quaternion,
  PCFShadowMap,
  Raycaster,
  Scene,
  Sprite,
  SpriteMaterial,
  TOUCH,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { AssetCatalog } from "../core/catalog";
import { catalogFromProject } from "../core/migrate";
import { isBoothProject } from "../core/boothCatalog";
import { calibrationComplete, venueNeedsCalibration } from "../core/model";
import type { LabelDisplayMode, ObjectKind, Project, SceneObject, ViewName, Zone } from "../core/model";
import { groupCenter, groupMembers } from "../core/arrays";
import { doorSweep } from "../core/placement";
import { buildMergedGeometry, assetInstanceMaterial } from "./assets";
import { applyRendererLook, installStudioLighting } from "./lighting";
import { SimCrowd } from "./crowd";
import { DEFAULT_THEME, EXPORT_PALETTE, MAT_COLORS, MAT_SURFACE_VARIATION, scenePalette, type ScenePalette, type ThemeName } from "../core/theme";
import { TextLabel } from "./label";
import { resolveVisualGroup } from "./visualRegistry";
import { clampPointToRect, rectCenterNdc, type Rect } from "../core/viewport";
import {
  declutterScreenLabels,
  type LabelPriority,
  type ScreenLabelCandidate,
  type ScreenRect,
} from "./labelLayout";
import {
  buildPropGroupCached,
  clearPartResult,
  diceRollQuaternion,
  paintPartResult,
  settleQuaternionFor,
} from "./propVisual";
import { propFaceOptions, propForAssetId } from "../core/propCatalog";
import type { PlaybackStationResult } from "../core/eventFlow";
import type { PartnerEmphasis, PartnerMark, PartnerRole } from "../core/partner";

const D2R = Math.PI / 180;
const SELECT = "#38bdf8";

export interface GhostState {
  kind: ObjectKind;
  assetId?: string;
  dims: { width: number; depth: number; height: number };
  x: number;
  z: number;
  rotationDeg: number;
  elevation: number;
  validity: "ok" | "warn" | "bad";
  door?: { hinge?: "left" | "right"; openInward?: boolean; openDeg?: number };
}

export interface PropPlaybackView {
  /** Continuous rehearsal clock, seconds. */
  t: number;
  results: Record<string, PlaybackStationResult>;
  /** Placed object id → the station bound to it. */
  stationOfObject: Record<string, string>;
}

export interface PickResult {
  type: "object" | "group" | "zone" | "routeNode";
  id: string;
  index?: number;
}

interface SessionView {
  selection: Set<string>;
  ghost: GhostState | null;
  measure: { a: { x: number; z: number } | null; b: { x: number; z: number } | null } | null;
  calibrate: { a: { x: number; z: number } | null; b: { x: number; z: number } | null } | null;
  showLabels: boolean;
  showObjectLabels?: boolean;
  labelDisplayMode?: LabelDisplayMode;
  /** The table currently being edited at detail scale, if any. */
  tabletopHostId?: string | null;
  focusRouteId?: string | null;
  simplify?: boolean;
  simPositions?: { id?: number; x: number; z: number; routeId?: string; state?: string }[];
  bottlenecks?: { x: number; z: number; count: number; name?: string; kind?: "door" | "corridor" | "route" }[];
  simQueues?: Record<string, number>;
  simStations?: { id: string; name: string; x: number; z: number; queue: number }[];
  /** Playback draws a station badge per stop; route names on top are soup. */
  hideRouteLabels?: boolean;
  /**
   * Latest rolled result per station while a rehearsal plays — the feed for
   * §25 (dice settling) and §31 (screens showing a result). Null when the
   * crowd is off; the scene then puts every prop back to rest.
   */
  propPlayback?: PropPlaybackView | null;
  /** Non-null in Partner Mode: emphasis per entity plus red/orange/green marks. */
  partner?: PartnerPresentation | null;
  /**
   * §58/§59 — the four places people stand around a selected prop, in WORLD
   * coordinates. Drawn on the plan so 「移動整組之後站位有沒有跟著走」 is a
   * thing you can look at rather than infer: the readouts are phrased relative
   * to the prop, so they read identically before and after a move.
   */
  propAnchors?: { role: string; label: string; x: number; z: number }[];
}

/** How the scene should present a plan to a partner rather than an editor. */
export interface PartnerPresentation {
  role: PartnerRole;
  emphasis: PartnerEmphasis;
  marks: PartnerMark[];
}

/** Same language as the §85 sentences: your post, the visitor, the queue, the way out. */
const ANCHOR_COLOR: Record<string, number> = {
  staff: 0x38bdf8,
  player: 0x22c55e,
  queue: 0xf59e0b,
  exit: 0xa78bfa,
};
const ANCHOR_TEXT: Record<string, string> = {
  staff: "#bae6fd",
  player: "#bbf7d0",
  queue: "#fde68a",
  exit: "#ddd6fe",
};

const MARK_COLOR: Record<PartnerMark["tone"], string> = {
  bad: "#ef4444",
  warn: "#f59e0b",
  ok: "#22c55e",
};

/** Ground colours for an outdoor booth: grass under the pitch, paving alongside. */
const OUTDOOR_GROUND: Record<ThemeName, { pitch: number; paving: number }> = {
  light: { pitch: 0xb9c7a8, paving: 0xc3cad2 },
  dark: { pitch: 0x33402f, paving: 0x2a3340 },
};

const SIMPLIFY_HIDE: ReadonlySet<ObjectKind> = new Set<ObjectKind>(["switch", "computer"]);

const LANDMARKS: ReadonlySet<ObjectKind> = new Set<ObjectKind>(["door", "screen", "switch", "regTable", "computer"]);

export class SceneManager {
  private renderer: WebGLRenderer;
  private scene: Scene;
  private camera: OrthographicCamera;
  private controls: OrbitControls;
  private raycaster = new Raycaster();
  private target = new Vector3();
  /**
   * World metres per CSS pixel at zoom 1. Kept independent of any rect so that
   * chrome appearing or disappearing re-anchors the camera without ever
   * rescaling the plan under the user's hands.
   */
  private worldPerPx = 0.024;
  /**
   * The workspace viewport. `safe` excludes permanent chrome and drives the
   * (deliberately asymmetric) projection; `focus` additionally excludes
   * transient sheets and drives fit / focus targeting. Null until the UI has
   * measured, in which case the whole canvas is assumed visible.
   */
  private viewport: { canvas: Rect; safe: Rect; focus: Rect } | null = null;
  /** Bounds of the last automatic fit, replayed when the visible rect changes. */
  private lastFitBounds: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;
  /** Set once the user pans/zooms/orbits — after that we never re-fit for them. */
  private userAdjustedCamera = false;

  private floorGroup = new Group();
  private tileGroup = new Group();
  private zoneGroup = new Group();
  private objectGroup = new Group();
  private arrayGroupRoot = new Group();
  private routeGroup = new Group();
  private ghostGroup = new Group();
  private measureGroup = new Group(); // persistent dimension lines
  private overlayGroup = new Group(); // selection + live measure/calibrate
  /** Simulation participants — persistent instanced figures, not per-frame meshes. */
  private crowd = new SimCrowd();
  private theme: ThemeName = DEFAULT_THEME;
  private palette: ScenePalette = scenePalette(DEFAULT_THEME);
  private partnerGroup = new Group(); // partner-mode marks (never in editor mode)

  private objectNodes = new Map<string, { group: Group; label: TextLabel | null; sig: string }>();
  private anchorLabels = new Map<string, TextLabel>();
  private stationLabels = new Map<string, TextLabel>();
  private bottleneckLabels = new Map<string, TextLabel>();
  private arrayNodes = new Map<string, { mesh: InstancedMesh; overlay: Group; sig: string }>();
  private zoneNodes = new Map<string, { group: Group; label: TextLabel; sig: string }>();
  private routeNodes = new Map<string, { group: Group; label: TextLabel; sig: string }>();
  private measureNodes = new Map<string, { group: Group; label: TextLabel; sig: string }>();
  private routeNodeMeshes: Mesh[] = [];
  private liveLabel: TextLabel | null = null;

  private layersState = { areas: true, zones: true, objects: true, tiles: true, routes: true };
  private lastAreaSig = "";
  private lastGhostSig = "";

  private catalog: AssetCatalog = new AssetCatalog();
  /** Roof fading is visual-only; collision and validation stay unchanged. */
  private currentProjectIsBooth = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    applyRendererLook(this.renderer);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;

    this.scene = new Scene();
    this.scene.background = new Color(this.palette.background);
    this.scene.add(
      this.floorGroup, this.tileGroup, this.zoneGroup, this.objectGroup,
      this.arrayGroupRoot, this.routeGroup, this.ghostGroup, this.measureGroup, this.overlayGroup,
      this.crowd.group,
      this.partnerGroup,
    );

    this.camera = new OrthographicCamera();
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.addEventListener("start", () => { this.userAdjustedCamera = true; });

    installStudioLighting(this.scene);

    this.worldPerPx = 18 / Math.max(canvas.clientHeight || window.innerHeight || 800, 1);
    this.setView("iso");
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  /** The projection surface — the workspace viewport measures against it. */
  get domElement(): HTMLCanvasElement {
    return this.canvas;
  }

  // --- camera ------------------------------------------------------------

  setView(view: ViewName): void {
    this.currentView = view;
    this.applyRoofVisibility();
    // Whatever sat at the centre of the *visible* canvas should still be there
    // after the camera swings around; the framing offset differs per basis.
    const anchor = this.getFocusAnchor();
    const d = 60;
    const t = this.target;
    switch (view) {
      // A slightly elevated isometric angle keeps the plan readable while the
      // stage, desks and classroom chairs still show their real volume.
      case "iso": this.camera.position.set(t.x + d, d * 1.32, t.z + d * 0.92); this.controls.enableRotate = true; break;
      case "top": this.camera.position.set(t.x, d, t.z + 0.001); this.controls.enableRotate = false; break;
      case "front": this.camera.position.set(t.x, 4, t.z + d); this.controls.enableRotate = true; break;
      case "left": this.camera.position.set(t.x - d, 4, t.z); this.controls.enableRotate = true; break;
      case "right": this.camera.position.set(t.x + d, 4, t.z); this.controls.enableRotate = true; break;
    }
    // With rotate disabled (俯視) a one-finger drag on empty canvas would map
    // to the dead ROTATE gesture — remap it to PAN so the plan can be moved
    // with one finger. Rotating views keep the Three.js defaults.
    if (this.controls.enableRotate) {
      this.controls.touches.ONE = TOUCH.ROTATE;
      this.controls.mouseButtons.LEFT = MOUSE.ROTATE;
    } else {
      this.controls.touches.ONE = TOUCH.PAN;
      this.controls.mouseButtons.LEFT = MOUSE.PAN;
    }
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(t);
    this.controls.target.copy(t);
    this.controls.update();
    this.setFocusAnchor(anchor);
  }

  setControlsEnabled(enabled: boolean): void {
    this.controls.enabled = enabled;
  }

  /** Exact editor zoom for tabletop work; percentages map to camera.zoom. */
  setZoomPercent(percent: number): void {
    this.camera.zoom = Math.max(0.25, Math.min(4, percent / 100));
    this.userAdjustedCamera = true;
    this.applyProjection();
  }

  zoomPercent(): number {
    return Math.round((this.camera.zoom || 1) * 100);
  }

  private currentView: ViewName = "iso";

  /**
   * A top view is a floor plan: a tent canopy has to come off, or the table
   * and stools underneath it are neither visible nor selectable. Hidden meshes
   * are also skipped by the raycast, so this fixes picking as well as drawing.
   */
  private applyRoofVisibility(): void {
    const hide = this.currentView === "top";
    const fade = this.currentProjectIsBooth && this.currentView === "iso";
    this.objectGroup.traverse((m) => {
      if (!(m instanceof Mesh) || !m.userData.roof) return;
      m.visible = !hide;
      const materials = Array.isArray(m.material) ? m.material : [m.material];
      for (const material of materials) {
        if (!(material instanceof MeshStandardMaterial)) continue;
        if (m.userData.roofBaseOpacity === undefined) m.userData.roofBaseOpacity = material.opacity;
        material.transparent = fade;
        material.opacity = fade ? Math.min(0.36, m.userData.roofBaseOpacity as number) : m.userData.roofBaseOpacity as number;
        material.depthWrite = !fade;
        material.needsUpdate = true;
      }
    });
  }

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.applyProjection();
  }

  // --- workspace viewport (CanvasSafeRect) --------------------------------

  /** Canvas width in CSS pixels — the workspace breakpoint reads this. */
  canvasWidth(): number {
    return this.canvasSize().w;
  }

  /** Canvas size in CSS pixels, with a sane fallback before first layout. */
  private canvasSize(): { w: number; h: number } {
    return {
      w: this.canvas.clientWidth || window.innerWidth || 1,
      h: this.canvas.clientHeight || window.innerHeight || 1,
    };
  }

  /** Safe / focus rects in canvas-local pixels, defaulting to the whole canvas. */
  private rects(): { canvas: Rect; safe: Rect; focus: Rect } {
    const { w, h } = this.canvasSize();
    const full: Rect = { x: 0, y: 0, width: w, height: h };
    const v = this.viewport;
    if (!v) return { canvas: full, safe: full, focus: full };
    const toLocal = (r: Rect): Rect => ({
      x: r.x - v.canvas.x,
      y: r.y - v.canvas.y,
      width: r.width,
      height: r.height,
    });
    return { canvas: full, safe: toLocal(v.safe), focus: toLocal(v.focus) };
  }

  /**
   * Tell the scene which part of the canvas the user can actually see.
   * The projection re-anchors on the safe rect, and the point that was at the
   * centre of the visible area stays there, so a layout change never yanks the
   * plan sideways.
   */
  setViewportRects(canvas: Rect, safe: Rect, focus: Rect): void {
    const prev = this.viewport;
    // A different *canvas* means the window itself changed (rotation, resize,
    // breakpoint): re-fit while the camera is still ours. Chrome coming and
    // going only re-anchors, so opening a sheet slides the plan up into the
    // strip that is left instead of zooming it out.
    const canvasResized =
      !prev || Math.abs(prev.canvas.width - canvas.width) > 1 || Math.abs(prev.canvas.height - canvas.height) > 1;
    const anchor = prev ? this.getFocusAnchor(this.rects().safe) : null;
    this.viewport = { canvas, safe, focus };
    this.applyProjection();
    if (canvasResized && !this.userAdjustedCamera && this.lastFitBounds) {
      this.fitBounds(this.lastFitBounds);
      return;
    }
    if (anchor) this.setFocusAnchor(anchor, this.rects().safe);
  }

  /** Current visible-canvas rect in canvas-local pixels (debug / tests). */
  getSafeRect(): Rect {
    return this.rects().safe;
  }

  /**
   * Build an orthographic frustum whose NDC origin sits at the centre of the
   * *visible* rect rather than the centre of the canvas. Chrome therefore eats
   * pixels without squashing what the user is looking at, and OrbitControls'
   * zoom/pan keep working because they only read `right - left` /
   * `top - bottom`.
   */
  private applyProjection(): void {
    const { canvas, safe } = this.rects();
    const worldPerPx = this.worldPerPx;
    const cx = safe.x + safe.width / 2;
    const cy = safe.y + safe.height / 2;
    this.camera.left = -cx * worldPerPx;
    this.camera.right = (canvas.width - cx) * worldPerPx;
    this.camera.top = cy * worldPerPx;
    this.camera.bottom = -(canvas.height - cy) * worldPerPx;
    this.camera.near = -200;
    this.camera.far = 500;
    this.camera.updateProjectionMatrix();
  }

  /** Camera-space (x, y) of a normalised device coordinate, honouring zoom. */
  private cameraSpaceForNdc(nx: number, ny: number): { x: number; y: number } {
    const zoom = this.camera.zoom || 1;
    const dx = (this.camera.right - this.camera.left) / (2 * zoom);
    const dy = (this.camera.top - this.camera.bottom) / (2 * zoom);
    const cx = (this.camera.right + this.camera.left) / 2;
    const cy = (this.camera.top + this.camera.bottom) / 2;
    return { x: cx + nx * dx, y: cy + ny * dy };
  }

  /** World-space offset from `controls.target` to the centre of the focus rect. */
  private focusOffset(rect?: Rect): Vector3 {
    const { canvas, focus } = this.rects();
    const ndc = rectCenterNdc(rect ?? focus, canvas);
    const cam = this.cameraSpaceForNdc(ndc.x, ndc.y);
    this.camera.updateMatrixWorld();
    const right = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    return right.multiplyScalar(cam.x).add(up.multiplyScalar(cam.y));
  }

  /** World point currently displayed at the centre of the visible canvas. */
  private getFocusAnchor(rect?: Rect): Vector3 {
    return this.target.clone().add(this.focusOffset(rect));
  }

  /** Move the camera so `anchor` sits at the centre of the visible canvas. */
  private setFocusAnchor(anchor: Vector3, rect?: Rect): void {
    const next = anchor.clone().sub(this.focusOffset(rect));
    const delta = next.clone().sub(this.target);
    if (delta.lengthSq() < 1e-12) return;
    this.target.copy(next);
    this.controls.target.copy(next);
    this.camera.position.add(delta);
    this.controls.update();
  }

  // --- sync --------------------------------------------------------------

  private hasCentered = false;

  sync(project: Project, session: SessionView): void {
    this.catalog = catalogFromProject(project);
    this.layersState = project.layers;
    this.currentProjectIsBooth = isBoothProject(project);
    const simplify = session.simplify ?? false;
    const partner = session.partner ?? null;
    this.partner = partner;
    this.syncAreasAndTiles(project, simplify);
    this.syncObjects(project, session, simplify);
    this.syncPropPlayback(project, session.propPlayback ?? null);
    this.syncArrays(project);
    this.syncZones(project, session.selection);
    this.syncRoutes(project, session.focusRouteId ?? null, session.hideRouteLabels ?? false, session.showLabels);
    this.syncGhost(session.ghost);
    this.syncMeasurements(project, simplify);
    this.syncOverlay(project, session);
    this.syncPartner(partner);
    this.applyLabelDeclutter(project, session);
  }

  /** Current partner presentation, or null while the editor is active. */
  private partner: PartnerPresentation | null = null;

  /**
   * Scene labels are a bounded annotation layer, not a second UI rendered over
   * the scene. Candidates are collected after every source has had a chance to
   * update, then projected to the real canvas and culled in screen space.
   */
  private applyLabelDeclutter(project: Project, session: SessionView): void {
    type Candidate = { id: string; label: TextLabel | Sprite; priority: LabelPriority };
    const candidates: Candidate[] = [];
    const add = (id: string, label: TextLabel | Sprite, priority: LabelPriority) => {
      const sprite = label instanceof TextLabel ? label.sprite : label;
      if (sprite.parent) candidates.push({ id, label, priority });
    };
    const selected = session.selection;
    const rehearsing = !!(session.simPositions?.length || session.simStations?.length);

    // Start from a closed annotation layer. Only the candidates below earn a
    // place back on the scene; this makes the density budget comprehensive.
    this.scene.traverse((node) => {
      if (node instanceof Sprite && node.userData.textLabel) node.visible = false;
    });

    // "顯示名稱" is a real visibility switch, including labels baked into the
    // venue and mat overlays. The selected outline still tells a user what is
    // selected while this quiet mode is on.
    if (!session.showLabels) {
      for (const root of [this.floorGroup, this.arrayGroupRoot]) {
        root.traverse((node) => {
          if (node instanceof Sprite && node.userData.sceneLabel) node.visible = false;
        });
      }
      for (const map of [this.objectNodes, this.zoneNodes, this.routeNodes]) {
        for (const entry of map.values()) {
          if (entry.label) entry.label.sprite.visible = false;
        }
      }
      for (const label of [...this.stationLabels.values(), ...this.bottleneckLabels.values(), ...this.anchorLabels.values()]) {
        label.sprite.visible = false;
      }
      return;
    }

    // The selected thing gets first claim on the screen. Its neighbours are
    // then allowed to yield rather than forcing the user to decipher a stack.
    for (const o of project.objects) {
      if (!selected.has(o.id)) continue;
      const label = this.objectNodes.get(o.id)?.label;
      if (label && !o.hidden && session.showLabels) add(`object:${o.id}`, label, 0);
    }
    for (const zone of project.zones) {
      if (!selected.has(zone.id)) continue;
      const label = this.zoneNodes.get(zone.id)?.label;
      if (label && !zone.hidden && session.showLabels) add(`zone:${zone.id}`, label, 0);
    }
    for (const route of project.routes) {
      if (route.id !== session.focusRouteId) continue;
      const label = this.routeNodes.get(route.id)?.label;
      if (label && route.visible && session.showLabels) add(`route:${route.id}`, label, 0);
    }

    if (session.showLabels) {
      // Room / corridor and the one field label orient a first-time viewer.
      // They are kept out of rehearsal mode, where the queue is the task.
      if (!rehearsing) {
        for (const root of [this.floorGroup, this.arrayGroupRoot]) {
          root.traverse((node) => {
            if (!(node instanceof Sprite)) return;
            const data = node.userData.sceneLabel as { id?: string; priority?: LabelPriority } | undefined;
            if (data?.id) add(data.id, node, data.priority ?? 1);
          });
        }
        for (const zone of project.zones) {
          if (zone.hidden || selected.has(zone.id)) continue;
          const priority: LabelPriority = ["registration", "payment", "meditation", "group"].includes(zone.type) ? 1 : 2;
          const label = this.zoneNodes.get(zone.id)?.label;
          if (label) add(`zone:${zone.id}`, label, priority);
        }
        for (const o of project.objects) {
          if (o.hidden || selected.has(o.id)) continue;
          const label = this.objectNodes.get(o.id)?.label;
          const isEssential = this.catalog.resolve(o.assetId, o.kind).category === "service" || LANDMARKS.has(o.kind);
          if (!label || o.showLabel === false) continue;
          if (session.labelDisplayMode === "selected") continue;
          if (session.labelDisplayMode === "essential" && !isEssential) continue;
          if (session.labelDisplayMode !== "all" && !session.showObjectLabels && !isEssential) continue;
          const entry = this.catalog.resolve(o.assetId, o.kind);
          add(`object:${o.id}`, label, entry.category === "service" || LANDMARKS.has(o.kind) ? 1 : 2);
        }
        if (!session.hideRouteLabels) {
          for (const route of project.routes) {
            if (!route.visible || route.id === session.focusRouteId) continue;
            const label = this.routeNodes.get(route.id)?.label;
            if (label) add(`route:${route.id}`, label, 2);
          }
        }
      }

      // In rehearsal these labels are the actionable information. They remain
      // P0 even on phone, above room names and decorative context.
      for (const station of session.simStations ?? []) {
        const label = this.stationLabels.get(station.id);
        if (label) add(`station:${station.id}`, label, 0);
      }
      for (const bn of session.bottlenecks ?? []) {
        const key = `${bn.kind ?? "route"}|${bn.x.toFixed(2)}|${bn.z.toFixed(2)}`;
        const label = this.bottleneckLabels.get(key);
        if (label) add(`bottleneck:${key}`, label, 0);
      }
      for (const anchor of session.propAnchors ?? []) {
        const label = this.anchorLabels.get(`anchor:${anchor.role}`);
        if (label) add(`anchor:${anchor.role}`, label, 1);
      }
      for (const measurement of project.measurements) {
        if (!measurement.visible) continue;
        const label = this.measureNodes.get(measurement.id)?.label;
        if (label) add(`measure:${measurement.id}`, label, 1);
      }
      if (this.liveLabel && (session.measure || session.calibrate)) add("live-measure", this.liveLabel, 0);
      this.partnerLabels.forEach((label, i) => add(`partner:${i}`, label, 0));
    }

    this.scene.updateMatrixWorld(true);
    this.camera.updateMatrixWorld();
    const screenCandidates: ScreenLabelCandidate[] = [];
    for (const candidate of candidates) {
      const rect = this.labelScreenRect(candidate.label instanceof TextLabel ? candidate.label.sprite : candidate.label);
      if (rect) screenCandidates.push({ id: candidate.id, priority: candidate.priority, rect });
    }
    const width = this.canvasSize().w;
    const maxVisible = width <= 600 ? 6 : width < 1200 ? 9 : 12;
    const visible = session.showLabels ? declutterScreenLabels(screenCandidates, maxVisible) : new Set<string>();

    // Set every candidate explicitly. A hidden label from the prior frame must
    // be eligible again when a camera pan opens up room for it.
    for (const candidate of candidates) {
      const sprite = candidate.label instanceof TextLabel ? candidate.label.sprite : candidate.label;
      sprite.visible = visible.has(candidate.id);
    }
  }

  private labelScreenRect(sprite: Sprite): ScreenRect | null {
    const world = sprite.getWorldPosition(new Vector3());
    const scale = sprite.getWorldScale(new Vector3());
    const center = world.clone().project(this.camera);
    if (center.z < -1 || center.z > 1 || center.x < -1.2 || center.x > 1.2 || center.y < -1.2 || center.y > 1.2) return null;
    const right = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
    const up = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1).normalize();
    const px = world.clone().addScaledVector(right, scale.x / 2).project(this.camera);
    const py = world.clone().addScaledVector(up, scale.y / 2).project(this.camera);
    const { w, h } = this.canvasSize();
    const width = Math.max(54, Math.abs(px.x - center.x) * w + 10);
    const height = Math.max(20, Math.abs(py.y - center.y) * h + 8);
    const x = (center.x * 0.5 + 0.5) * w;
    const y = (-center.y * 0.5 + 0.5) * h;
    return { x: x - width / 2, y: y - height / 2, width, height };
  }

  /**
   * Partner marks: a red / orange / green pin on the spot, with the plain
   * sentence describing what to do. Rebuilt wholesale — there are only a
   * handful and they change with every validation pass.
   */
  private syncPartner(partner: PartnerPresentation | null): void {
    const sig = partner ? JSON.stringify(partner.marks) : "";
    if (sig === this.lastPartnerSig) { this.partnerGroup.visible = !!partner; return; }
    this.lastPartnerSig = sig;
    for (const label of this.partnerLabels) label.dispose();
    this.partnerLabels = [];
    clearGroup(this.partnerGroup);
    this.partnerGroup.visible = !!partner;
    if (!partner) return;
    partner.marks.forEach((mark, i) => {
      const color = MARK_COLOR[mark.tone];
      const pin = new Mesh(
        new BoxGeometry(0.34, 0.9, 0.34),
        new MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }),
      );
      pin.position.set(mark.x, 0.45, mark.z);
      this.partnerGroup.add(pin);
      const halo = new Mesh(
        new PlaneGeometry(1.1, 1.1),
        new MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false }),
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.set(mark.x, 0.05, mark.z);
      this.partnerGroup.add(halo);
      // Only things you must act on get words on the plan. A green mark is a
      // reassuring dot; its sentence lives in the 要注意的地方 sheet.
      if (mark.tone === "ok") return;
      const label = new TextLabel({ width: 512, height: 128, fontSize: 54 });
      label.set(mark.text, color);
      label.sprite.scale.set(2.6, 0.65, 1);
      // Stagger heights so two nearby problems do not overprint each other.
      label.sprite.position.set(mark.x, 1.35 + (i % 3) * 0.55, mark.z);
      this.partnerLabels.push(label);
      this.partnerGroup.add(label.sprite);
    });
  }

  private lastPartnerSig = "";
  private partnerLabels: TextLabel[] = [];

  private recenter(project: Project): void {
    this.fitBounds(primaryWorkAreaBounds(project));
  }

  private combinedBounds(project: Project): { cx: number; cz: number; w: number; h: number } {
    const { classroom, corridor } = project;
    const minX = Math.min(classroom.x, corridor.x);
    const minZ = Math.min(classroom.z, corridor.z);
    const maxX = Math.max(classroom.x + classroom.length, corridor.x + corridor.length);
    const maxZ = Math.max(classroom.z + classroom.width, corridor.z + corridor.width);
    return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, w: maxX - minX, h: maxZ - minZ };
  }

  /** Current visual theme. Light is the default; dark is opt-in. */
  getTheme(): ThemeName {
    return this.theme;
  }

  /**
   * Switch the canvas between the paper-like light look and the dark look.
   * Floors, walls and area labels are baked into meshes, so the area cache is
   * invalidated to force a rebuild on the next sync.
   */
  setTheme(theme: ThemeName): void {
    if (theme === this.theme) return;
    this.theme = theme;
    this.applyPalette(scenePalette(theme));
  }

  private applyPalette(palette: ScenePalette): void {
    this.palette = palette;
    this.scene.background = new Color(palette.background);
    // Areas, walls and labels carry palette colours in their materials.
    this.lastAreaSig = "";
  }

  private syncAreasAndTiles(project: Project, simplify: boolean): void {
    const { tile } = project;
    this.floorGroup.visible = this.layersState.areas;
    this.tileGroup.visible = this.layersState.tiles && tile.visible && !simplify;
    const sig = JSON.stringify({ c: project.classroom, k: project.corridor, t: tile, venue: project.venuePresetId, theme: this.theme });
    if (sig === this.lastAreaSig) return;
    this.lastAreaSig = sig;
    if (!this.hasCentered) { this.recenter(project); this.hasCentered = true; }
    clearGroup(this.floorGroup);
    clearGroup(this.tileGroup);
    const e310 = project.venuePresetId === "venue:tku-e310";
    // An outdoor pitch is grass and paving, and it has no walls — a raised
    // wall rail around it would read as a room the stall is standing inside.
    const outdoor = isBoothProject(project);
    for (const area of [project.classroom, project.corridor]) {
      const areaGroup = new Group();
      const floor = new Mesh(
        new BoxGeometry(area.length, 0.055, area.width),
        new MeshStandardMaterial({
          color: outdoor
            ? (area.id === "classroom" ? OUTDOOR_GROUND[this.theme].pitch : OUTDOOR_GROUND[this.theme].paving)
            : e310 && this.theme === "light"
              ? (area.id === "classroom" ? "#ddd9d0" : "#c99698")
              : (area.id === "classroom" ? this.palette.floorClassroom : this.palette.floorCorridor),
          roughness: area.id === "classroom" ? 0.84 : 0.94,
        }),
      );
      floor.position.set(area.x + area.length / 2, -0.03, area.z + area.width / 2);
      floor.receiveShadow = true;
      areaGroup.add(floor);
      areaGroup.add(outdoor ? this.buildAreaOutline(area) : this.buildAreaWalls(area));
      const label = new TextLabel({ width: 320, height: 72, fontSize: 34 });
      // Always the pale palette colour. TextLabel paints its own dark pill
      // behind the text (label.ts: rgba(15,23,42,.72)), so the label's contrast
      // is against the PILL, never against the floor. An E310-only override to
      // a dark slate `#43534f` was reading it as floor text and landed at
      // 1.04:1 — the room and corridor names were invisible on the venue the
      // release uses as its visual baseline.
      label.set(area.name, area.id === "classroom" ? this.palette.areaLabelClassroom : this.palette.areaLabelCorridor);
      label.sprite.scale.set(1.55, 0.36, 1);
      label.sprite.position.set(area.x + 1.25, 0.14, area.z + 0.55);
      label.sprite.userData.sceneLabel = { id: `area:${area.id}`, priority: 1 as LabelPriority };
      areaGroup.add(label.sprite);
      this.floorGroup.add(areaGroup);
    }
    if (e310) this.floorGroup.add(this.buildE310Fixtures(project));
    this.tileGroup.add(this.buildTileGrid(project, project.classroom, e310 ? 0x8b918c : 0x64748b, e310 ? 0.26 : 0.42));
    this.tileGroup.add(this.buildTileGrid(project, project.corridor, e310 ? 0x8f5f64 : 0x64748b, e310 ? 0.3 : 0.42));
  }

  /**
   * Outdoors the pitch boundary is paint on the ground, not a rail: a flat
   * outline says "this is your 攤位範圍" without inventing a wall.
   */
  private buildAreaOutline(area: Project["classroom"]): Group {
    const g = new Group();
    const y = 0.014;
    const color = this.theme === "light" ? 0x475569 : 0xcbd5e1;
    const positions = [
      area.x, y, area.z, area.x + area.length, y, area.z,
      area.x + area.length, y, area.z, area.x + area.length, y, area.z + area.width,
      area.x + area.length, y, area.z + area.width, area.x, y, area.z + area.width,
      area.x, y, area.z + area.width, area.x, y, area.z,
    ];
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
    g.add(new LineSegments(geo, new LineBasicMaterial({ color, transparent: true, opacity: 0.8 })));
    return g;
  }

  /** Raised, thick wall rails make an empty classroom and its corridor legible. */
  private buildAreaWalls(area: Project["classroom"]): Group {
    const walls = new Group();
    const material = new MeshStandardMaterial({
      color: area.id === "classroom" ? this.palette.wallClassroom : this.palette.wallCorridor,
      roughness: 0.88,
    });
    const thickness = 0.1;
    const height = 0.12;
    const rails = [
      [area.length, thickness, area.x + area.length / 2, area.z],
      [area.length, thickness, area.x + area.length / 2, area.z + area.width],
      [thickness, area.width, area.x, area.z + area.width / 2],
      [thickness, area.width, area.x + area.length, area.z + area.width / 2],
    ] as const;
    for (const [width, depth, x, z] of rails) {
      const wall = new Mesh(new BoxGeometry(width, height, depth), material);
      wall.position.set(x, height / 2, z);
      wall.castShadow = true;
      wall.receiveShadow = true;
      walls.add(wall);
    }
    return walls;
  }

  private buildTileGrid(project: Project, area: Project["classroom"], color: number, opacity: number): Object3D {
    const { tile } = project;
    const minX = area.x, minZ = area.z;
    const maxX = area.x + area.length, maxZ = area.z + area.width;
    const positions: number[] = [];
    const w = Math.max(tile.width, 0.05);
    const d = Math.max(tile.depth, 0.05);
    let sx = tile.originX; while (sx > minX) sx -= w;
    for (let x = sx; x <= maxX + 1e-6; x += w) positions.push(x, 0, minZ, x, 0, maxZ);
    let sz = tile.originZ; while (sz > minZ) sz -= d;
    for (let z = sz; z <= maxZ + 1e-6; z += d) positions.push(minX, 0, z, maxX, 0, z);
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
    const grid = new LineSegments(geo, new LineBasicMaterial({ color, transparent: true, opacity }));
    grid.position.y = 0.003;
    grid.rotation.y = tile.rotationDeg * D2R;
    return grid;
  }

  /** Low-cost architectural cues copied from the E310 field photographs. */
  private buildE310Fixtures(project: Project): Group {
    const g = new Group();
    const c = project.classroom, k = project.corridor;
    const trim = new MeshStandardMaterial({ color: 0x8c9aa0, roughness: 0.92 });
    const curtain = new MeshStandardMaterial({ color: 0x7f929b, roughness: 1 });
    const glass = new MeshStandardMaterial({ color: 0xc9dde0, roughness: 0.28, metalness: 0.04 });
    // Blue-grey lower wall band and a few curtain/window bays, kept low enough
    // that the editable floor remains unobstructed from the iso camera.
    for (const [len, dep, x, z] of [
      [c.length, 0.06, c.x + c.length / 2, c.z],
      [0.06, c.width, c.x, c.z + c.width / 2],
    ] as const) {
      const base = new Mesh(new BoxGeometry(len, 0.3, dep), trim);
      base.position.set(x, 0.15, z);
      base.receiveShadow = true;
      g.add(base);
    }
    for (let i = 0; i < 3; i++) {
      const z = c.z + 1.5 + i * 2.05;
      const pane = new Mesh(new BoxGeometry(0.035, 1.28, 1.55), glass);
      pane.position.set(c.x + 0.02, 0.95, z);
      g.add(pane);
      const drape = new Mesh(new BoxGeometry(0.08, 1.46, 0.24), curtain);
      drape.position.set(c.x + 0.08, 0.9, z - 0.74);
      drape.castShadow = true;
      g.add(drape);
    }
    // Yellow tactile strip crossing the pink-tiled open corridor lobby.
    const tactile = new Mesh(
      new BoxGeometry(Math.max(1.2, k.length * 0.72), 0.018, 0.28),
      new MeshStandardMaterial({ color: 0xd8ad35, roughness: 0.82 }),
    );
    tactile.position.set(k.x + k.length * 0.42, 0.014, k.z + k.width * 0.72);
    tactile.receiveShadow = true;
    g.add(tactile);
    return g;
  }

  private syncObjects(project: Project, session: SessionView, simplify: boolean): void {
    this.objectGroup.visible = this.layersState.objects;
    const showLabels = session.showLabels;
    const labelMode = session.labelDisplayMode ?? (session.showObjectLabels ? "all" : "essential");
    const seen = new Set<string>();
    for (const o of project.objects) {
      seen.add(o.id);
      const catalogEntry = this.catalog.resolve(o.assetId, o.kind);
      const quality = "standard";
      // A prop's faces render from its bound station's chance options — the
      // one live record for face colour/label. Both feed the signature: an
      // edited face must rebuild exactly like an edited definition.
      const propDef = catalogEntry.visualRef.startsWith("prop:")
        ? propForAssetId(project.props, o.assetId)
        : undefined;
      const faceOptions = propDef ? propFaceOptions(project, o.id, propDef) : undefined;
      const faceSig = faceOptions
        ? faceOptions.map((opt) => `${opt.label}|${opt.color ?? ""}|${opt.imageBlobId ?? ""}`).join("¦")
        : "";
      // entry.version is part of the identity: editing a custom definition
      // bumps it, and without it here the scene kept drawing the old visual
      // after every edit.
      const sig = `${o.assetId ?? o.kind}|${catalogEntry.visualRef}|v${catalogEntry.version}|${faceSig}|${o.width}|${o.depth}|${o.height}|${o.hinge}|${o.openInward}|${o.openDeg}|${quality}`;
      let entry = this.objectNodes.get(o.id);
      if (!entry || entry.sig !== sig) {
        if (entry) { this.objectGroup.remove(entry.group); disposeObject(entry.group); entry.label?.dispose(); }
        const group = propDef
          ? buildPropGroupCached(propDef, { faceOptions })
          : resolveVisualGroup(
            catalogEntry,
            o.kind,
            { width: o.width, depth: o.depth, height: o.height },
            o.kind === "door" ? { hinge: o.hinge, openInward: o.openInward, openDeg: o.openDeg } : undefined,
            quality,
          );
        group.userData = { ...group.userData, type: "object", id: o.id };
        group.traverse((m) => {
          if (m instanceof Mesh) {
            // Spread, not replace: the tent canopy tags itself `roof` at build
            // time and that tag has to survive being adopted into the scene.
            m.userData = { ...m.userData, type: "object", id: o.id };
            m.castShadow = o.kind !== "mat";
            m.receiveShadow = true;
          }
        });
        // Enlarged invisible pick proxy for thin wall assets and the small
        // tabletop kit (a 8 cm 筆筒 is otherwise un-tappable on a phone).
        const tinyTabletop = catalogEntry.placementType === "tabletop" && (o.width < 0.45 || o.depth < 0.45);
        if (catalogEntry.placementType === "wall" || tinyTabletop) {
          const pw = Math.max(o.width, catalogEntry.placementType === "wall" ? 0.5 : 0.28);
          const ph = Math.max(o.height, catalogEntry.placementType === "wall" ? 1.0 : 0.2);
          const pd = Math.max(o.depth, catalogEntry.placementType === "wall" ? 0.45 : 0.28);
          const proxy = new Mesh(new BoxGeometry(pw, ph, pd), new MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 }));
          proxy.position.y = ph / 2;
          proxy.userData = { type: "object", id: o.id };
          group.add(proxy);
        }
        this.objectGroup.add(group);
        entry = { group, label: null, sig };
        this.objectNodes.set(o.id, entry);
      }
      entry.group.position.set(o.x, o.elevation, o.z);
      entry.group.rotation.y = o.rotationDeg * D2R;
      const persistentLabel = LANDMARKS.has(o.kind) || catalogEntry.category === "service";
      const selected = session.selection.has(o.id);
      const wantsLabel = o.showLabel !== false && (
        labelMode === "all"
        || selected
        || (labelMode === "essential" && persistentLabel)
      );
      if (wantsLabel && !entry.label) {
        entry.label = new TextLabel();
        this.objectGroup.add(entry.label.sprite);
      } else if (!wantsLabel && entry.label) {
        this.objectGroup.remove(entry.label.sprite);
        entry.label.dispose();
        entry.label = null;
      }
      // In Partner Mode, objects that belong to another role drop out entirely:
      // their materials are shared from a cache, so fading them would tint every
      // other object of the same kind too.
      const roleMuted = !!this.partner && this.partner.emphasis.objects[o.id] === "muted";
      entry.group.visible = !o.hidden && !(simplify && SIMPLIFY_HIDE.has(o.kind)) && !roleMuted;
      if (entry.label) {
        entry.label.sprite.visible = showLabels && labelMode !== "none" && !o.hidden;
        if (showLabels) {
          const pos = o.labelPosition ?? { offsetX: 0, offsetY: 0, offsetZ: 0 };
          const style = o.labelStyle;
          entry.label.set(o.label ?? o.name ?? catalogEntry.name, selected ? "#e0f2fe" : (style?.color ?? "#f8fafc"), style);
          entry.label.sprite.position.set(o.x + pos.offsetX, o.elevation + o.height + 0.35 + pos.offsetY, o.z + pos.offsetZ);
        }
      }
    }
    for (const [id, entry] of this.objectNodes) {
      if (!seen.has(id)) {
        this.objectGroup.remove(entry.group); disposeObject(entry.group);
        entry.label?.dispose();
        this.objectNodes.delete(id);
      }
    }
    this.applyRoofVisibility();
  }

  /**
   * §25/§31 — animate placed props from the rehearsal's per-station results.
   *
   * Mutates only mesh transforms and per-mesh painted materials inside the
   * already-built groups; the rebuild signature never sees any of it, so a
   * spinning dice cannot trigger a rebuild and a rebuild mid-spin just
   * re-settles deterministically on the next tick.
   */
  private syncPropPlayback(project: Project, playback: PropPlaybackView | null): void {
    for (const o of project.objects) {
      const def = propForAssetId(project.props, o.assetId);
      if (!def) continue;
      const entry = this.objectNodes.get(o.id);
      if (!entry) continue;
      const ownStation = playback?.stationOfObject[o.id];

      const roller = def.parts.find((p) => p.facesFromOptions);
      if (roller) {
        const mesh = entry.group.getObjectByName(`part:${roller.id}`) as Mesh | undefined;
        if (mesh) {
          if (!mesh.userData.restQuat) mesh.userData.restQuat = mesh.quaternion.clone();
          const rest = mesh.userData.restQuat as Quaternion;
          const result = playback && ownStation ? playback.results[ownStation] : undefined;
          if (result && playback) {
            const options = propFaceOptions(project, o.id, def) ?? [];
            const idx = options.findIndex((opt) => opt.id === result.optionId);
            // Ask the PART how it comes to rest. A dice turns a face upward; a
            // spinner turns a wedge to its pointer and stays flat. Applying the
            // dice rotation to a disc stood the wheel on its edge for five of
            // six outcomes and left it there for the rest of the rehearsal.
            // An outcome the part cannot show settles back to rest rather than
            // displaying the wrong one.
            const settle = settleQuaternionFor(roller, idx, options.length) ?? rest.clone();
            mesh.quaternion.copy(diceRollQuaternion(playback.t - result.t, result.serial, settle));
          } else {
            mesh.quaternion.copy(rest);
          }
        }
      }

      for (const part of def.parts) {
        if (!part.showsResultOf) continue;
        const mesh = entry.group.getObjectByName(`part:${part.id}`) as Mesh | undefined;
        if (!mesh) continue;
        const stationId = part.showsResultOf === "self" ? ownStation : part.showsResultOf;
        const result = playback && stationId ? playback.results[stationId] : undefined;
        if (result) paintPartResult(mesh, part, result.label, result.color ?? part.color ?? "#f8fafc");
        else clearPartResult(mesh);
      }
    }
  }

  private syncArrays(project: Project): void {
    this.arrayGroupRoot.visible = this.layersState.objects;
    const seen = new Set<string>();
    const dummy = new Object3D();
    for (const g of project.groups) {
      seen.add(g.id);
      const members = groupMembers(g);
      const sig = `${g.sourceKind}|${g.name}|${g.numberPrefix}|${g.rows}|${g.cols}|${g.gapX}|${g.gapZ}|${g.itemWidth}|${g.itemDepth}|${g.itemHeight}|${members.length}|${JSON.stringify(members.map((m) => [round(m.x), round(m.z), m.rotationDeg]))}`;
      let entry = this.arrayNodes.get(g.id);
      if (!entry || entry.sig !== sig) {
        if (entry) {
          this.arrayGroupRoot.remove(entry.mesh);
          this.arrayGroupRoot.remove(entry.overlay);
          entry.mesh.geometry.dispose();
          disposeObject(entry.overlay);
        }
        const geom = buildMergedGeometry(g.sourceKind, { width: g.itemWidth, depth: g.itemDepth, height: g.itemHeight });
        const material = assetInstanceMaterial(g.sourceKind).clone();
        if (isFieldMatGroup(g)) {
          // Opaque EVA with slight piece-to-piece variation reads as the
          // photographed continuous puzzle-mat field, not a transparent zone.
          //
          // `vertexColors` must stay OFF. `setColorAt` writes `instanceColor`,
          // which three.js applies on its own; turning on `vertexColors` also
          // switches on USE_COLOR, and with no `color` attribute on the merged
          // geometry the albedo multiplies by (0,0,0) — the field renders
          // BLACK and only an emissive term can be seen at all. Measured:
          // vertexColors on + no emissive → `#516672` (the floor showing
          // through dead mats); vertexColors off + no emissive → `#27aa94`,
          // the photographed teal, straight out of real lighting.
          //
          // That is why the emissive is now a whisper instead of 0.65: the
          // diffuse term is doing the work again, so thickness, seams and the
          // shaded side of each piece are visible instead of washed flat.
          material.color.set("#ffffff");
          material.roughness = 0.96;
          material.vertexColors = false;
          material.emissive.set(MAT_COLORS.base);
          material.emissiveIntensity = 0.12;
        }
        const mesh = new InstancedMesh(geom, material, Math.max(members.length, 1));
        mesh.count = members.length;
        mesh.userData = { type: "group", id: g.id };
        for (let i = 0; i < members.length; i++) {
          dummy.position.set(members[i].x, 0, members[i].z);
          dummy.rotation.set(0, members[i].rotationDeg * D2R, 0);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          if (isFieldMatGroup(g)) {
            // Piece-to-piece variation, measured range (dark .. base .. light).
            // Cycled on row+col rather than a flat index so the variation does
            // not read as stripes down one axis, the way `i % 3` did.
            // Mostly one continuous colour, with a few irregular batches. A
            // formula such as row + col * 2 creates a diagonal checkerboard
            // even when each colour was sampled from a real photo.
            const v = matBatchVariation(members[i].row, members[i].col);
            mesh.setColorAt(i, new Color(v === 1 ? MAT_SURFACE_VARIATION.light : v === -1 ? MAT_SURFACE_VARIATION.dark : MAT_COLORS.base));
          }
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.receiveShadow = true;
        // Same rule an individually placed object gets: everything casts a
        // contact shadow except mats, which lie flat on the floor. Sixteen
        // array chairs used to float shadowless beside one placed chair that
        // sat on the ground.
        mesh.castShadow = g.sourceKind !== "mat";
        const overlay = this.buildArrayOverlay(g, members);
        this.arrayGroupRoot.add(mesh);
        this.arrayGroupRoot.add(overlay);
        entry = { mesh, overlay, sig };
        this.arrayNodes.set(g.id, entry);
      }
      entry.mesh.visible = !g.hidden;
      entry.overlay.visible = !g.hidden;
    }
    for (const [id, entry] of this.arrayNodes) {
      if (!seen.has(id)) {
        this.arrayGroupRoot.remove(entry.mesh);
        this.arrayGroupRoot.remove(entry.overlay);
        entry.mesh.geometry.dispose();
        disposeObject(entry.overlay);
        this.arrayNodes.delete(id);
      }
    }
  }

  /** Editor presentation for square mat fields: a 60 cm grid plus one clear label. */
  private buildArrayOverlay(g: Project["groups"][number], members: ReturnType<typeof groupMembers>): Group {
    const overlay = new Group();
    if (!isFieldMatGroup(g) || !members.length) return overlay;

    // Trace the joints, do not float over them. This was a hard-coded 0.12
    // against a mat whose top is `itemHeight * 0.89` (0.036 m for a 4 cm mat),
    // so the seam grid hovered 8.6 cm up and read as an overlay drawn on the
    // field instead of the seams between interlocking 巧拼 — displaced
    // diagonally by about a seventh of a tile at the default iso camera.
    // Derived, not a constant: the top scales with the mat's own thickness.
    const seamY = g.itemHeight * 0.89 + 0.004;
    const positions: number[] = [];
    for (const member of members) {
      const r = member.rotationDeg * D2R;
      const cos = Math.cos(r), sin = Math.sin(r);
      const hw = g.itemWidth / 2, hd = g.itemDepth / 2;
      const corners = [
        [-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd],
      ].map(([x, z]) => ({ x: member.x + x * cos - z * sin, z: member.z + x * sin + z * cos }));
      for (let i = 0; i < corners.length; i++) {
        const a = corners[i], b = corners[(i + 1) % corners.length];
        positions.push(a.x, seamY, a.z, b.x, seamY, b.z);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
    // The seam between two interlocking pieces, in the colour the photographs
    // show it — a shaded joint, not a drawn black grid.
    overlay.add(new LineSegments(geo, new LineBasicMaterial({
      color: new Color(MAT_COLORS.seam), transparent: true, opacity: 0.62,
    })));

    const label = new TextLabel({ width: 720, height: 112, fontSize: 42 });
    const name = g.name?.trim() || `地墊區 ${g.numberPrefix || "A"}`;
    label.set(`${name} · ${g.cols}×${g.rows} · ${g.rows * g.cols} 片`, this.theme === "light" ? "#134e4a" : "#d1fae5");
    label.sprite.scale.set(3.25, 0.52, 1);
    const center = groupCenter(g);
    label.sprite.position.set(center.x, Math.max(0.36, g.itemHeight + 0.4), center.z);
    label.sprite.userData.sceneLabel = { id: `field:${g.id}`, priority: 1 as LabelPriority };
    overlay.add(label.sprite);
    return overlay;
  }

  private syncZones(project: Project, selection: Set<string>): void {
    this.zoneGroup.visible = this.layersState.zones;
    const partner = this.partner;
    const seen = new Set<string>();
    for (const zone of project.zones) {
      seen.add(zone.id);
      // Partner labels are drawn at a higher texture resolution, so the mode
      // is part of the signature and the node is rebuilt when it changes.
      const sig = `${zone.type}|${zone.width}|${zone.depth}|${partner ? "partner" : "editor"}`;
      let entry = this.zoneNodes.get(zone.id);
      if (!entry || entry.sig !== sig) {
        if (entry) { this.zoneGroup.remove(entry.group); entry.label.dispose(); }
        entry = this.buildZone(zone, sig, !!partner);
        this.zoneGroup.add(entry.group);
        this.zoneNodes.set(zone.id, entry);
      }
      entry.group.position.set(zone.x, 0.02, zone.z);
      entry.group.visible = !zone.hidden;
      const fill = entry.group.getObjectByName("fill") as Mesh;
      const edges = entry.group.getObjectByName("edges") as LineSegments;
      const fillMat = fill.material as MeshStandardMaterial;
      const edgeMat = edges.material as LineBasicMaterial;
      fillMat.color.set(zone.color);
      edgeMat.color.set(zone.color);
      const cap = zone.capacity ? ` · ${zone.capacity}人` : "";
      entry.label.sprite.position.y = partner ? 0.8 : 0.5;
      if (partner) {
        // A zone the current role owns reads as a solid, labelled place; the
        // rest stay as faint context so the room still makes sense.
        const muted = partner.emphasis.zones[zone.id] === "muted";
        fillMat.opacity = muted ? 0.05 : 0.16;
        edgeMat.opacity = muted ? 0.25 : 1;
        entry.label.sprite.visible = !muted;
        entry.label.set(`${zone.icon ?? ""} ${zone.name}${cap}`.trim(), "#f8fafc");
      } else {
        fillMat.opacity = selection.has(zone.id) ? 0.16 : 0.1;
        edgeMat.opacity = selection.has(zone.id) ? 1 : 0.72;
        entry.label.sprite.visible = true;
        entry.label.set(`${zone.icon ?? ""}${zone.name}${cap}`.trim(), selection.has(zone.id) ? "#e0f2fe" : "#f8fafc");
      }
    }
    for (const [id, entry] of this.zoneNodes) {
      if (!seen.has(id)) { this.zoneGroup.remove(entry.group); entry.label.dispose(); this.zoneNodes.delete(id); }
    }
  }

  private buildZone(zone: Zone, sig: string, partner: boolean) {
    const group = new Group();
    const fill = new Mesh(
      new PlaneGeometry(zone.width, zone.depth),
      new MeshStandardMaterial({ transparent: true, opacity: 0.2, side: DoubleSide, depthWrite: false }),
    );
    fill.rotation.x = -Math.PI / 2;
    fill.position.y = 0.01;
    fill.name = "fill";
    fill.userData = { type: "zone", id: zone.id };
    group.add(fill);
    const edges = new LineSegments(
      new EdgesGeometry(new PlaneGeometry(zone.width, zone.depth)),
      new LineBasicMaterial({ transparent: true, opacity: 0.9 }),
    );
    edges.rotation.x = -Math.PI / 2;
    edges.position.y = 0.02;
    edges.name = "edges";
    group.add(edges);
    group.add(this.buildZoneProps(zone));
    const label = partner
      ? new TextLabel({ width: 640, height: 140, fontSize: 62 })
      : new TextLabel();
    if (partner) label.sprite.scale.set(2.9, 0.64, 1);
    label.sprite.position.y = 0.5;
    group.add(label.sprite);
    return { group, label, sig };
  }

  /** Small non-interactive props make operational zones recognizable at a glance. */
  private buildZoneProps(zone: Zone): Group {
    const props = new Group();
    const addBox = (w: number, h: number, d: number, x: number, y: number, z: number, color: string, rotation = 0) => {
      const mesh = new Mesh(new BoxGeometry(w, h, d), new MeshStandardMaterial({ color, roughness: 0.9 }));
      mesh.position.set(x, y, z);
      mesh.rotation.y = rotation;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      props.add(mesh);
    };
    if (zone.type === "shoe") {
      const count = Math.max(2, Math.min(5, Math.floor(zone.depth / 0.55)));
      for (let i = 0; i < count; i++) {
        const z = -zone.depth / 2 + 0.3 + i * ((zone.depth - 0.6) / Math.max(count - 1, 1));
        const tone = i % 2 ? "#d9d4ca" : "#313a3d";
        addBox(0.12, 0.065, 0.25, -0.09, 0.045, z, tone, -0.12);
        addBox(0.12, 0.065, 0.25, 0.09, 0.045, z, tone, 0.12);
      }
    } else if (zone.type === "backpack") {
      // KNOWN, DEFERRED: the field research says the bags go ON the parked
      // 課桌椅, and these are drawn on the floor beside them — in the 30-person
      // example the middle one is speared through a chair.
      //
      // Lifting them to seat height was tried, rendered and rejected: they then
      // passed through the chairs instead of resting on them, because this
      // function knows the ZONE rectangle and not where the carriers actually
      // stand. Doing it properly means feeding the carrier positions in, which
      // is more than a constant and not a release-freeze change.
      for (let i = -1; i <= 1; i++) {
        const z = i * Math.min(0.72, zone.depth / 3.4);
        addBox(0.34, 0.42, 0.2, 0, 0.23, z, i === 0 ? "#b85b42" : "#3f6670");
        addBox(0.2, 0.07, 0.08, 0, 0.47, z, i === 0 ? "#8f4332" : "#304e57");
      }
    } else if (zone.type === "meditation") {
      addBox(Math.min(0.72, zone.width * 0.22), 0.035, Math.min(1.5, zone.depth * 0.72), 0, 0.035, 0, "#38785f");
    } else if (zone.type === "life") {
      addBox(0.55, 0.25, 0.42, -0.35, 0.14, 0, "#b88b53");
      addBox(0.55, 0.2, 0.42, 0.35, 0.11, 0, "#d0aa72");
    }
    return props;
  }

  private syncRoutes(project: Project, focusRouteId: string | null, hideLabels = false, showLabels = true): void {
    this.routeGroup.visible = this.layersState.routes;
    this.routeNodeMeshes = [];
    const seen = new Set<string>();
    for (const route of project.routes) {
      seen.add(route.id);
      const partner = this.partner;
      const muted = !!partner && partner.emphasis.routes[route.id] === "muted";
      const dim = muted || (focusRouteId !== null && focusRouteId !== route.id);
      const sig = JSON.stringify(route.points) + route.color + (dim ? "|dim" : "") + (partner ? "|partner" : "");
      let entry = this.routeNodes.get(route.id);
      if (!entry || entry.sig !== sig) {
        if (entry) { this.routeGroup.remove(entry.group); disposeObject(entry.group); entry.label.dispose(); }
        entry = this.buildRoute(route, 0.06, dim, sig, !!partner);
        this.routeGroup.add(entry.group);
        this.routeNodes.set(route.id, entry);
      }
      entry.group.visible = route.visible;
      // In the 全部 overview the arrows, colours and ①②③ badges carry the flow;
      // adding four route names on top is what made a phone-sized plan
      // unreadable. Names come back as soon as a role narrows the picture.
      entry.label.sprite.visible = !showLabels || hideLabels
        ? false
        : partner ? partner.role !== "all" && !dim : true;
      entry.label.set(partner ? `${routeIcon(route)} ${route.name}` : route.name, dim ? "#64748b" : route.color);
      entry.group.traverse((o) => { if (o instanceof Mesh && o.userData.type === "routeNode") this.routeNodeMeshes.push(o); });
    }
    for (const [id, entry] of this.routeNodes) {
      if (!seen.has(id)) { this.routeGroup.remove(entry.group); disposeObject(entry.group); entry.label.dispose(); this.routeNodes.delete(id); }
    }
  }

  private buildRoute(route: Route2, y: number, dim: boolean, sig: string, partner = false) {
    const group = new Group();
    const color = dim ? "#475569" : route.color;
    const opacity = dim ? (partner ? 0.2 : 0.35) : 1;
    // Partner mode draws the flow as a bold arrow a stranger can follow across
    // the room; the editor keeps the thinner, less obtrusive ribbon.
    const width = dim ? 0.06 : partner ? 0.3 : 0.12;
    const arrowLen = partner ? 0.8 : 0.34;
    const arrowWidth = partner ? 0.52 : 0.22;
    // Thick ribbon: a flat box per segment (WebGL line width is unreliable).
    for (let i = 0; i < route.points.length - 1; i++) {
      const a = route.points[i], b = route.points[i + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 1e-4) continue;
      const ribbon = new Mesh(new BoxGeometry(len, 0.02, width), new MeshBasicMaterial({ color, transparent: true, opacity }));
      ribbon.position.set((a.x + b.x) / 2, y, (a.z + b.z) / 2);
      ribbon.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
      group.add(ribbon);
      // Direction arrow at segment midpoint.
      const arrow = new Mesh(new BoxGeometry(arrowLen, 0.02, arrowWidth), new MeshBasicMaterial({ color, transparent: true, opacity }));
      arrow.position.set((a.x + b.x) / 2, y + 0.01, (a.z + b.z) / 2);
      arrow.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
      group.add(arrow);
      if (partner && !dim) {
        // A second, narrower bar just behind the tip reads as an arrowhead
        // from directly above without needing a cone mesh.
        const head = new Mesh(new BoxGeometry(arrowLen * 0.5, 0.02, arrowWidth * 0.5), new MeshBasicMaterial({ color, transparent: true, opacity }));
        head.position.set(
          (a.x + b.x) / 2 + ((b.x - a.x) / len) * arrowLen * 0.5,
          y + 0.02,
          (a.z + b.z) / 2 + ((b.z - a.z) / len) * arrowLen * 0.5,
        );
        head.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
        group.add(head);
      }
    }
    // Step-number markers + start/end colours.
    route.points.forEach((p, index) => {
      const isStart = index === 0;
      const isEnd = index === route.points.length - 1 && route.points.length > 1;
      const c = dim ? "#475569" : isStart ? "#22c55e" : isEnd ? "#ef4444" : route.color;
      const size = partner && !dim ? 0.44 : 0.3;
      const node = new Mesh(new BoxGeometry(size, size, size), new MeshBasicMaterial({ color: c, transparent: true, opacity }));
      node.position.set(p.x, y, p.z);
      node.userData = { type: "routeNode", id: route.id, index };
      group.add(node);
      if (!dim) {
        const numLabel = partner
          ? new TextLabel({ width: 160, height: 160, fontSize: 108 })
          : new TextLabel();
        numLabel.set(partner ? circledNumber(index + 1) : String(index + 1), partner ? "#f8fafc" : this.palette.stepNumber);
        numLabel.sprite.scale.set(partner ? 0.9 : 0.5, partner ? 0.9 : 0.5, 1);
        numLabel.sprite.position.set(p.x, y + (partner ? 0.75 : 0.5), p.z);
        group.add(numLabel.sprite);
      }
    });
    const label = partner ? new TextLabel({ width: 640, height: 140, fontSize: 58 }) : new TextLabel();
    if (partner) label.sprite.scale.set(2.8, 0.62, 1);
    // The name sits at the middle of the walk, not on top of step ① — and in
    // partner mode it rides above the step badges so both stay readable.
    const anchor = partner ? polylineMidpoint(route.points) : route.points[0];
    if (anchor) label.sprite.position.set(anchor.x, partner ? 1.7 : 0.9, anchor.z);
    group.add(label.sprite);
    return { group, label, sig };
  }

  private syncGhost(ghost: GhostState | null): void {
    const sig = ghost ? JSON.stringify(ghost) : "";
    if (sig === this.lastGhostSig) return;
    this.lastGhostSig = sig;
    clearGroup(this.ghostGroup);
    if (!ghost) return;
    const catalogEntry = this.catalog.resolve(ghost.assetId, ghost.kind);
    const g = resolveVisualGroup(catalogEntry, ghost.kind, ghost.dims, ghost.door, "detail");
    const color = ghost.validity === "ok" ? 0x22c55e : ghost.validity === "warn" ? 0xf59e0b : 0xef4444;
    g.traverse((m) => {
      if (m instanceof Mesh) {
        m.material = new MeshStandardMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false });
      }
    });
    g.position.set(ghost.x, ghost.elevation, ghost.z);
    g.rotation.y = ghost.rotationDeg * D2R;
    this.ghostGroup.add(g);
    // Door sweep arc preview on the ground.
    if (ghost.kind === "door") {
      const sweep = doorSweep({ x: ghost.x, z: ghost.z, rotationDeg: ghost.rotationDeg, width: ghost.dims.width, hinge: ghost.door?.hinge, openInward: ghost.door?.openInward, openDeg: ghost.door?.openDeg } as SceneObject);
      this.ghostGroup.add(this.buildArc(sweep, color));
    }
  }

  private buildArc(s: { hingeX: number; hingeZ: number; radius: number; startAngle: number; sweepAngle: number }, color: number): Object3D {
    const pos: number[] = [];
    const steps = 24;
    for (let i = 0; i < steps; i++) {
      const a0 = s.startAngle + (s.sweepAngle * i) / steps;
      const a1 = s.startAngle + (s.sweepAngle * (i + 1)) / steps;
      pos.push(s.hingeX + Math.cos(a0) * s.radius, 0.04, s.hingeZ + Math.sin(a0) * s.radius);
      pos.push(s.hingeX + Math.cos(a1) * s.radius, 0.04, s.hingeZ + Math.sin(a1) * s.radius);
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
    return new LineSegments(geo, new LineBasicMaterial({ color }));
  }

  private syncMeasurements(project: Project, simplify: boolean): void {
    this.measureGroup.visible = !simplify;
    const seen = new Set<string>();
    for (const m of project.measurements) {
      if (!m.visible) continue;
      seen.add(m.id);
      const sig = `${m.start.x}|${m.start.z}|${m.end.x}|${m.end.z}|${m.color}`;
      let entry = this.measureNodes.get(m.id);
      if (!entry || entry.sig !== sig) {
        if (entry) { this.measureGroup.remove(entry.group); entry.label.dispose(); }
        entry = this.buildMeasure(m.start, m.end, m.color, sig);
        this.measureGroup.add(entry.group);
        this.measureNodes.set(m.id, entry);
      }
      entry.label.set(measureText(m.start, m.end), "#fde68a");
      entry.label.sprite.position.set((m.start.x + m.end.x) / 2, 0.35, (m.start.z + m.end.z) / 2);
    }
    for (const [id, entry] of this.measureNodes) {
      if (!seen.has(id)) { this.measureGroup.remove(entry.group); entry.label.dispose(); this.measureNodes.delete(id); }
    }
  }

  private buildMeasure(a: { x: number; z: number }, b: { x: number; z: number }, color: string, sig: string) {
    const group = new Group();
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute([a.x, 0.07, a.z, b.x, 0.07, b.z], 3));
    group.add(new LineSegments(geo, new LineBasicMaterial({ color })));
    for (const p of [a, b]) {
      const dot = new Mesh(new BoxGeometry(0.12, 0.12, 0.12), new MeshBasicMaterial({ color }));
      dot.position.set(p.x, 0.09, p.z);
      group.add(dot);
    }
    const label = new TextLabel();
    group.add(label.sprite);
    return { group, label, sig };
  }

  private syncOverlay(project: Project, session: SessionView): void {
    const { selection, measure, calibrate } = session;
    clearGroup(this.overlayGroup);

    // Route focus: dark plane over the whole plan + a bright copy of the focused route on top.
    if (session.focusRouteId) {
      const focus = project.routes.find((r) => r.id === session.focusRouteId);
      const b = this.combinedBounds(project);
      const plane = new Mesh(
        new PlaneGeometry(b.w + 4, b.h + 4),
        new MeshBasicMaterial({
          color: this.palette.focusVeil,
          transparent: true,
          opacity: this.palette.focusVeilOpacity,
          depthWrite: false,
        }),
      );
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(b.cx, 3, b.cz);
      this.overlayGroup.add(plane);
      if (focus) {
        const vis = this.buildRoute({ id: focus.id, color: focus.color, points: focus.points }, 3.1, false, "");
        this.overlayGroup.add(vis.group);
        vis.label.set(focus.name, focus.color);
      }
    }

    // Simulation markers + bottleneck warnings + station queue badges.
    if (session.simStations?.length) {
      for (const st of session.simStations) {
        const q = st.queue;
        const color = q >= 6 ? 0xef4444 : q >= 3 ? 0xf59e0b : 0x22c55e;
        const pad = new Mesh(
          new BoxGeometry(0.7, 0.04, 0.7),
          new MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false }),
        );
        pad.position.set(st.x, 0.55, st.z);
        this.overlayGroup.add(pad);
        if (!this.stationLabels.has(st.id)) this.stationLabels.set(st.id, new TextLabel());
        const label = this.stationLabels.get(st.id)!;
        this.overlayGroup.add(label.sprite);
        label.set(`${st.name}${q ? ` ${q}` : ""}`, q >= 6 ? "#fecaca" : q >= 3 ? "#fde68a" : "#bbf7d0");
        label.sprite.position.set(st.x, 1.1, st.z);
      }
    }
    // §58/§59: the selected prop's standing positions, on the floor.
    for (const a of session.propAnchors ?? []) {
      const color = ANCHOR_COLOR[a.role] ?? 0x94a3b8;
      const pad = new Mesh(
        new CylinderGeometry(0.24, 0.24, 0.03, 20),
        new MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthWrite: false }),
      );
      pad.position.set(a.x, 0.05, a.z);
      this.overlayGroup.add(pad);
      const key = `anchor:${a.role}`;
      const label = this.anchorLabels.get(key) ?? new TextLabel();
      this.anchorLabels.set(key, label);
      this.overlayGroup.add(label.sprite);
      label.set(a.label, ANCHOR_TEXT[a.role] ?? "#e2e8f0");
      label.sprite.position.set(a.x, 0.75, a.z);
    }

    // People are drawn by SimCrowd in its own persistent group — instanced and
    // reused, so playback does not allocate a mesh per person per frame.
    this.crowd.update(session.simPositions);
    if (session.bottlenecks && session.bottlenecks.length) {
      const seenBottleneckLabels = new Set<string>();
      for (const bn of session.bottlenecks) {
        const ring = new Mesh(new BoxGeometry(1.2, 0.05, 1.2), new MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.4, depthWrite: false }));
        ring.position.set(bn.x, 0.6, bn.z);
        this.overlayGroup.add(ring);
        if (bn.name) {
          const key = `${bn.kind ?? "route"}|${bn.x.toFixed(2)}|${bn.z.toFixed(2)}`;
          seenBottleneckLabels.add(key);
          const label = this.bottleneckLabels.get(key) ?? new TextLabel();
          this.bottleneckLabels.set(key, label);
          this.overlayGroup.add(label.sprite);
          label.set(`${bn.name} ${bn.count}`, "#fecaca");
          label.sprite.position.set(bn.x, 1.15, bn.z);
        }
      }
      for (const [key, label] of this.bottleneckLabels) {
        if (!seenBottleneckLabels.has(key)) {
          label.dispose();
          this.bottleneckLabels.delete(key);
        }
      }
    } else {
      for (const label of this.bottleneckLabels.values()) label.dispose();
      this.bottleneckLabels.clear();
    }

    for (const o of project.objects) {
      if (!selection.has(o.id)) continue;
      this.overlayGroup.add(this.footprintOutline(o.x, o.z, o.width, o.depth, o.rotationDeg));
    }
    for (const z of project.zones) {
      if (!selection.has(z.id)) continue;
      this.overlayGroup.add(this.footprintOutline(z.x, z.z, z.width, z.depth, 0));
    }
    for (const g of project.groups) {
      if (!selection.has(g.id)) continue;
      for (const m of groupMembers(g)) this.overlayGroup.add(this.footprintOutline(m.x, m.z, g.itemWidth, g.itemDepth, m.rotationDeg));
    }
    const tabletopHost = session.tabletopHostId
      ? project.objects.find((o) => o.id === session.tabletopHostId)
      : undefined;
    if (tabletopHost) {
      // Detail mode needs an unambiguous legal surface, not just the table's
      // legs. This outline sits on the actual tabletop height and stays visible
      // while small props are selected or dragged.
      this.overlayGroup.add(this.footprintOutline(
        tabletopHost.x, tabletopHost.z, tabletopHost.width, tabletopHost.depth,
        tabletopHost.rotationDeg, tabletopHost.elevation + tabletopHost.height + 0.018, "#22d3ee",
      ));
    }
    // Live measure / calibrate line + endpoints.
    const live = measure && (measure.a || measure.b) ? measure : (calibrate && (calibrate.a || calibrate.b) ? calibrate : null);
    const liveColor = measure && (measure.a || measure.b) ? 0xfacc15 : 0x38bdf8;
    if (live) {
      for (const p of [live.a, live.b]) {
        if (!p) continue;
        const dot = new Mesh(new BoxGeometry(0.15, 0.15, 0.15), new MeshBasicMaterial({ color: liveColor }));
        dot.position.set(p.x, 0.1, p.z);
        this.overlayGroup.add(dot);
      }
      if (live.a && live.b) {
        const geo = new BufferGeometry();
        geo.setAttribute("position", new Float32BufferAttribute([live.a.x, 0.08, live.a.z, live.b.x, 0.08, live.b.z], 3));
        this.overlayGroup.add(new LineSegments(geo, new LineBasicMaterial({ color: liveColor })));
        if (!this.liveLabel) { this.liveLabel = new TextLabel(); }
        this.overlayGroup.add(this.liveLabel.sprite);
        this.liveLabel.set(measureText(live.a, live.b), "#fef9c3");
        this.liveLabel.sprite.position.set((live.a.x + live.b.x) / 2, 0.4, (live.a.z + live.b.z) / 2);
      }
    }
  }

  private footprintOutline(cx: number, cz: number, w: number, d: number, rotDeg: number, y = 0.09, color = SELECT): Object3D {
    const edges = new LineSegments(
      new EdgesGeometry(new PlaneGeometry(w + 0.06, d + 0.06)),
      new LineBasicMaterial({ color }),
    );
    edges.rotation.x = -Math.PI / 2;
    edges.position.set(cx, y, cz);
    edges.rotation.z = rotDeg * D2R;
    return edges;
  }

  // --- picking / projection ---------------------------------------------

  /**
   * Client point → NDC. The canvas element itself is the projection surface, so
   * normalisation stays canvas-relative; the *visible* rect is applied through
   * the asymmetric frustum instead, which keeps raycasts and screen projection
   * exactly consistent with what is drawn.
   */
  private ndc(clientX: number, clientY: number): Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    return new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  }

  /**
   * Keep a client point inside the visible canvas. Used for the touch ghost
   * offset so a placement preview lifted above the finger cannot slide under
   * the header or behind a bottom sheet.
   */
  clampClientToVisible(clientX: number, clientY: number, pad = 8): { x: number; y: number } {
    const v = this.viewport;
    if (!v) return { x: clientX, y: clientY };
    return clampPointToRect({ x: clientX, y: clientY }, v.focus, pad);
  }

  groundPoint(clientX: number, clientY: number): { x: number; z: number } | null {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const hit = new Vector3();
    const res = this.raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), hit);
    return res ? { x: hit.x, z: hit.z } : null;
  }

  /**
   * Every hit under a pointer, nearest first. The editor uses this rather than
   * throwing away lower intersections so a small QR stand behind a display
   * card remains selectable on a crowded tabletop.
   */
  pickAll(clientX: number, clientY: number): PickResult[] {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const results: PickResult[] = [];
    const seen = new Set<string>();
    const add = (hit: PickResult) => {
      const key = `${hit.type}:${hit.id}:${hit.index ?? ""}`;
      if (!seen.has(key)) { seen.add(key); results.push(hit); }
    };
    if (this.layersState.routes) {
      const rn = this.raycaster.intersectObjects(this.routeNodeMeshes, false);
      for (const h of rn) { const u = h.object.userData; add({ type: "routeNode", id: u.id, index: u.index }); }
    }
    if (this.layersState.objects) {
      const objs: Object3D[] = [];
      for (const e of this.objectNodes.values()) if (e.group.visible) objs.push(e.group);
      const hit = this.raycaster.intersectObjects(objs, true);
      for (const h of hit) { const id = ancestorId(h.object); if (id) add({ type: "object", id }); }
      const arrays: Object3D[] = [];
      for (const e of this.arrayNodes.values()) if (e.mesh.visible) arrays.push(e.mesh);
      const ah = this.raycaster.intersectObjects(arrays, false);
      for (const h of ah) add({ type: "group", id: h.object.userData.id });
    }
    if (this.layersState.zones) {
      const fills: Object3D[] = [];
      for (const e of this.zoneNodes.values()) if (e.group.visible) { const f = e.group.getObjectByName("fill"); if (f) fills.push(f); }
      const hit = this.raycaster.intersectObjects(fills, false);
      for (const h of hit) add({ type: "zone", id: h.object.userData.id });
    }
    return results;
  }

  pick(clientX: number, clientY: number): PickResult | null {
    return this.pickAll(clientX, clientY)[0] ?? null;
  }

  /**
   * Pan so a world point lands at the centre of the *visible* canvas — used by
   * validation focus, simulation focus and "locate this object". On a compact
   * workspace the canvas centre is behind the bottom sheet, so targeting the
   * canvas would put the thing the user asked to see under the chrome.
   */
  focusOn(x: number, z: number): void {
    this.setFocusAnchor(new Vector3(x, 0, z));
  }

  /**
   * Frame a world-space rectangle inside the visible canvas: pick the zoom from
   * the focus rect's pixel size, then anchor the content centre on it.
   */
  fitBounds(
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
    opts: { padding?: number; heightMeters?: number } = {},
  ): void {
    const { focus } = this.rects();
    this.lastFitBounds = { ...bounds };
    const padding = opts.padding ?? 0.9;
    const height = Math.max(0, opts.heightMeters ?? 2.4);

    this.camera.updateMatrixWorld();
    const right = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    const center = new Vector3(
      (bounds.minX + bounds.maxX) / 2,
      height / 2,
      (bounds.minZ + bounds.maxZ) / 2,
    );

    // Measure the content's extent along the camera's own axes so an iso view
    // (where the plan is rotated on screen) is framed as tightly as a top view.
    let halfU = 0;
    let halfV = 0;
    for (const x of [bounds.minX, bounds.maxX]) {
      for (const y of [0, height]) {
        for (const z of [bounds.minZ, bounds.maxZ]) {
          const d = new Vector3(x, y, z).sub(center);
          halfU = Math.max(halfU, Math.abs(d.dot(right)));
          halfV = Math.max(halfV, Math.abs(d.dot(up)));
        }
      }
    }

    const usableW = Math.max(1, focus.width * padding);
    const usableH = Math.max(1, focus.height * padding);

    this.camera.zoom = 1;
    this.worldPerPx = Math.max((2 * halfU) / usableW, (2 * halfV) / usableH, 1e-4);
    this.applyProjection();
    this.setFocusAnchor(center.setY(0), focus);
  }

  /** Recenter + zoom the camera so the whole plan fills the visible canvas. */
  /**
   * A stored visual finished loading after the fact (GLB rehydration): the
   * objects adopted with the proxy box while the bytes were still in
   * IndexedDB must be rebuilt. Their signatures did not change — the cache
   * behind `resolveVisualGroup` did — so these nodes are dropped by hand and
   * the next sync builds them from the now-cached model.
   */
  invalidateVisualRefs(refs: readonly string[]): void {
    if (!refs.length) return;
    const marks = refs.map((ref) => `|${ref}|`);
    for (const [id, entry] of [...this.objectNodes]) {
      if (!marks.some((m) => entry.sig.includes(m))) continue;
      this.objectGroup.remove(entry.group);
      disposeObject(entry.group);
      entry.label?.dispose();
      this.objectNodes.delete(id);
    }
  }

  recenterView(project: Project): void {
    this.userAdjustedCamera = false;
    this.fitBounds(primaryWorkAreaBounds(project));
  }

  project(x: number, z: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const v = new Vector3(x, 0, z).project(this.camera);
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  /**
   * Snapshot the current 3D scene (used for the 3D iso export image).
   * Editor-only layers (selection outlines, placement ghost, live measure,
   * simulation markers) are hidden for the shot so none of them bake into
   * the exported PNG.
   */
  renderToDataURL(project: Project, view: ViewName): string {
    const editorLayers = [this.ghostGroup, this.overlayGroup, this.measureGroup, this.crowd.group];
    const prevVisible = editorLayers.map((g) => g.visible);
    const savedPosition = this.camera.position.clone();
    const savedQuaternion = this.camera.quaternion.clone();
    const savedUp = this.camera.up.clone();
    const savedZoom = this.camera.zoom;
    const savedTarget = this.target.clone();
    const savedControlTarget = this.controls.target.clone();
    const savedRotate = this.controls.enableRotate;
    const savedWorldPerPx = this.worldPerPx;
    const savedPixelRatio = Math.min(window.devicePixelRatio, 2);
    const savedBackground = this.scene.background;
    for (const g of editorLayers) g.visible = false;
    try {
      const shotW = 2560;
      const shotH = 1600;
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(shotW, shotH, false);
      this.setView(view);
      this.fitExportBounds(planBounds(project), shotW, shotH);
      // The 場刊 is a paper document. Render its 3D page on the light palette
      // even when the editor is in dark mode, so every exported page is one
      // consistent artifact instead of a near-black sheet among white ones.
      this.applyPalette(EXPORT_PALETTE);
      this.syncAreasAndTiles(project, false);
      this.renderer.render(this.scene, this.camera);
      return this.cropExportBackground(this.renderer.domElement, EXPORT_PALETTE.background, project);
    } finally {
      editorLayers.forEach((g, i) => (g.visible = prevVisible[i]));
      this.applyPalette(scenePalette(this.theme));
      this.syncAreasAndTiles(project, false);
      this.scene.background = savedBackground;
      this.renderer.setPixelRatio(savedPixelRatio);
      this.renderer.setSize(this.canvas.clientWidth || window.innerWidth, this.canvas.clientHeight || window.innerHeight, false);
      this.camera.position.copy(savedPosition);
      this.camera.quaternion.copy(savedQuaternion);
      this.camera.up.copy(savedUp);
      this.camera.zoom = savedZoom;
      this.target.copy(savedTarget);
      this.controls.target.copy(savedControlTarget);
      this.controls.enableRotate = savedRotate;
      this.worldPerPx = savedWorldPerPx;
      this.applyProjection();
      this.renderer.render(this.scene, this.camera);
    }
  }

  /** Fit a snapshot independently of the editor viewport and user's zoom. */
  private fitExportBounds(
    bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
    width: number,
    height: number,
  ): void {
    const contentHeight = 3.8;
    const center = new Vector3((bounds.minX + bounds.maxX) / 2, contentHeight * 0.38, (bounds.minZ + bounds.maxZ) / 2);
    const offset = this.camera.position.clone().sub(this.target);
    this.target.copy(center);
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(offset);
    this.camera.lookAt(center);
    this.camera.zoom = 1;
    this.camera.updateMatrixWorld();
    const right = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    let halfU = 0;
    let halfV = 0;
    for (const x of [bounds.minX, bounds.maxX]) {
      for (const y of [0, contentHeight]) {
        for (const z of [bounds.minZ, bounds.maxZ]) {
          const d = new Vector3(x, y, z).sub(center);
          halfU = Math.max(halfU, Math.abs(d.dot(right)));
          halfV = Math.max(halfV, Math.abs(d.dot(up)));
        }
      }
    }
    this.worldPerPx = Math.max((2 * halfU) / (width * 0.88), (2 * halfV) / (height * 0.88), 1e-4);
    this.camera.left = (-width / 2) * this.worldPerPx;
    this.camera.right = (width / 2) * this.worldPerPx;
    this.camera.top = (height / 2) * this.worldPerPx;
    this.camera.bottom = (-height / 2) * this.worldPerPx;
    this.camera.near = -200;
    this.camera.far = 500;
    this.camera.updateProjectionMatrix();
  }

  /** Remove the solid scene background around the fitted plan. */
  private cropExportBackground(source: HTMLCanvasElement, background: number, project: Project): string {
    const raster = document.createElement("canvas");
    raster.width = source.width;
    raster.height = source.height;
    const ctx = raster.getContext("2d");
    if (!ctx) return source.toDataURL("image/png");
    ctx.drawImage(source, 0, 0);
    const image = ctx.getImageData(0, 0, source.width, source.height);
    const br = (background >> 16) & 255;
    const bg = (background >> 8) & 255;
    const bb = background & 255;
    let minX = source.width, minY = source.height, maxX = -1, maxY = -1;
    for (let y = 0; y < source.height; y++) {
      for (let x = 0; x < source.width; x++) {
        const i = (y * source.width + x) * 4;
        if (Math.abs(image.data[i] - br) + Math.abs(image.data[i + 1] - bg) + Math.abs(image.data[i + 2] - bb) > 12) {
          minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
      }
    }
    if (maxX < 0) return source.toDataURL("image/png");
    const margin = 24;
    minX = Math.max(0, minX - margin); minY = Math.max(0, minY - margin);
    maxX = Math.min(source.width - 1, maxX + margin); maxY = Math.min(source.height - 1, maxY + margin);
    const croppedW = maxX - minX + 1;
    const croppedH = maxY - minY + 1;
    const headerH = 118;
    const framed = document.createElement("canvas");
    framed.width = croppedW;
    framed.height = croppedH + headerH;
    const out = framed.getContext("2d")!;
    out.fillStyle = "#e9eef5";
    out.fillRect(0, 0, framed.width, framed.height);
    out.fillStyle = "#0f172a";
    out.font = "700 42px system-ui, 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif";
    out.fillText(project.name, 34, 51);
    out.fillStyle = "#64748b";
    out.font = "600 24px system-ui, 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif";
    // Asked, not asserted. This line used to be hard-coded, so it stamped
    // 「尺寸待現場校正」 over a plan whose owner had typed their own measured
    // room size — and it kept saying it after a full field calibration, while
    // the other seven sheets correctly dropped it. One artifact in the album
    // contradicting the rest is worse than either answer alone.
    const pending = venueNeedsCalibration(project) && !calibrationComplete(project)
      ? " · 尺寸待現場校正"
      : "";
    out.fillText(`3D 場佈圖 · 微立體視角${pending}`, 34, 88);
    out.drawImage(source, minX, minY, croppedW, croppedH, 0, headerH, croppedW, croppedH);
    return framed.toDataURL("image/png");
  }
}

/** Point half-way along a polyline by arc length — where a route name reads best. */
function polylineMidpoint(points: { x: number; z: number }[]): { x: number; z: number } | null {
  if (!points.length) return null;
  if (points.length === 1) return points[0];
  let total = 0;
  const segs: number[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const d = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].z - points[i].z);
    segs.push(d);
    total += d;
  }
  if (total < 1e-6) return points[0];
  let travelled = 0;
  for (let i = 0; i < segs.length; i++) {
    if (travelled + segs[i] >= total / 2) {
      const t = segs[i] < 1e-6 ? 0 : (total / 2 - travelled) / segs[i];
      return {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        z: points[i].z + (points[i + 1].z - points[i].z) * t,
      };
    }
    travelled += segs[i];
  }
  return points[points.length - 1];
}

/** ①②③… for partner-facing step numbers; falls back to plain digits past 20. */
function circledNumber(n: number): string {
  return n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : String(n);
}

const ROUTE_ICONS: Record<string, string> = {
  entry: "🚪", registration: "👋", shoe: "👟", backpack: "🎒",
  seating: "🧎", group: "👥", staff: "🦺", custom: "➰",
};

function routeIcon(route: { id: string; color: string; points: unknown[] } & { type?: string }): string {
  return ROUTE_ICONS[route.type ?? ""] ?? "➰";
}

/** World-space bounds of the whole plan (classroom + corridor). */
export function planBounds(project: Project): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const { classroom, corridor } = project;
  return {
    minX: Math.min(classroom.x, corridor.x),
    minZ: Math.min(classroom.z, corridor.z),
    maxX: Math.max(classroom.x + classroom.length, corridor.x + corridor.length),
    maxZ: Math.max(classroom.z + classroom.width, corridor.z + corridor.width),
  };
}

/**
 * A booth's roof, backdrop and tall signs make the place recognisable, but
 * they are not the work the organiser must inspect. Initial camera framing
 * follows routes, stations, zones and tables first; export framing still uses
 * the full venue through `planBounds` so a 場刊 never silently crops context.
 */
export function primaryWorkAreaBounds(project: Project): { minX: number; maxX: number; minZ: number; maxZ: number } {
  if (!isBoothProject(project)) return planBounds(project);
  const included: { minX: number; maxX: number; minZ: number; maxZ: number }[] = [];
  const include = (minX: number, maxX: number, minZ: number, maxZ: number) => {
    included.push({ minX, maxX, minZ, maxZ });
  };
  for (const zone of project.zones) {
    if (!zone.hidden) include(zone.x - zone.width / 2, zone.x + zone.width / 2, zone.z - zone.depth / 2, zone.z + zone.depth / 2);
  }
  for (const route of project.routes) {
    if (!route.visible) continue;
    for (const point of route.points) include(point.x, point.x, point.z, point.z);
  }
  for (const object of project.objects) {
    if (object.hidden || /tent|backdrop|banner|standee|flag/i.test(object.assetId ?? "")) continue;
    include(object.x - object.width / 2, object.x + object.width / 2, object.z - object.depth / 2, object.z + object.depth / 2);
  }
  if (!included.length) return planBounds(project);
  const bounds = included.reduce((all, next) => ({
    minX: Math.min(all.minX, next.minX),
    maxX: Math.max(all.maxX, next.maxX),
    minZ: Math.min(all.minZ, next.minZ),
    maxZ: Math.max(all.maxZ, next.maxZ),
  }));
  const pad = 0.7;
  return {
    minX: bounds.minX - pad,
    maxX: bounds.maxX + pad,
    minZ: bounds.minZ - pad,
    maxZ: bounds.maxZ + pad,
  };
}

interface Route2 { id: string; color: string; type?: string; points: { x: number; z: number }[] }

function round(n: number): number { return Math.round(n * 1000) / 1000; }

function isFieldMatGroup(g: Project["groups"][number]): boolean {
  return g.sourceKind === "mat" && Math.abs(g.itemWidth - 0.6) < 1e-6 && Math.abs(g.itemDepth - 0.6) < 1e-6;
}

/** Deterministic, sparse batch variation — deliberately not a chess pattern. */
export function matBatchVariation(row: number, col: number): -1 | 0 | 1 {
  let hash = Math.imul(row + 1, 73856093) ^ Math.imul(col + 1, 19349663);
  hash ^= hash >>> 13;
  const sample = (hash >>> 0) % 100;
  if (sample < 7) return 1;
  if (sample > 94) return -1;
  return 0;
}

function measureText(a: { x: number; z: number }, b: { x: number; z: number }): string {
  const m = Math.hypot(b.x - a.x, b.z - a.z);
  return `${m.toFixed(2)} m · ${Math.round(m * 100)} cm`;
}

function ancestorId(obj: Object3D): string | null {
  let o: Object3D | null = obj;
  while (o) {
    if (o.userData && o.userData.type === "object" && o.userData.id) return o.userData.id as string;
    o = o.parent;
  }
  return null;
}

function clearGroup(group: Group): void {
  for (let i = group.children.length - 1; i >= 0; i--) {
    const child = group.children[i];
    group.remove(child);
    disposeObject(child);
  }
}

function disposeObject(obj: Object3D): void {
  obj.traverse((o) => {
    if (o instanceof Mesh || o instanceof LineSegments || o instanceof InstancedMesh) {
      (o as Mesh).geometry?.dispose?.();
    }
    if (o instanceof Sprite) {
      const m = o.material as SpriteMaterial;
      m.map?.dispose?.();
      m.dispose?.();
    }
  });
}
