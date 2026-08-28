/**
 * Event Flow / Simulation adapter.
 *
 * Exposes the DES core (`core/eventFlow.ts`) to Quick Agent tools and UI.
 * Falls back to lightweight route-walking summary only when no scenario can
 * be derived from the project.
 */

import {
  buildCheckinPaymentVariants,
  compareScenarioVariants,
  runDiscreteEvent,
  runInteraction,
  runScenarioMedian,
  type ScenarioVariantCompareResult,
  type SimulationResult,
} from "../core/eventFlow";
import { createDefaultScenario, resolveScenarioBindings, resolveTemplateBindings } from "../core/migrate";
import type {
  EventScenario,
  Project,
  ServiceStation,
  StationType,
} from "../core/model";
import { uid } from "../core/model";
import {
  agentPositions,
  detectBottlenecks,
  initSimulation,
  stepSimulation,
  type SimParams,
} from "../core/simulation";

export interface SimulationSummaryAvailable {
  available: true;
  participants: number;
  routeCount?: number;
  bottleneckCount: number;
  bottlenecks: { x: number; z: number; count: number; name?: string }[];
  message: string;
  result?: SimulationResult;
  scenarioId?: string;
}

export interface SimulationSummaryUnavailable {
  available: false;
  reason: string;
  message: string;
}

export type SimulationSummary = SimulationSummaryAvailable | SimulationSummaryUnavailable;

export interface StationMutationResult {
  available: true;
  station: ServiceStation;
  scenarioId: string;
  message: string;
}

function ensureScenario(project: Project, participants?: number): EventScenario {
  const existing =
    (project.activeScenarioId &&
      project.scenarios.find((s) => s.id === project.activeScenarioId)) ||
    project.scenarios[0];
  if (existing) {
    if (participants && participants !== existing.participantCount) {
      return { ...existing, participantCount: participants };
    }
    return existing;
  }
  return createDefaultScenario(project, {
    participantCount: participants ?? 60,
  });
}

function ensureScenarioInProject(project: Project, participants?: number): EventScenario {
  let scn = ensureScenario(project, participants);
  if (!project.scenarios.some((s) => s.id === scn.id)) {
    project.scenarios = [...(project.scenarios ?? []), scn];
    project.activeScenarioId = scn.id;
  } else if (participants && scn.participantCount !== participants) {
    project.scenarios = project.scenarios.map((s) =>
      s.id === scn.id ? { ...s, participantCount: participants } : s,
    );
    scn = project.scenarios.find((s) => s.id === scn.id)!;
  }
  if (!project.activeScenarioId) project.activeScenarioId = scn.id;
  return scn;
}

function routeWalkSummary(project: Project, participants: number): SimulationSummary {
  const routes = project.routes.filter((r) => r.visible && r.points.length >= 2);
  if (routes.length === 0) {
    return {
      available: false,
      reason: "no-routes",
      message: "尚無可用動線。先在「動線」建立路徑，或建立活動流程站點後再模擬。",
    };
  }
  const perRoute = Math.max(1, Math.round(participants / routes.length));
  const params: SimParams = { countPerRoute: perRoute, speed: 1.0, spacing: 0.8 };
  let state = initSimulation(routes, params);
  for (let i = 0; i < 40; i++) {
    state = stepSimulation(state, routes, 0.25);
  }
  const positions = agentPositions(state, routes);
  const bottlenecks = detectBottlenecks(positions, 1.2, 3);
  return {
    available: true,
    participants,
    routeCount: routes.length,
    bottleneckCount: bottlenecks.length,
    bottlenecks,
    message: bottlenecks.length
      ? `動線預覽 ${participants} 人：發現 ${bottlenecks.length} 處可能壅塞。`
      : `動線預覽 ${participants} 人：目前未偵測到明顯壅塞。`,
  };
}

