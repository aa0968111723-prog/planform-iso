/**
 * Event Flow Simulation adapter stub (PR #9 not merged).
 * Quick Agent tools call into this instead of embedding simulation core.
 */

export interface SimulationSummaryUnavailable {
  available: false;
  reason: "event-flow-pr-not-merged";
  message: string;
}

export const eventFlowAdapter = {
  available(): false {
    return false;
  },

  getSimulationSummary(): SimulationSummaryUnavailable {
    return {
      available: false,
      reason: "event-flow-pr-not-merged",
      message: "活動模擬核心尚未合併（PR #9）。場佈 / Validation 仍可用。",
    };
  },

  createServiceStation(): SimulationSummaryUnavailable {
    return this.getSimulationSummary();
  },

  updateServiceStation(): SimulationSummaryUnavailable {
    return this.getSimulationSummary();
  },

  simulateScenario(): SimulationSummaryUnavailable {
    return this.getSimulationSummary();
  },

  compareScenarios(): SimulationSummaryUnavailable {
    return this.getSimulationSummary();
  },
};
