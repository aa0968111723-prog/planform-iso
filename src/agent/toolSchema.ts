/**
 * Declarative schema for every agent tool.
 *
 * Why a schema at all, when the executor already switches on a tool name:
 *
 * 1. **A tool may never receive a raw Project.** The executor's old signature
 *    was `args?: Record<string, unknown>` and it read whatever keys it liked.
 *    Nothing stopped a provider from sending `{ objects: [...] }` and nothing
 *    stopped a future tool from honouring it. Validation here rejects any key
 *    the tool did not declare, so "hand me the whole project" is not
 *    expressible.
 * 2. **A tool must fail honestly.** Coercing a missing number to a default and
 *    reporting success is how an agent tells the user it moved a desk it never
 *    found. Required params are required; out-of-range values are errors.
 * 3. **The list is the contract.** UI, tests and any future cloud provider all
 *    read the same table, so a tool cannot exist in one and not the others.
 *
 * This module is pure data + a validator. It imports no scene, no store and no
 * Three.js, which is what lets the schema test run without a DOM.
 */

import type { AgentToolName } from "./types";

export type ToolCategory =
  | "read"
  | "object"
  | "array"
  | "zone-route"
  | "spatial"
  | "project"
  | "view"
  | "meta";

export type ToolParamType =
  | "string"
  | "number"
  | "boolean"
  | "enum"
  | "string[]"
  | "object[]";

export interface ToolParamSpec {
  type: ToolParamType;
  description: string;
  required?: boolean;
  /** Numbers: inclusive bounds. A value outside them is an error, not a clamp. */
  min?: number;
  max?: number;
  integer?: boolean;
  /** enum / string[]: the permitted values. */
  values?: readonly string[];
  /** strings: maximum length, so a tool argument cannot carry a payload. */
  maxLength?: number;
  /** arrays: maximum element count. */
  maxItems?: number;
  /** object[]: the shape each element must have. */
  itemShape?: Record<string, ToolParamSpec>;
}

export interface ToolSpec {
  name: AgentToolName;
  category: ToolCategory;
  /** One line, shown in the tool catalogue and used by the planner. */
  summary: string;
  /** True when the tool writes to the draft project. */
  mutates: boolean;
  /**
   * True when the tool needs capabilities that live outside the plan document —
   * the project library, the viewport camera, the exporters. Without a host the
   * executor refuses the call with a real error instead of a cheerful no-op.
   */
  needsHost?: boolean;
  params: Record<string, ToolParamSpec>;
}

const ZONE_TYPES = [
  "registration", "payment", "life", "group", "meditation", "shoe", "backpack", "custom",
] as const;

const STATION_TYPES = [
  "entrance", "guide", "queue", "checkin", "payment", "shoe", "backpack", "seating", "group", "custom",
] as const;

const ROUTE_TYPES = [
  "entry", "registration", "payment", "shoe", "backpack", "seating", "group", "staff", "custom",
] as const;

const VIEW_NAMES = ["iso", "top", "front", "left", "right"] as const;

const LAYER_NAMES = ["areas", "zones", "objects", "tiles", "routes"] as const;

const SEMANTIC_TYPES = [
  "table", "chair", "mat", "service-desk", "screen", "door", "switch", "computer",
  "sign", "shelf", "box", "tent", "banner", "other",
] as const;

const SERVICE_ROLES = ["checkin", "payment", "guidance", "storage", "none"] as const;

const PLACEMENT_TARGETS = [
  "near-entrance", "classroom-center", "beside-selection", "point",
] as const;

const OBJECTIVES = [
  "clear-doors", "separate-checkin-payment", "reduce-crowding",
  "increase-interaction", "easy-to-staff", "maximise-capacity",
] as const;

const EVENT_TYPES = [
  "tea-gathering", "meditation", "classroom", "booth", "lecture", "workshop", "custom",
] as const;

const ALIGN_AXES = ["left", "right", "top", "bottom", "center-x", "center-z"] as const;

const DISTRIBUTE_AXES = ["x", "z"] as const;

const PLAN_PRESETS = [
  "full", "mats", "route", "zones", "staff", "partner", "inventory", "flow",
] as const;

/** Metres. Nothing in this product is legitimately larger than a sports hall. */
const MAX_METERS = 500;
const MIN_METERS = -500;

function meters(description: string, required = false): ToolParamSpec {
  return { type: "number", description, required, min: MIN_METERS, max: MAX_METERS };
}

function positiveMeters(description: string, required = false): ToolParamSpec {
  return { type: "number", description, required, min: 0.01, max: MAX_METERS };
}

function id(description: string, required = true): ToolParamSpec {
  return { type: "string", description, required, maxLength: 120 };
}

