/**
 * Agent tool executor — runs allowlisted, schema-validated tools against a
 * draft Project.
 *
 * Three contracts this file keeps, and the failure each one prevents:
 *
 * 1. **Every call is validated before it runs.** `validateToolArgs` rejects
 *    unknown parameters, wrong types and out-of-range numbers. Without it a
 *    tool reads whatever keys it likes and a caller can hand over a whole
 *    Project blob.
 * 2. **A tool that cannot do the thing says so.** There is no `{ ok: true,
 *    note: "請用手動面板" }` in here any more. That shape was reported to the
 *    user as a successful change and it was not one — `updateZone`,
 *    `updateRoute`, `createArray`, `updateArray`, `updateAssetMetadata` and
 *    `measureGap` all used to do it. They are implemented now; anything still
 *    unavailable returns `ok: false` with the reason.
 * 3. **Nothing here touches Three.js or the committed store.** Mutations go
 *    through `AgentTransaction.mutate` into the draft. Capabilities outside the
 *    plan document (project library, camera, exporters) go through `AgentHost`,
 *    and are absent-by-default so a headless run fails honestly.
 */

import { eventFlowAdapter } from "../adapters/eventFlow";
import { ALL_KINDS, assetDef } from "../core/assets";
import { createCustomAssetProxy } from "../assets/proxy";
import { describeRecipe, propFromRecipe, type PropRecipe } from "../core/propRecipe";
import { syncPropEntries } from "../core/propCatalog";
import {
  MockReconstructionWorker,
  ReconstructionQueue,
  replaceCatalogVisual,
} from "../assets/reconstruction";
import type { AssetCatalogEntry, SemanticAssetType, ServiceRole } from "../core/catalog";
import { catalogFromProject } from "../core/migrate";
import { buildSummaryLines } from "../core/summary";
import { inventoryLines, printOrderLines } from "../export/constructionPlan";
import { groupMembers } from "../core/arrays";
import { measure, objectGap } from "../core/measure";
import { areaBounds, doorSweep, footprintBounds, pointInDoorSweep, pointToRectDist, wallClearances, type Rect } from "../core/placement";
import {
  buildScheme,
  compareSchemes,
  generateLayoutSchemes,
  type EventType,
  type LayoutBrief,
  type LayoutObjective,
} from "../core/spatialPlanner";
import {
  explainWithSources,
  knowledgeValue,
  SAFETY_DISCLAIMER,
} from "../core/spatialKnowledge";
import {
  uid,
  ZONE_DEFAULTS,
  type ArrayGroup,
  type LayerVisibility,
  type Project,
  type Route,
  type RouteType,
  type SceneObject,
  type ViewName,
  type Zone,
  type ZoneType,
} from "../core/model";
import { issueCounts, validateProject } from "../core/validation";
import { isAllowedTool } from "./tools";
import { toolSpec, validateToolArgs } from "./toolSchema";
import type { AgentHost } from "./host";
import type { AgentToolCall } from "./types";
import type { AgentTransaction } from "./transaction";

export interface ExecutorContext {
  selectionIds: string[];
  reconstructionQueue: ReconstructionQueue;
  /** Capabilities outside the plan document. Absent in headless runs. */
  host?: AgentHost;
}

export interface ToolResult {
  ok: boolean;
  tool: string;
  data?: unknown;
  error?: string;
}

type Args = Record<string, unknown>;

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function rectOf(o: { x: number; z: number; width: number; depth: number; rotationDeg: number }): Rect {
  return { cx: o.x, cz: o.z, w: o.width, d: o.depth, rot: o.rotationDeg };
}

export class AgentExecutor {
  constructor(
    private tx: AgentTransaction,
    private ctx: ExecutorContext,
  ) {}

  async runAll(calls: AgentToolCall[]): Promise<ToolResult[]> {
    const results: ToolResult[] = [];
    for (const call of calls) {
      results.push(await this.run(call));
    }
    return results;
  }

