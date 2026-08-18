/**
 * Img2ThreeJS reconstruction adapter — agent-side workflow contract.
 *
 * Generated TypeScript factories are NEVER eval'd. Only in-process registered
 * VisualFactory functions (or MockReconstructionWorker procedural output) are
 * accepted after normalize + quality gate.
 */

import { Box3, Group, Mesh } from "three";
import type { AssetCatalogEntry } from "../core/catalog";
import { normalizeGroup, type ForwardAxis } from "./normalize";
import { evaluateQuality, emptyMetrics, type QualityReport } from "./qualityGate";
import { registerVisualFactory, buildProxyGroup } from "../scene/visualRegistry";
import { materialFromPreset } from "../scene/materials";
import { BoxGeometry } from "three";

export interface GeneratedAssetFactoryMetadata {
  name: string;
  source: "img2threejs";
  version: string;
  forwardAxis: ForwardAxis;
  unitHint?: "m" | "cm" | "unknown";
}

export interface GeneratedAssetFactory {
  metadata: GeneratedAssetFactoryMetadata;
  create(): Group;
}

export type ReconstructionStatus = "queued" | "running" | "done" | "failed";

export interface AssetReconstructionJob {
  id: string;
  catalogId: string;
  sourceImageBlobId?: string;
  status: ReconstructionStatus;
  resultVisualRef?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AdaptFactoryResult {
  ok: boolean;
  visualRef?: string;
  report?: QualityReport;
  bounds?: { width: number; depth: number; height: number };
  error?: string;
}

const ALLOWED_SOURCES = new Set(["img2threejs"]);

export function validateFactoryManifest(factory: GeneratedAssetFactory): string | null {
  const m = factory.metadata;
  if (!m || m.source !== "img2threejs") return "metadata.source 必須是 img2threejs";
  if (!ALLOWED_SOURCES.has(m.source)) return "未知來源";
  if (!m.name?.trim()) return "缺少 name";
  if (!m.version?.trim()) return "缺少 version";
  if (!["+Z", "-Z", "+X", "-X"].includes(m.forwardAxis)) return "forwardAxis 無效";
  if (typeof factory.create !== "function") return "缺少 create()";
  return null;
}

function countTriangles(group: Group): { triangles: number; meshes: number } {
  let triangles = 0;
  let meshes = 0;
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (o instanceof Mesh) {
      meshes += 1;
      const g = o.geometry;
      const idx = g.getIndex();
      if (idx) triangles += Math.floor(idx.count / 3);
      else {
        const pos = g.getAttribute("position");
        if (pos) triangles += Math.floor(pos.count / 3);
      }
    }
  });
  return { triangles, meshes };
}

/**
 * Adapt a generated factory into a registered visualRef.
 * Does not mutate SceneObject positions — caller updates catalog visualRef only.
 */
export function adaptGeneratedFactory(
  factory: GeneratedAssetFactory,
  targetDims: { width: number; depth: number; height: number },
  visualRef: string,
): AdaptFactoryResult {
  const invalid = validateFactoryManifest(factory);
  if (invalid) return { ok: false, error: invalid };

  let raw: Group;
  try {
    raw = factory.create();
  } catch (e) {
    return { ok: false, error: `factory.create 失敗：${e instanceof Error ? e.message : String(e)}` };
  }
  if (!(raw instanceof Group)) {
    return { ok: false, error: "factory.create 必須回傳 THREE.Group" };
  }

  const normalized = normalizeGroup(raw, {
    targetDims,
    forwardAxis: factory.metadata.forwardAxis,
  });
  const { triangles, meshes } = countTriangles(normalized.group);
  const report = evaluateQuality({
    ...emptyMetrics(0),
    triangleCount: triangles,
    materialCount: meshes,
    nodeCount: meshes + 1,
    drawCallEstimate: meshes,
    vertexCount: triangles * 3,
    textureCount: 0,
    maxTextureDim: 0,
  });
  if (!report.passMobile) {
    return { ok: false, error: `品質未通過：${report.warnings.join("；")}`, report };
  }

  const frozen = normalized.group; // capture
  registerVisualFactory(visualRef, () => frozen.clone(true));
  return {
    ok: true,
    visualRef,
    report,
    bounds: normalized.bounds,
  };
}

