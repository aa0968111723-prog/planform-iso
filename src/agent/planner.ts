/**
 * Multi-step planner: parsed intent + the current project → an ordered list of
 * tool calls.
 *
 * This is where a sentence becomes coordinates. 「把報到桌移到入口右側」 cannot
 * be planned without the project, because "the entrance" and "the check-in
 * desk" are things the plan has, not things the sentence has. So parsing
 * (`intent.ts`, project-free and easy to test) and resolution (here, needs
 * fixtures) are deliberately separate stages.
 *
 * Two rules the planner keeps:
 *
 * - **A reference that cannot be resolved becomes an unresolved note, never a
 *   guess.** If the plan has no check-in desk, "move the check-in desk" reports
 *   that, rather than moving the nearest table and calling it done.
 * - **Reads come before writes, and validation comes after them.** The order is
 *   part of the answer: a simulation run before the layout was applied
 *   describes the old plan.
 */

import type { Project, SceneObject, ZoneType } from "../core/model";
import { areaBounds } from "../core/placement";
import { RECOMMENDED_SCHEME, type EventType } from "../core/spatialPlanner";
import type { ObjectReference, ParsedRequest, SpatialRelation } from "./intent";
import type { AgentToolCall } from "./types";

export interface PlannedStep {
  call: AgentToolCall;
  /** Why this step is in the plan, in one line. */
  because: string;
}

export interface PlanResult {
  steps: PlannedStep[];
  /** References the sentence made that the project could not satisfy. */
  unresolved: string[];
  /** What the planner assumed, carried from parsing plus anything added here. */
  assumptions: string[];
  /** One-paragraph account of the plan, for the agent's reply. */
  message: string;
}

const DEFAULT_PARTICIPANTS = 60;
const DEFAULT_STAFF = 4;
const DEFAULT_DOOR_CLEARANCE = 1.2;
const DEFAULT_EVENT: EventType = "tea-gathering";

/** Where the entrance is, and which way is "right" when facing into the room. */
function entranceFrame(project: Project): {
  x: number; z: number;
  /** +1 when increasing X is to the viewer's right on entering, -1 otherwise. */
  rightSign: number;
  fromSouth: boolean;
} {
  const doors = project.objects.filter((o) => o.kind === "door" && !o.hidden);
  const b = areaBounds(project.classroom);
  const midZ = (b.minZ + b.maxZ) / 2;
  let x: number;
  let z: number;
  if (doors.length) {
    const corr = project.corridor;
    const cx = corr.x + corr.length / 2;
    const cz = corr.z + corr.width / 2;
    const best = doors.reduce((acc, d) =>
      Math.hypot(d.x - cx, d.z - cz) < Math.hypot(acc.x - cx, acc.z - cz) ? d : acc,
    );
    x = best.x;
    z = best.z;
  } else {
    x = project.corridor.x + project.corridor.length / 2;
    z = project.corridor.z + project.corridor.width / 2;
  }
  // Entering from the south edge means you face -Z, so your right hand points
  // at -X. Getting this backwards puts 報到桌 on the wrong side of the door,
  // which is exactly the kind of error a user notices immediately and the
  // software never does.
  const fromSouth = z >= midZ;
  return { x, z, rightSign: fromSouth ? -1 : 1, fromSouth };
}

/** Turn a relation into a target point inside the usable area. */
function pointFor(project: Project, relation: SpatialRelation | undefined, offset: number): { x: number; z: number } {
  const b = areaBounds(project.classroom);
  const inset = 1.0;
  const usable = {
    minX: b.minX + inset, maxX: b.maxX - inset,
    minZ: b.minZ + inset, maxZ: b.maxZ - inset,
  };
  const frame = entranceFrame(project);
  const serviceZ = frame.fromSouth ? usable.maxZ - 1.4 : usable.minZ + 1.4;
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

  switch (relation) {
    case "right":
      return { x: clamp(frame.x + frame.rightSign * offset, usable.minX, usable.maxX), z: clamp(serviceZ, usable.minZ, usable.maxZ) };
    case "left":
      return { x: clamp(frame.x - frame.rightSign * offset, usable.minX, usable.maxX), z: clamp(serviceZ, usable.minZ, usable.maxZ) };
    case "center":
      return { x: (usable.minX + usable.maxX) / 2, z: (usable.minZ + usable.maxZ) / 2 };
    case "front":
      return { x: (usable.minX + usable.maxX) / 2, z: clamp(frame.fromSouth ? usable.maxZ - 1.2 : usable.minZ + 1.2, usable.minZ, usable.maxZ) };
    case "back":
      return { x: (usable.minX + usable.maxX) / 2, z: clamp(frame.fromSouth ? usable.minZ + 1.2 : usable.maxZ - 1.2, usable.minZ, usable.maxZ) };
    case "near-entrance":
      return { x: clamp(frame.x, usable.minX, usable.maxX), z: clamp(serviceZ, usable.minZ, usable.maxZ) };
    case "near-exit": {
      const exits = project.objects.filter((o) => o.kind === "door" && Math.hypot(o.x - frame.x, o.z - frame.z) > 0.5);
      if (exits.length) return { x: clamp(exits[0].x, usable.minX, usable.maxX), z: clamp(exits[0].z, usable.minZ, usable.maxZ) };
      return { x: clamp(frame.x, usable.minX, usable.maxX), z: clamp(serviceZ, usable.minZ, usable.maxZ) };
    }
    case "along-wall":
      return { x: usable.minX, z: (usable.minZ + usable.maxZ) / 2 };
    default:
      return { x: (usable.minX + usable.maxX) / 2, z: (usable.minZ + usable.maxZ) / 2 };
  }
}

