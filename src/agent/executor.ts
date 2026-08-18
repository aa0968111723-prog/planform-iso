/**
 * Agent tool executor — runs allowlisted tools against a draft Project.
 */

import { eventFlowAdapter } from "../adapters/eventFlow";
import { createCustomAssetProxy } from "../assets/proxy";
import {
  MockReconstructionWorker,
  ReconstructionQueue,
  replaceCatalogVisual,
} from "../assets/reconstruction";
import type { AssetCatalogEntry, SemanticAssetType, ServiceRole } from "../core/catalog";
import { buildCheckinPaymentVariants } from "../core/eventFlow";
import {
  optimizeEventFlow,
  whatIfFewerStaff,
  type OptimizationObjective,
} from "../core/eventOptimization";
import { catalogFromProject } from "../core/migrate";
import { buildSummaryLines } from "../core/summary";
import { uid, ZONE_DEFAULTS, type Project, type SceneObject, type ZoneType } from "../core/model";
import { issueCounts, validateProject } from "../core/validation";
import { isAllowedTool } from "./tools";
import type { AgentToolCall } from "./types";
import type { AgentTransaction } from "./transaction";
import { recordAgentTool } from "../core/diagnostics";

export interface ExecutorContext {
  selectionIds: string[];
  reconstructionQueue: ReconstructionQueue;
}

export interface ToolResult {
  ok: boolean;
  tool: string;
  data?: unknown;
  error?: string;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
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
    if (!isAllowedTool(call.tool)) {
      return { ok: false, tool: call.tool, error: `工具不在允許清單：${call.tool}` };
    }
    const draft = this.tx.getDraft();
    if (!draft && call.tool !== "rollbackAgentChanges") {
      return { ok: false, tool: call.tool, error: "沒有進行中的 Preview" };
    }