/** Replace catalog visual without touching scene spatial data. */
export function replaceCatalogVisual(
  entry: AssetCatalogEntry,
  visualRef: string,
  sourceType: AssetCatalogEntry["sourceType"] = "generated-procedural",
): AssetCatalogEntry {
  return {
    ...entry,
    visualRef,
    sourceType,
    version: entry.version + 1,
  };
}

/**
 * Production reconstruction provider contract.
 * Img2ThreeJS / remote jobs implement this; MockReconstructionWorker is the
 * offline fallback. Generated code is NEVER eval'd in the browser.
 */
export interface AssetReconstructionProvider {
  readonly id: string;
  enqueue(catalogId: string, sourceImageBlobId?: string): AssetReconstructionJob;
  status(jobId: string): AssetReconstructionJob | undefined;
  cancel?(jobId: string): void;
  /** Run job to completion; on failure proxy remains usable. */
  run(
    jobId: string,
    entry: AssetCatalogEntry,
  ): Promise<{ entry: AssetCatalogEntry; ok: boolean; error?: string }>;
}

export class ReconstructionQueue {
  private jobs = new Map<string, AssetReconstructionJob>();

  enqueue(catalogId: string, sourceImageBlobId?: string): AssetReconstructionJob {
    const id = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const now = Date.now();
    const job: AssetReconstructionJob = {
      id,
      catalogId,
      sourceImageBlobId,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.set(id, job);
    return job;
  }

  get(id: string): AssetReconstructionJob | undefined {
    return this.jobs.get(id);
  }

  list(): AssetReconstructionJob[] {
    return [...this.jobs.values()];
  }

  update(id: string, patch: Partial<AssetReconstructionJob>): AssetReconstructionJob | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    Object.assign(job, patch, { updatedAt: Date.now() });
    return job;
  }
}

/**
 * Local mock worker — refined procedural stand-in when Img2ThreeJS agent is offline.
 * Proves proxy → reconstruction → visual replacement path.
 */
export class MockReconstructionWorker {
  constructor(private queue: ReconstructionQueue) {}

  async run(
    jobId: string,
    entry: AssetCatalogEntry,
  ): Promise<{ entry: AssetCatalogEntry; job: AssetReconstructionJob }> {
    const job = this.queue.update(jobId, { status: "running" });
    if (!job) throw new Error("job not found");

    // Simulate async reconstruction.
    await new Promise((r) => setTimeout(r, 10));

    const visualRef = `factory:${entry.id}:v${entry.version + 1}`;
    const factory: GeneratedAssetFactory = {
      metadata: {
        name: entry.name,
        source: "img2threejs",
        version: "mock-1",
        forwardAxis: "+Z",
        unitHint: "m",
      },
      create: () => buildRefinedProxy(entry),
    };
    const adapted = adaptGeneratedFactory(factory, entry.dimensions, visualRef);
    if (!adapted.ok || !adapted.visualRef) {
      this.queue.update(jobId, { status: "failed", error: adapted.error });
      throw new Error(adapted.error ?? "adapt failed");
    }
    const next = replaceCatalogVisual(entry, adapted.visualRef, "generated-procedural");
    const done = this.queue.update(jobId, {
      status: "done",
      resultVisualRef: adapted.visualRef,
    })!;
    return { entry: next, job: done };
  }
}

function buildRefinedProxy(entry: AssetCatalogEntry): Group {
  // Slightly richer than simple proxy: top slab + legs for desks, etc.
  const g = new Group();
  const { width: w, depth: d, height: h } = entry.dimensions;
  if (entry.semanticType === "service-desk" || entry.semanticType === "table") {
    const top = new Mesh(new BoxGeometry(w, 0.04, d), materialFromPreset("light-wood", entry.color));
    top.position.y = h - 0.02;
    g.add(top);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const leg = new Mesh(new BoxGeometry(0.05, h - 0.04, 0.05), materialFromPreset("painted-metal"));
      leg.position.set(sx * (w / 2 - 0.06), (h - 0.04) / 2, sz * (d / 2 - 0.06));
      g.add(leg);
    }
    return g;
  }
  return buildProxyGroup(entry.dimensions, entry.color, entry.name);
}

/** Test helper: ensure factory groups report a positive volume. */
export function hasVolume(group: Group): boolean {
  const box = new Box3().setFromObject(group);
  const s = box.getSize(box.min.clone());
  return s.x > 0 && s.y > 0 && s.z > 0;
}