function name(description: string, required = false): ToolParamSpec {
  return { type: "string", description, required, maxLength: 80 };
}

const REQUIRED_ASSET_SHAPE: Record<string, ToolParamSpec> = {
  assetId: { type: "string", description: "素材目錄 id", required: true, maxLength: 120 },
  count: { type: "number", description: "數量", required: true, min: 1, max: 200, integer: true },
  zone: { type: "enum", description: "要放在哪一類區域附近", values: ZONE_TYPES },
};

const POINT_SHAPE: Record<string, ToolParamSpec> = {
  x: meters("X 座標（公尺）", true),
  z: meters("Z 座標（公尺）", true),
};

const PRINT_STANDARD_IDS = [
  "A6", "A5", "A4", "A3", "A2", "A1", "B2",
  "x-banner", "roll-up", "table-runner", "hanging-banner",
  "backdrop-24", "backdrop-30", "standee-a1",
] as const;

const PRINT_MATERIALS = [
  "coated-paper", "matte-paper", "sticker", "pp-synthetic", "canvas",
  "foam-board", "acrylic", "fabric", "corrugated",
] as const;

const PRINT_SHAPE: Record<string, ToolParamSpec> = {
  standard: { type: "enum", description: "印刷標準尺寸", values: PRINT_STANDARD_IDS },
  widthMm: { type: "number", description: "自訂寬（公釐）", min: 10, max: 5000 },
  heightMm: { type: "number", description: "自訂高（公釐）", min: 10, max: 5000 },
  orientation: { type: "enum", description: "直式或橫式", values: ["portrait", "landscape"] as const },
  sides: { type: "number", description: "單面 1 或雙面 2", min: 1, max: 2, integer: true },
  material: { type: "enum", description: "材質", values: PRINT_MATERIALS },
  quantity: { type: "number", description: "印製份數", min: 1, max: 10000, integer: true },
  finishNote: { type: "string", description: "加工需求，例如上光、打孔", maxLength: 60 },
};

const FACE_SHAPE: Record<string, ToolParamSpec> = {
  label: { type: "string", description: "面上的文字", required: true, maxLength: 60 },
  color: { type: "string", description: "十六進位顏色", maxLength: 9 },
  prompt: { type: "string", description: "這一面的題目", maxLength: 200 },
};

/* ------------------------------------------------------------------ */
/* The tool table                                                      */
/* ------------------------------------------------------------------ */

