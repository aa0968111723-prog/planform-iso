/**
 * GLB / GLTF import pipeline: validate → inspect → optimize → normalize → catalog entry.
 */

import { Group } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  kindForSemantic,
  type AssetCatalogEntry,
  type SemanticAssetType,
  type ServiceRole,
} from "../core/catalog";
import { uid } from "../core/model";
import { getAssetBlobStore } from "./idbStore";
import { normalizeGroup } from "./normalize";
import { optimizeGltfBuffer, inspectGltfBuffer } from "./optimizeGltf";
import { evaluateQuality, MOBILE_LIMITS, STANDARD_LIMITS, type QualityReport } from "./qualityGate";
import { cacheGlbGroup } from "../scene/visualRegistry";

const MAX_RAW_BYTES = STANDARD_LIMITS.maxBytes;
const ALLOWED_EXT = new Set(["glb", "gltf"]);

export interface ImportGltfRequest {
  fileName: string;
  data: ArrayBuffer;
  name?: string;
  semanticType?: SemanticAssetType;
  serviceRole?: ServiceRole;
  dimensions?: { width: number; depth: number; height: number };
}

export interface ImportGltfResult {
  ok: boolean;
  entry?: AssetCatalogEntry;
  report?: QualityReport;
  error?: string;
  usedProxy?: boolean;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function validateGltfFile(fileName: string, byteLength: number): string | null {
  const ext = extOf(fileName);
  if (!ALLOWED_EXT.has(ext)) return `不支援的格式：.${ext || "?"}（僅 .glb / .gltf）`;
  if (byteLength <= 0) return "檔案是空的";
  if (byteLength > MAX_RAW_BYTES) {
    return `檔案過大（${Math.round(byteLength / 1024 / 1024)} MB），上限 ${Math.round(MAX_RAW_BYTES / 1024 / 1024)} MB`;
  }
  return null;
}

async function loadGroupFromGlb(buffer: ArrayBuffer): Promise<Group> {
  const loader = new GLTFLoader();
  const gltf = await loader.parseAsync(buffer, "");
  const root = gltf.scene ?? new Group();
  const wrap = new Group();
  wrap.add(root);
  return wrap;
}

function guessDimsFromBounds(b: { width: number; depth: number; height: number }) {
  // If model is tiny (< 5cm) or huge (> 20m), treat as unitless and fall back to table-ish defaults.
  const max = Math.max(b.width, b.depth, b.height);
  if (max < 0.05 || max > 20) {
    return { width: 1.2, depth: 0.6, height: 0.74 };
  }
  return {
    width: Math.max(0.05, Number(b.width.toFixed(3))),
    depth: Math.max(0.05, Number(b.depth.toFixed(3))),
    height: Math.max(0.05, Number(b.height.toFixed(3))),
  };
}

export async function importGltfAsset(req: ImportGltfRequest): Promise<ImportGltfResult> {
  const err = validateGltfFile(req.fileName, req.data.byteLength);
  if (err) return { ok: false, error: err };

  const ext = extOf(req.fileName);
  if (ext === "gltf") {
    // External URI .gltf packages are risky in PWA; require self-contained GLB for V1.
    // Still allow if the buffer is a binary-ish pack — but prefer rejecting classic .gltf+bin.
    // Heuristic: if it looks like JSON and references external buffers, reject.
    try {
      const text = new TextDecoder().decode(req.data.slice(0, Math.min(req.data.byteLength, 2048)));
      if (text.trimStart().startsWith("{") && /"uri"\s*:/.test(text)) {
        return { ok: false, error: "請匯入單一 .glb（含貼圖），暫不支援外部 URI 的 .gltf" };
      }
    } catch {
      /* continue */
    }
  }

  let report = await inspectGltfBuffer(req.data);
  let buffer = req.data;
  let optimized = false;

  if (!report.passMobile || req.data.byteLength > MOBILE_LIMITS.maxBytes / 2) {
    try {
      const opt = await optimizeGltfBuffer(req.data, { maxTextureSize: 1024 });
      buffer = opt.buffer;
      report = opt.report;
      optimized = true;
    } catch (e) {
      return { ok: false, error: `最佳化失敗：${e instanceof Error ? e.message : String(e)}`, report };
    }
  }

  if (!report.passStandard) {
    return {
      ok: false,
      error: `模型仍過重，無法匯入：${report.warnings.join("；")}`,
      report,
    };
  }

  let group: Group;
  try {
    group = await loadGroupFromGlb(buffer);
  } catch (e) {
    return { ok: false, error: `無法解析模型：${e instanceof Error ? e.message : String(e)}`, report };
  }

  // Rough bounds before normalize (identity scale).
  const { measureBounds } = await import("./normalize");
  const raw = measureBounds(group);
  const dims = req.dimensions ?? guessDimsFromBounds(raw);
  const normalized = normalizeGroup(group, { targetDims: dims, forwardAxis: "+Z" });

  const semanticType = req.semanticType ?? "other";
  const serviceRole = req.serviceRole ?? "none";
  const kind = kindForSemantic(semanticType, serviceRole);
  const id = `custom:${uid("asset")}`;
  const blobId = `glb_${id}`;
  const visualRef = `glb:${id}`;

  await getAssetBlobStore().putBlob(blobId, buffer, {
    kind: "glb",
    mimeType: "model/gltf-binary",
  });
  cacheGlbGroup(visualRef, normalized.group);

  const usedProxy = !report.passMobile;
  const entry: AssetCatalogEntry = {
    id,
    name: req.name?.trim() || req.fileName.replace(/\.(glb|gltf)$/i, ""),
    semanticType,
    sourceType: "glb",
    category: "custom",
    placementType: kind === "computer" ? "tabletop" : kind === "door" || kind === "switch" || kind === "screen" ? "wall" : "floor",
    dimensions: dims,
    defaultFacingDeg: 0,
    clearanceFront: 0,
    blocksFlow: semanticType === "table" || semanticType === "service-desk" || semanticType === "storage",
    serviceRole,
    kind,
    icon: "📦",
    color: "#94a3b8",
    visualRef,
    planSymbolRef: `plan:${semanticType}`,
    tags: ["custom", "import", semanticType],
    createdBy: "import",
    version: 1,
    blobIds: { glb: blobId },
    allowCustomSize: true,
  };

  return {
    ok: true,
    entry,
    report: evaluateQuality({ ...report, byteLength: buffer.byteLength }),
    usedProxy: usedProxy || optimized === false && !report.passMobile,
  };
}
