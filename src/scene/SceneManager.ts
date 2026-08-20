import {
  BoxGeometry,
  BufferGeometry,
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
  Object3D,
  OrthographicCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { AssetCatalog } from "../core/catalog";
import { catalogFromProject } from "../core/migrate";
import type { ObjectKind, Project, SceneObject, ViewName, Zone } from "../core/model";
import { groupMembers } from "../core/arrays";
import { doorSweep } from "../core/placement";
import { buildMergedGeometry, assetInstanceMaterial } from "./assets";
import { applyRendererLook, installStudioLighting } from "./lighting";
import { TextLabel } from "./label";
import { resolveVisualGroup } from "./visualRegistry";
import { clampPointToRect, rectCenterNdc, type Rect } from "../core/viewport";
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
  focusRouteId?: string | null;
  simplify?: boolean;
  simPositions?: { x: number; z: number; routeId?: string; state?: string }[];
  bottlenecks?: { x: number; z: number; count: number }[];
  simQueues?: Record<string, number>;
  simStations?: { id: string; name: string; x: number; z: number; queue: number }[];
  /** Non-null in Partner Mode: emphasis per entity plus red/orange/green marks. */
  partner?: PartnerPresentation | null;
}

/** How the scene should present a plan to a partner rather than an editor. */
export interface PartnerPresentation {
  role: PartnerRole;
  emphasis: PartnerEmphasis;
  marks: PartnerMark[];
}