/** Find the object a phrase like 「報到桌」 refers to. */
function resolveObject(project: Project, ref: ObjectReference): SceneObject | null {
  if (ref.serviceRole) {
    const byRole = project.objects.find((o) => !o.hidden && o.serviceRole === ref.serviceRole);
    if (byRole) return byRole;
  }
  if (ref.phrase === "報到桌") {
    const reg = project.objects.find((o) => !o.hidden && o.kind === "regTable");
    if (reg) return reg;
  }
  if (ref.zoneType) {
    const zone = project.zones.find((z) => !z.hidden && z.type === ref.zoneType);
    if (zone) {
      // A zone with no desk is still a real reference; find something inside it.
      const inside = project.objects.find(
        (o) => !o.hidden && Math.abs(o.x - zone.x) <= zone.width / 2 && Math.abs(o.z - zone.z) <= zone.depth / 2,
      );
      if (inside) return inside;
    }
  }
  return null;
}

export function planFromRequest(parsed: ParsedRequest, project: Project): PlanResult {
  const steps: PlannedStep[] = [];
  const unresolved: string[] = [];
  const assumptions = [...parsed.assumptions];
  const s = parsed.slots;
  const types = new Set(parsed.intents.map((i) => i.type));

  const participants = s.participants?.value ?? DEFAULT_PARTICIPANTS;
  const staffCount = s.staffCount?.value ?? DEFAULT_STAFF;
  const eventType = s.eventType?.value ?? DEFAULT_EVENT;
  const doorClearance = s.doorClearance?.value ?? DEFAULT_DOOR_CLEARANCE;
  const objectives = s.objectives.map((o) => o.value);
  const zones = s.requiredZones.map((z) => z.value);

  const briefArgs: Record<string, unknown> = {
    participants,
    eventType,
    staffCount,
    doorClearance,
    ...(s.aisleWidth ? { minAisleWidth: s.aisleWidth.value } : {}),
    ...(zones.length ? { zones: dedupeZones(zones, eventType) } : {}),
    ...(objectives.length ? { objectives } : {}),
    ...(s.requiredAssets.length ? { requiredAssets: s.requiredAssets.map((a) => a.value) } : {}),
  };

  const add = (call: AgentToolCall, because: string) => steps.push({ call, because });

  // --- always start by reading, so the plan is about THIS venue.
  if (types.has("design-layout") || types.has("propose-alternatives") || types.has("move-objects")) {
    add({ tool: "getVenueGeometry", args: {} }, "先讀場地尺寸與校正資料。");
  }

  if (s.venueSize) {
    // The planner cannot resize the venue — that is a calibration action with
    // real-world consequences. Say so rather than silently ignoring it.
    unresolved.push(
      `你提到場地是 ${s.venueSize.value.length} x ${s.venueSize.value.width} 公尺，` +
      "但改場地尺寸要走「場地校正」，Agent 不會自己改。目前方案是依現有場地尺寸算的。",
    );
  }

  // --- diagnosis first. 「找出最塞的地方，提出改善方案」 only reads correctly in
  // that order: the alternatives are an answer to the diagnosis, and printing
  // them first makes the diagnosis look like an afterthought.
  if (types.has("diagnose-bottleneck")) {
    add({ tool: "explainBottleneck", args: { participants } }, "先跑模擬，找出最塞的站點與原因。");
  }

  // --- alternatives / layout design
  if (types.has("propose-alternatives") || types.has("design-layout") || types.has("diagnose-bottleneck")) {
    add(
      { tool: "generateLayoutCandidates", args: briefArgs },
      types.has("diagnose-bottleneck")
        ? "針對瓶頸產生 A/B/C 三種改善方案，各自量測容量、等待時間與檢查結果。"
        : "產生 A/B/C 三種方案，並各自量測容量、等待時間與檢查結果。",
    );
  }

  if (types.has("design-layout") && !types.has("propose-alternatives")) {
    // A direct 「幫我排」 applies the scheme that SCORED best for the stated
    // goals; 「提出三種方案」 stops at the comparison and lets the user choose.
    //
    // The planner used to pick with its own objective→scheme table while the
    // engine recommended by measured score. The two disagreed — the user was
    // shown 「推薦 C（92.9 分）」 and handed B — which is the kind of
    // contradiction that makes every other number look untrustworthy too.
    add(
      { tool: "applySmartLayout", args: { candidateId: RECOMMENDED_SCHEME, ...briefArgs } },
      "套用分數最高的方案（分數已依你說的目標加權）。",
    );
    add({ tool: "validateLayout", args: {} }, "套用後重跑檢查。");
  }

  // --- explicit moves
  if (types.has("move-objects")) {
    let index = 0;
    for (const ref of s.objectRefs) {
      const obj = resolveObject(project, ref);
      if (!obj) {
        unresolved.push(`場上找不到「${ref.phrase}」，沒有移動任何東西。`);
        continue;
      }
      // Two desks each asked to keep a metre of aisle need to be at least
      // desk-width + aisle apart, or they satisfy the words and not the intent.
      //
      // 「兩邊各保留一公尺走道」 is one instruction about both desks, so it lands
      // on the sentence-level aisle slot rather than on either desk. Falling
      // back to it here is what makes that sentence do what it says.
      const gap = ref.clearance ?? s.aisleWidth?.value ?? 1.0;
      const offset = obj.width / 2 + gap + index * 0.2;
      const p = pointFor(project, ref.relation, offset);
      add(
        { tool: "moveAsset", args: { objectId: obj.id, x: round2(p.x), z: round2(p.z) } },
        `把「${ref.phrase}」移到${relationLabel(ref.relation)}${ref.clearance ? `，保留 ${ref.clearance} 公尺` : ""}。`,
      );
      index += 1;
    }
    if (s.objectRefs.length && steps.some((st) => st.call.tool === "moveAsset")) {
      add({ tool: "validateLayout", args: {} }, "移動後重跑檢查，確認沒有擋門或走道過窄。");
      if (s.aisleWidth || s.objectRefs.some((r) => r.clearance)) {
        const moved = steps.filter((st) => st.call.tool === "moveAsset");
        if (moved.length >= 2) {
          add(
            {
              tool: "measureGap",
              args: {
                objectIdA: String((moved[0].call.args as Record<string, unknown>).objectId),
                objectIdB: String((moved[1].call.args as Record<string, unknown>).objectId),
              },
            },
            "量兩張桌子之間實際留下的淨距。",
          );
        }
      }
    }
  }

  // --- assets and props
  if (types.has("create-prop")) {
    add(
      { tool: "createPropFromRecipe", args: { name: "AI 道具", ...(s.dimensions ? dimsToArgs(s.dimensions.value) : {}) } },
      "依描述建立互動道具。",
    );
  } else if (types.has("create-asset")) {
    const d = s.dimensions?.value ?? { width: 1.8, depth: 0.6, height: 0.74 };
    if (!s.dimensions) assumptions.push("沒有給尺寸，先用 180 x 60 x 74 公分的標準折疊桌。");
    const targetZone = s.requiredZones[0]?.value;
    add(
      {
        tool: "createCustomAssetProxy",
        args: {
          name: guessAssetName(parsed.normalized),
          semanticType: "service-desk",
          serviceRole: targetZone === "payment" ? "payment" : targetZone === "registration" ? "checkin" : "none",
          width: d.width, depth: d.depth, height: d.height ?? 0.74,
        },
      },
      "以你給的尺寸建立簡化 3D 素材（照片重建可以之後再跑）。",
    );
    // Placement needs the id the previous step returns, so the orchestrator
    // fills it in. Encoding a fake id here would produce a tool call that
    // always fails.
    add(
      { tool: "placeAsset", args: { assetId: "<from:createCustomAssetProxy>", target: targetZone ? "near-entrance" : "classroom-center" } },
      targetZone ? `放到${zoneLabel(targetZone)}附近。` : "放到教室中央。",
    );
  }

  // --- simulation and comparison (diagnosis already ran above, if asked for)
  if (types.has("simulate") && !types.has("diagnose-bottleneck")) {
    add({ tool: "simulateScenario", args: { participants } }, `模擬 ${participants} 人進場。`);
  }
  if (types.has("compare")) {
    add({ tool: "compareScenarios", args: { participants } }, "比較同桌與分桌兩種做法。");
  }

  // --- inspection
  if (types.has("inspect")) {
    add({ tool: "validateLayout", args: {} }, "跑一次完整檢查。");
    add({ tool: "checkDoorClearance", args: { clearance: doorClearance } }, "另外確認每一扇門前的淨空。");
  }

  // --- deliverables
  if (types.has("export-deliverables")) {
    const wantsStaffPlan = /工作人員|夥伴|場佈圖|施工圖|平面圖/.test(parsed.normalized);
    if (wantsStaffPlan) {
      add({ tool: "exportPlanImage", args: { preset: "staff" } }, "輸出工作人員看得懂的場佈圖。");
    }
    if (/物資|清單|器材|要帶什麼/.test(parsed.normalized)) {
      add({ tool: "exportMaterialList", args: {} }, "產生物資清單。");
    }
    if (/動線圖/.test(parsed.normalized)) {
      add({ tool: "exportPlanImage", args: { preset: "route" } }, "輸出動線圖。");
    }
    if (/夥伴/.test(parsed.normalized)) {
      add({ tool: "exportPartnerView", args: {} }, "輸出夥伴觀看圖。");
    }
  }

  if (!steps.length) {
    add({ tool: "getProjectSummary", args: {} }, "先讀目前場佈狀態。");
    add({ tool: "getValidationIssues", args: {} }, "順便看看有沒有待處理的問題。");
  }

  // Two intents can legitimately want the same work — 「找出最塞的地方，提出兩種
  // 改善方案」 fires both diagnose-bottleneck and propose-alternatives, and both
  // want the candidates generated. Running it twice costs a full simulation and
  // shows the user the same card twice.
  const deduped = dedupeSteps(steps);

  return {
    steps: deduped,
    unresolved,
    assumptions,
    message: buildMessage(parsed, deduped, unresolved, assumptions),
  };
}

