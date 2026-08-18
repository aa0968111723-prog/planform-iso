/**
 * Event Flow / Simulation adapter.
 *
 * PR #10 landed a lightweight route-walking simulation in `core/simulation.ts`.
 * Full Event Flow service-station discrete-event core (PR #9 plan) is still a
 * separate deeper model — expose what exists today to Quick Agent tools.
 */

import {
  agentPositions,
  detectBottlenecks,
  initSimulation,
  stepSimulation,
  type SimParams,
} from "../core/simulation";
import type { Project } from "../core/model";

export interface SimulationSummaryAvailable {
  available: true;
  participants: number;
  routeCount: number;
  bottleneckCount: number;
  bottlenecks: { x: number; z: number; count: number }[];
  message: string;
}

export interface SimulationSummaryUnavailable {
  available: false;
  reason: string;
  message: string;
}

export type SimulationSummary = SimulationSummaryAvailable | SimulationSummaryUnavailable;

export const eventFlowAdapter = {
  available(): boolean {
    return true;
  },

  getSimulationSummary(project?: Project, participants = 60): SimulationSummary {
    if (!project) {
      return {
        available: false,
        reason: "no-project",
        message: "沒有專案可模擬。",
      };
    }
    const routes = project.routes.filter((r) => r.visible && r.points.length >= 2);
    if (routes.length === 0) {
      return {
        available: false,
        reason: "no-routes",
        message: "尚無可用動線。先在「動線」建立路徑再模擬。",
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
        ? `模擬 ${participants} 人：發現 ${bottlenecks.length} 處可能壅塞。`
        : `模擬 ${participants} 人：目前未偵測到明顯壅塞。`,
    };
  },

  createServiceStation(): SimulationSummaryUnavailable {
    return {
      available: false,
      reason: "service-station-not-in-core",
      message: "服務站點離散事件模型尚未落地；請用報到/收費桌 + 動線先布置。",
    };
  },

  updateServiceStation(): SimulationSummaryUnavailable {
    return this.createServiceStation();
  },

  simulateScenario(project: Project, participants: number): SimulationSummary {
    return this.getSimulationSummary(project, participants);
  },

  compareScenarios(): SimulationSummaryUnavailable {
    return {
      available: false,
      reason: "scenario-compare-not-in-core",
      message: "多方案比較尚未落地；可手動複製專案後分別模擬。",
    };
  },
};