export const TOOL_SPECS: readonly ToolSpec[] = [
  /* ---- read ---- */
  { name: "getProjectSummary", category: "read", mutates: false, summary: "讀取專案摘要文字", params: {} },
  { name: "getVenueGeometry", category: "read", mutates: false, summary: "讀取場地尺寸、走廊與校正資料", params: {} },
  { name: "getSelection", category: "read", mutates: false, summary: "讀取目前選取的物件 id", params: {} },
  { name: "getZones", category: "read", mutates: false, summary: "讀取所有區域", params: {} },
  { name: "getRoutes", category: "read", mutates: false, summary: "讀取所有動線", params: {} },
  {
    name: "listAssets", category: "read", mutates: false, summary: "列出素材目錄",
    params: {
      category: { type: "string", description: "只列出某一類素材", maxLength: 40 },
      search: { type: "string", description: "名稱關鍵字", maxLength: 40 },
    },
  },
  { name: "getValidationIssues", category: "read", mutates: false, summary: "讀取目前的檢查問題清單", params: {} },
  {
    name: "getSimulationSummary", category: "read", mutates: false, summary: "讀取人流模擬摘要",
    params: { participants: { type: "number", description: "參與人數", min: 1, max: 5000, integer: true } },
  },
  { name: "getViewportState", category: "read", mutates: false, summary: "讀取目前視角與工作區模式", params: {} },
  { name: "getLayerVisibility", category: "read", mutates: false, summary: "讀取圖層顯示狀態", params: {} },
  { name: "getMeasurements", category: "read", mutates: false, summary: "讀取已標註的量測", params: {} },
  { name: "getActiveScenario", category: "read", mutates: false, summary: "讀取目前活動情境與站點", params: {} },

  /* ---- objects ---- */
  {
    name: "createAssetFromCatalog", category: "object", mutates: true, summary: "從素材目錄放置一件物件",
    params: {
      assetId: id("素材目錄 id，例如 builtin:regTable"),
      target: { type: "enum", description: "放置位置策略", values: PLACEMENT_TARGETS },
      x: meters("target 為 point 時的 X"),
      z: meters("target 為 point 時的 Z"),
      index: { type: "number", description: "同一批的第幾件，用來自動錯開", min: 0, max: 500, integer: true },
      offsetX: meters("在策略位置上再偏移的 X"),
      offsetZ: meters("在策略位置上再偏移的 Z"),
      rotationDeg: { type: "number", description: "朝向角度", min: -360, max: 360 },
    },
  },
  {
    name: "createCustomAssetProxy", category: "object", mutates: true, summary: "以尺寸建立簡化自訂素材",
    params: {
      name: name("素材名稱", true),
      semanticType: { type: "enum", description: "語意類型", values: SEMANTIC_TYPES },
      serviceRole: { type: "enum", description: "服務角色", values: SERVICE_ROLES },
      width: positiveMeters("寬（公尺）"),
      depth: positiveMeters("深（公尺）"),
      height: positiveMeters("高（公尺）"),
      sourceImageId: id("來源照片 blob id", false),
    },
  },
  {
    name: "createPropFromRecipe", category: "object", mutates: true, summary: "依配方建立互動道具",
    params: {
      name: name("道具名稱", true),
      kind: { type: "string", description: "dice / spinner / cardbox / box / table / screen / sign", maxLength: 30 },
      color: { type: "string", description: "十六進位顏色", maxLength: 9 },
      width: positiveMeters("寬（公尺）"),
      depth: positiveMeters("深（公尺）"),
      height: positiveMeters("高（公尺）"),
      interactive: { type: "boolean", description: "是否可互動" },
      faces: { type: "object[]", description: "面／格／卡片", maxItems: 12, itemShape: FACE_SHAPE },
      text: { type: "string", description: "印在主要面上的文字", maxLength: 120 },
      imageBlobId: id("已匯入的圖片 blob id，畫在主要面上", false),
      print: {
        type: "object[]", description: "印刷規格（只取第一筆）",
        maxItems: 1, itemShape: PRINT_SHAPE,
      },
    },
  },
  {
    name: "setPropArtwork", category: "object", mutates: true,
    summary: "把已匯入的圖片貼到道具的印刷面（海報、展架、背景牆）",
    params: {
      propId: id("道具 id"),
      assetId: id("已匯入、帶有來源圖片的素材 id", false),
      imageBlobId: id("直接指定圖片 blob id", false),
      partId: id("要貼的零件 id；省略時用主要印刷面", false),
    },
  },
  {
    name: "importAsset", category: "object", mutates: true, summary: "匯入已解析的 GLB/GLTF 素材",
    needsHost: true,
    params: {
      assetId: id("已由匯入 UI 建立的素材 id"),
    },
  },
  {
    name: "requestAssetReconstruction", category: "object", mutates: true, summary: "為自訂素材排入重建工作",
    params: { assetId: id("自訂素材 id") },
  },
  {
    name: "updateAssetMetadata", category: "object", mutates: true, summary: "更新素材的名稱、尺寸與角色",
    params: {
      assetId: id("素材 id"),
      name: name("新名稱"),
      semanticType: { type: "enum", description: "語意類型", values: SEMANTIC_TYPES },
      serviceRole: { type: "enum", description: "服務角色", values: SERVICE_ROLES },
      width: positiveMeters("寬（公尺）"),
      depth: positiveMeters("深（公尺）"),
      height: positiveMeters("高（公尺）"),
    },
  },
  {
    name: "replaceAssetVisual", category: "object", mutates: true, summary: "換掉素材的視覺模型",
    params: { assetId: id("素材 id"), visualRef: id("新的視覺參照") },
  },
  {
    name: "placeAsset", category: "object", mutates: true, summary: "放置一件物件（createAssetFromCatalog 的別名）",
    params: {
      assetId: id("素材目錄 id"),
      target: { type: "enum", description: "放置位置策略", values: PLACEMENT_TARGETS },
      x: meters("target 為 point 時的 X"),
      z: meters("target 為 point 時的 Z"),
      index: { type: "number", description: "同一批的第幾件", min: 0, max: 500, integer: true },
      offsetX: meters("再偏移的 X"),
      offsetZ: meters("再偏移的 Z"),
      rotationDeg: { type: "number", description: "朝向角度", min: -360, max: 360 },
    },
  },
  {
    name: "moveAsset", category: "object", mutates: true, summary: "移動一件物件到指定座標",
    params: { objectId: id("物件 id"), x: meters("目標 X", true), z: meters("目標 Z", true) },
  },
  {
    name: "rotateAsset", category: "object", mutates: true, summary: "旋轉一件物件",
    params: {
      objectId: id("物件 id"),
      rotationDeg: { type: "number", description: "絕對角度", min: -360, max: 360, required: true },
    },
  },
  {
    name: "resizeAsset", category: "object", mutates: true, summary: "調整一件物件的尺寸",
    params: {
      objectId: id("物件 id"),
      width: positiveMeters("寬（公尺）"),
      depth: positiveMeters("深（公尺）"),
      height: positiveMeters("高（公尺）"),
    },
  },
  {
    name: "duplicateAsset", category: "object", mutates: true, summary: "複製一件物件",
    params: {
      objectId: id("物件 id"),
      offsetX: meters("複製件的 X 偏移"),
      offsetZ: meters("複製件的 Z 偏移"),
    },
  },
  {
    name: "removeAsset", category: "object", mutates: true, summary: "刪除一件物件",
    params: { objectId: id("物件 id") },
  },

  /* ---- arrays ---- */
  {
    name: "createArray", category: "array", mutates: true, summary: "建立列×行陣列（桌椅、地墊）",
    params: {
      assetId: id("素材目錄 id", false),
      kind: { type: "string", description: "物件種類，未給 assetId 時使用", maxLength: 30 },
      rows: { type: "number", description: "列數（沿 +Z）", min: 1, max: 100, integer: true, required: true },
      cols: { type: "number", description: "行數（沿 +X）", min: 1, max: 100, integer: true, required: true },
      gapX: { type: "number", description: "X 間距（公尺）", min: 0, max: 20 },
      gapZ: { type: "number", description: "Z 間距（公尺）", min: 0, max: 20 },
      anchorX: meters("左上角錨點 X"),
      anchorZ: meters("左上角錨點 Z"),
      rotationDeg: { type: "number", description: "整組角度", min: -360, max: 360 },
      name: name("陣列名稱"),
      numberPrefix: { type: "string", description: "編號前綴，例如 A", maxLength: 6 },
    },
  },
  {
    name: "updateArray", category: "array", mutates: true, summary: "修改既有陣列的列數、行數與間距",
    params: {
      groupId: id("陣列 id"),
      rows: { type: "number", description: "列數", min: 1, max: 100, integer: true },
      cols: { type: "number", description: "行數", min: 1, max: 100, integer: true },
      gapX: { type: "number", description: "X 間距（公尺）", min: 0, max: 20 },
      gapZ: { type: "number", description: "Z 間距（公尺）", min: 0, max: 20 },
      anchorX: meters("錨點 X"),
      anchorZ: meters("錨點 Z"),
      rotationDeg: { type: "number", description: "角度", min: -360, max: 360 },
      name: name("名稱"),
    },
  },
  {
    name: "removeArray", category: "array", mutates: true, summary: "刪除一組陣列",
    params: { groupId: id("陣列 id") },
  },
  {
    name: "distributeObjects", category: "array", mutates: true, summary: "把多件物件沿一軸等距排開",
    params: {
      objectIds: { type: "string[]", description: "要排開的物件 id", required: true, maxItems: 200 },
      axis: { type: "enum", description: "排列軸", values: DISTRIBUTE_AXES, required: true },
      spacing: { type: "number", description: "指定中心間距（公尺）；省略時在頭尾之間均分", min: 0, max: 50 },
    },
  },
  {
    name: "alignObjects", category: "array", mutates: true, summary: "把多件物件對齊",
    params: {
      objectIds: { type: "string[]", description: "要對齊的物件 id", required: true, maxItems: 200 },
      edge: { type: "enum", description: "對齊邊", values: ALIGN_AXES, required: true },
    },
  },

  /* ---- zones / routes / stations ---- */
  {
    name: "createZone", category: "zone-route", mutates: true, summary: "建立區域",
    params: {
      type: { type: "enum", description: "區域類型", values: ZONE_TYPES, required: true },
      name: name("區域名稱"),
      x: meters("中心 X"),
      z: meters("中心 Z"),
      width: positiveMeters("寬（公尺）"),
      depth: positiveMeters("深（公尺）"),
      capacity: { type: "number", description: "容納人數", min: 0, max: 5000, integer: true },
    },
  },
  {
    name: "updateZone", category: "zone-route", mutates: true, summary: "修改區域位置、尺寸與名稱",
    params: {
      zoneId: id("區域 id"),
      name: name("名稱"),
      x: meters("中心 X"),
      z: meters("中心 Z"),
      width: positiveMeters("寬（公尺）"),
      depth: positiveMeters("深（公尺）"),
      capacity: { type: "number", description: "容納人數", min: 0, max: 5000, integer: true },
      locked: { type: "boolean", description: "鎖定" },
      hidden: { type: "boolean", description: "隱藏" },
    },
  },
  { name: "removeZone", category: "zone-route", mutates: true, summary: "刪除區域", params: { zoneId: id("區域 id") } },
  {
    name: "createRoute", category: "zone-route", mutates: true, summary: "建立動線",
    params: {
      name: name("動線名稱"),
      type: { type: "enum", description: "動線類型", values: ROUTE_TYPES },
      color: { type: "string", description: "十六進位顏色", maxLength: 9 },
      points: { type: "object[]", description: "路徑點（至少兩點）", maxItems: 64, itemShape: POINT_SHAPE },
    },
  },
  {
    name: "updateRoute", category: "zone-route", mutates: true, summary: "修改動線的名稱、顏色與路徑",
    params: {
      routeId: id("動線 id"),
      name: name("名稱"),
      color: { type: "string", description: "十六進位顏色", maxLength: 9 },
      visible: { type: "boolean", description: "顯示" },
      points: { type: "object[]", description: "新的路徑點", maxItems: 64, itemShape: POINT_SHAPE },
    },
  },
  { name: "removeRoute", category: "zone-route", mutates: true, summary: "刪除動線", params: { routeId: id("動線 id") } },
  {
    name: "connectRouteToZones", category: "zone-route", mutates: true, summary: "把動線接到起訖區域並重算路徑",
    params: {
      routeId: id("動線 id"),
      startZoneId: id("起點區域 id", false),
      endZoneId: id("終點區域 id", false),
      waypointZoneIds: { type: "string[]", description: "中途經過的區域 id", maxItems: 20 },
    },
  },
  {
    name: "createServiceStation", category: "zone-route", mutates: true, summary: "建立服務站點",
    params: {
      type: { type: "enum", description: "站點類型", values: STATION_TYPES },
      name: name("站點名稱"),
      x: meters("X"),
      z: meters("Z"),
      staffCount: { type: "number", description: "人力數", min: 0, max: 200, integer: true },
      meanServiceSeconds: { type: "number", description: "平均服務秒數", min: 1, max: 3600 },
      objectId: id("綁定的物件 id", false),
      zoneId: id("綁定的區域 id", false),
    },
  },
  {
    name: "updateServiceStation", category: "zone-route", mutates: true, summary: "修改服務站點",
    params: {
      stationId: id("站點 id"),
      name: name("名稱"),
      staffCount: { type: "number", description: "人力數", min: 0, max: 200, integer: true },
      parallelServers: { type: "number", description: "同時服務窗口數", min: 0, max: 200, integer: true },
      meanServiceSeconds: { type: "number", description: "平均服務秒數", min: 1, max: 3600 },
      x: meters("X"),
      z: meters("Z"),
      queueCapacity: { type: "number", description: "排隊容量", min: 0, max: 5000, integer: true },
    },
  },
  {
    name: "removeServiceStation", category: "zone-route", mutates: true, summary: "刪除服務站點",
    params: { stationId: id("站點 id") },
  },

  /* ---- spatial design ---- */
  {
    name: "generateLayoutCandidates", category: "spatial", mutates: false,
    summary: "依需求產生 A/B/C 多個場佈方案（含容量、等待時間與風險）",
    params: {
      participants: { type: "number", description: "參與人數", min: 1, max: 5000, integer: true },
      eventType: { type: "enum", description: "活動類型", values: EVENT_TYPES },
      staffCount: { type: "number", description: "工作人員人數", min: 0, max: 500, integer: true },
      minAisleWidth: { type: "number", description: "最小走道寬度（公尺）", min: 0.3, max: 10 },
      doorClearance: { type: "number", description: "門前保留距離（公尺）", min: 0, max: 10 },
      zones: { type: "string[]", description: "需要的區域類型", values: ZONE_TYPES, maxItems: 16 },
      objectives: { type: "string[]", description: "設計目標", values: OBJECTIVES, maxItems: 8 },
      seatAssetId: id("座位素材 id（地墊或椅子）", false),
      requiredAssets: {
        type: "object[]", description: "指名要的素材與數量，例如三張長桌",
        maxItems: 20, itemShape: REQUIRED_ASSET_SHAPE,
      },
    },
  },
  {
    name: "applySmartLayout", category: "spatial", mutates: true, summary: "把指定方案套用到草稿",
    params: {
      candidateId: id("方案 id，例如 scheme-a"),
      participants: { type: "number", description: "參與人數", min: 1, max: 5000, integer: true },
      eventType: { type: "enum", description: "活動類型", values: EVENT_TYPES },
      staffCount: { type: "number", description: "工作人員人數", min: 0, max: 500, integer: true },
      minAisleWidth: { type: "number", description: "最小走道寬度（公尺）", min: 0.3, max: 10 },
      doorClearance: { type: "number", description: "門前保留距離（公尺）", min: 0, max: 10 },
      zones: { type: "string[]", description: "需要的區域類型", values: ZONE_TYPES, maxItems: 16 },
      objectives: { type: "string[]", description: "設計目標", values: OBJECTIVES, maxItems: 8 },
      seatAssetId: id("座位素材 id", false),
      requiredAssets: {
        type: "object[]", description: "指名要的素材與數量",
        maxItems: 20, itemShape: REQUIRED_ASSET_SHAPE,
      },
    },
  },
  {
    name: "scoreLayoutCandidate", category: "spatial", mutates: false, summary: "對單一方案評分並說明理由",
    params: {
      candidateId: id("方案 id"),
      participants: { type: "number", description: "參與人數", min: 1, max: 5000, integer: true },
      eventType: { type: "enum", description: "活動類型", values: EVENT_TYPES },
      objectives: { type: "string[]", description: "設計目標", values: OBJECTIVES, maxItems: 8 },
    },
  },
  {
    name: "validateLayout", category: "spatial", mutates: true, summary: "執行檢查；可選擇同時清出門前空間",
    params: {
      optimize: { type: "enum", description: "順手做的最佳化", values: ["clear-doors"] as const },
    },
  },
  {
    name: "measureGap", category: "spatial", mutates: false, summary: "量兩件物件之間或物件與牆的淨距",
    params: {
      objectIdA: id("物件 A id"),
      objectIdB: id("物件 B id", false),
      toWall: { type: "boolean", description: "改量到最近的牆" },
    },
  },
  {
    name: "checkDoorClearance", category: "spatial", mutates: false, summary: "檢查每一扇門前的淨空",
    params: {
      clearance: { type: "number", description: "要求的淨空（公尺）", min: 0, max: 10 },
    },
  },
  {
    name: "checkAccessibilityWarnings", category: "spatial", mutates: false,
    summary: "列出無障礙與通道的設計提醒（非法規判定）",
    params: {
      corridorWidth: { type: "number", description: "要求的通路淨寬（公尺）", min: 0.3, max: 10 },
      turningSpace: { type: "number", description: "輪椅迴轉直徑（公尺）", min: 0.5, max: 5 },
    },
  },
  {
    name: "checkSightlines", category: "spatial", mutates: false, summary: "檢查螢幕／舞台的視線是否被擋",
    params: { targetId: id("要檢查的螢幕物件 id", false) },
  },
  {
    name: "calculateCapacity", category: "spatial", mutates: false, summary: "依面積與座位方式估算容納人數",
    params: {
      mode: {
        type: "enum", description: "座位方式",
        values: ["floor-mat", "chairs-rows", "banquet-round", "standing", "classroom-desks"] as const,
      },
      areaSquareMeters: { type: "number", description: "指定面積；省略時用教室面積", min: 0.1, max: 100000 },
    },
  },
  {
    name: "simulateScenario", category: "spatial", mutates: true, summary: "跑人流模擬",
    params: {
      participants: { type: "number", description: "參與人數", min: 1, max: 5000, integer: true },
      scenarioId: id("情境 id", false),
    },
  },
  {
    name: "compareScenarios", category: "spatial", mutates: false, summary: "比較同桌／分桌等方案",
    params: { participants: { type: "number", description: "參與人數", min: 1, max: 5000, integer: true } },
  },
  {
    name: "explainBottleneck", category: "spatial", mutates: true, summary: "找出最塞的地方並解釋原因",
    params: { participants: { type: "number", description: "參與人數", min: 1, max: 5000, integer: true } },
  },

  /* ---- project ---- */
  {
    name: "createProject", category: "project", mutates: false, needsHost: true, summary: "建立新專案",
    params: {
      name: name("專案名稱", true),
      eventDate: { type: "string", description: "活動日期 YYYY-MM-DD", maxLength: 10 },
      venuePresetId: id("場地預設 id", false),
    },
  },
  {
    name: "openProject", category: "project", mutates: false, needsHost: true, summary: "開啟既有專案",
    params: { projectId: id("專案 id") },
  },
  { name: "saveProject", category: "project", mutates: false, needsHost: true, summary: "存檔目前專案", params: {} },
  {
    name: "duplicateProject", category: "project", mutates: false, needsHost: true, summary: "複製專案",
    params: { projectId: id("專案 id", false), name: name("新名稱") },
  },
  {
    name: "renameProject", category: "project", mutates: false, needsHost: true, summary: "重新命名專案",
    params: { projectId: id("專案 id", false), name: name("新名稱", true) },
  },
  {
    name: "deleteProject", category: "project", mutates: false, needsHost: true, summary: "刪除專案（需要明確確認）",
    params: {
      projectId: id("專案 id"),
      confirm: { type: "boolean", description: "必須為 true，代表使用者已確認刪除", required: true },
    },
  },
  {
    name: "createLayoutVersion", category: "project", mutates: false, needsHost: true, summary: "把目前配置存成具名版本",
    params: { name: name("版本名稱", true) },
  },
  {
    name: "restoreLayoutVersion", category: "project", mutates: true, needsHost: true, summary: "把具名版本讀回草稿",
    params: { name: name("版本名稱", true) },
  },
  { name: "exportProject", category: "project", mutates: false, needsHost: true, summary: "匯出專案 JSON", params: {} },
  {
    name: "importProject", category: "project", mutates: false, needsHost: true, summary: "匯入專案 JSON（需由 UI 選檔）",
    params: {},
  },
  {
    name: "exportPlanImage", category: "project", mutates: false, needsHost: true, summary: "匯出場佈圖／動線圖／施工圖",
    params: {
      preset: { type: "enum", description: "圖面種類", values: PLAN_PRESETS },
      pageSize: { type: "enum", description: "頁面尺寸", values: ["a4", "a3", "phone"] as const },
      orientation: { type: "enum", description: "方向", values: ["landscape", "portrait"] as const },
    },
  },
  { name: "exportPartnerView", category: "project", mutates: false, needsHost: true, summary: "匯出夥伴觀看圖", params: {} },
  { name: "exportMaterialList", category: "project", mutates: false, summary: "產生物資清單", params: {} },

  /* ---- view ---- */
  { name: "focusObject", category: "view", mutates: false, needsHost: true, summary: "把鏡頭對到某件物件", params: { objectId: id("物件 id") } },
  { name: "focusZone", category: "view", mutates: false, needsHost: true, summary: "把鏡頭對到某個區域", params: { zoneId: id("區域 id") } },
  {
    name: "setView", category: "view", mutates: true, needsHost: false, summary: "切換視角",
    params: { view: { type: "enum", description: "視角", values: VIEW_NAMES, required: true } },
  },
  {
    name: "setLayerVisibility", category: "view", mutates: true, summary: "開關圖層",
    params: {
      layer: { type: "enum", description: "圖層", values: LAYER_NAMES, required: true },
      visible: { type: "boolean", description: "是否顯示", required: true },
    },
  },
  { name: "fitScene", category: "view", mutates: false, needsHost: true, summary: "縮放到全場", params: {} },
  {
    name: "toggleLabels", category: "view", mutates: false, needsHost: true, summary: "開關標籤",
    params: { visible: { type: "boolean", description: "是否顯示" } },
  },
  {
    name: "toggleSimulation", category: "view", mutates: false, needsHost: true, summary: "開關模擬播放",
    params: { running: { type: "boolean", description: "是否播放" } },
  },

  /* ---- meta ---- */
  { name: "previewAgentChanges", category: "meta", mutates: false, summary: "產生 before/after 差異摘要", params: {} },
  { name: "commitAgentChanges", category: "meta", mutates: false, summary: "套用草稿（由編排層處理）", params: {} },
  { name: "rollbackAgentChanges", category: "meta", mutates: false, summary: "捨棄草稿（由編排層處理）", params: {} },
];

