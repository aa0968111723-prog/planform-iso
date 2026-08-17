import {
  AmbientLight,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  DEFAULT_CLASSROOM,
  DEFAULT_CORRIDOR,
  DEFAULT_TILE,
  type AreaConfig,
} from "../core/room";
import { createTileGrid } from "./TileGrid";
import { createSetupObject } from "./objects";

export type ViewName = "iso" | "top" | "front";

export class SceneManager {
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly camera: OrthographicCamera;
  private readonly controls: OrbitControls;
  private readonly target = new Vector3();
  private grids: Object3D[] = [];
  private frustum = 9;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true, // needed for PNG export
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;

    this.scene = new Scene();
    this.scene.background = new Color(0x0f172a);

    this.camera = new OrthographicCamera();
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;

    // Center the view on the combined classroom + corridor footprint.
    this.target.set(
      DEFAULT_CLASSROOM.x + DEFAULT_CLASSROOM.length / 2,
      0,
      DEFAULT_CLASSROOM.z + (DEFAULT_CLASSROOM.width + DEFAULT_CORRIDOR.width) / 2,
    );

    this.buildLights();
    this.buildAreas();
    this.buildDemoObjects();

    this.setView("iso");
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.renderer.setAnimationLoop(() => this.tick());
  }

  private buildLights(): void {
    this.scene.add(new AmbientLight(0xffffff, 0.75));
    const sun = new DirectionalLight(0xffffff, 1.1);
    sun.position.set(6, 12, 4);
    sun.castShadow = true;
    this.scene.add(sun);
  }

  private buildAreas(): void {
    for (const area of [DEFAULT_CLASSROOM, DEFAULT_CORRIDOR]) {
      this.buildFloor(area);
      const grid = createTileGrid(area, DEFAULT_TILE);
      this.grids.push(grid);
      this.scene.add(grid);
    }
  }

  private buildFloor(area: AreaConfig): void {
    const floor = new Mesh(
      new PlaneGeometry(area.length, area.width),
      new MeshStandardMaterial({ color: 0x1e293b, roughness: 1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(
      area.x + area.length / 2,
      0,
      area.z + area.width / 2,
    );
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  private buildDemoObjects(): void {
    // A representative, real-scale hello-world layout on the tile grid.
    this.scene.add(createSetupObject("screen", { col: 8, row: 0 }, DEFAULT_TILE));
    this.scene.add(createSetupObject("table", { col: 3, row: 2 }, DEFAULT_TILE));
    this.scene.add(createSetupObject("chair", { col: 3, row: 4 }, DEFAULT_TILE));
    this.scene.add(createSetupObject("mat", { col: 10, row: 6 }, DEFAULT_TILE));
    this.scene.add(createSetupObject("mat", { col: 12, row: 6 }, DEFAULT_TILE));
  }

  setView(view: ViewName): void {
    const d = 40;
    switch (view) {
      case "iso":
        this.camera.position.set(this.target.x + d, d, this.target.z + d);
        break;
      case "top":
        this.camera.position.set(this.target.x, d, this.target.z + 0.001);
        break;
      case "front":
        this.camera.position.set(this.target.x, 4, this.target.z + d);
        break;
    }
    this.camera.lookAt(this.target);
    this.controls.target.copy(this.target);
    this.controls.update();
  }

  setGridVisible(visible: boolean): void {
    for (const grid of this.grids) grid.visible = visible;
  }

  /** Return a PNG data URL of the current view (no UI chrome). */
  exportPng(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  private resize(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const aspect = w / h || 1;
    this.camera.left = -this.frustum * aspect;
    this.camera.right = this.frustum * aspect;
    this.camera.top = this.frustum;
    this.camera.bottom = -this.frustum;
    this.camera.near = 0.1;
    this.camera.far = 200;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  private tick(): void {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
