import { describe, expect, it } from "vitest";
import {
  enableDiagnostics,
  formatDiagnosticsText,
  getDiagnostics,
  isDiagnosticsEnabled,
  recordAgentTool,
  recordOptimization,
  recordSimulationTiming,
} from "../src/core/diagnostics";

describe("diagnostics", () => {
  it("stays quiet until enabled", () => {
    enableDiagnostics(false);
    expect(isDiagnosticsEnabled()).toBe(false);
    recordSimulationTiming(12);
    expect(getDiagnostics().simulationMs).toBeUndefined();
  });

  it("records timings when enabled", () => {
    enableDiagnostics(true);
    expect(isDiagnosticsEnabled()).toBe(true);
    recordSimulationTiming(18.5);
    recordOptimization(8, 120);
    recordAgentTool("simulateScenario", true, 40);
    const text = formatDiagnosticsText();
    expect(text).toMatch(/sim 18/);
    expect(text).toMatch(/opt 120/);
    expect(text).toMatch(/simulateScenario/);
    enableDiagnostics(false);
  });
});