const SPEC_BY_NAME = new Map<string, ToolSpec>(TOOL_SPECS.map((s) => [s.name, s]));

export function toolSpec(name: string): ToolSpec | undefined {
  return SPEC_BY_NAME.get(name);
}

export function toolNames(): AgentToolName[] {
  return TOOL_SPECS.map((s) => s.name);
}

export function toolsByCategory(category: ToolCategory): ToolSpec[] {
  return TOOL_SPECS.filter((s) => s.category === category);
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export type ToolArgsValidation =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; error: string };

function describeType(spec: ToolParamSpec): string {
  if (spec.type === "enum") return `列舉（${(spec.values ?? []).join(" / ")}）`;
  return spec.type;
}

function validateScalar(key: string, spec: ToolParamSpec, raw: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  switch (spec.type) {
    case "number": {
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        return { ok: false, error: `${key} 必須是數字，收到 ${JSON.stringify(raw)}` };
      }
      if (spec.integer && !Number.isInteger(raw)) {
        return { ok: false, error: `${key} 必須是整數，收到 ${raw}` };
      }
      if (spec.min !== undefined && raw < spec.min) {
        return { ok: false, error: `${key} 不可小於 ${spec.min}，收到 ${raw}` };
      }
      if (spec.max !== undefined && raw > spec.max) {
        return { ok: false, error: `${key} 不可大於 ${spec.max}，收到 ${raw}` };
      }
      return { ok: true, value: raw };
    }
    case "boolean": {
      if (typeof raw !== "boolean") return { ok: false, error: `${key} 必須是 true 或 false` };
      return { ok: true, value: raw };
    }
    case "string": {
      if (typeof raw !== "string") return { ok: false, error: `${key} 必須是字串` };
      if (spec.maxLength !== undefined && raw.length > spec.maxLength) {
        return { ok: false, error: `${key} 太長（上限 ${spec.maxLength} 字）` };
      }
      return { ok: true, value: raw };
    }
    case "enum": {
      if (typeof raw !== "string") return { ok: false, error: `${key} 必須是字串` };
      if (!(spec.values ?? []).includes(raw)) {
        return { ok: false, error: `${key} 只能是 ${(spec.values ?? []).join(" / ")}，收到 ${raw}` };
      }
      return { ok: true, value: raw };
    }
    default:
      return { ok: false, error: `${key} 的型別 ${describeType(spec)} 無法以純量驗證` };
  }
}