const MARK_COLOR: Record<PartnerMark["tone"], string> = {
  bad: "#ef4444",
  warn: "#f59e0b",
  ok: "#22c55e",
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
  private partnerGroup = new Group(); // partner-mode marks (never in editor mode)

  private objectNodes = new Map<string, { group: Group; label: TextLabel | null; sig: string }>();
  private stationLabels = new Map<string, TextLabel>();
  private arrayNodes = new Map<string, { mesh: InstancedMesh; sig: string }>();
  private zoneNodes = new Map<string, { group: Group; label: TextLabel; sig: string }>();
  private routeNodes = new Map<string, { group: Group; label: TextLabel; sig: string }>();
  private measureNodes = new Map<string, { group: Group; label: TextLabel; sig: string }>();
  private routeNodeMeshes: Mesh[] = [];
  private liveLabel: TextLabel | null = null;

  private layersState = { areas: true, zones: true, objects: true, tiles: true, routes: true };
  private lastAreaSig = "";
  private lastGhostSig = "";

  private catalog: AssetCatalog = new AssetCatalog();

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    applyRendererLook(this.renderer);

    this.scene = new Scene();
    this.scene.background = new Color(0x0b1120);
    this.scene.add(
      this.floorGroup, this.tileGroup, this.zoneGroup, this.objectGroup,
      this.arrayGroupRoot, this.routeGroup, this.ghostGroup, this.measureGroup, this.overlayGroup,
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
    // Whatever sat at the centre of the *visible* canvas should still be there
    // after the camera swings around; the framing offset differs per basis.
    const anchor = this.getFocusAnchor();
    const d = 60;
    const t = this.target;
    switch (view) {
      case "iso": this.camera.position.set(t.x + d, d, t.z + d); this.controls.enableRotate = true; break;
      case "top": this.camera.position.set(t.x, d, t.z + 0.001); this.controls.enableRotate = false; break;
      case "front": this.camera.position.set(t.x, 4, t.z + d); this.controls.enableRotate = true; break;
      case "left": this.camera.position.set(t.x - d, 4, t.z); this.controls.enableRotate = true; break;
      case "right": this.camera.position.set(t.x + d, 4, t.z); this.controls.enableRotate = true; break;
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

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.applyProjection();
  }

  // --- workspace viewport (CanvasSafeRect) --------------------------------

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
    const simplify = session.simplify ?? false;
    const partner = session.partner ?? null;
    this.partner = partner;
    this.syncAreasAndTiles(project, simplify);
    this.syncObjects(project, session.showLabels, simplify);
    this.syncArrays(project);
    this.syncZones(project);
    this.syncRoutes(project, session.focusRouteId ?? null);
    this.syncGhost(session.ghost);
    this.syncMeasurements(project, simplify);
    this.syncOverlay(project, session);
    this.syncPartner(partner);
  }

  /** Current partner presentation, or null while the editor is active. */
  private partner: PartnerPresentation | null = null;

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
    this.fitBounds(planBounds(project));
  }

  private combinedBounds(project: Project): { cx: number; cz: number; w: number; h: number } {
    const { classroom, corridor } = project;
    const minX = Math.min(classroom.x, corridor.x);
    const minZ = Math.min(classroom.z, corridor.z);
    const maxX = Math.max(classroom.x + classroom.length, corridor.x + corridor.length);
    const maxZ = Math.max(classroom.z + classroom.width, corridor.z + corridor.width);
    return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, w: maxX - minX, h: maxZ - minZ };
  }

  private syncAreasAndTiles(project: Project, simplify: boolean): void {
    const { tile } = project;
    this.floorGroup.visible = this.layersState.areas;
    this.tileGroup.visible = this.layersState.tiles && tile.visible && !simplify;
    const sig = JSON.stringify({ c: project.classroom, k: project.corridor, t: tile });
    if (sig === this.lastAreaSig) return;
    this.lastAreaSig = sig;
    if (!this.hasCentered) { this.recenter(project); this.hasCentered = true; }
    clearGroup(this.floorGroup);
    clearGroup(this.tileGroup);
    for (const area of [project.classroom, project.corridor]) {
      const floor = new Mesh(
        new PlaneGeometry(area.length, area.width),
        new MeshStandardMaterial({ color: area.id === "classroom" ? 0x243040 : 0x1c2734, roughness: 1, side: DoubleSide }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(area.x + area.length / 2, 0, area.z + area.width / 2);
      this.floorGroup.add(floor);
    }
    this.tileGroup.add(this.buildTileGrid(project));
  }

  private buildTileGrid(project: Project): Object3D {
    const { classroom, corridor, tile } = project;
    const minX = Math.min(classroom.x, corridor.x);
    const minZ = Math.min(classroom.z, corridor.z);
    const maxX = Math.max(classroom.x + classroom.length, corridor.x + corridor.length);
    const maxZ = Math.max(classroom.z + classroom.width, corridor.z + corridor.width);
    const positions: number[] = [];
    const w = Math.max(tile.width, 0.05);
    const d = Math.max(tile.depth, 0.05);
    let sx = tile.originX; while (sx > minX) sx -= w;
    for (let x = sx; x <= maxX + 1e-6; x += w) positions.push(x, 0, minZ, x, 0, maxZ);
    let sz = tile.originZ; while (sz > minZ) sz -= d;
    for (let z = sz; z <= maxZ + 1e-6; z += d) positions.push(minX, 0, z, maxX, 0, z);
    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
    const grid = new LineSegments(geo, new LineBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.5 }));
    grid.position.y = 0.003;
    grid.rotation.y = tile.rotationDeg * D2R;
    return grid;
  }

  private syncObjects(project: Project, showLabels: boolean, simplify: boolean): void {
    this.objectGroup.visible = this.layersState.objects;
    const seen = new Set<string>();
    for (const o of project.objects) {
      seen.add(o.id);
      const catalogEntry = this.catalog.resolve(o.assetId, o.kind);
      const quality = "standard";
      const sig = `${o.assetId ?? o.kind}|${catalogEntry.visualRef}|${o.width}|${o.depth}|${o.height}|${o.hinge}|${o.openInward}|${o.openDeg}|${quality}`;
      let entry = this.objectNodes.get(o.id);
      if (!entry || entry.sig !== sig) {
        if (entry) { this.objectGroup.remove(entry.group); disposeObject(entry.group); entry.label?.dispose(); }
        const group = resolveVisualGroup(
          catalogEntry,
          o.kind,
          { width: o.width, depth: o.depth, height: o.height },
          o.kind === "door" ? { hinge: o.hinge, openInward: o.openInward, openDeg: o.openDeg } : undefined,
          quality,
        );
        group.userData = { type: "object", id: o.id };
        group.traverse((m) => { if (m instanceof Mesh) m.userData = { type: "object", id: o.id }; });
        // Enlarged invisible pick proxy for thin wall assets (easier touch targets).
        if (catalogEntry.placementType === "wall") {
          const pw = Math.max(o.width, 0.5), ph = Math.max(o.height, 1.0), pd = Math.max(o.depth, 0.45);
          const proxy = new Mesh(new BoxGeometry(pw, ph, pd), new MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 }));
          proxy.position.y = ph / 2;
          proxy.userData = { type: "object", id: o.id };
          group.add(proxy);
        }
        this.objectGroup.add(group);
        const label = LANDMARKS.has(o.kind) || catalogEntry.category === "service" ? new TextLabel() : null;
        if (label) this.objectGroup.add(label.sprite);
        entry = { group, label, sig };
        this.objectNodes.set(o.id, entry);
      }
      entry.group.position.set(o.x, o.elevation, o.z);
      entry.group.rotation.y = o.rotationDeg * D2R;
      // In Partner Mode, objects that belong to another role drop out entirely:
      // their materials are shared from a cache, so fading them would tint every
      // other object of the same kind too.
      const roleMuted = !!this.partner && this.partner.emphasis.objects[o.id] === "muted";
      entry.group.visible = !o.hidden && !(simplify && SIMPLIFY_HIDE.has(o.kind)) && !roleMuted;
      if (entry.label) {
        entry.label.sprite.visible = showLabels && !o.hidden;
        if (showLabels) {
          entry.label.set(catalogEntry.name, "#e2e8f0");
          entry.label.sprite.position.set(o.x, o.elevation + o.height + 0.35, o.z);
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
  }

  private syncArrays(project: Project): void {
    this.arrayGroupRoot.visible = this.layersState.objects;
    const seen = new Set<string>();
    const dummy = new Object3D();
    for (const g of project.groups) {
      seen.add(g.id);
      const members = groupMembers(g);
      const sig = `${g.sourceKind}|${g.itemWidth}|${g.itemDepth}|${g.itemHeight}|${members.length}|${JSON.stringify(members.map((m) => [round(m.x), round(m.z), m.rotationDeg]))}`;
      let entry = this.arrayNodes.get(g.id);
      if (!entry || entry.sig !== sig) {
        if (entry) { this.arrayGroupRoot.remove(entry.mesh); entry.mesh.geometry.dispose(); }
        const geom = buildMergedGeometry(g.sourceKind, { width: g.itemWidth, depth: g.itemDepth, height: g.itemHeight });
        const material = assetInstanceMaterial(g.sourceKind).clone();
        const mesh = new InstancedMesh(geom, material, Math.max(members.length, 1));
        mesh.count = members.length;
        mesh.userData = { type: "group", id: g.id };
        for (let i = 0; i < members.length; i++) {
          dummy.position.set(members[i].x, 0, members[i].z);
          dummy.rotation.set(0, members[i].rotationDeg * D2R, 0);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        mesh.instanceMatrix.needsUpdate = true;
        this.arrayGroupRoot.add(mesh);
        entry = { mesh, sig };
        this.arrayNodes.set(g.id, entry);
      }
      entry.mesh.visible = !g.hidden;
    }
    for (const [id, entry] of this.arrayNodes) {
      if (!seen.has(id)) {
        this.arrayGroupRoot.remove(entry.mesh); entry.mesh.geometry.dispose();
        this.arrayNodes.delete(id);
      }
    }
  }

  private syncZones(project: Project): void {
    this.zoneGroup.visible = this.layersState.zones;
    const partner = this.partner;
    const seen = new Set<string>();
    for (const zone of project.zones) {
      seen.add(zone.id);
      // Partner labels are drawn at a higher texture resolution, so the mode
      // is part of the signature and the node is rebuilt when it changes.
      const sig = `${zone.width}|${zone.depth}|${partner ? "partner" : "editor"}`;
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
      if (partner) {
        // A zone the current role owns reads as a solid, labelled place; the
        // rest stay as faint context so the room still makes sense.
        const muted = partner.emphasis.zones[zone.id] === "muted";
        fillMat.opacity = muted ? 0.07 : 0.4;
        edgeMat.opacity = muted ? 0.25 : 1;
        entry.label.sprite.visible = !muted;
        entry.label.set(`${zone.icon ?? ""} ${zone.name}${cap}`.trim(), "#f8fafc");
      } else {
        fillMat.opacity = 0.2;
        edgeMat.opacity = 0.9;
        entry.label.sprite.visible = true;
        entry.label.set(`${zone.icon ?? ""}${zone.name}${cap}`.trim(), "#e2e8f0");
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
    const label = partner
      ? new TextLabel({ width: 640, height: 140, fontSize: 62 })
      : new TextLabel();
    if (partner) label.sprite.scale.set(2.9, 0.64, 1);
    label.sprite.position.y = 0.5;
    group.add(label.sprite);
    return { group, label, sig };
  }

  private syncRoutes(project: Project, focusRouteId: string | null): void {
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
      entry.label.sprite.visible = partner ? partner.role !== "all" && !dim : true;
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
        numLabel.set(partner ? circledNumber(index + 1) : String(index + 1), partner ? "#f8fafc" : "#0b1120");
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
        new MeshBasicMaterial({ color: 0x0b1120, transparent: true, opacity: 0.62, depthWrite: false }),
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
    if (session.simPositions && session.simPositions.length) {
      for (const p of session.simPositions) {
        const col =
          p.state === "queued" ? 0xfbbf24 : p.state === "serving" ? 0x38bdf8 : 0xfef08a;
        const dot = new Mesh(new BoxGeometry(0.28, 0.28, 0.28), new MeshBasicMaterial({ color: col }));
        dot.position.set(p.x, 0.5, p.z);
        this.overlayGroup.add(dot);
      }
    }
    if (session.bottlenecks && session.bottlenecks.length) {
      for (const bn of session.bottlenecks) {
        const ring = new Mesh(new BoxGeometry(1.2, 0.05, 1.2), new MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.4, depthWrite: false }));
        ring.position.set(bn.x, 0.6, bn.z);
        this.overlayGroup.add(ring);
      }
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

  private footprintOutline(cx: number, cz: number, w: number, d: number, rotDeg: number): Object3D {
    const edges = new LineSegments(
      new EdgesGeometry(new PlaneGeometry(w + 0.06, d + 0.06)),
      new LineBasicMaterial({ color: SELECT }),
    );
    edges.rotation.x = -Math.PI / 2;
    edges.position.set(cx, 0.09, cz);
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

  pick(clientX: number, clientY: number): PickResult | null {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    if (this.layersState.routes) {
      const rn = this.raycaster.intersectObjects(this.routeNodeMeshes, false);
      if (rn.length) { const u = rn[0].object.userData; return { type: "routeNode", id: u.id, index: u.index }; }
    }
    if (this.layersState.objects) {
      const objs: Object3D[] = [];
      for (const e of this.objectNodes.values()) if (e.group.visible) objs.push(e.group);
      const hit = this.raycaster.intersectObjects(objs, true);
      if (hit.length) { const id = ancestorId(hit[0].object); if (id) return { type: "object", id }; }
      const arrays: Object3D[] = [];
      for (const e of this.arrayNodes.values()) if (e.mesh.visible) arrays.push(e.mesh);
      const ah = this.raycaster.intersectObjects(arrays, false);
      if (ah.length) return { type: "group", id: ah[0].object.userData.id };
    }
    if (this.layersState.zones) {
      const fills: Object3D[] = [];
      for (const e of this.zoneNodes.values()) if (e.group.visible) { const f = e.group.getObjectByName("fill"); if (f) fills.push(f); }
      const hit = this.raycaster.intersectObjects(fills, false);
      if (hit.length) return { type: "zone", id: hit[0].object.userData.id };
    }
    return null;
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
  recenterView(project: Project): void {
    this.userAdjustedCamera = false;
    this.fitBounds(planBounds(project));
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
    const prev = project.view;
    const editorLayers = [this.ghostGroup, this.overlayGroup, this.measureGroup];
    const prevVisible = editorLayers.map((g) => g.visible);
    for (const g of editorLayers) g.visible = false;
    this.setView(view);
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL("image/png");
    editorLayers.forEach((g, i) => (g.visible = prevVisible[i]));
    this.setView(prev);
    this.renderer.render(this.scene, this.camera);
    return url;
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

interface Route2 { id: string; color: string; type?: string; points: { x: number; z: number }[] }

function round(n: number): number { return Math.round(n * 1000) / 1000; }

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