export const eventFlowAdapter = {
  available(): boolean {
    return true;
  },

  ensureScenario,

  getSimulationSummary(project?: Project, participants = 60): SimulationSummary {
    if (!project) {
      return {
        available: false,
        reason: "no-project",
        message: "沒有專案可模擬。",
      };
    }
    return this.simulateScenario(project, participants);
  },

  simulateScenario(project: Project, participants: number): SimulationSummary {
    // A plan with its own step list is simulated as that step list. Asking the
    // agent about a booth and getting an answer about an invented check-in
    // desk is the kind of confident wrong answer that costs trust.
    if (project.interaction) return this.simulateInteraction(project);
    const scn = resolveScenarioBindings(project, ensureScenario(project, participants));
    if (!scn.stations.length) {
      return routeWalkSummary(project, participants);
    }
    const result = runDiscreteEvent(scn, { sampleDt: 2 });
    const bottlenecks = result.stations
      .filter((s) => s.maxQueue >= 3)
      .map((s) => {
        const st = scn.stations.find((x) => x.id === s.stationId)!;
        return { x: st.x, z: st.z, count: s.maxQueue, name: s.name };
      });
    return {
      available: true,
      participants: result.participantCount,
      bottleneckCount: bottlenecks.length,
      bottlenecks,
      message: result.summaryLines.join(" "),
      result,
      scenarioId: scn.id,
    };
  },

  /** The plan's own interaction flow, run and summarised the same way. */
  simulateInteraction(project: Project): SimulationSummary {
    const template = project.interaction;
    if (!template) {
      return { available: false, reason: "no-interaction", message: "這份計畫沒有互動流程。" };
    }
    const bound = resolveTemplateBindings(project, template);
    const result = runInteraction(bound, { sampleDt: 5 });
    const bottlenecks = result.stations
      .filter((s) => s.maxQueue >= 3)
      .map((s) => {
        const st = bound.stations.find((x) => x.id === s.stationId);
        return { x: st?.x ?? 0, z: st?.z ?? 0, count: s.maxQueue, name: s.name };
      });
    return {
      available: true,
      participants: result.participantCount,
      bottleneckCount: bottlenecks.length,
      bottlenecks,
      message: result.summaryLines.join(" "),
      result,
      scenarioId: bound.id,
    };
  },

  createServiceStation(
    project: Project,
    args: {
      type?: StationType;
      name?: string;
      x?: number;
      z?: number;
      staffCount?: number;
      meanServiceSeconds?: number;
      objectId?: string;
      zoneId?: string;
    } = {},
  ): StationMutationResult {
    const scn = ensureScenarioInProject(project);
    const type: StationType = args.type ?? "custom";
    const station: ServiceStation = {
      id: uid("stn"),
      name: args.name ?? type,
      type,
      x: args.x ?? project.classroom.x + 2,
      z: args.z ?? project.classroom.z + 2,
      staffCount: args.staffCount ?? 1,
      parallelServers: args.staffCount ?? 1,
      meanServiceSeconds: args.meanServiceSeconds ?? 30,
      queueCapacity: 30,
      objectId: args.objectId,
      zoneId: args.zoneId,
    };
    scn.stations = [...scn.stations, station];
    // Append to all profile branches by default.
    scn.profiles = scn.profiles.map((p) => ({
      ...p,
      branch: [...p.branch, station.id],
    }));
    project.scenarios = project.scenarios.map((s) => (s.id === scn.id ? { ...scn } : s));
    return {
      available: true,
      station,
      scenarioId: scn.id,
      message: `已新增站點「${station.name}」。`,
    };
  },

  updateServiceStation(
    project: Project,
    args: {
      stationId: string;
      name?: string;
      staffCount?: number;
      parallelServers?: number;
      meanServiceSeconds?: number;
      x?: number;
      z?: number;
      queueCapacity?: number;
    },
  ): StationMutationResult | SimulationSummaryUnavailable {
    const scn =
      (project.activeScenarioId &&
        project.scenarios.find((s) => s.id === project.activeScenarioId)) ||
      project.scenarios[0];
    if (!scn) {
      return {
        available: false,
        reason: "no-scenario",
        message: "尚無活動流程，請先建立預設情境。",
      };
    }
    const idx = scn.stations.findIndex((s) => s.id === args.stationId);
    if (idx < 0) {
      return {
        available: false,
        reason: "station-not-found",
        message: `找不到站點 ${args.stationId}`,
      };
    }
    const prev = scn.stations[idx];
    const station: ServiceStation = {
      ...prev,
      name: args.name ?? prev.name,
      staffCount: args.staffCount ?? prev.staffCount,
      parallelServers: args.parallelServers ?? prev.parallelServers,
      meanServiceSeconds: args.meanServiceSeconds ?? prev.meanServiceSeconds,
      x: args.x ?? prev.x,
      z: args.z ?? prev.z,
      queueCapacity: args.queueCapacity ?? prev.queueCapacity,
    };
    scn.stations = scn.stations.map((s, i) => (i === idx ? station : s));
    project.scenarios = project.scenarios.map((s) => (s.id === scn.id ? { ...scn } : s));
    return {
      available: true,
      station,
      scenarioId: scn.id,
      message: `已更新站點「${station.name}」。`,
    };
  },

  compareScenarios(
    project: Project,
    participants?: number,
  ): {
    available: true;
    comparison: ScenarioVariantCompareResult;
    message: string;
  } {
    const base = resolveScenarioBindings(project, ensureScenario(project, participants));
    const { combined, separated, corridor } = buildCheckinPaymentVariants(base);
    const a = runScenarioMedian(combined, { sampleDt: 2 });
    const b = runScenarioMedian(separated, { sampleDt: 2 });
    const c = runScenarioMedian(corridor ?? separated, { sampleDt: 2 });
    const comparison = compareScenarioVariants(a, b, c);
    return {
      available: true,
      comparison,
      message: `A「${combined.name}」vs B「${separated.name}」：${comparison.reason}`,
    };
  },
};