/** Drop a step whose tool AND arguments already appear earlier in the plan. */
function dedupeSteps(steps: PlannedStep[]): PlannedStep[] {
  const seen = new Set<string>();
  const out: PlannedStep[] = [];
  for (const step of steps) {
    // validateLayout is deliberately allowed to repeat: running it after a move
    // and again after a layout is two different questions about two different
    // states, and collapsing them would report a stale answer.
    const key = `${step.call.tool}:${JSON.stringify(step.call.args ?? {})}`;
    if (step.call.tool !== "validateLayout" && seen.has(key)) continue;
    seen.add(key);
    out.push(step);
  }
  return out;
}

/* ------------------------------------------------------------------ */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function dimsToArgs(d: { width: number; depth: number; height?: number }): Record<string, number> {
  return { width: d.width, depth: d.depth, height: d.height ?? 0.6 };
}

/**
 * A seating event needs a seating zone even when the sentence only named the
 * service zones, or the planner lays out desks and no seats.
 */
function dedupeZones(zones: ZoneType[], eventType: EventType): ZoneType[] {
  const out = [...new Set(zones)];
  const seating: ZoneType = eventType === "classroom" || eventType === "lecture" ? "group" : "meditation";
  if (!out.includes("meditation") && !out.includes("group")) out.push(seating);
  return out;
}

