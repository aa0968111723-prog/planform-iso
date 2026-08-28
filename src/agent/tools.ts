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
  "createAssetFromCatalog",
  "createCustomAssetProxy",
  "createPropFromRecipe",
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
  "validateLayout",
  "measureGap",
  "simulateScenario",
  "compareScenarios",
  "previewAgentChanges",
  "commitAgentChanges",
  "rollbackAgentChanges",
]);

export function isAllowedTool(name: string): name is AgentToolName {
  return AGENT_TOOL_ALLOWLIST.has(name as AgentToolName);
}
