/**
 * Four workbench layers for the professional venue editor.
 *
 * These are a presentation/grouping overlay on SceneObject — they never invent
 * a second object list. Visibility and lock write through to the same
 * `hidden` / `locked` fields canvas interactions already use, plus an optional
 * `editorLayer` tag so grouping survives reload.
 */

import {
  DEFAULT_WORKBENCH_LAYERS,
  type EditorLayerId,
  type Project,
  type SceneObject,
  type WorkbenchLayers,
  type Zone,
} from "./model";

export const EDITOR_LAYER_DEFS: { id: EditorLayerId; label: string; hint: string }[] = [
  { id: "fixture", label: "固定設施", hint: "門／投影幕／黑板／窗／冷氣／燈／電源／消防" },
  { id: "furniture", label: "教室家具", hint: "課桌椅／講桌／講台／報到桌／工作桌／椅子／櫃子" },
  { id: "event", label: "活動場佈", hint: "地墊／鞋子／背包／講師／報到／生活組／小組／新生等候" },
  { id: "flow", label: "動線與標記", hint: "入口／出口／箭頭／區域標籤／工作人員／新生位置／注意" },
];

const FIXTURE_ASSETS = new Set([
  "builtin:door", "builtin:switch", "builtin:screen",
  "builtin:blackboard", "builtin:window", "builtin:ac-unit",
  "builtin:ceiling-light", "builtin:power-outlet", "builtin:fire-alarm",
  "builtin:room-plate", "builtin:column", "builtin:stair", "builtin:elevator",
  "builtin:notice-board", "builtin:trash-bin", "builtin:hydrant",
  "builtin:extinguisher", "builtin:corridor-light", "builtin:tactile-paving",
  "builtin:fountain", "builtin:corridor-custom",
]);

const FURNITURE_ASSETS = new Set([
  "builtin:table", "builtin:chair", "builtin:lectern", "builtin:stage-platform",
  "builtin:cabinet", "builtin:bench", "builtin:plant",
]);

const EVENT_ASSETS = new Set([
  "builtin:mat", "builtin:regTable", "builtin:payment-desk", "builtin:shoe-rack",
  "builtin:computer", "builtin:payment-box",
]);

const FLOW_ASSETS = new Set([
  "builtin:signage-stand", "builtin:queue-barrier",
]);

export function inferEditorLayer(obj: Pick<SceneObject, "kind" | "assetId" | "editorLayer" | "serviceRole">): EditorLayerId {
  if (obj.editorLayer) return obj.editorLayer;
  const id = obj.assetId ?? `builtin:${obj.kind}`;
  if (FIXTURE_ASSETS.has(id) || obj.kind === "door" || obj.kind === "switch" || obj.kind === "screen") return "fixture";
  if (FLOW_ASSETS.has(id)) return "flow";
  if (EVENT_ASSETS.has(id) || obj.kind === "mat" || obj.kind === "regTable" || obj.serviceRole === "checkin" || obj.serviceRole === "payment") {
    return "event";
  }
  if (FURNITURE_ASSETS.has(id) || obj.kind === "table" || obj.kind === "chair") return "furniture";
  if (id.includes("corridor") || id.includes("hydrant") || id.includes("window") || id.includes("blackboard")) return "fixture";
  return "furniture";
}

export function cloneWorkbenchLayers(layers?: Partial<WorkbenchLayers> | null): WorkbenchLayers {
  const base = DEFAULT_WORKBENCH_LAYERS;
  const out: WorkbenchLayers = {
    fixture: { ...base.fixture, ...(layers?.fixture ?? {}) },
    furniture: { ...base.furniture, ...(layers?.furniture ?? {}) },
    event: { ...base.event, ...(layers?.event ?? {}) },
    flow: { ...base.flow, ...(layers?.flow ?? {}) },
  };
  return out;
}

export function objectLayerVisible(project: Project, obj: SceneObject): boolean {
  const layers = cloneWorkbenchLayers(project.workbenchLayers);
  const id = inferEditorLayer(obj);
  if (!layers[id].visible) return false;
  if (obj.visibleInEdit === false) return false;
  return !obj.hidden;
}

export function objectLayerLocked(project: Project, obj: SceneObject): boolean {
  const layers = cloneWorkbenchLayers(project.workbenchLayers);
  return obj.locked || layers[inferEditorLayer(obj)].locked;
}

export interface LayerObjectRow {
  object: SceneObject;
  layer: EditorLayerId;
}

export function objectsByEditorLayer(project: Project): Record<EditorLayerId, SceneObject[]> {
  const grouped: Record<EditorLayerId, SceneObject[]> = {
    fixture: [], furniture: [], event: [], flow: [],
  };
  const sorted = [...project.objects].sort((a, b) => (b.layer ?? 0) - (a.layer ?? 0) || (b.createdAt ?? 0) - (a.createdAt ?? 0));
  for (const o of sorted) grouped[inferEditorLayer(o)].push(o);
  return grouped;
}

export function zoneEditorLayer(zone: Zone): EditorLayerId {
  return zone.type === "staff" || zone.type === "wait" ? "flow" : "flow";
}
