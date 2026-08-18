/**
 * Immediate simple semantic proxy for photo → custom asset (before reconstruction).
 */

import { Group } from "three";
import {
  kindForSemantic,
  type AssetCatalogEntry,
  type SemanticAssetType,
  type ServiceRole,
} from "../core/catalog";
import { uid } from "../core/model";
import { buildProxyGroup } from "../scene/visualRegistry";
import { getAssetBlobStore } from "./idbStore";

export interface CreateProxyRequest {
  name: string;
  semanticType: SemanticAssetType;
  serviceRole?: ServiceRole;
  dimensions: { width: number; depth: number; height: number };
  sourceImage?: ArrayBuffer;
  sourceMimeType?: string;
  color?: string;
}

export interface CreateProxyResult {
  entry: AssetCatalogEntry;
  group: Group;
}

const SEMANTIC_COLORS: Partial<Record<SemanticAssetType, string>> = {
  table: "#c8b6a6",
  "service-desk": "#a8b3a0",
  chair: "#b8c0cc",
  storage: "#94a3b8",
  signage: "#f1f5f9",
  "payment-equipment": "#475569",
  "queue-barrier": "#64748b",
  other: "#78716c",
};

export async function createCustomAssetProxy(req: CreateProxyRequest): Promise<CreateProxyResult> {
  const serviceRole = req.serviceRole ?? (req.semanticType === "service-desk" ? "checkin" : "none");
  const kind = kindForSemantic(req.semanticType, serviceRole);
  const id = `custom:${uid("asset")}`;
  const visualRef = `proxy:${id}`;
  const color = req.color ?? SEMANTIC_COLORS[req.semanticType] ?? "#78716c";

  let sourceImageId: string | undefined;
  if (req.sourceImage && req.sourceImage.byteLength > 0) {
    sourceImageId = `img_${id}`;
    await getAssetBlobStore().putBlob(sourceImageId, req.sourceImage, {
      kind: "sourceImage",
      mimeType: req.sourceMimeType ?? "image/jpeg",
    });
  }

  const entry: AssetCatalogEntry = {
    id,
    name: req.name.trim() || "自訂素材",
    semanticType: req.semanticType,
    sourceType: "simple-proxy",
    category: "custom",
    placementType:
      kind === "computer"
        ? "tabletop"
        : kind === "door" || kind === "switch" || kind === "screen"
          ? "wall"
          : "floor",
    dimensions: { ...req.dimensions },
    defaultFacingDeg: 0,
    clearanceFront: serviceRole === "checkin" || serviceRole === "payment" ? 0.6 : 0,
    blocksFlow: ["table", "service-desk", "storage", "queue-barrier"].includes(req.semanticType),
    serviceRole,
    kind,
    icon: "📷",
    color,
    visualRef,
    planSymbolRef: `plan:${req.semanticType}`,
    tags: ["custom", "photo", req.semanticType, serviceRole],
    createdBy: "photo",
    version: 1,
    blobIds: sourceImageId ? { sourceImage: sourceImageId } : undefined,
    allowCustomSize: true,
  };

  const group = buildProxyGroup(req.dimensions, color, entry.name);
  return { entry, group };
}

/** Heuristic guess when AI provider unavailable. */
export function guessSemanticFromName(name: string): {
  semanticType: SemanticAssetType;
  serviceRole: ServiceRole;
} {
  const n = name.toLowerCase();
  if (/收費|付款|payment|cash/.test(n)) return { semanticType: "service-desk", serviceRole: "payment" };
  if (/報到|報名|check.?in|reception/.test(n)) return { semanticType: "service-desk", serviceRole: "checkin" };
  if (/椅|chair|seat/.test(n)) return { semanticType: "chair", serviceRole: "none" };
  if (/地墊|瑜伽|mat/.test(n)) return { semanticType: "mat", serviceRole: "none" };
  if (/指示|立牌|sign/.test(n)) return { semanticType: "signage", serviceRole: "guidance" };
  if (/鞋|櫃|架|rack|storage/.test(n)) return { semanticType: "storage", serviceRole: "storage" };
  if (/收費箱|錢箱|pos/.test(n)) return { semanticType: "payment-equipment", serviceRole: "payment" };
  if (/桌|table|desk/.test(n)) return { semanticType: "table", serviceRole: "none" };
  return { semanticType: "other", serviceRole: "none" };
}