  async run(call: AgentToolCall): Promise<ToolResult> {
    const tool = call.tool;
    if (!isAllowedTool(tool)) {
      return { ok: false, tool, error: `工具不在允許清單：${tool}` };
    }
    const spec = toolSpec(tool);
    if (!spec) {
      return { ok: false, tool, error: `工具沒有 schema：${tool}` };
    }
    const validated = validateToolArgs(tool, call.args);
    if (!validated.ok) {
      return { ok: false, tool, error: validated.error };
    }
    const args = validated.args;

    const draft = this.tx.getDraft();
    // Read tools need a draft too — they report on what the preview would look
    // like, not on some other project.
    if (!draft && tool !== "rollbackAgentChanges") {
      return { ok: false, tool, error: "沒有進行中的 Preview" };
    }

    try {
      return await this.dispatch(tool, args, draft as Project);
    } catch (e) {
      return { ok: false, tool, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /* ---------------------------------------------------------------- */

  private async dispatch(tool: string, args: Args, draft: Project): Promise<ToolResult> {
    const ok = (data: unknown): ToolResult => ({ ok: true, tool, data });
    const fail = (error: string): ToolResult => ({ ok: false, tool, error });

    switch (tool) {
      /* ---------------- read ---------------- */
      case "getProjectSummary":
        return ok({ name: draft.name, lines: buildSummaryLines(draft) });

      case "getVenueGeometry":
        return ok({
          classroom: draft.classroom,
          corridor: draft.corridor,
          tile: draft.tile,
          calibration: draft.calibration,
          venuePresetId: draft.venuePresetId ?? null,
        });

      case "getSelection":
        return ok({ selectionIds: this.ctx.selectionIds });

      case "getZones":
        return ok({ zones: draft.zones });

      case "getRoutes":
        return ok({ routes: draft.routes });

      case "listAssets": {
        const catalog = catalogFromProject(draft);
        const category = str(args.category);
        const search = str(args.search).toLowerCase();
        let list = catalog.list();
        if (category) list = list.filter((e) => e.category === category);
        if (search) list = list.filter((e) => e.name.toLowerCase().includes(search));
        return ok({
          assets: list.map((e) => ({
            id: e.id,
            name: e.name,
            kind: e.kind,
            category: e.category,
            semanticType: e.semanticType,
            serviceRole: e.serviceRole ?? "none",
            dimensions: e.dimensions,
          })),
        });
      }

      case "getValidationIssues": {
        const issues = validateProject(draft);
        return ok({ issues, counts: issueCounts(issues) });
      }

      case "getSimulationSummary":
        return ok(eventFlowAdapter.getSimulationSummary(draft, num(args.participants, 60)));

      case "getViewportState":
        return ok({
          view: draft.view,
          layers: draft.layers,
          workspaceMode: this.ctx.host?.viewport?.workspaceMode() ?? null,
        });

      case "getLayerVisibility":
        return ok({ layers: draft.layers });

      case "getMeasurements":
        return ok({ measurements: draft.measurements });

      case "getActiveScenario": {
        const active =
          (draft.activeScenarioId && draft.scenarios.find((s) => s.id === draft.activeScenarioId)) ||
          draft.scenarios[0] ||
          null;
        return ok({
          activeScenarioId: draft.activeScenarioId,
          scenario: active,
          scenarioCount: draft.scenarios.length,
          hasInteractionFlow: !!draft.interaction,
        });
      }

      /* ---------------- objects ---------------- */
      case "createAssetFromCatalog":
      case "placeAsset": {
        const assetId = str(args.assetId);
        const obj = this.placeFromCatalog(draft, assetId, args);
        if (!obj) return fail(`找不到素材 ${assetId}`);
        this.tx.mutate((p) => {
          p.objects.push(obj);
        });
        return ok({ objectId: obj.id, x: obj.x, z: obj.z });
      }

      case "createCustomAssetProxy": {
        const { entry } = await createCustomAssetProxy({
          name: str(args.name, "自訂素材"),
          semanticType: (str(args.semanticType, "table") as SemanticAssetType),
          serviceRole: (str(args.serviceRole, "none") as ServiceRole),
          dimensions: {
            width: num(args.width, 1.2),
            depth: num(args.depth, 0.6),
            height: num(args.height, 0.74),
          },
          ...(args.sourceImageId ? { sourceImageId: str(args.sourceImageId) } : {}),
        });
        this.tx.mutate((p) => {
          p.catalogExtras = [...(p.catalogExtras ?? []), entry as never];
        });
        return ok({ assetId: entry.id, entry });
      }

      case "createPropFromRecipe": {
        const faces = Array.isArray(args.faces)
          ? (args.faces as Args[]).map((o) => ({
            label: str(o.label, ""),
            ...(typeof o.color === "string" ? { color: o.color } : {}),
            ...(typeof o.prompt === "string" ? { prompt: o.prompt } : {}),
          }))
          : undefined;
        const def = propFromRecipe(
          {
            name: str(args.name, "AI 道具"),
            ...(args.kind !== undefined ? { kind: str(args.kind) } : {}),
            ...(args.color !== undefined ? { color: str(args.color) } : {}),
            ...(args.width !== undefined || args.depth !== undefined || args.height !== undefined
              ? {
                dimensions: {
                  width: num(args.width, 0.6),
                  depth: num(args.depth, 0.6),
                  height: num(args.height, 0.6),
                },
              }
              : {}),
            ...(faces?.length ? { faces } : {}),
            ...(args.interactive === false ? { interactive: false } : {}),
            ...(args.text !== undefined ? { text: str(args.text) } : {}),
            ...(args.imageBlobId !== undefined ? { imageBlobId: str(args.imageBlobId) } : {}),
            ...(Array.isArray(args.print) && args.print.length
              ? { print: (args.print as Args[])[0] as PropRecipe["print"] }
              : {}),
          },
          uid("prop"),
        );
        this.tx.mutate((p) => {
          p.props = [...(p.props ?? []), def];
          p.catalogExtras = syncPropEntries(p.catalogExtras, p.props);
        });
        return ok({ propId: def.id, summary: describeRecipe(def) });
      }

      case "setPropArtwork": {
        const propId = str(args.propId);
        const def = (draft.props ?? []).find((d) => d.id === propId);
        if (!def) return fail(`找不到道具 ${propId}`);

        // A blob id can be given directly, but nobody knows one by heart. The
        // useful path is 「用剛剛匯入的那張圖」: name the asset, and its stored
        // source image is found for you.
        let blobId = str(args.imageBlobId);
        if (!blobId) {
          const assetId = str(args.assetId);
          if (!assetId) return fail("setPropArtwork 需要 assetId 或 imageBlobId");
          const entry = (draft.catalogExtras ?? []).find((e) => e.id === assetId);
          if (!entry) return fail(`找不到素材 ${assetId}`);
          blobId = entry.blobIds?.sourceImage ?? "";
          if (!blobId) return fail(`素材「${entry.name}」沒有來源圖片，無法當作圖稿。`);
        }

        // The printable face is the last part for every printed preset (foot
        // first, panel last). A named part wins when the caller knows better.
        const wantedPart = str(args.partId);
        const index = wantedPart
          ? def.parts.findIndex((p) => p.id === wantedPart)
          : def.parts.length - 1;
        if (index < 0) return fail(`道具「${def.name}」沒有零件 ${wantedPart}`);
        const target = def.parts[index];
        if (target.shape !== "plane") {
          return fail(`零件「${target.id}」不是平面，貼圖只能貼在印刷面上。`);
        }

        this.tx.mutate((p) => {
          p.props = (p.props ?? []).map((d) => (d.id === propId
            ? {
              ...d,
              // The catalog entry mirrors this number and the scene's rebuild
              // signature reads it; without the bump the artwork never appears.
              version: (d.version ?? 1) + 1,
              parts: d.parts.map((part, i) => (i === index ? { ...part, imageBlobId: blobId } : part)),
            }
            : d));
          p.catalogExtras = syncPropEntries(p.catalogExtras, p.props);
        });
        return ok({ propId, partId: target.id, imageBlobId: blobId });
      }

      case "importAsset": {
        // Reading a file needs a picker, and a picker needs the user. The agent
        // can place an asset the import UI already produced, but it cannot open
        // a file dialog on the user's behalf.
        const assetId = str(args.assetId);
        const entry = catalogFromProject(draft).get(assetId);
        if (!entry) {
          return fail("匯入 3D 檔案需要由使用者在「匯入素材」選擇檔案；Agent 只能放置已匯入的素材。");
        }
        return ok({ assetId, entry, note: "素材已在目錄中，可用 placeAsset 放置。" });
      }

      case "requestAssetReconstruction": {
        const assetId = str(args.assetId);
        const found = (draft.catalogExtras ?? []).find((e) => e.id === assetId);
        if (!found) return fail(`找不到自訂素材 ${assetId}`);
        const job = this.ctx.reconstructionQueue.enqueue(assetId, found.blobIds?.sourceImage);
        const worker = new MockReconstructionWorker(this.ctx.reconstructionQueue);
        const { entry } = await worker.run(job.id, found as AssetCatalogEntry);
        this.tx.mutate((p) => {
          p.catalogExtras = (p.catalogExtras ?? []).map((e) => (e.id === assetId ? (entry as never) : e));
        });
        return ok({ assetId, visualRef: entry.visualRef });
      }

      case "updateAssetMetadata": {
        const assetId = str(args.assetId);
        if (assetId.startsWith("builtin:")) {
          return fail("內建素材不能改尺寸或名稱；請先用 createCustomAssetProxy 建立自訂素材。");
        }
        const extras = draft.catalogExtras ?? [];
        const idx = extras.findIndex((e) => e.id === assetId);
        if (idx < 0) return fail(`找不到自訂素材 ${assetId}`);
        const before = extras[idx] as AssetCatalogEntry;
        const next: AssetCatalogEntry = {
          ...before,
          name: args.name !== undefined ? str(args.name) : before.name,
          semanticType: args.semanticType !== undefined ? (str(args.semanticType) as SemanticAssetType) : before.semanticType,
          serviceRole: args.serviceRole !== undefined ? (str(args.serviceRole) as ServiceRole) : before.serviceRole,
          dimensions: {
            width: num(args.width, before.dimensions.width),
            depth: num(args.depth, before.dimensions.depth),
            height: num(args.height, before.dimensions.height),
          },
          version: (before.version ?? 1) + 1,
        };
        this.tx.mutate((p) => {
          p.catalogExtras = (p.catalogExtras ?? []).map((e) => (e.id === assetId ? (next as never) : e));
          // Objects already placed from this asset keep their own size unless
          // the caller changed dimensions — a rename must not move furniture.
          if (args.width !== undefined || args.depth !== undefined || args.height !== undefined) {
            for (const o of p.objects) {
              if (o.assetId === assetId && !o.locked) {
                o.width = next.dimensions.width;
                o.depth = next.dimensions.depth;
                o.height = next.dimensions.height;
              }
            }
          }
        });
        return ok({ assetId, before: before.dimensions, after: next.dimensions });
      }

      case "replaceAssetVisual": {
        const assetId = str(args.assetId);
        const visualRef = str(args.visualRef);
        if (!(draft.catalogExtras ?? []).some((e) => e.id === assetId)) {
          return fail(`找不到自訂素材 ${assetId}`);
        }
        this.tx.mutate((p) => {
          p.catalogExtras = (p.catalogExtras ?? []).map((e) =>
            e.id === assetId ? (replaceCatalogVisual(e as AssetCatalogEntry, visualRef) as never) : e,
          );
        });
        return ok({ assetId, visualRef });
      }

      case "moveAsset": {
        const id = str(args.objectId);
        const target = draft.objects.find((o) => o.id === id);
        if (!target) return fail(`找不到物件 ${id}`);
        if (target.locked) return fail(`物件 ${id} 已鎖定，請先解鎖`);
        const from = { x: target.x, z: target.z };
        const to = { x: num(args.x, target.x), z: num(args.z, target.z) };
        this.tx.mutate((p) => {
          const o = p.objects.find((x) => x.id === id)!;
          o.x = to.x;
          o.z = to.z;
        });
        return ok({ objectId: id, from, to });
      }

      case "rotateAsset": {
        const id = str(args.objectId);
        const target = draft.objects.find((o) => o.id === id);
        if (!target) return fail(`找不到物件 ${id}`);
        if (target.locked) return fail(`物件 ${id} 已鎖定，請先解鎖`);
        const rot = num(args.rotationDeg, target.rotationDeg);
        this.tx.mutate((p) => {
          p.objects.find((x) => x.id === id)!.rotationDeg = rot;
        });
        return ok({ objectId: id, from: target.rotationDeg, to: rot });
      }

      case "resizeAsset": {
        const id = str(args.objectId);
        const target = draft.objects.find((o) => o.id === id);
        if (!target) return fail(`找不到物件 ${id}`);
        if (target.locked) return fail(`物件 ${id} 已鎖定，請先解鎖`);
        if (args.width === undefined && args.depth === undefined && args.height === undefined) {
          return fail("resizeAsset 至少需要 width、depth 或 height 其中一個");
        }
        const before = { width: target.width, depth: target.depth, height: target.height };
        const after = {
          width: num(args.width, target.width),
          depth: num(args.depth, target.depth),
          height: num(args.height, target.height),
        };
        this.tx.mutate((p) => {
          const o = p.objects.find((x) => x.id === id)!;
          o.width = after.width;
          o.depth = after.depth;
          o.height = after.height;
        });
        return ok({ objectId: id, before, after });
      }

      case "duplicateAsset": {
        const id = str(args.objectId);
        const src = draft.objects.find((o) => o.id === id);
        if (!src) return fail(`找不到物件 ${id}`);
        const copy: SceneObject = {
          ...structuredClone(src),
          id: uid("obj"),
          x: src.x + num(args.offsetX, 0.6),
          z: src.z + num(args.offsetZ, 0.6),
        };
        this.tx.mutate((p) => {
          p.objects.push(copy);
        });
        return ok({ objectId: copy.id, sourceId: id });
      }

      case "removeAsset": {
        const id = str(args.objectId);
        const target = draft.objects.find((o) => o.id === id);
        if (!target) return fail(`找不到物件 ${id}`);
        if (target.locked) return fail(`物件 ${id} 已鎖定，請先解鎖`);
        // Anything anchored to this object goes with it, and any station bound
        // to it is unbound. Leaving a station pointing at a deleted object is
        // how a simulation ends up serving people at coordinates 0,0.
        const orphans = draft.objects.filter((o) => o.parentId === id).map((o) => o.id);
        let unboundStations = 0;
        this.tx.mutate((p) => {
          p.objects = p.objects.filter((o) => o.id !== id && o.parentId !== id);
          p.scenarios = p.scenarios.map((s) => ({
            ...s,
            stations: s.stations.map((st) => {
              if (st.objectId !== id) return st;
              unboundStations += 1;
              const next = { ...st };
              delete next.objectId;
              return next;
            }),
          }));
        });
        return ok({ objectId: id, removedChildren: orphans, unboundStations });
      }

      /* ---------------- arrays ---------------- */
      case "createArray": {
        const assetId = str(args.assetId);
        const entry = assetId ? catalogFromProject(draft).get(assetId) : undefined;
        if (assetId && !entry) return fail(`找不到素材 ${assetId}`);
        const kind = entry?.kind ?? (str(args.kind, "mat") as SceneObject["kind"]);
        // Falling back to a mat's 0.6 x 0.6 x 0.03 for every kind produced a
        // 40-chair array of 3 cm high floor tiles. The builtin definition knows
        // each kind's real size; use it.
        const fallback = ALL_KINDS.includes(kind) ? assetDef(kind).defaultDimensions : null;
        if (!entry && !fallback) return fail(`不認得的物件種類：${kind}`);
        const w = entry?.dimensions.width ?? fallback!.width;
        const d = entry?.dimensions.depth ?? fallback!.depth;
        const h = entry?.dimensions.height ?? fallback!.height;
        const rows = num(args.rows, 1);
        const cols = num(args.cols, 1);
        const b = areaBounds(draft.classroom);
        const gapX = num(args.gapX, 0);
        const gapZ = num(args.gapZ, 0);
        const blockW = cols * w + (cols - 1) * gapX;
        const blockD = rows * d + (rows - 1) * gapZ;
        const group: ArrayGroup = {
          id: uid("grp"),
          name: str(args.name, `${rows}×${cols} 陣列`),
          sourceKind: kind,
          rows, cols,
          itemWidth: w,
          itemDepth: d,
          itemHeight: h,
          gapX, gapZ,
          rotationDeg: num(args.rotationDeg, 0),
          anchorX: num(args.anchorX, (b.minX + b.maxX) / 2 - blockW / 2),
          anchorZ: num(args.anchorZ, (b.minZ + b.maxZ) / 2 - blockD / 2),
          locked: false,
          hidden: false,
          numberPrefix: str(args.numberPrefix, "A"),
          numberOrder: "row",
          numberStart: "nw",
        };
        this.tx.mutate((p) => {
          p.groups.push(group);
        });
        return ok({ groupId: group.id, count: rows * cols, footprint: { width: blockW, depth: blockD } });
      }

      case "updateArray": {
        const groupId = str(args.groupId);
        const before = draft.groups.find((g) => g.id === groupId);
        if (!before) return fail(`找不到陣列 ${groupId}`);
        if (before.locked) return fail(`陣列 ${groupId} 已鎖定，請先解鎖`);
        const patch: Partial<ArrayGroup> = {};
        if (args.rows !== undefined) patch.rows = num(args.rows, before.rows);
        if (args.cols !== undefined) patch.cols = num(args.cols, before.cols);
        if (args.gapX !== undefined) patch.gapX = num(args.gapX, before.gapX);
        if (args.gapZ !== undefined) patch.gapZ = num(args.gapZ, before.gapZ);
        if (args.anchorX !== undefined) patch.anchorX = num(args.anchorX, before.anchorX);
        if (args.anchorZ !== undefined) patch.anchorZ = num(args.anchorZ, before.anchorZ);
        if (args.rotationDeg !== undefined) patch.rotationDeg = num(args.rotationDeg, before.rotationDeg);
        if (args.name !== undefined) patch.name = str(args.name, before.name);
        if (Object.keys(patch).length === 0) return fail("updateArray 沒有任何要修改的欄位");
        this.tx.mutate((p) => {
          const g = p.groups.find((x) => x.id === groupId)!;
          Object.assign(g, patch);
        });
        const after = this.tx.getDraft()!.groups.find((g) => g.id === groupId)!;
        return ok({
          groupId,
          before: { rows: before.rows, cols: before.cols, count: before.rows * before.cols },
          after: { rows: after.rows, cols: after.cols, count: after.rows * after.cols },
        });
      }

      case "removeArray": {
        const groupId = str(args.groupId);
        const g = draft.groups.find((x) => x.id === groupId);
        if (!g) return fail(`找不到陣列 ${groupId}`);
        if (g.locked) return fail(`陣列 ${groupId} 已鎖定，請先解鎖`);
        this.tx.mutate((p) => {
          p.groups = p.groups.filter((x) => x.id !== groupId);
        });
        return ok({ groupId, removedCount: g.rows * g.cols });
      }

      case "distributeObjects": {
        const ids = (args.objectIds as string[]) ?? [];
        const axis = str(args.axis, "x") as "x" | "z";
        const found = ids.map((id) => draft.objects.find((o) => o.id === id));
        const missing = ids.filter((_, i) => !found[i]);
        if (missing.length) return fail(`找不到物件：${missing.join("、")}`);
        const locked = found.filter((o): o is SceneObject => !!o && o.locked).map((o) => o.id);
        const movable = found.filter((o): o is SceneObject => !!o && !o.locked);
        // Silently distributing the subset that happened to be unlocked is the
        // same failure as the old `{ ok: true, skipped: true }`: the caller
        // asked for five objects and is told it worked.
        if (locked.length) {
          return fail(`這些物件已鎖定，請先解鎖：${locked.join("、")}`);
        }
        if (movable.length < 3 && args.spacing === undefined) {
          return fail("distributeObjects 需要至少 3 件未鎖定的物件，或指定 spacing");
        }
        const key = axis === "x" ? "x" : "z";
        const sorted = [...movable].sort((a, b) => a[key] - b[key]);
        const spacingArg = args.spacing !== undefined ? num(args.spacing, 0) : null;
        const start = sorted[0][key];
        const step = spacingArg ?? (sorted[sorted.length - 1][key] - start) / (sorted.length - 1);
        const placed: { id: string; from: number; to: number }[] = [];
        this.tx.mutate((p) => {
          sorted.forEach((o, i) => {
            const t = p.objects.find((x) => x.id === o.id)!;
            const to = start + step * i;
            placed.push({ id: o.id, from: t[key], to });
            t[key] = to;
          });
        });
        return ok({ axis, spacing: step, moved: placed });
      }

      case "alignObjects": {
        const ids = (args.objectIds as string[]) ?? [];
        const edge = str(args.edge, "left");
        const found = ids.map((id) => draft.objects.find((o) => o.id === id));
        const missing = ids.filter((_, i) => !found[i]);
        if (missing.length) return fail(`找不到物件：${missing.join("、")}`);
        const lockedIds = found.filter((o): o is SceneObject => !!o && o.locked).map((o) => o.id);
        const movable = found.filter((o): o is SceneObject => !!o && !o.locked);
        if (lockedIds.length) {
          return fail(`這些物件已鎖定，請先解鎖：${lockedIds.join("、")}`);
        }
        if (movable.length < 2) return fail("alignObjects 需要至少 2 件未鎖定的物件");

        // Alignment uses the ROTATED footprint, not the raw width. Aligning a
        // 90°-rotated desk by its unrotated width leaves it visibly out of line.
        const bounds = movable.map((o) => ({ o, b: footprintBounds(rectOf(o)) }));
        let targetValue: number;
        switch (edge) {
          case "left": targetValue = Math.min(...bounds.map((x) => x.b.minX)); break;
          case "right": targetValue = Math.max(...bounds.map((x) => x.b.maxX)); break;
          case "top": targetValue = Math.min(...bounds.map((x) => x.b.minZ)); break;
          case "bottom": targetValue = Math.max(...bounds.map((x) => x.b.maxZ)); break;
          case "center-x": targetValue = bounds.reduce((s, x) => s + x.o.x, 0) / bounds.length; break;
          case "center-z": targetValue = bounds.reduce((s, x) => s + x.o.z, 0) / bounds.length; break;
          default: return fail(`未知的對齊邊 ${edge}`);
        }
        const moved: { id: string; from: number; to: number }[] = [];
        this.tx.mutate((p) => {
          for (const { o, b } of bounds) {
            const t = p.objects.find((x) => x.id === o.id)!;
            let to: number;
            switch (edge) {
              case "left": to = o.x + (targetValue - b.minX); break;
              case "right": to = o.x + (targetValue - b.maxX); break;
              case "top": to = o.z + (targetValue - b.minZ); break;
              case "bottom": to = o.z + (targetValue - b.maxZ); break;
              case "center-x": to = targetValue; break;
              default: to = targetValue; break;
            }
            const horizontal = edge === "left" || edge === "right" || edge === "center-x";
            moved.push({ id: o.id, from: horizontal ? t.x : t.z, to });
            if (horizontal) t.x = to; else t.z = to;
          }
        });
        return ok({ edge, moved });
      }

      /* ---------------- zones ---------------- */
      case "createZone": {
        const type = str(args.type, "registration") as ZoneType;
        const d = ZONE_DEFAULTS[type] ?? ZONE_DEFAULTS.registration;
        const zone: Zone = {
          id: uid("zone"),
          type,
          name: str(args.name, d.label),
          x: num(args.x, draft.classroom.x + draft.classroom.length / 2),
          z: num(args.z, draft.classroom.z + draft.classroom.width / 2),
          width: num(args.width, d.width),
          depth: num(args.depth, d.depth),
          color: d.color,
          icon: d.icon,
          capacity: args.capacity !== undefined ? num(args.capacity, 0) : null,
          locked: false,
          hidden: false,
        };
        this.tx.mutate((p) => {
          p.zones.push(zone);
        });
        return ok({ zoneId: zone.id, zone });
      }

      case "updateZone": {
        const zoneId = str(args.zoneId);
        const before = draft.zones.find((z) => z.id === zoneId);
        if (!before) return fail(`找不到區域 ${zoneId}`);
        if (before.locked && args.locked === undefined) return fail(`區域 ${zoneId} 已鎖定，請先解鎖`);
        const patch: Partial<Zone> = {};
        if (args.name !== undefined) patch.name = str(args.name);
        if (args.x !== undefined) patch.x = num(args.x, before.x);
        if (args.z !== undefined) patch.z = num(args.z, before.z);
        if (args.width !== undefined) patch.width = num(args.width, before.width);
        if (args.depth !== undefined) patch.depth = num(args.depth, before.depth);
        if (args.capacity !== undefined) patch.capacity = num(args.capacity, 0);
        if (args.locked !== undefined) patch.locked = args.locked === true;
        if (args.hidden !== undefined) patch.hidden = args.hidden === true;
        if (Object.keys(patch).length === 0) return fail("updateZone 沒有任何要修改的欄位");
        this.tx.mutate((p) => {
          Object.assign(p.zones.find((z) => z.id === zoneId)!, patch);
          // A zone-bound station follows its zone. Without this, moving 報到區
          // leaves the simulated desk behind and the two views disagree.
          if (patch.x !== undefined || patch.z !== undefined) {
            p.scenarios = p.scenarios.map((s) => ({
              ...s,
              stations: s.stations.map((st) =>
                st.zoneId === zoneId
                  ? { ...st, x: patch.x ?? st.x, z: patch.z ?? st.z }
                  : st,
              ),
            }));
          }
        });
        return ok({ zoneId, before: { x: before.x, z: before.z, width: before.width, depth: before.depth }, patch });
      }

      case "removeZone": {
        const zoneId = str(args.zoneId);
        const z = draft.zones.find((x) => x.id === zoneId);
        if (!z) return fail(`找不到區域 ${zoneId}`);
        if (z.locked) return fail(`區域 ${zoneId} 已鎖定，請先解鎖`);
        let unboundStations = 0;
        let unlinkedRoutes = 0;
        this.tx.mutate((p) => {
          p.zones = p.zones.filter((x) => x.id !== zoneId);
          p.routes = p.routes.map((r) => {
            const touches = r.startZoneId === zoneId || r.endZoneId === zoneId || (r.waypointZoneIds ?? []).includes(zoneId);
            if (!touches) return r;
            unlinkedRoutes += 1;
            const next = { ...r };
            if (next.startZoneId === zoneId) delete next.startZoneId;
            if (next.endZoneId === zoneId) delete next.endZoneId;
            if (next.waypointZoneIds) next.waypointZoneIds = next.waypointZoneIds.filter((i) => i !== zoneId);
            return next;
          });
          p.scenarios = p.scenarios.map((s) => ({
            ...s,
            stations: s.stations.map((st) => {
              if (st.zoneId !== zoneId) return st;
              unboundStations += 1;
              const next = { ...st };
              delete next.zoneId;
              return next;
            }),
          }));
        });
        return ok({ zoneId, unboundStations, unlinkedRoutes });
      }

      /* ---------------- routes ---------------- */
      case "createRoute": {
        const points = (args.points as { x: number; z: number }[] | undefined) ?? [
          { x: draft.classroom.x + 0.5, z: draft.classroom.z + draft.classroom.width / 2 },
          { x: draft.classroom.x + draft.classroom.length - 0.5, z: draft.classroom.z + draft.classroom.width / 2 },
        ];
        if (points.length < 2) return fail("動線至少需要兩個路徑點");
        const route: Route = {
          id: uid("route"),
          name: str(args.name, "動線"),
          color: str(args.color, "#38bdf8"),
          type: (str(args.type, "custom") as RouteType),
          points,
          visible: true,
        };
        this.tx.mutate((p) => {
          p.routes.push(route);
        });
        return ok({ routeId: route.id, pointCount: points.length });
      }

      case "updateRoute": {
        const routeId = str(args.routeId);
        const before = draft.routes.find((r) => r.id === routeId);
        if (!before) return fail(`找不到動線 ${routeId}`);
        const points = args.points as { x: number; z: number }[] | undefined;
        if (points && points.length < 2) return fail("動線至少需要兩個路徑點");
        const patch: Partial<Route> = {};
        if (args.name !== undefined) patch.name = str(args.name);
        if (args.color !== undefined) patch.color = str(args.color);
        if (args.visible !== undefined) patch.visible = args.visible === true;
        if (points) patch.points = points;
        if (Object.keys(patch).length === 0) return fail("updateRoute 沒有任何要修改的欄位");
        this.tx.mutate((p) => {
          Object.assign(p.routes.find((r) => r.id === routeId)!, patch);
        });
        return ok({ routeId, pointCount: (patch.points ?? before.points).length });
      }

      case "removeRoute": {
        const routeId = str(args.routeId);
        if (!draft.routes.some((r) => r.id === routeId)) return fail(`找不到動線 ${routeId}`);
        this.tx.mutate((p) => {
          p.routes = p.routes.filter((r) => r.id !== routeId);
        });
        return ok({ routeId });
      }

      case "connectRouteToZones": {
        const routeId = str(args.routeId);
        const route = draft.routes.find((r) => r.id === routeId);
        if (!route) return fail(`找不到動線 ${routeId}`);
        const zoneById = new Map(draft.zones.map((z) => [z.id, z]));
        const startId = str(args.startZoneId);
        const endId = str(args.endZoneId);
        const waypointIds = (args.waypointZoneIds as string[] | undefined) ?? [];
        const unknown = [startId, endId, ...waypointIds].filter((i) => i && !zoneById.has(i));
        if (unknown.length) return fail(`找不到區域：${unknown.join("、")}`);
        if (!startId && !endId && waypointIds.length === 0) {
          return fail("connectRouteToZones 需要 startZoneId、endZoneId 或 waypointZoneIds");
        }
        // The path is recomputed from the zones' centres, in order. A route that
        // still points at the old coordinates while claiming to link two zones
        // is worse than one that never claimed the link.
        const chain = [startId, ...waypointIds, endId].filter(Boolean);
        const points = chain.map((i) => {
          const z = zoneById.get(i)!;
          return { x: z.x, z: z.z };
        });
        if (points.length < 2) return fail("連接區域至少需要兩個區域才能重算路徑");
        this.tx.mutate((p) => {
          const r = p.routes.find((x) => x.id === routeId)!;
          r.points = points;
          if (startId) r.startZoneId = startId; else delete r.startZoneId;
          if (endId) r.endZoneId = endId; else delete r.endZoneId;
          if (waypointIds.length) r.waypointZoneIds = waypointIds; else delete r.waypointZoneIds;
        });
        return ok({ routeId, points, linkedZones: chain });
      }

      /* ---------------- stations ---------------- */
      case "createServiceStation": {
        let created: unknown = null;
        this.tx.mutate((p) => {
          created = eventFlowAdapter.createServiceStation(p, {
            type: (str(args.type, "custom") as never),
            ...(args.name !== undefined ? { name: str(args.name) } : {}),
            ...(args.x !== undefined ? { x: num(args.x, 0) } : {}),
            ...(args.z !== undefined ? { z: num(args.z, 0) } : {}),
            ...(args.staffCount !== undefined ? { staffCount: num(args.staffCount, 1) } : {}),
            ...(args.meanServiceSeconds !== undefined ? { meanServiceSeconds: num(args.meanServiceSeconds, 30) } : {}),
            ...(args.objectId !== undefined ? { objectId: str(args.objectId) } : {}),
            ...(args.zoneId !== undefined ? { zoneId: str(args.zoneId) } : {}),
          });
        });
        return ok(created);
      }

      case "updateServiceStation": {
        const stationId = str(args.stationId);
        const results: ReturnType<typeof eventFlowAdapter.updateServiceStation>[] = [];
        this.tx.mutate((p) => {
          results.push(eventFlowAdapter.updateServiceStation(p, {
            stationId,
            ...(args.name !== undefined ? { name: str(args.name) } : {}),
            ...(args.staffCount !== undefined ? { staffCount: num(args.staffCount, 1) } : {}),
            ...(args.parallelServers !== undefined ? { parallelServers: num(args.parallelServers, 1) } : {}),
            ...(args.meanServiceSeconds !== undefined ? { meanServiceSeconds: num(args.meanServiceSeconds, 30) } : {}),
            ...(args.x !== undefined ? { x: num(args.x, 0) } : {}),
            ...(args.z !== undefined ? { z: num(args.z, 0) } : {}),
            ...(args.queueCapacity !== undefined ? { queueCapacity: num(args.queueCapacity, 30) } : {}),
          }));
        });
        const updated = results[0];
        // The adapter reports "not found" in its RETURN VALUE rather than
        // throwing. Passing that straight through as ok:true is how a typo in a
        // station id becomes a silent no-op the user reads as success.
        if (!updated) return fail(`更新站點 ${stationId} 沒有回應`);
        if (updated.available === false) return fail(updated.message);
        return ok(updated);
      }

      case "removeServiceStation": {
        const stationId = str(args.stationId);
        const owner = draft.scenarios.find((s) => s.stations.some((st) => st.id === stationId));
        if (!owner) return fail(`找不到站點 ${stationId}`);
        this.tx.mutate((p) => {
          p.scenarios = p.scenarios.map((s) => ({
            ...s,
            stations: s.stations.filter((st) => st.id !== stationId),
            // Leaving a removed station in a profile branch routes participants
            // to a station that no longer exists.
            profiles: s.profiles.map((pr) => ({ ...pr, branch: pr.branch.filter((i) => i !== stationId) })),
          }));
        });
        return ok({ stationId, scenarioId: owner.id });
      }

      /* ---------------- spatial design ---------------- */
      case "generateLayoutCandidates": {
        const result = generateLayoutSchemes(draft, this.briefFrom(args));
        return ok({
          recommendedId: result.recommendedId,
          recommendation: result.recommendation,
          notes: result.notes,
          comparison: compareSchemes(result),
          schemes: result.schemes.map((s) => ({
            id: s.id,
            name: s.name,
            estimatedCapacity: s.estimatedCapacity,
            simulation: s.simulation,
            validation: { errors: s.validation.errors, warnings: s.validation.warnings },
            score: s.score,
            rationale: s.rationale,
            risks: s.risks,
            objectCount: s.objects.length,
            zoneCount: s.zones.length,
            routeCount: s.routes.length,
            explanation: explainWithSources(s.rationale.join(" "), s.knowledgeRefs),
          })),
        });
      }

      case "applySmartLayout": {
        const candidateId = str(args.candidateId, "scheme-a");
        const built = buildScheme(draft, candidateId, this.briefFrom(args));
        if (!built) return fail(`找不到方案 ${candidateId}（可用：scheme-a / scheme-b / scheme-c）`);
        this.tx.mutate((p) => built.apply(p));
        const after = this.tx.getDraft()!;
        return ok({
          candidateId,
          name: built.scheme.name,
          appliedObjects: built.scheme.objects.length,
          appliedGroups: built.scheme.groups.length,
          appliedZones: built.scheme.zones.length,
          appliedRoutes: built.scheme.routes.length,
          estimatedCapacity: built.scheme.estimatedCapacity,
          validationAfter: issueCounts(validateProject(after)),
          explanation: explainWithSources(built.scheme.rationale.join(" "), built.scheme.knowledgeRefs),
          risks: built.scheme.risks,
        });
      }

      case "scoreLayoutCandidate": {
        const candidateId = str(args.candidateId, "scheme-a");
        const result = generateLayoutSchemes(draft, this.briefFrom(args));
        const scheme = result.schemes.find((s) => s.id === candidateId);
        if (!scheme) return fail(`找不到方案 ${candidateId}`);
        return ok({
          id: scheme.id,
          name: scheme.name,
          score: scheme.score,
          estimatedCapacity: scheme.estimatedCapacity,
          simulation: scheme.simulation,
          validation: { errors: scheme.validation.errors, warnings: scheme.validation.warnings },
          rationale: scheme.rationale,
          risks: scheme.risks,
          explanation: explainWithSources(scheme.rationale.join(" "), scheme.knowledgeRefs),
        });
      }

      case "validateLayout": {
        let optimized = 0;
        if (args.optimize === "clear-doors") {
          this.tx.mutate((p) => {
            optimized = this.optimizeClearDoors(p);
          });
        }
        const issues = validateProject(this.tx.getDraft()!);
        return ok({ issues, counts: issueCounts(issues), movedObjects: optimized });
      }

      case "measureGap": {
        const a = draft.objects.find((o) => o.id === str(args.objectIdA));
        if (!a) return fail(`找不到物件 ${str(args.objectIdA)}`);
        if (args.toWall === true) {
          const w = wallClearances(rectOf(a), draft.classroom);
          return ok({
            mode: "to-wall",
            objectId: a.id,
            clearances: { west: w.west, east: w.east, north: w.north, south: w.south },
            nearestMeters: w.nearest,
            nearestCm: Math.round(w.nearest * 100),
          });
        }
        const bId = str(args.objectIdB);
        if (!bId) return fail("measureGap 需要 objectIdB，或設定 toWall: true");
        const b = draft.objects.find((o) => o.id === bId);
        if (!b) return fail(`找不到物件 ${bId}`);
        const gap = objectGap(a, b);
        const centres = measure({ x: a.x, z: a.z }, { x: b.x, z: b.z }, draft.tile);
        return ok({
          mode: "object-gap",
          objectIdA: a.id,
          objectIdB: b.id,
          gapMeters: gap,
          gapCm: Math.round(gap * 100),
          centreDistanceMeters: centres.meters,
          minAisleWidth: draft.validationSettings.minAisleWidth,
          meetsMinimum: gap >= draft.validationSettings.minAisleWidth,
        });
      }

      case "checkDoorClearance": {
        const required = num(args.clearance, draft.validationSettings.doorFrontClearance);
        const doors = draft.objects.filter((o) => o.kind === "door" && !o.hidden);
        if (!doors.length) {
          return ok({
            required,
            doors: [],
            blocked: [],
            note: "這份計畫沒有門物件，無法檢查門前淨空。",
            disclaimer: SAFETY_DISCLAIMER,
          });
        }
        const blocked: { doorId: string; objectId: string; reason: string; distance: number }[] = [];
        for (const door of doors) {
          const sweep = doorSweep(door);
          for (const o of draft.objects) {
            if (o.id === door.id || o.hidden || o.kind === "door") continue;
            const dist = objectGap(door, o);
            if (pointInDoorSweep(o.x, o.z, sweep)) {
              blocked.push({ doorId: door.id, objectId: o.id, reason: "在門的開啟弧線內", distance: dist });
            } else if (dist < required) {
              blocked.push({ doorId: door.id, objectId: o.id, reason: `距離 ${(dist * 100).toFixed(0)} 公分，少於要求的 ${(required * 100).toFixed(0)} 公分`, distance: dist });
            }
          }
        }
        return ok({
          required,
          doors: doors.map((d) => ({ id: d.id, x: d.x, z: d.z })),
          blocked,
          passed: blocked.length === 0,
          disclaimer: SAFETY_DISCLAIMER,
        });
      }

      case "checkAccessibilityWarnings": {
        const corridorWidth = num(args.corridorWidth, knowledgeValue("checkAccessibilityWarnings")?.value ?? 1.2);
        const turning = num(args.turningSpace, 1.5);
        const warnings: { code: string; message: string; targetId: string | null }[] = [];

        const issues = validateProject(draft);
        for (const i of issues) {
          if (i.code === "aisle-too-narrow" || i.code === "booth-aisle-too-narrow") {
            warnings.push({ code: i.code, message: i.message, targetId: i.targetId });
          }
        }
        // Aisle checks use the project's own minimum, which may be below the
        // accessible-route figure. Say so rather than passing silently.
        if (draft.validationSettings.minAisleWidth < corridorWidth) {
          warnings.push({
            code: "min-aisle-below-accessible",
            message:
              `目前設定的最小走道寬度是 ${(draft.validationSettings.minAisleWidth * 100).toFixed(0)} 公分，` +
              `低於無障礙通路常見要求的 ${(corridorWidth * 100).toFixed(0)} 公分。`,
            targetId: null,
          });
        }
        // A real turning circle, not "is anything within half the diameter".
        // The old test measured edge-to-edge distance from the DOOR, which is
        // neither the right shape nor the right centre: the space a wheelchair
        // needs is a circle just inside the doorway, and an object beside the
        // door counted while one squarely in the circle two metres in did not.
        const roomCentre = {
          x: draft.classroom.x + draft.classroom.length / 2,
          z: draft.classroom.z + draft.classroom.width / 2,
        };
        for (const door of draft.objects.filter((o) => o.kind === "door" && !o.hidden)) {
          const toRoom = { x: roomCentre.x - door.x, z: roomCentre.z - door.z };
          const len = Math.hypot(toRoom.x, toRoom.z) || 1;
          const radius = turning / 2;
          // Centre the circle one radius inside the room from the doorway.
          const cx = door.x + (toRoom.x / len) * radius;
          const cz = door.z + (toRoom.z / len) * radius;
          const intruders = draft.objects.filter((o) => {
            if (o.id === door.id || o.kind === "door" || o.hidden) return false;
            if (o.surface === "wall") return false; // a wall fitting is not floor obstruction
            return pointToRectDist(cx, cz, rectOf(o)) < radius;
          });
          if (intruders.length) {
            warnings.push({
              code: "turning-space",
              message:
                `門「${door.id}」內側直徑 ${(turning * 100).toFixed(0)} 公分的迴轉空間裡有 ` +
                `${intruders.length} 件物件（${intruders.map((o) => o.id).join("、")}）。` +
                // A102.2.6 permits a T-shaped turning space where a circle does
                // not fit. This check only tests the circle, so it is stricter
                // than the regulation — say so rather than letting the user
                // read a warning as a violation.
                "規範在空間受限時允許改用 T 型迴轉空間，本工具只檢查圓形，所以這個提醒比規範嚴格。",
              targetId: door.id,
            });
          }
        }
        return ok({
          corridorWidth,
          turningSpace: turning,
          warnings,
          explanation: explainWithSources(
            "以下是依模型尺寸做的初步比對。",
            ["accessibility-corridor-width", "accessibility-turning-space", "egress-not-a-single-number"],
          ),
          disclaimer: SAFETY_DISCLAIMER,
        });
      }

      case "checkSightlines": {
        const targetId = str(args.targetId);
        const issues = validateProject(draft).filter((i) => i.code === "screen-view-blocked");
        const filtered = targetId ? issues.filter((i) => i.targetId === targetId) : issues;
        const screens = draft.objects.filter((o) => o.kind === "screen" && !o.hidden);
        if (!screens.length) {
          return ok({ screens: [], blocked: [], note: "這份計畫沒有螢幕物件，沒有視線可檢查。" });
        }
        if (!draft.validationSettings.checkScreenView) {
          return ok({
            screens: screens.map((s) => s.id),
            blocked: [],
            note: "專案設定關閉了螢幕視線檢查（checkScreenView），這次沒有實際檢查。",
          });
        }
        return ok({
          screens: screens.map((s) => ({ id: s.id, x: s.x, z: s.z })),
          blocked: filtered.map((i) => ({ targetId: i.targetId, message: i.message, focus: i.focus })),
          passed: filtered.length === 0,
        });
      }

      case "calculateCapacity": {
        const mode = str(args.mode, "floor-mat");
        const b = areaBounds(draft.classroom);
        const area = num(args.areaSquareMeters, (b.maxX - b.minX) * (b.maxZ - b.minZ));
        if (mode === "floor-mat") {
          // Floor seating has no published per-person area figure, so it is
          // counted from the geometry actually laid down instead of invented.
          const seats = draft.groups
            .filter((g) => !g.hidden && g.sourceKind === "mat")
            .reduce((n, g) => n + groupMembers(g).length, 0);
          const looseMats = draft.objects.filter((o) => o.kind === "mat" && !o.hidden).length;
          return ok({
            mode,
            method: "geometry",
            areaSquareMeters: area,
            matCells: seats + looseMats,
            estimatedPeople: Math.floor((seats + looseMats) / 2),
            note: "地墊容量由實際鋪設的墊格計算（每人約兩格 60×60 公分），不套用面積係數。",
            explanation: explainWithSources("席地而坐沒有通行的每人面積標準值。", ["floor-seating-no-standard"]),
          });
        }
        const perPerson = knowledgeValue(`calculateCapacity:${mode}`);
        if (!perPerson) return fail(`沒有 ${mode} 的每人面積依據，無法估算`);
        return ok({
          mode,
          method: "area-per-person",
          areaSquareMeters: area,
          squareMetersPerPerson: perPerson.value,
          estimatedPeople: Math.floor(area / perPerson.value),
          note: "估算未扣除服務桌、器材、舞台與無障礙空間。",
          explanation: explainWithSources(
            `以每人 ${perPerson.value} 平方公尺估算。`,
            [perPerson.entry.id],
          ),
        });
      }

      case "simulateScenario": {
        const participants = num(args.participants, 60);
        const ensured = eventFlowAdapter.ensureScenario(draft, participants);
        this.tx.mutate((p) => {
          if (!p.scenarios.some((s) => s.id === ensured.id)) {
            p.scenarios = [...(p.scenarios ?? []), ensured];
            p.activeScenarioId = ensured.id;
          } else {
            p.scenarios = p.scenarios.map((s) =>
              s.id === ensured.id ? { ...s, participantCount: participants } : s,
            );
          }
        });
        return ok(eventFlowAdapter.simulateScenario(this.tx.getDraft()!, participants));
      }

      case "compareScenarios":
        return ok(eventFlowAdapter.compareScenarios(draft, num(args.participants, 60)));

      case "explainBottleneck": {
        const participants = num(args.participants, 60);
        const summary = eventFlowAdapter.simulateScenario(draft, participants);
        if (!summary.available) return fail(summary.message);
        const result = summary.result;
        if (!result) {
          return ok({ ...summary, explanation: null, note: "只有動線預覽，沒有站點層級的結果可解釋。" });
        }
        const worst = result.stations.reduce<(typeof result.stations)[number] | null>(
          (acc, s) => (!acc || s.maxQueue > acc.maxQueue ? s : acc),
          null,
        );
        const overloaded = result.stations.filter((s) => s.utilization >= 0.8);
        const reasons: string[] = [];
        if (worst) {
          reasons.push(`最長隊伍出現在「${worst.name}」，最多 ${worst.maxQueue} 人在排。`);
          reasons.push(`該站使用率 ${(worst.utilization * 100).toFixed(0)}%，平均等待 ${Math.round(worst.avgWaitSeconds)} 秒。`);
          if (worst.servers === 0) {
            reasons.push("這個站點目前沒有人力，所以隊伍只會一直長下去。");
          } else if (worst.utilization >= 0.8) {
            reasons.push("使用率超過 80%，等待時間對人力非常敏感——增加一名人力的效果會大於移動桌子。");
          }
        }
        for (const s of overloaded) {
          if (worst && s.stationId === worst.stationId) continue;
          reasons.push(`「${s.name}」使用率也達到 ${(s.utilization * 100).toFixed(0)}%，是第二個要注意的地方。`);
        }
        if (result.spatialBottlenecks.length) {
          reasons.push(
            `另外有 ${result.spatialBottlenecks.length} 處空間瓶頸：` +
            result.spatialBottlenecks.map((b) => b.name).join("、"),
          );
        }
        return ok({
          participants: result.participantCount,
          worstStation: worst
            ? { id: worst.stationId, name: worst.name, maxQueue: worst.maxQueue, utilization: worst.utilization, servers: worst.servers }
            : null,
          spatialBottlenecks: result.spatialBottlenecks,
          reasons,
          explanation: explainWithSources(reasons.join(" "), ["queue-utilisation-cliff", "queue-parallel-servers"]),
        });
      }

      /* ---------------- project (host) ---------------- */
      case "createProject": {
        const h = this.ctx.host?.projects;
        if (!h) return fail("目前環境沒有專案庫，無法建立專案。");
        const meta = h.create({
          name: str(args.name),
          ...(args.eventDate !== undefined ? { eventDate: str(args.eventDate) } : {}),
          ...(args.venuePresetId !== undefined ? { venuePresetId: str(args.venuePresetId) } : {}),
        });
        return ok({ project: meta });
      }

      case "openProject": {
        const h = this.ctx.host?.projects;
        if (!h) return fail("目前環境沒有專案庫，無法開啟專案。");
        const r = h.open(str(args.projectId));
        if (!r.ok) return fail(r.reason);
        return ok({ projectId: str(args.projectId), name: r.project.name });
      }

      case "saveProject": {
        const h = this.ctx.host?.projects;
        if (!h) return fail("目前環境沒有專案庫，無法存檔。");
        const r = h.save();
        return r.ok ? ok({ saved: true }) : fail(r.reason);
      }

      case "duplicateProject": {
        const h = this.ctx.host?.projects;
        if (!h) return fail("目前環境沒有專案庫，無法複製專案。");
        const id = str(args.projectId) || h.activeId();
        if (!id) return fail("沒有指定專案，也沒有正在編輯的專案。");
        const meta = h.duplicate(id, args.name !== undefined ? str(args.name) : undefined);
        return meta ? ok({ project: meta }) : fail(`複製失敗：找不到專案 ${id}`);
      }

      case "renameProject": {
        const h = this.ctx.host?.projects;
        if (!h) return fail("目前環境沒有專案庫，無法重新命名。");
        const id = str(args.projectId) || h.activeId();
        if (!id) return fail("沒有指定專案，也沒有正在編輯的專案。");
        const meta = h.rename(id, str(args.name));
        return meta ? ok({ project: meta }) : fail(`重新命名失敗：找不到專案 ${id}`);
      }

      case "deleteProject": {
        const h = this.ctx.host?.projects;
        if (!h) return fail("目前環境沒有專案庫，無法刪除專案。");
        // Deletion is outside the preview/commit gate — rolling back a preview
        // does not bring a project back. It therefore requires the caller to
        // have carried an explicit user confirmation this far.
        if (args.confirm !== true) {
          return fail("刪除專案需要使用者明確確認（confirm: true）。這個動作不在預覽／套用的保護範圍內。");
        }
        const id = str(args.projectId);
        const r = h.remove(id);
        return r ? ok({ projectId: id, restorable: r.restored }) : fail(`找不到專案 ${id}`);
      }

      case "createLayoutVersion": {
        const h = this.ctx.host?.layoutVersions;
        if (!h) return fail("目前環境沒有版本儲存，無法建立版本。");
        const name = str(args.name);
        const existed = h.exists(name);
        const saved = h.save(name);
        return saved
          ? ok({ name, overwrote: existed })
          : fail(`版本「${name}」儲存失敗（可能是本機儲存空間已滿）。`);
      }

      case "restoreLayoutVersion": {
        const h = this.ctx.host?.layoutVersions;
        if (!h) return fail("目前環境沒有版本儲存，無法讀回版本。");
        const name = str(args.name);
        const project = h.read(name);
        if (!project) return fail(`找不到版本「${name}」（可用：${h.list().join("、") || "無"}）`);
        // Restoring goes into the DRAFT, so it still passes the preview gate —
        // the user sees what the old version looks like before it replaces
        // what is on screen.
        this.tx.mutate((p) => {
          p.objects = structuredClone(project.objects);
          p.groups = structuredClone(project.groups);
          p.zones = structuredClone(project.zones);
          p.routes = structuredClone(project.routes);
          p.measurements = structuredClone(project.measurements);
        });
        return ok({ name, objects: project.objects.length, zones: project.zones.length, note: "已載入預覽，尚未套用。" });
      }

      case "exportProject": {
        const h = this.ctx.host?.exports;
        if (!h) return fail("目前環境沒有匯出功能。");
        const json = h.projectJson();
        return ok({ bytes: json.length, note: "已產生專案 JSON。" });
      }

      case "importProject":
        return fail("匯入專案需要由使用者選擇檔案；Agent 不會自行讀取檔案。");

      case "exportPlanImage": {
        const h = this.ctx.host?.exports;
        if (!h) return fail("目前環境沒有匯出功能。");
        const filename = await h.planImage({
          preset: (str(args.preset, "full") as never),
          pageSize: (str(args.pageSize, "a4") as never),
          orientation: (str(args.orientation, "landscape") as never),
        });
        return ok({ filename });
      }

      case "exportPartnerView": {
        const h = this.ctx.host?.exports;
        if (!h) return fail("目前環境沒有匯出功能。");
        return ok({ filename: await h.partnerView() });
      }

      case "exportMaterialList": {
        // Pure data: this one works headless, so it does not need a host.
        const lines = inventoryLines(draft);
        // Anything printed gets its own list, because it is a different errand
        // on a different deadline: the 物資 you carry from the club room, and
        // the 文宣 somebody has to send to a printer days earlier.
        const print = printOrderLines(draft);
        return ok({
          lines,
          totalItems: lines.reduce((n, l) => n + l.count, 0),
          printOrders: print,
          totalPrints: print.reduce((n, l) => n + l.quantity, 0),
          explanation: explainWithSources(
            print.length
              ? "物資清單由目前場佈的物件與陣列統計；印刷品另外列出可直接送印的規格。"
              : "物資清單由目前場佈的物件與陣列統計。",
            ["visual-plan-legibility"],
          ),
        });
      }

      /* ---------------- view ---------------- */
      case "focusObject": {
        const v = this.ctx.host?.viewport;
        if (!v) return fail("目前環境沒有 3D 視窗，無法移動鏡頭。");
        const o = draft.objects.find((x) => x.id === str(args.objectId));
        if (!o) return fail(`找不到物件 ${str(args.objectId)}`);
        v.focusPoint(o.x, o.z);
        return ok({ objectId: o.id, x: o.x, z: o.z });
      }

      case "focusZone": {
        const v = this.ctx.host?.viewport;
        if (!v) return fail("目前環境沒有 3D 視窗，無法移動鏡頭。");
        const z = draft.zones.find((x) => x.id === str(args.zoneId));
        if (!z) return fail(`找不到區域 ${str(args.zoneId)}`);
        v.focusPoint(z.x, z.z);
        return ok({ zoneId: z.id, x: z.x, z: z.z });
      }

      case "setView": {
        const view = str(args.view, "iso") as ViewName;
        this.tx.mutate((p) => {
          p.view = view;
        });
        return ok({ view });
      }

      case "setLayerVisibility": {
        const layer = str(args.layer) as keyof LayerVisibility;
        const visible = args.visible === true;
        this.tx.mutate((p) => {
          p.layers = { ...p.layers, [layer]: visible };
        });
        return ok({ layer, visible, layers: this.tx.getDraft()!.layers });
      }

      case "fitScene": {
        const v = this.ctx.host?.viewport;
        if (!v) return fail("目前環境沒有 3D 視窗，無法縮放。");
        v.fitScene();
        return ok({ fitted: true });
      }

      case "toggleLabels": {
        const v = this.ctx.host?.viewport;
        if (!v) return fail("目前環境沒有 3D 視窗，無法切換標籤。");
        const visible = args.visible === undefined ? true : args.visible === true;
        v.setLabelsVisible(visible);
        return ok({ visible });
      }

      case "toggleSimulation": {
        const v = this.ctx.host?.viewport;
        if (!v) return fail("目前環境沒有 3D 視窗，無法播放模擬。");
        const running = args.running === undefined ? true : args.running === true;
        v.setSimulationRunning(running);
        return ok({ running });
      }

      /* ---------------- meta ---------------- */
      case "previewAgentChanges":
        return ok(this.tx.summarize());

      case "commitAgentChanges":
      case "rollbackAgentChanges":
        return fail("套用與取消由 QuickAgent 編排層處理，不能由工具直接呼叫。");

      default:
        return fail(`未實作的工具：${tool}`);
    }
  }

  /* ---------------------------------------------------------------- */

  /** Pull the planner brief out of validated tool args. */
  private briefFrom(args: Args): Partial<LayoutBrief> {
    const brief: Partial<LayoutBrief> = {};
    if (args.participants !== undefined) brief.participants = num(args.participants, 60);
    if (args.eventType !== undefined) brief.eventType = str(args.eventType) as EventType;
    if (args.staffCount !== undefined) brief.staffCount = num(args.staffCount, 4);
    if (args.minAisleWidth !== undefined) brief.minAisleWidth = num(args.minAisleWidth, 0.9);
    if (args.doorClearance !== undefined) brief.doorClearance = num(args.doorClearance, 1.2);
    if (args.zones !== undefined) brief.requiredZones = args.zones as ZoneType[];
    if (args.objectives !== undefined) brief.objectives = args.objectives as LayoutObjective[];
    if (args.seatAssetId !== undefined) brief.seatAssetId = str(args.seatAssetId);
    if (args.requiredAssets !== undefined) {
      brief.requiredAssets = (args.requiredAssets as Args[]).map((a) => ({
        assetId: str(a.assetId),
        count: num(a.count, 1),
        ...(a.zone !== undefined ? { zone: str(a.zone) as ZoneType } : {}),
      }));
    }
    return brief;
  }

  private placeFromCatalog(draft: Project, assetId: string, args: Args): SceneObject | null {
    const catalog = catalogFromProject(draft);
    const entry = catalog.get(assetId);
    if (!entry) return null;
    const classroom = draft.classroom;
    const index = num(args.index, 0);
    const offsetX = num(args.offsetX, index * (entry.dimensions.width + 0.4));
    const offsetZ = num(args.offsetZ, 0);
    const target = str(args.target, "");

    let x: number;
    let z: number;
    if (target === "point") {
      x = num(args.x, classroom.x + classroom.length / 2);
      z = num(args.z, classroom.z + classroom.width / 2);
    } else if (target === "classroom-center") {
      x = classroom.x + classroom.length / 2 + offsetX;
      z = classroom.z + classroom.width / 2 + offsetZ;
    } else if (target === "near-entrance") {
      x = classroom.x + 2 + offsetX;
      z = classroom.z + classroom.width - 1.2 + offsetZ;
    } else if (target === "beside-selection") {
      const sel = draft.objects.find((o) => this.ctx.selectionIds.includes(o.id));
      if (!sel) return null;
      x = sel.x + (entry.dimensions.width + 0.4) * (index + 1) + offsetX;
      z = sel.z + offsetZ;
    } else {
      x = classroom.x + 1.5 + offsetX;
      z = classroom.z + 1.2 + offsetZ;
    }

    x = Math.min(Math.max(x, classroom.x + 1), classroom.x + classroom.length - 1);
    z = Math.min(Math.max(z, classroom.z + 1), classroom.z + classroom.width - 1);

    return {
      id: uid("obj"),
      kind: entry.kind,
      assetId: entry.id,
      serviceRole: entry.serviceRole,
      x, z,
      rotationDeg: num(args.rotationDeg, entry.defaultFacingDeg),
      width: entry.dimensions.width,
      depth: entry.dimensions.depth,
      height: entry.dimensions.height,
      locked: false,
      hidden: false,
      surface: entry.placementType,
      elevation: entry.placementType === "wall" ? entry.defaultElevation ?? 0 : 0,
    };
  }

  /** Push blocking objects out of every door's approach. Returns how many moved. */
  private optimizeClearDoors(draft: Project): number {
    const doors = draft.objects.filter((o) => o.kind === "door");
    let moved = 0;
    for (const door of doors) {
      for (const o of draft.objects) {
        if (o.id === door.id || o.locked || o.kind === "door") continue;
        const dx = o.x - door.x;
        const dz = o.z - door.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 1.0 && dist > 1e-6) {
          const push = (1.05 - dist) / dist;
          o.x += dx * push;
          o.z += dz * push;
          moved += 1;
        }
      }
    }
    return moved;
  }
}