/**
 * Validate one tool call's arguments against its declared schema.
 *
 * Unknown keys are an error rather than being dropped. Silently ignoring an
 * argument the caller believed in is how a tool ends up reporting that it
 * honoured a constraint it never read.
 */
export function validateToolArgs(toolName: string, rawArgs: unknown): ToolArgsValidation {
  const spec = SPEC_BY_NAME.get(toolName);
  if (!spec) return { ok: false, error: `未知工具：${toolName}` };

  if (rawArgs === undefined || rawArgs === null) {
    const missing = Object.entries(spec.params).filter(([, p]) => p.required).map(([k]) => k);
    if (missing.length) return { ok: false, error: `${toolName} 缺少必要參數：${missing.join("、")}` };
    return { ok: true, args: {} };
  }
  if (typeof rawArgs !== "object" || Array.isArray(rawArgs)) {
    return { ok: false, error: `${toolName} 的參數必須是物件` };
  }

  const args = rawArgs as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const key of Object.keys(args)) {
    // `key in spec.params` walks the prototype chain, so `__proto__`,
    // `constructor` and `toString` all pass a plain `in` check and slip past
    // the unknown-key rule. hasOwnProperty is the only correct test here.
    if (!Object.prototype.hasOwnProperty.call(spec.params, key)) {
      return { ok: false, error: `${toolName} 不接受參數「${key}」（可用：${Object.keys(spec.params).join("、") || "無"}）` };
    }
  }

  for (const [key, param] of Object.entries(spec.params)) {
    const raw = args[key];
    if (raw === undefined) {
      if (param.required) return { ok: false, error: `${toolName} 缺少必要參數「${key}」` };
      continue;
    }
    if (raw === null) {
      if (param.required) return { ok: false, error: `${toolName} 的「${key}」不可為 null` };
      continue;
    }

    if (param.type === "string[]") {
      if (!Array.isArray(raw)) return { ok: false, error: `${key} 必須是字串陣列` };
      if (param.maxItems !== undefined && raw.length > param.maxItems) {
        return { ok: false, error: `${key} 最多 ${param.maxItems} 筆，收到 ${raw.length}` };
      }
      const items: string[] = [];
      for (const [i, v] of raw.entries()) {
        if (typeof v !== "string") return { ok: false, error: `${key}[${i}] 必須是字串` };
        if (param.values && !param.values.includes(v)) {
          return { ok: false, error: `${key}[${i}] 只能是 ${param.values.join(" / ")}，收到 ${v}` };
        }
        items.push(v);
      }
      out[key] = items;
      continue;
    }

    if (param.type === "object[]") {
      if (!Array.isArray(raw)) return { ok: false, error: `${key} 必須是陣列` };
      if (param.maxItems !== undefined && raw.length > param.maxItems) {
        return { ok: false, error: `${key} 最多 ${param.maxItems} 筆，收到 ${raw.length}` };
      }
      const shape = param.itemShape ?? {};
      const items: Record<string, unknown>[] = [];
      for (const [i, v] of raw.entries()) {
        if (typeof v !== "object" || v === null || Array.isArray(v)) {
          return { ok: false, error: `${key}[${i}] 必須是物件` };
        }
        const src = v as Record<string, unknown>;
        for (const k of Object.keys(src)) {
          // Same prototype-chain trap as above, one level down.
          if (!Object.prototype.hasOwnProperty.call(shape, k)) {
            return { ok: false, error: `${key}[${i}] 不接受欄位「${k}」` };
          }
        }
        const item: Record<string, unknown> = {};
        for (const [k, sub] of Object.entries(shape)) {
          const sv = src[k];
          if (sv === undefined || sv === null) {
            if (sub.required) return { ok: false, error: `${key}[${i}] 缺少「${k}」` };
            continue;
          }
          const r = validateScalar(`${key}[${i}].${k}`, sub, sv);
          if (!r.ok) return r;
          item[k] = r.value;
        }
        items.push(item);
      }
      out[key] = items;
      continue;
    }

    const r = validateScalar(key, param, raw);
    if (!r.ok) return r;
    out[key] = r.value;
  }

  return { ok: true, args: out };
}