    const t0 = performance.now();
    try {
      const result = await this.runInner(call);
      recordAgentTool(call.tool, result.ok, performance.now() - t0, result.error);
      return result;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      recordAgentTool(call.tool, false, performance.now() - t0, error);
      return { ok: false, tool: call.tool, error };
    }
  }

  private async runInner(call: AgentToolCall): Promise<ToolResult> {
    const draft = this.tx.getDraft();
    try {
      switch (call.tool) {
        case "getProjectSummary":
          return { ok: true, tool: call.tool, data: { lines: buildSummaryLines(draft!) } };
        case "getVenueGeometry":
          return {
            ok: true,
            tool: call.tool,
            data: { classroom: draft!.classroom, corridor: draft!.corridor, tile: draft!.tile },
          };
        case "listAssets": {
          const catalog = catalogFromProject(draft!);
          return { ok: true, tool: call.tool, data: catalog.list().map((e) => ({ id: e.id, name: e.name, kind: e.kind })) };
        }
        case "getSelection":
          return { ok: true, tool: call.tool, data: this.ctx.selectionIds };
        case "getZones":
          return { ok: true, tool: call.tool, data: draft!.zones };
        case "getRoutes":
          return { ok: true, tool: call.tool, data: draft!.routes };
        case "getValidationIssues":
        case "validateLayout": {
          let issues = validateProject(draft!);
          if (call.args?.optimize === "clear-doors") {
            this.optimizeClearDoors(draft!);
            issues = validateProject(draft!);
          }
          return { ok: true, tool: call.tool, data: { issues, counts: issueCounts(issues) } };
        }
        case "getSimulationSummary":
        case "simulateScenario": {
          const participants = num(call.args?.participants, 60);
          // Ensure scenario exists on the draft so subsequent tools see it.
          const ensured = eventFlowAdapter.ensureScenario(draft!, participants);
          if (!draft!.scenarios.some((s) => s.id === ensured.id)) {
            this.tx.mutate((p) => {
              p.scenarios = [...(p.scenarios ?? []), ensured];
              p.activeScenarioId = ensured.id;
            });
          } else if (ensured.participantCount !== draft!.scenarios.find((s) => s.id === ensured.id)?.participantCount) {
            this.tx.mutate((p) => {
              p.scenarios = p.scenarios.map((s) =>
                s.id === ensured.id ? { ...s, participantCount: participants } : s,
              );
            });
          }
          return {
            ok: true,
            tool: call.tool,
            data: eventFlowAdapter.simulateScenario(this.tx.getDraft()!, participants),
          };
        }
        case "compareScenarios": {
          const participants = num(call.args?.participants, 60);
          return {
            ok: true,
            tool: call.tool,
            data: eventFlowAdapter.compareScenarios(draft!, participants),
          };
        }
        case "readScenario": {
          const scn =
            (draft!.activeScenarioId &&
              draft!.scenarios.find((s) => s.id === draft!.activeScenarioId)) ||
            draft!.scenarios[0] ||
            eventFlowAdapter.ensureScenario(draft!);
          return {
            ok: true,
            tool: call.tool,
            data: {
              id: scn.id,
              name: scn.name,
              participantCount: scn.participantCount,
              stations: scn.stations.map((s) => ({
                id: s.id,
                name: s.name,
                type: s.type,
                staffCount: s.staffCount,
                x: s.x,
                z: s.z,
              })),
              profiles: scn.profiles,
            },
          };
        }
        case "readSimulationResult":
        case "findBottlenecks": {
          const participants = num(call.args?.participants, draft!.scenarios[0]?.participantCount ?? 60);
          const summary = eventFlowAdapter.simulateScenario(draft!, participants);
          return { ok: true, tool: call.tool, data: summary };
        }
        case "configureScenario": {
          const participants = num(call.args?.participants, 60);
          const prepaidRatio =
            typeof call.args?.prepaidRatio === "number"
              ? call.args.prepaidRatio
              : typeof call.args?.prepaidCount === "number"
                ? Number(call.args.prepaidCount) / Math.max(1, participants)
                : 2 / 3;
          const checkinStaff = num(call.args?.checkinStaff, 2);
          const paymentStaff = num(call.args?.paymentStaff, 1);
          const hasOnsite =
            call.args?.hasOnsitePayment !== false &&
            (typeof call.args?.onsitePaymentCount === "number"
              ? Number(call.args.onsitePaymentCount) > 0
              : prepaidRatio < 1);
          this.tx.mutate((p) => {
            let scn = eventFlowAdapter.ensureScenario(p, participants);
            if (!p.scenarios.some((s) => s.id === scn.id)) {
              p.scenarios = [...p.scenarios, scn];
              p.activeScenarioId = scn.id;
            }
            scn = {
              ...scn,
              participantCount: participants,
              arrivalWindowSeconds: num(call.args?.arrivalWindowSeconds, scn.arrivalWindowSeconds),
              stations: scn.stations.map((st) => {
                if (st.type === "checkin") {
                  return { ...st, staffCount: checkinStaff, parallelServers: checkinStaff };
                }
                if (st.type === "payment") {
                  const staff = hasOnsite ? paymentStaff : 0;
                  return { ...st, staffCount: staff, parallelServers: staff };
                }
                return st;
              }),
            };
            const prepaidBranch = scn.stations.filter((s) => s.type !== "payment").map((s) => s.id);
            const fullBranch = scn.stations.map((s) => s.id);
            scn.profiles = hasOnsite
              ? [
                  { id: "prepaid", ratio: prepaidRatio, branch: prepaidBranch },
                  { id: "pay-on-site", ratio: 1 - prepaidRatio, branch: fullBranch },
                ]
              : [{ id: "prepaid", ratio: 1, branch: prepaidBranch }];
            p.scenarios = p.scenarios.map((s) => (s.id === scn.id ? scn : s));
            p.activeScenarioId = scn.id;
          });
          return {
            ok: true,
            tool: call.tool,
            data: { configured: true, participants, prepaidRatio, checkinStaff, paymentStaff },
          };
        }
        case "splitPaymentFlow": {
          this.tx.mutate((p) => {
            const scn = eventFlowAdapter.ensureScenario(p);
            const { separated } = buildCheckinPaymentVariants(scn);
            // Place payment desk offset if object exists
            const pay = separated.stations.find((s) => s.type === "payment");
            const ck = separated.stations.find((s) => s.type === "checkin");
            if (pay && ck) {
              const payObj = p.objects.find((o) => o.serviceRole === "payment");
              const ckObj = p.objects.find((o) => o.serviceRole === "checkin" || o.kind === "regTable");
              if (payObj) {
                payObj.x = (ckObj?.x ?? ck.x) + 2.5;
                payObj.z = ckObj?.z ?? ck.z;
              } else if (ckObj) {
                p.objects.push({
                  ...ckObj,
                  id: uid("obj"),
                  x: ckObj.x + 2.5,
                  serviceRole: "payment",
                  assetId: "builtin:payment-desk",
                });
              }
            }
            p.scenarios = [separated, ...p.scenarios.filter((s) => s.id !== separated.id && s.id !== scn.id)];
            p.activeScenarioId = separated.id;
          });
          return { ok: true, tool: call.tool, data: { split: true } };
        }
        case "assignStaff": {
          const checkinStaff = typeof call.args?.checkinStaff === "number" ? call.args.checkinStaff : undefined;
          const paymentStaff = typeof call.args?.paymentStaff === "number" ? call.args.paymentStaff : undefined;
          const remove = num(call.args?.remove, 0);
          this.tx.mutate((p) => {
            let scn = eventFlowAdapter.ensureScenario(p);
            if (remove > 0) {
              scn = whatIfFewerStaff(scn, remove);
            } else {
              scn = {
                ...scn,
                stations: scn.stations.map((st) => {
                  if (st.type === "checkin" && checkinStaff !== undefined) {
                    return { ...st, staffCount: checkinStaff, parallelServers: checkinStaff };
                  }
                  if (st.type === "payment" && paymentStaff !== undefined) {
                    return { ...st, staffCount: paymentStaff, parallelServers: paymentStaff };
                  }
                  return st;
                }),
              };
            }
            p.scenarios = p.scenarios.map((s) => (s.id === scn.id || s.id === p.activeScenarioId ? scn : s));
            if (!p.scenarios.some((s) => s.id === scn.id)) p.scenarios = [scn, ...p.scenarios];
            p.activeScenarioId = scn.id;
          });
          return { ok: true, tool: call.tool, data: { assigned: true, remove } };
        }
        case "generateLayoutCandidates":
        case "optimizeEventFlow": {
          const objective = str(call.args?.objective, "fastest") as OptimizationObjective;
          const scn = eventFlowAdapter.ensureScenario(draft!);
          const report = optimizeEventFlow(scn, objective, draft!);
          if (report.improved) {
            this.tx.mutate((p) => {
              const next = report.improved!.candidate.scenario;
              for (const st of next.stations) {
                if (!st.objectId) continue;
                const obj = p.objects.find((o) => o.id === st.objectId);
                if (obj) {
                  obj.x = st.x;
                  obj.z = st.z;
                }
              }
              p.scenarios = [next, ...p.scenarios.filter((s) => s.id !== next.id)];
              p.activeScenarioId = next.id;
            });
          }
          return {
            ok: true,
            tool: call.tool,
            data: {
              summary: report.summary,
              deltas: report.deltas,
              improved: report.improved?.candidate.name ?? null,
              baseline: {
                finish: report.baseline.result.finishTimeSeconds,
                maxQueue: report.baseline.result.maxQueue,
                avgWait: report.baseline.result.avgWaitSeconds,
                staff: report.baseline.result.staffUsed,
              },
              after: report.improved
                ? {
                    finish: report.improved.result.finishTimeSeconds,
                    maxQueue: report.improved.result.maxQueue,
                    avgWait: report.improved.result.avgWaitSeconds,
                    staff: report.improved.result.staffUsed,
                  }
                : null,
            },
          };
        }
        case "explainImprovement": {
          const scn = eventFlowAdapter.ensureScenario(draft!);
          const report = optimizeEventFlow(scn, "fastest", draft!);
          return {
            ok: true,
            tool: call.tool,
            data: { summary: report.summary, deltas: report.deltas },
          };
        }
        case "focusIssue": {
          return {
            ok: true,
            tool: call.tool,
            data: {
              note: "請在模擬面板點問題以聚焦；Agent 已標出瓶頸",
              x: typeof call.args?.x === "number" ? call.args.x : undefined,
              z: typeof call.args?.z === "number" ? call.args.z : undefined,
            },
          };
        }
        case "createServiceStation": {
          let created: ReturnType<typeof eventFlowAdapter.createServiceStation> | null = null;
          this.tx.mutate((p) => {
            created = eventFlowAdapter.createServiceStation(p, {
              type: str(call.args?.type, "custom") as never,
              name: str(call.args?.name, "") || undefined,
              x: typeof call.args?.x === "number" ? call.args.x : undefined,
              z: typeof call.args?.z === "number" ? call.args.z : undefined,
              staffCount: typeof call.args?.staffCount === "number" ? call.args.staffCount : undefined,
              meanServiceSeconds:
                typeof call.args?.meanServiceSeconds === "number"
                  ? call.args.meanServiceSeconds
                  : undefined,
              objectId: str(call.args?.objectId, "") || undefined,
              zoneId: str(call.args?.zoneId, "") || undefined,
            });
          });
          return { ok: true, tool: call.tool, data: created };
        }
        case "updateServiceStation": {
          const stationId = str(call.args?.stationId);
          if (!stationId) return { ok: false, tool: call.tool, error: "缺少 stationId" };
          let updated: ReturnType<typeof eventFlowAdapter.updateServiceStation> | null = null;
          this.tx.mutate((p) => {
            updated = eventFlowAdapter.updateServiceStation(p, {
              stationId,
              name: str(call.args?.name, "") || undefined,
              staffCount: typeof call.args?.staffCount === "number" ? call.args.staffCount : undefined,
              parallelServers:
                typeof call.args?.parallelServers === "number" ? call.args.parallelServers : undefined,
              meanServiceSeconds:
                typeof call.args?.meanServiceSeconds === "number"
                  ? call.args.meanServiceSeconds
                  : undefined,
              x: typeof call.args?.x === "number" ? call.args.x : undefined,
              z: typeof call.args?.z === "number" ? call.args.z : undefined,
              queueCapacity:
                typeof call.args?.queueCapacity === "number" ? call.args.queueCapacity : undefined,
            });
          });
          return { ok: true, tool: call.tool, data: updated };
        }

        case "createCustomAssetProxy": {
          const semanticType = (str(call.args?.semanticType, "table") as SemanticAssetType) || "table";
          const serviceRole = (str(call.args?.serviceRole, "none") as ServiceRole) || "none";
          const { entry } = await createCustomAssetProxy({
            name: str(call.args?.name, "自訂素材"),
            semanticType,
            serviceRole,
            dimensions: {
              width: num(call.args?.width, 1.2),
              depth: num(call.args?.depth, 0.6),
              height: num(call.args?.height, 0.74),
            },
          });
          this.tx.mutate((p) => {
            p.catalogExtras = [...(p.catalogExtras ?? []), entry as never];
          });
          return { ok: true, tool: call.tool, data: { assetId: entry.id, entry } };
        }

        case "createAssetFromCatalog":
        case "placeAsset": {
          const assetId = str(call.args?.assetId);
          if (!assetId) return { ok: false, tool: call.tool, error: "缺少 assetId" };
          const obj = this.placeFromCatalog(draft!, assetId, call.args ?? {});
          if (!obj) return { ok: false, tool: call.tool, error: `找不到素材 ${assetId}` };
          this.tx.mutate((p) => {
            p.objects.push(obj);
          });
          return { ok: true, tool: call.tool, data: { objectId: obj.id } };
        }

        case "moveAsset": {
          const id = str(call.args?.objectId);
          const x = num(call.args?.x, NaN);
          const z = num(call.args?.z, NaN);
          if (!id || Number.isNaN(x) || Number.isNaN(z)) {
            return { ok: false, tool: call.tool, error: "moveAsset 需要 objectId/x/z" };
          }
          this.tx.mutate((p) => {
            const o = p.objects.find((x) => x.id === id);
            if (o && !o.locked) {
              o.x = x;
              o.z = z;
            }
          });
          return { ok: true, tool: call.tool, data: { objectId: id } };
        }

        case "rotateAsset": {
          const id = str(call.args?.objectId);
          const rot = num(call.args?.rotationDeg, 0);
          this.tx.mutate((p) => {
            const o = p.objects.find((x) => x.id === id);
            if (o && !o.locked) o.rotationDeg = rot;
          });
          return { ok: true, tool: call.tool, data: { objectId: id } };
        }

        case "duplicateAsset": {
          const id = str(call.args?.objectId);
          let copyId: string | null = null;
          this.tx.mutate((p) => {
            const o = p.objects.find((x) => x.id === id);
            if (!o) return;
            const copy: SceneObject = {
              ...structuredClone(o),
              id: uid("obj"),
              x: o.x + 0.6,
              z: o.z + 0.6,
            };
            p.objects.push(copy);
            copyId = copy.id;
          });
          return copyId
            ? { ok: true, tool: call.tool, data: { objectId: copyId } }
            : { ok: false, tool: call.tool, error: "找不到物件" };
        }

        case "createZone": {
          const type = str(call.args?.type, "registration") as ZoneType;
          const d = ZONE_DEFAULTS[type] ?? ZONE_DEFAULTS.registration;
          const zone = {
            id: uid("zone"),
            type,
            name: d.label,
            x: draft!.classroom.x + draft!.classroom.length / 2,
            z: draft!.classroom.z + draft!.classroom.width / 2,
            width: d.width,
            depth: d.depth,
            color: d.color,
            icon: d.icon,
            capacity: null as number | null,
            locked: false,
            hidden: false,
          };
          this.tx.mutate((p) => p.zones.push(zone));
          return { ok: true, tool: call.tool, data: { zoneId: zone.id } };
        }

        case "updateZone":
        case "updateArray":
        case "updateRoute":
        case "updateAssetMetadata": {
          return { ok: true, tool: call.tool, data: { skipped: true, note: "參數更新請用手動屬性面板（V1）" } };
        }

        case "createArray": {
          return { ok: true, tool: call.tool, data: { note: "請用素材庫「陣列」建立；Agent V1 以單件放置為主" } };
        }

        case "createRoute": {
          const route = {
            id: uid("route"),
            name: str(call.args?.name, "動線"),
            color: str(call.args?.color, "#38bdf8"),
            type: "custom" as const,
            points: [
              { x: draft!.classroom.x + 0.5, z: draft!.classroom.z + draft!.classroom.width / 2 },
              { x: draft!.classroom.x + draft!.classroom.length - 0.5, z: draft!.classroom.z + draft!.classroom.width / 2 },
            ],
            visible: true,
          };
          this.tx.mutate((p) => p.routes.push(route));
          return { ok: true, tool: call.tool, data: { routeId: route.id } };
        }

        case "measureGap": {
          return { ok: true, tool: call.tool, data: { note: "請用檢查模式的測距工具" } };
        }

        case "requestAssetReconstruction": {
          const assetId = str(call.args?.assetId);
          const extras = draft!.catalogExtras ?? [];
          const found = extras.find((e) => e.id === assetId);
          if (!found) return { ok: false, tool: call.tool, error: "找不到自訂素材" };
          const job = this.ctx.reconstructionQueue.enqueue(assetId, found.blobIds?.sourceImage);
          const worker = new MockReconstructionWorker(this.ctx.reconstructionQueue);
          const { entry } = await worker.run(job.id, found as AssetCatalogEntry);
          this.tx.mutate((p) => {
            p.catalogExtras = (p.catalogExtras ?? []).map((e) => (e.id === assetId ? (entry as never) : e));
          });
          return { ok: true, tool: call.tool, data: { assetId, visualRef: entry.visualRef } };
        }

        case "replaceAssetVisual": {
          const assetId = str(call.args?.assetId);
          const visualRef = str(call.args?.visualRef);
          this.tx.mutate((p) => {
            p.catalogExtras = (p.catalogExtras ?? []).map((e) =>
              e.id === assetId ? (replaceCatalogVisual(e as AssetCatalogEntry, visualRef) as never) : e,
            );
          });
          return { ok: true, tool: call.tool, data: { assetId, visualRef } };
        }

        case "importAsset":
          return { ok: false, tool: call.tool, error: "請用「匯入 3D 素材」UI 選擇檔案" };

        case "previewAgentChanges":
          return { ok: true, tool: call.tool, data: this.tx.summarize() };
        case "commitAgentChanges":
        case "rollbackAgentChanges":
          return { ok: true, tool: call.tool, data: { note: "由 QuickAgent 編排層處理" } };

        default:
          return { ok: false, tool: call.tool, error: "未實作" };
      }
    } catch (e) {
      return { ok: false, tool: call.tool, error: e instanceof Error ? e.message : String(e) };
    }
  }

  private placeFromCatalog(
    draft: Project,
    assetId: string,
    args: Record<string, unknown>,
  ): SceneObject | null {
    const catalog = catalogFromProject(draft);
    const entry = catalog.get(assetId);
    if (!entry) return null;
    const classroom = draft.classroom;
    const index = num(args.index, 0);
    const offsetX = num(args.offsetX, index * (entry.dimensions.width + 0.4));
    let x = classroom.x + 1.5 + offsetX;
    let z = classroom.z + 1.2;
    if (args.target === "classroom-center") {
      x = classroom.x + classroom.length / 2 + offsetX;
      z = classroom.z + classroom.width / 2;
    } else if (args.target === "near-entrance") {
      // Near south edge of classroom (corridor side) but inset 1m from door-ish area.
      x = classroom.x + 2 + offsetX;
      z = classroom.z + classroom.width - 1.2;
    }
    // Keep 1m from walls roughly
    x = Math.min(Math.max(x, classroom.x + 1), classroom.x + classroom.length - 1);
    z = Math.min(Math.max(z, classroom.z + 1), classroom.z + classroom.width - 1);

    return {
      id: uid("obj"),
      kind: entry.kind,
      assetId: entry.id,
      serviceRole: entry.serviceRole,
      x,
      z,
      rotationDeg: entry.defaultFacingDeg,
      width: entry.dimensions.width,
      depth: entry.dimensions.depth,
      height: entry.dimensions.height,
      locked: false,
      hidden: false,
      surface: entry.placementType,
      elevation: entry.placementType === "wall" ? entry.defaultElevation ?? 0 : 0,
    };
  }

  private optimizeClearDoors(draft: Project): void {
    const doors = draft.objects.filter((o) => o.kind === "door");
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
        }
      }
    }
  }
}
