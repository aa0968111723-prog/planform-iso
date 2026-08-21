/**
 * Simulation crowd — the people you actually see walking in from the corridor.
 *
 * The playback used to draw one 28 cm cube per participant, allocating a fresh
 * geometry and material for every person on every frame. Volunteers reading the
 * screen could not tell that those specks were people, and a 100-person stress
 * run churned hundreds of throwaway objects a second.
 *
 * This draws real 1.7 m figures — round head on a capsule body — as two
 * InstancedMeshes that are allocated once and reused. Colour carries the state
 * (moving / queueing / being served) using the same green-amber palette as the
 * station badges, and each figure turns to face where it is walking so a queue
 * reads as a queue rather than a smear of dots.
 */

import {
  CapsuleGeometry,
  Color,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";

export interface CrowdPerson {
  /** Stable participant id, used to keep facing continuous between frames. */
  id?: number;
  x: number;
  z: number;
  state?: string;
}

/** Real-person proportions, in metres. Total height 1.70 m. */
const BODY_RADIUS = 0.2;
const BODY_LENGTH = 1.05; // cylindrical part; capsule total = LENGTH + 2 * RADIUS
const BODY_TOP = BODY_LENGTH + BODY_RADIUS * 2;
const BODY_CENTER_Y = BODY_TOP / 2;
const HEAD_RADIUS = 0.125;
const HEAD_CENTER_Y = BODY_TOP + HEAD_RADIUS;

const MIN_CAPACITY = 64;

/**
 * Same language as the station queue badges: green = being served, amber =
 * waiting, blue = on the move. Readable on both the light and dark canvas.
 */
const STATE_COLOR: Record<string, number> = {
  serving: 0x22c55e,
  queued: 0xf59e0b,
  traveling: 0x3b82f6,
};
const DEFAULT_COLOR = 0x3b82f6;

/** Movement below this (metres/frame) is treated as standing still. */
const HEADING_EPSILON = 0.004;

export class SimCrowd {
  readonly group = new Group();

  private body: InstancedMesh | null = null;
  private head: InstancedMesh | null = null;
  private capacity = 0;

  private readonly bodyMaterial = new MeshStandardMaterial({ roughness: 0.72, metalness: 0.0 });
  private readonly headMaterial = new MeshStandardMaterial({ roughness: 0.68, metalness: 0.0 });

  /** Last known position per participant, so we can derive a facing direction. */
  private readonly lastPos = new Map<number, { x: number; z: number }>();
  private readonly headings = new Map<number, number>();

  private readonly matrix = new Matrix4();
  private readonly quat = new Quaternion();
  private readonly euler = new Euler();
  private readonly pos = new Vector3();
  private readonly scale = new Vector3(1, 1, 1);
  private readonly color = new Color();

  constructor() {
    this.group.name = "sim-crowd";
    this.group.renderOrder = 5;
  }

  /** Replace the drawn crowd with `people`. Safe to call every frame. */
  update(people: readonly CrowdPerson[] | undefined): void {
    const n = people?.length ?? 0;
    if (n === 0) {
      this.setCount(0);
      this.lastPos.clear();
      this.headings.clear();
      return;
    }

    this.ensureCapacity(n);
    const body = this.body;
    const head = this.head;
    if (!body || !head) return;

    const seen = new Set<number>();
    for (let i = 0; i < n; i++) {
      const p = people![i];
      const key = p.id ?? i;
      seen.add(key);

      const heading = this.headingFor(key, p.x, p.z);
      this.euler.set(0, heading, 0);
      this.quat.setFromEuler(this.euler);

      this.pos.set(p.x, BODY_CENTER_Y, p.z);
      this.matrix.compose(this.pos, this.quat, this.scale);
      body.setMatrixAt(i, this.matrix);

      this.pos.set(p.x, HEAD_CENTER_Y, p.z);
      this.matrix.compose(this.pos, this.quat, this.scale);
      head.setMatrixAt(i, this.matrix);

      const base = STATE_COLOR[p.state ?? ""] ?? DEFAULT_COLOR;
      this.color.setHex(base);
      body.setColorAt(i, this.color);
      // Head a touch darker so the figure still reads as a head-on-body from
      // straight above, where the body is mostly hidden behind it.
      this.color.setHex(base).multiplyScalar(0.72);
      head.setColorAt(i, this.color);
    }

    // Participants that finished or left keep no stale facing state.
    if (this.lastPos.size > n * 2 + MIN_CAPACITY) {
      for (const key of [...this.lastPos.keys()]) {
        if (!seen.has(key)) {
          this.lastPos.delete(key);
          this.headings.delete(key);
        }
      }
    }

    this.setCount(n);
    body.instanceMatrix.needsUpdate = true;
    head.instanceMatrix.needsUpdate = true;
    if (body.instanceColor) body.instanceColor.needsUpdate = true;
    if (head.instanceColor) head.instanceColor.needsUpdate = true;
    body.computeBoundingSphere();
    head.computeBoundingSphere();
  }

  dispose(): void {
    this.destroyMeshes();
    this.bodyMaterial.dispose();
    this.headMaterial.dispose();
    this.lastPos.clear();
    this.headings.clear();
  }

  private headingFor(key: number, x: number, z: number): number {
    const prev = this.lastPos.get(key);
    let heading = this.headings.get(key) ?? 0;
    if (prev) {
      const dx = x - prev.x;
      const dz = z - prev.z;
      if (Math.abs(dx) > HEADING_EPSILON || Math.abs(dz) > HEADING_EPSILON) {
        heading = Math.atan2(dx, dz);
        this.headings.set(key, heading);
      }
    }
    this.lastPos.set(key, { x, z });
    return heading;
  }

  private setCount(n: number): void {
    if (this.body) this.body.count = n;
    if (this.head) this.head.count = n;
    this.group.visible = n > 0;
  }

  private ensureCapacity(n: number): void {
    if (this.body && this.head && n <= this.capacity) return;
    this.destroyMeshes();

    this.capacity = Math.max(MIN_CAPACITY, Math.ceil(n * 1.5));
    const bodyGeom = new CapsuleGeometry(BODY_RADIUS, BODY_LENGTH, 4, 10);
    const headGeom = new SphereGeometry(HEAD_RADIUS, 12, 8);

    this.body = new InstancedMesh(bodyGeom, this.bodyMaterial, this.capacity);
    this.head = new InstancedMesh(headGeom, this.headMaterial, this.capacity);
    for (const mesh of [this.body, this.head]) {
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.count = 0;
      // Allocate the per-instance colour buffer up front; setColorAt on an
      // InstancedMesh that never had one would otherwise leave it unlit.
      this.color.setHex(DEFAULT_COLOR);
      for (let i = 0; i < this.capacity; i++) mesh.setColorAt(i, this.color);
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.group.add(mesh);
    }
  }

  private destroyMeshes(): void {
    for (const mesh of [this.body, this.head]) {
      if (!mesh) continue;
      this.group.remove(mesh);
      mesh.geometry.dispose();
      mesh.dispose();
    }
    this.body = null;
    this.head = null;
    this.capacity = 0;
  }
}
