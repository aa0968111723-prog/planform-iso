import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Color,
  DirectionalLight,
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
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { assetDef } from "../core/assets";
import type { ObjectKind, Project, SceneObject, ViewName, Zone } from "../core/model";
import { groupMembers } from "../core/arrays";
import { doorSweep } from "../core/placement";
import { buildAssetGroup, buildMergedGeometry, assetInstanceMaterial } from "./assets";
import { TextLabel } from "./label";

const D2R = Math.PI / 180;
const SELECT = "#38bdf8";

export interface GhostState {
  kind: ObjectKind;
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
  showLabels: boolean;
}

const LANDMARKS: ReadonlySet<ObjectKind> = new Set<ObjectKind>(["door", "screen", "switch", "regTable", "computer"]);

export class SceneManager {
  private renderer: WebGLRenderer;
  private scene: Scene;
  private camera: OrthographicCamera;
  private controls: OrbitControls;
  private raycaster = new Raycaster();
  private target = new Vector3();
  private frustum = 9;

  private floorGroup = new Group();
  private tileGroup = new Group();
  private zoneGroup = new Group();
  private objectGroup = new Group();
  private arrayGroupRoot = new Group();
  private routeGroup = new Group();
  private ghostGroup = new Group();
  private overlayGroup = new Group(); // selection + measure

  private objectNodes = new Map<string, { group: Group; label: TextLabel | null; sig: string }>();
  private arrayNodes = new Map<string, { mesh: InstancedMesh; sig: string }>();
  private zoneNodes = new Map<string, { group: Group; label: TextLabel; sig: string }>();
  private routeNodes = new Map<string, { group: Group; label: TextLabel; sig: string }>();
  private routeNodeMeshes: Mesh[] = [];

  private layersState = { areas: true, zones: true, objects: true, tiles: true, routes: true };
  private lastAreaSig = "";
  private lastGhostSig = "";

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new Scene();
    this.scene.background = new Color(0x0b1120);
    this.scene.add(
      this.floorGroup, this.tileGroup, this.zoneGroup, this.objectGroup,
      this.arrayGroupRoot, this.routeGroup, this.ghostGroup, this.overlayGroup,
    );

    this.camera = new OrthographicCamera();
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;

    this.scene.add(new AmbientLight(0xffffff, 0.82));
    const sun = new DirectionalLight(0xffffff, 0.95);
    sun.position.set(8, 16, 6);
    this.scene.add(sun);
    const fill = new DirectionalLight(0xffffff, 0.35);
    fill.position.set(-6, 10, -4);
    this.scene.add(fill);

    this.setView("iso");
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  // --- camera ------------------------------------------------------------

  setView(view: ViewName): void {
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
  }

  setControlsEnabled(enabled: boolean): void {
    this.controls.enabled = enabled;
  }

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const aspect = w / h || 1;
    this.camera.left = -this.frustum * aspect;
    this.camera.right = this.frustum * aspect;
    this.camera.top = this.frustum;
    this.camera.bottom = -this.frustum;
    this.camera.near = -200;
    this.camera.far = 500;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  // --- sync --------------------------------------------------------------

  private hasCentered = false;

  sync(project: Project, session: SessionView): void {
    this.layersState = project.layers;
    this.syncAreasAndTiles(project);
    this.syncObjects(project, session.showLabels);
    this.syncArrays(project);
    this.syncZones(project);
    this.syncRoutes(project);
    this.syncGhost(session.ghost);
    this.syncOverlay(project, session.selection, session.measure);
  }

  private recenter(project: Project): void {
    const { classroom, corridor } = project;
    const minX = Math.min(classroom.x, corridor.x);
    const minZ = Math.min(classroom.z, corridor.z);
    const maxX = Math.max(classroom.x + classroom.length, corridor.x + corridor.length);
    const maxZ = Math.max(classroom.z + classroom.width, corridor.z + corridor.width);
    this.target.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  }

