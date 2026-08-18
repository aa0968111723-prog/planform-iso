/**
 * Allowlisted agent tools. Unknown tools are rejected by the executor.
 */

import type { AgentToolName } from "./types";

export const AGENT_TOOL_ALLOWLIST: ReadonlySet<AgentToolName> = new Set([
  "getProjectSummary",
  "getVenueGeometry",
  "listAssets",
  "getSelection",
  "getZones",
  "getRoutes",
  "getValidationIssues",
  "getSimulationSummary",
  "readScenario",
  "readSimulationResult",
  "createAssetFromCatalog",
  "createCustomAssetProxy",
  "requestAssetReconstruction",
  "importAsset",
  "updateAssetMetadata",
  "replaceAssetVisual",
  "placeAsset",
  "moveAsset",
  "rotateAsset",
  "duplicateAsset",
  "createArray",
  "updateArray",
  "createZone",
  "updateZone",
  "createRoute",
  "updateRoute",
  "createServiceStation",
  "updateServiceStation",
  "configureScenario",
  "splitPaymentFlow",
  "assignStaff",
  "validateLayout",
  "measureGap",
  "simulateScenario",
  "compareScenarios",
  "findBottlenecks",
  "generateLayoutCandidates",
  "optimizeEventFlow",
  "explainImprovement",
  "focusIssue",
  "previewAgentChanges",
  "commitAgentChanges",
  "rollbackAgentChanges",
]);

export function isAllowedTool(name: string): name is AgentToolName {
  return AGENT_TOOL_ALLOWLIST.has(name as AgentToolName);
}
