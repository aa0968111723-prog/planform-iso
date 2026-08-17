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
  LineBasicMaterial,
  LineSegments,
  Mesh,
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
import {
  OBJECT_DEFAULTS,
  type Project,
  type ViewName,
  type Zone,
} from "../core/model";
import { matPreviewCenters, type MatPreviewState } from "../core/mat";
import { TextLabel } from "./label";

const SELECT_COLOR = new Color(0x38bdf8);
const deg2rad = (d: number) => (d * Math.PI) / 180;

export interface PickResult {
  type: "object" | "zone" | "routeNode";
  id: string;
  /** For routeNode: the point index. */
  index?: number;
}

interface SessionView {
  selection: Set<string>;
  matPreview: MatPreviewState | null;
}

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
  private objectGroup = new Group();
  private zoneGroup = new Group();
  private routeGroup = new Group();
  private previewGroup = new Group();

  private objectMeshes = new Map<string, { mesh: Mesh; sig: string }>();
  private zoneNodes = new Map<string, { group: Group; label: TextLabel; sig: string }>();
  private routeNodes = new Map<string, { group: Group; label: TextLabel; sig: string }>();
  private routeNodeMeshes: Mesh[] = [];

  private layersState = { areas: true, zones: true, objects: true, tiles: true, routes: true };
  private lastAreaSig = "";
  private lastPreviewSig = "";

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new Scene();
    this.scene.background = new Color(0x0b1120);
    this.scene.add(this.floorGroup, this.tileGroup, this.zoneGroup, this.objectGroup, this.routeGroup, this.previewGroup);

    this.camera = new OrthographicCamera();
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;

    this.scene.add(new AmbientLight(0xffffff, 0.8));
    const sun = new DirectionalLight(0xffffff, 1.0);
    sun.position.set(8, 16, 6);
    this.scene.add(sun);

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
      case "iso":
        this.camera.position.set(t.x + d, d, t.z + d);
        this.controls.enableRotate = true;
        break;
      case "top":
        this.camera.position.set(t.x, d, t.z + 0.001);
        this.controls.enableRotate = false;
        break;
      case "front":
        this.camera.position.set(t.x, 4, t.z + d);
        this.controls.enableRotate = true;
        break;
      case "left":
        this.camera.position.set(t.x - d, 4, t.z);
        this.controls.enableRotate = true;
        break;
      case "right":
        this.camera.position.set(t.x + d, 4, t.z);
        this.controls.enableRotate = true;
        break;
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

  // --- sync from state ---------------------------------------------------

  sync(project: Project, session: SessionView): void {
    this.layersState = project.layers;
    this.syncAreasAndTiles(project);
    this.syncObjects(project, session.selection);
    this.syncZones(project, session.selection);
    this.syncRoutes(project, session.selection);
    this.syncPreview(session.matPreview);
  }

  private syncAreasAndTiles(project: Project): void {
    const { classroom, corridor, tile } = project;
    const sig = JSON.stringify({ classroom, corridor, tile });
    // Recenter camera target to the combined footprint.
    const minX = Math.min(classroom.x, corridor.x);
    const minZ = Math.min(classroom.z, corridor.z);
    const maxX = Math.max(classroom.x + classroom.length, corridor.x + corridor.length);
    const maxZ = Math.max(classroom.z + classroom.width, corridor.z + corridor.width);
    this.target.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);

    this.floorGroup.visible = this.layersState.areas;
    this.tileGroup.visible = this.layersState.tiles && tile.visible;
    if (sig === this.lastAreaSig) return;
    this.lastAreaSig = sig;

    clearGroup(this.floorGroup);
    clearGroup(this.tileGroup);

    for (const area of [classroom, corridor]) {
      const floor = new Mesh(
        new PlaneGeometry(area.length, area.width),
        new MeshStandardMaterial({ color: 0x1e293b, roughness: 1, side: DoubleSide }),
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

    let start = tile.originX;
    while (start > minX) start -= w;
    for (let x = start; x <= maxX + 1e-6; x += w) positions.push(x, 0, minZ, x, 0, maxZ);
    let startZ = tile.originZ;
    while (startZ > minZ) startZ -= d;
    for (let z = startZ; z <= maxZ + 1e-6; z += d) positions.push(minX, 0, z, maxX, 0, z);

    const geo = new BufferGeometry();
    geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
    const grid = new LineSegments(
      geo,
      new LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.3 }),
    );
    grid.position.y = 0.003;
    grid.rotation.y = deg2rad(tile.rotationDeg);
    return grid;
  }

  private syncObjects(project: Project, selection: Set<string>): void {
    this.objectGroup.visible = this.layersState.objects;
    const seen = new Set<string>();
    for (const obj of project.objects) {
      seen.add(obj.id);
      const sig = `${obj.kind}|${obj.width}|${obj.depth}|${obj.height}`;
      let entry = this.objectMeshes.get(obj.id);
      if (!entry || entry.sig !== sig) {
        if (entry) this.objectGroup.remove(entry.mesh);
        const mesh = new Mesh(
          new BoxGeometry(obj.width, obj.height, obj.depth),
          new MeshStandardMaterial({ color: OBJECT_DEFAULTS[obj.kind].color, roughness: 0.8 }),
        );
        mesh.userData = { type: "object", id: obj.id };
        this.objectGroup.add(mesh);
        entry = { mesh, sig };
        this.objectMeshes.set(obj.id, entry);
      }
      const mesh = entry.mesh;
      mesh.position.set(obj.x, obj.height / 2, obj.z);
      mesh.rotation.y = -deg2rad(obj.rotationDeg);
      mesh.visible = !obj.hidden;
      const mat = mesh.material as MeshStandardMaterial;
      mat.color.set(OBJECT_DEFAULTS[obj.kind].color);
      const selected = selection.has(obj.id);
      mat.emissive.set(selected ? SELECT_COLOR : 0x000000);
      mat.emissiveIntensity = selected ? 0.6 : 0;
      mat.opacity = obj.locked ? 0.6 : 1;
      mat.transparent = obj.locked;
    }
    for (const [id, entry] of this.objectMeshes) {
      if (!seen.has(id)) {
        this.objectGroup.remove(entry.mesh);
        this.objectMeshes.delete(id);
      }
    }
  }

  private syncZones(project: Project, selection: Set<string>): void {
    this.zoneGroup.visible = this.layersState.zones;
    const seen = new Set<string>();
    for (const zone of project.zones) {
      seen.add(zone.id);
      const sig = `${zone.width}|${zone.depth}`;
      let entry = this.zoneNodes.get(zone.id);
      if (!entry || entry.sig !== sig) {
        if (entry) {
          this.zoneGroup.remove(entry.group);
          entry.label.dispose();
        }
        entry = this.buildZone(zone, sig);
        this.zoneGroup.add(entry.group);
        this.zoneNodes.set(zone.id, entry);
      }
      this.updateZone(entry, zone, selection.has(zone.id));
    }
    for (const [id, entry] of this.zoneNodes) {
      if (!seen.has(id)) {
        this.zoneGroup.remove(entry.group);
        entry.label.dispose();
        this.zoneNodes.delete(id);
      }
    }
  }

  private buildZone(zone: Zone, sig: string): { group: Group; label: TextLabel; sig: string } {
    const group = new Group();
    const fill = new Mesh(
      new BoxGeometry(zone.width, 0.05, zone.depth),
      new MeshStandardMaterial({ transparent: true, opacity: 0.22, side: DoubleSide }),
    );
    fill.name = "fill";
    fill.userData = { type: "zone", id: zone.id };
    group.add(fill);
    const edges = new LineSegments(
      new EdgesGeometry(new BoxGeometry(zone.width, 0.05, zone.depth)),
      new LineBasicMaterial(),
    );
    edges.name = "edges";
    group.add(edges);
    const label = new TextLabel();
    label.sprite.position.y = 0.6;
    group.add(label.sprite);
    return { group, label, sig };
  }

  private updateZone(
    entry: { group: Group; label: TextLabel },
    zone: Zone,
    selected: boolean,
  ): void {
    entry.group.position.set(zone.x, 0.03, zone.z);
    entry.group.visible = !zone.hidden;
    const fill = entry.group.getObjectByName("fill") as Mesh;
    const edges = entry.group.getObjectByName("edges") as LineSegments;
    (fill.material as MeshStandardMaterial).color.set(zone.color);
    (fill.material as MeshStandardMaterial).opacity = zone.locked ? 0.12 : 0.22;
    (edges.material as LineBasicMaterial).color.set(selected ? "#38bdf8" : zone.color);
    entry.label.set(zone.name, "#e2e8f0");
  }

  private syncRoutes(project: Project, selection: Set<string>): void {
    this.routeGroup.visible = this.layersState.routes;
    this.routeNodeMeshes = [];
    const seen = new Set<string>();
    for (const route of project.routes) {
      seen.add(route.id);
      const sig = JSON.stringify(route.points) + route.color + selection.has(route.id);
      let entry = this.routeNodes.get(route.id);
      if (!entry || entry.sig !== sig) {
        if (entry) {
          this.routeGroup.remove(entry.group);
          entry.label.dispose();
        }
        entry = this.buildRoute(route, selection.has(route.id), sig);
        this.routeGroup.add(entry.group);
        this.routeNodes.set(route.id, entry);
      }
      entry.group.visible = route.visible;
      entry.label.set(route.name, route.color);
      // Collect node meshes for picking.
      entry.group.traverse((o) => {
        if (o instanceof Mesh && o.userData.type === "routeNode") this.routeNodeMeshes.push(o);
      });
    }
    for (const [id, entry] of this.routeNodes) {
      if (!seen.has(id)) {
        this.routeGroup.remove(entry.group);
        entry.label.dispose();
        this.routeNodes.delete(id);
      }
    }
  }

  private buildRoute(
    route: { id: string; color: string; points: { x: number; z: number }[] },
    selected: boolean,
    sig: string,
  ): { group: Group; label: TextLabel; sig: string } {
    const group = new Group();
    const y = 0.05;
    if (route.points.length >= 2) {
      const pos: number[] = [];
      for (let i = 0; i < route.points.length - 1; i++) {
        const a = route.points[i];
        const b = route.points[i + 1];
        pos.push(a.x, y, a.z, b.x, y, b.z);
      }
      const geo = new BufferGeometry();
      geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
      const line = new LineSegments(
        geo,
        new LineBasicMaterial({ color: route.color, linewidth: 2 }),
      );
      group.add(line);
      // Direction arrows at each segment midpoint.
      for (let i = 0; i < route.points.length - 1; i++) {
        group.add(this.buildArrow(route.points[i], route.points[i + 1], route.color, y));
      }
    }
    route.points.forEach((p, index) => {
      const node = new Mesh(
        new BoxGeometry(0.25, 0.25, 0.25),
        new MeshStandardMaterial({ color: selected ? "#38bdf8" : route.color }),
      );
      node.position.set(p.x, y, p.z);
      node.userData = { type: "routeNode", id: route.id, index };
      group.add(node);
    });
    const label = new TextLabel();
    if (route.points[0]) label.sprite.position.set(route.points[0].x, 0.7, route.points[0].z);
    group.add(label.sprite);
    return { group, label, sig };
  }

  private buildArrow(
    a: { x: number; z: number },
    b: { x: number; z: number },
    color: string,
    y: number,
  ): Object3D {
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const angle = Math.atan2(b.z - a.z, b.x - a.x);
    const arrow = new Mesh(
      new BoxGeometry(0.4, 0.03, 0.18),
      new MeshStandardMaterial({ color }),
    );
    arrow.position.set(mx, y, mz);
    arrow.rotation.y = -angle;
    return arrow;
  }

  private syncPreview(preview: MatPreviewState | null): void {
    const sig = preview ? JSON.stringify(preview) : "";
    if (sig === this.lastPreviewSig) return;
    this.lastPreviewSig = sig;
    clearGroup(this.previewGroup);
    if (!preview) return;
    const centers = matPreviewCenters(preview);
    for (const c of centers) {
      const ghost = new Mesh(
        new BoxGeometry(preview.spec.matWidth, 0.05, preview.spec.matDepth),
        new MeshStandardMaterial({
          color: 0x22d3ee,
          transparent: true,
          opacity: 0.45,
          emissive: 0x0891b2,
          emissiveIntensity: 0.3,
        }),
      );
      ghost.position.set(c.x, 0.06, c.z);
      ghost.rotation.y = -deg2rad(preview.rotationDeg);
      this.previewGroup.add(ghost);
    }
  }

  // --- picking / projection ---------------------------------------------

  private ndc(clientX: number, clientY: number): Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    return new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  groundPoint(clientX: number, clientY: number): { x: number; z: number } | null {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    const hit = new Vector3();
    const plane = new Plane(new Vector3(0, 1, 0), 0);
    const res = this.raycaster.ray.intersectPlane(plane, hit);
    return res ? { x: hit.x, z: hit.z } : null;
  }

  pick(clientX: number, clientY: number): PickResult | null {
    this.raycaster.setFromCamera(this.ndc(clientX, clientY), this.camera);
    // Priority: route nodes, then objects, then zones.
    if (this.layersState.routes) {
      const rn = this.raycaster.intersectObjects(this.routeNodeMeshes, false);
      if (rn.length) {
        const u = rn[0].object.userData;
        return { type: "routeNode", id: u.id, index: u.index };
      }
    }
    if (this.layersState.objects) {
      const objs = [...this.objectMeshes.values()].map((e) => e.mesh).filter((m) => m.visible);
      const hit = this.raycaster.intersectObjects(objs, false);
      if (hit.length) return { type: "object", id: hit[0].object.userData.id };
    }
    if (this.layersState.zones) {
      const fills: Object3D[] = [];
      for (const entry of this.zoneNodes.values()) {
        if (!entry.group.visible) continue;
        const fill = entry.group.getObjectByName("fill");
        if (fill) fills.push(fill);
      }
      const hit = this.raycaster.intersectObjects(fills, false);
      if (hit.length) return { type: "zone", id: hit[0].object.userData.id };
    }
    return null;
  }

  /** Project a world position to canvas client coordinates (for box select). */
  project(x: number, z: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const v = new Vector3(x, 0, z).project(this.camera);
    return {
      x: rect.left + ((v.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - v.y) / 2) * rect.height,
    };
  }

  // --- export ------------------------------------------------------------

  exportPng(project: Project, view: ViewName, mode: "layout" | "flow"): string {
    const prevView = project.view;
    const prevLayers = { ...this.layersState };
    // Temporarily emphasize as requested and clear selection highlight.
    this.sync(project, { selection: new Set(), matPreview: null });
    if (mode === "flow") {
      this.floorGroup.visible = true;
      this.objectGroup.visible = false;
      this.zoneGroup.visible = project.layers.zones;
    }
    this.setView(view);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    const url = this.renderer.domElement.toDataURL("image/png");
    // Restore.
    this.layersState = prevLayers;
    this.objectGroup.visible = prevLayers.objects;
    this.zoneGroup.visible = prevLayers.zones;
    this.setView(prevView);
    return url;
  }
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
    if (o instanceof Mesh || o instanceof LineSegments) {
      o.geometry?.dispose?.();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
      else m?.dispose?.();
    }
  });
}