function relationLabel(r: SpatialRelation | undefined): string {
  switch (r) {
    case "right": return "入口右側";
    case "left": return "入口左側";
    case "center": return "場地中央";
    case "front": return "前方";
    case "back": return "後方";
    case "near-entrance": return "入口附近";
    case "near-exit": return "出口附近";
    case "along-wall": return "靠牆處";
    default: return "指定位置";
  }
}

function zoneLabel(z: ZoneType): string {
  const map: Record<ZoneType, string> = {
    registration: "報到區", payment: "收費區", life: "生活區", group: "小組區",
    meditation: "禪坐區", shoe: "鞋子區", backpack: "背包區", custom: "自訂區",
  };
  return map[z] ?? "指定區域";
}

function guessAssetName(text: string): string {
  if (/收費|繳費|售票/.test(text)) return "收費桌";
  if (/報到|簽到/.test(text)) return "報到桌";
  if (/椅/.test(text)) return "自訂椅子";
  return "自訂桌子";
}

function buildMessage(
  parsed: ParsedRequest,
  steps: PlannedStep[],
  unresolved: string[],
  assumptions: string[],
): string {
  const parts: string[] = [];
  if (steps.length) {
    parts.push(`規劃了 ${steps.length} 個步驟：` + steps.map((s) => s.because).join(" "));
  }
  if (assumptions.length) parts.push("假設：" + assumptions.join(" "));
  if (unresolved.length) parts.push("沒做到的部分：" + unresolved.join(" "));
  if (!parts.length) parts.push("我可以幫你排場、檢查、模擬、比較方案與匯出圖面。");
  void parsed;
  return parts.join("\n");
}