  private syncAreasAndTiles(project: Project): void {
    const { tile } = project;
    this.floorGroup.visible = this.layersState.areas;
    this.tileGroup.visible = this.layersState.tiles && tile.visible;
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

  private syncObjects(project: Project, showLabels: boolean): void {
    this.objectGroup.visible = this.layersState.objects;
    const seen = new Set<string>();
    for (const o of project.objects) {
      seen.add(o.id);
      const sig = `${o.kind}|${o.width}|${o.depth}|${o.height}|${o.hinge}|${o.openInward}|${o.openDeg}`;
      let entry = this.objectNodes.get(o.id);
      if (!entry || entry.sig !== sig) {
        if (entry) { this.objectGroup.remove(entry.group); disposeObject(entry.group); entry.label?.dispose(); }
        const group = buildAssetGroup(o.kind, { width: o.width, depth: o.depth, height: o.height },
          o.kind === "door" ? { hinge: o.hinge, openInward: o.openInward, openDeg: o.openDeg } : undefined);
        group.userData = { type: "object", id: o.id };
        group.traverse((m) => { if (m instanceof Mesh) m.userData = { type: "object", id: o.id }; });
        this.objectGroup.add(group);
        const label = LANDMARKS.has(o.kind) ? new TextLabel() : null;
        if (label) this.objectGroup.add(label.sprite);
        entry = { group, label, sig };
        this.objectNodes.set(o.id, entry);
      }
      entry.group.position.set(o.x, o.elevation, o.z);
      entry.group.rotation.y = o.rotationDeg * D2R;
      entry.group.visible = !o.hidden;
      if (entry.label) {
        entry.label.sprite.visible = showLabels && !o.hidden;
        if (showLabels) {
          entry.label.set(assetDef(o.kind).displayName, "#e2e8f0");
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
    const seen = new Set<string>();
    for (const zone of project.zones) {
      seen.add(zone.id);
      const sig = `${zone.width}|${zone.depth}`;
      let entry = this.zoneNodes.get(zone.id);
      if (!entry || entry.sig !== sig) {
        if (entry) { this.zoneGroup.remove(entry.group); entry.label.dispose(); }
        entry = this.buildZone(zone, sig);
        this.zoneGroup.add(entry.group);
        this.zoneNodes.set(zone.id, entry);
      }
      entry.group.position.set(zone.x, 0.02, zone.z);
      entry.group.visible = !zone.hidden;
      const fill = entry.group.getObjectByName("fill") as Mesh;
      const edges = entry.group.getObjectByName("edges") as LineSegments;
      (fill.material as MeshStandardMaterial).color.set(zone.color);
      (edges.material as LineBasicMaterial).color.set(zone.color);
      entry.label.set(zone.name, "#e2e8f0");
    }
    for (const [id, entry] of this.zoneNodes) {
      if (!seen.has(id)) { this.zoneGroup.remove(entry.group); entry.label.dispose(); this.zoneNodes.delete(id); }
    }
  }

  private buildZone(zone: Zone, sig: string) {
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
    const label = new TextLabel();
    label.sprite.position.y = 0.5;
    group.add(label.sprite);
    return { group, label, sig };
  }

  private syncRoutes(project: Project): void {
    this.routeGroup.visible = this.layersState.routes;
    this.routeNodeMeshes = [];
    const seen = new Set<string>();
    for (const route of project.routes) {
      seen.add(route.id);
      const sig = JSON.stringify(route.points) + route.color;
      let entry = this.routeNodes.get(route.id);
      if (!entry || entry.sig !== sig) {
        if (entry) { this.routeGroup.remove(entry.group); entry.label.dispose(); }
        entry = this.buildRoute(route, sig);
        this.routeGroup.add(entry.group);
        this.routeNodes.set(route.id, entry);
      }
      entry.group.visible = route.visible;
      entry.label.set(route.name, route.color);
      entry.group.traverse((o) => { if (o instanceof Mesh && o.userData.type === "routeNode") this.routeNodeMeshes.push(o); });
    }
    for (const [id, entry] of this.routeNodes) {
      if (!seen.has(id)) { this.routeGroup.remove(entry.group); entry.label.dispose(); this.routeNodes.delete(id); }
    }
  }

  private buildRoute(route: Route2, sig: string) {
    const group = new Group();
    const y = 0.05;
    if (route.points.length >= 2) {
      const pos: number[] = [];
      for (let i = 0; i < route.points.length - 1; i++) {
        pos.push(route.points[i].x, y, route.points[i].z, route.points[i + 1].x, y, route.points[i + 1].z);
      }
      const geo = new BufferGeometry();
      geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
      group.add(new LineSegments(geo, new LineBasicMaterial({ color: route.color })));
      for (let i = 0; i < route.points.length - 1; i++) {
        const a = route.points[i]; const b = route.points[i + 1];
        const arrow = new Mesh(new BoxGeometry(0.4, 0.03, 0.18), new MeshStandardMaterial({ color: route.color }));
        arrow.position.set((a.x + b.x) / 2, y, (a.z + b.z) / 2);
        arrow.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
        group.add(arrow);
      }
    }
    route.points.forEach((p, index) => {
      const node = new Mesh(new BoxGeometry(0.24, 0.24, 0.24), new MeshStandardMaterial({ color: route.color }));
      node.position.set(p.x, y, p.z);
      node.userData = { type: "routeNode", id: route.id, index };
      group.add(node);
    });
    const label = new TextLabel();
    if (route.points[0]) label.sprite.position.set(route.points[0].x, 0.7, route.points[0].z);
    group.add(label.sprite);
    return { group, label, sig };
  }

  private syncGhost(ghost: GhostState | null): void {
    const sig = ghost ? JSON.stringify(ghost) : "";
    if (sig === this.lastGhostSig) return;
    this.lastGhostSig = sig;
    clearGroup(this.ghostGroup);
    if (!ghost) return;
    const g = buildAssetGroup(ghost.kind, ghost.dims, ghost.door);
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

  private syncOverlay(project: Project, selection: Set<string>, measure: SessionView["measure"]): void {
    clearGroup(this.overlayGroup);
    // Selection outlines.
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
    // Measure line.
    if (measure && measure.a && measure.b) {
      const geo = new BufferGeometry();
      geo.setAttribute("position", new Float32BufferAttribute([measure.a.x, 0.06, measure.a.z, measure.b.x, 0.06, measure.b.z], 3));
      this.overlayGroup.add(new LineSegments(geo, new LineBasicMaterial({ color: 0xfacc15 })));
      for (const p of [measure.a, measure.b]) {
        const dot = new Mesh(new BoxGeometry(0.15, 0.15, 0.15), new MeshBasicMaterial({ color: 0xfacc15 }));
        dot.position.set(p.x, 0.08, p.z);
        this.overlayGroup.add(dot);
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

  private ndc(clientX: number, clientY: number): Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    return new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
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

  /** Pan the camera to look at a world point (used to focus a validation issue). */
  focusOn(x: number, z: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    this.target.set(x, 0, z);
    this.controls.target.copy(this.target);
    this.camera.position.copy(this.target.clone().add(offset));
    this.controls.update();
  }

  /** Recenter the camera on the whole plan. */
  recenterView(project: Project): void {
    this.recenter(project);
    this.controls.target.copy(this.target);
    this.controls.update();
  }

  project(x: number, z: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const v = new Vector3(x, 0, z).project(this.camera);
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
  }

  /** Snapshot the current 3D scene (used for the 3D iso export image). */
  renderToDataURL(project: Project, view: ViewName): string {
    const prev = project.view;
    this.setView(view);
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL("image/png");
    this.setView(prev);
    return url;
  }
}

interface Route2 { id: string; color: string; points: { x: number; z: number }[] }

function round(n: number): number { return Math.round(n * 1000) / 1000; }

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
  });
}
